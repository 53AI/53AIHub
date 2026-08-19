import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Collapse, Empty, Spin } from "antd";
import { CloseOutlined, DownOutlined, UpOutlined } from "@ant-design/icons";
import openclawApi from "@/api/modules/openclaw";
import { t } from "@/locales";
import { getPublicPath } from "@/utils/config";
import { getOpenClawPayload } from "@km/shared-business/chat";
import {
  type OpenClawConnectionState,
  getOpenClawInputDisabledReason,
  getOpenClawGatewayDisplayName,
  getOpenClawHostKind,
  isOpenClawGatewayUnavailableError,
} from "../openclaw-status";

export { formatOpenClawGatewayName } from "../openclaw-status";

interface OpenClawPanelProps {
  agentId: string | number;
  open: boolean;
  status: Record<string, any> | null;
  connectionState: OpenClawConnectionState;
  statusLoading?: boolean;
  onRefreshStatus?: (options?: { showLoading?: boolean }) => Promise<unknown>;
  onClose: () => void;
}

interface PanelState {
  config: Record<string, any> | null;
  skills: Record<string, any> | null;
  cronTasks: Record<string, any> | null;
  detailLoading: boolean;
  error: string;
}

type OpenClawTaskState = "executed" | "disabled" | "pending";

const QCLAW_LOGO = "/images/vibe/openclaw-panel/qclaw-logo.svg";
const OPENCLAW_LOGO = "/images/vibe/openclaw-panel/openclaw-logo.svg";
const OVERVIEW_ICON = "/images/vibe/openclaw-panel/overview.svg";
const MODEL_ICON = "/images/vibe/openclaw-panel/model.svg";
const CRON_ICON = "/images/vibe/openclaw-panel/cron.svg";
const SKILLS_ICON = "/images/vibe/openclaw-panel/skills.svg";
const VERSION_ICON = "/images/vibe/openclaw-panel/version.svg";
const SKILL_ITEM_ICON = "/images/vibe/openclaw-panel/skill-item.svg";

function textValue(value: unknown, fallback = "-") {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value ? t("openclaw.panel.yes") : t("openclaw.panel.no");
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function readList(payload: any, keys: string[]) {
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function readString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function getOpenClawErrorMessage(error: unknown, gatewayName = "OpenClaw") {
  if (isOpenClawGatewayUnavailableError(error)) {
    return getOpenClawInputDisabledReason("disconnected", gatewayName, t);
  }
  return error instanceof Error ? error.message : t("openclaw.panel.info_load_failed");
}

function getOpenClawGatewayLogo(hostKind?: unknown) {
  return String(hostKind || "").trim().toLowerCase() === "qclaw" ? QCLAW_LOGO : OPENCLAW_LOGO;
}

function formatDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const lang = typeof window === "undefined" ? "zh-cn" : localStorage.getItem("default_lang");
  const locale = lang === "en" ? "en-US" : lang === "zh-tw" ? "zh-TW" : lang === "ja" || lang === "jp" ? "ja-JP" : "zh-CN";
  return date.toLocaleString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDurationFrom(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const totalMinutes = Math.max(1, Math.floor((Date.now() - date.getTime()) / 60000));
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function SectionTitle({
  iconSrc,
  title,
}: {
  iconSrc: string;
  title: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-7 items-center justify-center rounded-full bg-[#F6F7FB]">
        <img className="size-4" src={getPublicPath(iconSrc)} alt={title} />
      </span>
      <span className="text-[15px] font-semibold text-[#3F4248]">{title}</span>
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg bg-[#F7F8FA] px-4 py-3">
      <div className="text-xs text-[#AFB5C3]">{label}</div>
      <div className={`mt-2 text-sm font-semibold ${highlight ? "text-[#19C37D]" : "text-[#31343A]"}`}>
        {value}
      </div>
    </div>
  );
}

function ConnectionBadge({ connectionState }: { connectionState: OpenClawConnectionState }) {
  const connected = connectionState === "connected";
  const checking = connectionState === "checking";
  return (
    <span
      className={`rounded px-2 py-1 text-xs font-medium ${
        connected
          ? "bg-[#E9FFF3] text-[#19B873]"
          : checking
            ? "bg-[#F4F6FA] text-[#7A8494]"
            : "bg-[#FFF1F1] text-[#FF5A5F]"
      }`}
    >
      • {connected ? t("openclaw.panel.connected") : checking ? t("openclaw.panel.checking") : t("openclaw.panel.disconnected")}
    </span>
  );
}

function getTaskState(task: any): OpenClawTaskState {
  if (task?.status === "completed" || task?.lastRunAt || task?.last_run_at) return "executed";
  if (task?.enabled === false || task?.status === "disabled") return "disabled";
  return "pending";
}

function getTaskLabel(state: OpenClawTaskState) {
  if (state === "executed") return t("openclaw.panel.executed");
  if (state === "disabled") return t("openclaw.panel.disabled");
  return t("openclaw.panel.pending");
}

function getTaskBadgeClass(state: OpenClawTaskState) {
  if (state === "executed") return "bg-[#EFFFF4] text-[#20B970]";
  if (state === "disabled") return "bg-[#F4F6FA] text-[#A0A7B5]";
  return "bg-[#FFF8E6] text-[#E8A600]";
}

export default function OpenClawPanel({
  agentId,
  open,
  status,
  connectionState,
  statusLoading = false,
  onRefreshStatus,
  onClose,
}: OpenClawPanelProps) {
  const detailLoadedRef = useRef(false);
  const detailLoadingRef = useRef(false);
  const detailRequestSeqRef = useRef(0);
  const [state, setState] = useState<PanelState>({
    config: null,
    skills: null,
    cronTasks: null,
    detailLoading: false,
    error: "",
  });
  const [activeKeys, setActiveKeys] = useState<string[]>([]);
  const hostKind = getOpenClawHostKind(status, state.config);
  const gatewayName = getOpenClawGatewayDisplayName(status, state.config);

  const loadDetails = useCallback(async () => {
    if (!agentId) return;
    if (detailLoadedRef.current || detailLoadingRef.current) return;
    const requestSeq = detailRequestSeqRef.current + 1;
    detailRequestSeqRef.current = requestSeq;
    detailLoadingRef.current = true;
    setState((prev) => ({ ...prev, detailLoading: true, error: "" }));
    try {
      const [configRes, skillsRes, cronTasksRes] = await Promise.all([
        openclawApi.config(agentId, { ignoreMessage: true }),
        openclawApi.skills(agentId, { ignoreMessage: true }),
        openclawApi.cronTasks(agentId, { limit: 10 }, { ignoreMessage: true }),
      ]);
      if (detailRequestSeqRef.current !== requestSeq) return;

      detailLoadedRef.current = true;
      setState((prev) => ({
        ...prev,
        config: getOpenClawPayload(configRes),
        skills: getOpenClawPayload(skillsRes),
        cronTasks: getOpenClawPayload(cronTasksRes),
        detailLoading: false,
        error: "",
      }));
    } catch (error) {
      if (detailRequestSeqRef.current !== requestSeq) return;
      setState((prev) => ({
        ...prev,
        detailLoading: false,
        error: getOpenClawErrorMessage(error, gatewayName),
      }));
    } finally {
      if (detailRequestSeqRef.current === requestSeq) {
        detailLoadingRef.current = false;
      }
    }
  }, [agentId, gatewayName]);

  useEffect(() => {
    if (open) {
      detailRequestSeqRef.current += 1;
      detailLoadedRef.current = false;
      detailLoadingRef.current = false;
      setState({
        config: null,
        skills: null,
        cronTasks: null,
        detailLoading: false,
        error: "",
      });
      void onRefreshStatus?.({ showLoading: true });
    }
  }, [agentId, onRefreshStatus, open]);

  const connected = connectionState === "connected";

  useEffect(() => {
    if (!open) return;
    setActiveKeys(connected ? ["overview", "model", "cron", "skills"] : []);
    if (connected) {
      void loadDetails();
    }
  }, [connected, loadDetails, open]);

  const skills = useMemo(
    () => readList(state.skills, ["enabledSkills", "skills", "items"]),
    [state.skills]
  );
  const cronTasks = useMemo(
    () => readList(state.cronTasks, ["cronTasks", "tasks", "items"]),
    [state.cronTasks]
  );

  const isWorkBuddy = hostKind === "workbuddy";
  const isCodex = hostKind === "codex";
  const workerStatus = status?.workerStatus || state.config?.workbuddy?.workerStatus || {};
  const workbuddyConfig = state.config?.workbuddy || {};
  const codexConfig = state.config?.codex || {};
  const codexWorkspaceRoot = readString(
    status?.workspaceRoot,
    status?.codex?.workspaceRoot,
    status?.workspace?.workspaceRoot,
    status?.workspace?.codex_workspace_root,
    codexConfig?.workspaceRoot
  );
  const workerCount = Number(status?.workerCount ?? workbuddyConfig?.workers?.length ?? 0);
  const cronTotal = Number(status?.cronScheduler?.jobCount ?? cronTasks.length);
  const enabledCronCount = cronTasks.length
    ? cronTasks.filter((task: any) => task?.enabled !== false && task?.status !== "disabled").length
    : cronTotal;
  const modelName =
    readString(
      state.config?.model?.requestModelName,
      state.config?.model?.name,
      state.config?.modelName,
      status?.requestModelName,
      status?.modelPrimary,
      workbuddyConfig?.model,
      workbuddyConfig?.requestModelName,
      codexConfig?.model
    ) ||
    state.config?.model?.name ||
    state.config?.modelName ||
    status?.modelPrimary ||
    (isWorkBuddy ? t("openclaw.panel.auto") : isCodex ? t("openclaw.panel.codex_decides") : "modelroute");
  const maxContext =
    state.config?.model?.maxContext ||
    state.config?.model?.max_context ||
    state.config?.maxContext ||
    codexConfig?.maxContext ||
    (isCodex ? t("openclaw.panel.codex_decides") : undefined) ||
    (isWorkBuddy ? t("openclaw.panel.workbuddy_decides") : "200k token");
  const expertName = readString(
    status?.expertName,
    status?.expertId,
    workbuddyConfig?.expertName,
    workbuddyConfig?.expertId,
  ) || "-";
  const permissionMode = readString(status?.permissionMode, workbuddyConfig?.permissionMode) || "-";
  const gatewayLogo = getOpenClawGatewayLogo(hostKind);

  const collapseItems = [
    {
      key: "overview",
      label: <SectionTitle iconSrc={OVERVIEW_ICON} title={t("openclaw.panel.overview")} />,
      children: (
        <div className="px-1 pb-1">
          <div className="text-xs font-medium text-[#BEC4D0]">{t("openclaw.panel.snapshot")}</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <StatCard label={t("openclaw.panel.status")} value={status?.healthy ? t("openclaw.panel.normal") : t("openclaw.panel.abnormal")} highlight={status?.healthy} />
            {isWorkBuddy ? (
              <>
                <StatCard
                  label="Worker"
                  value={`${workerStatus?.sharedSessionActive ? t("openclaw.panel.activated") : t("openclaw.panel.inactive")} / ${workerCount ? t("openclaw.panel.worker_count", { count: workerCount }) : "-"}`}
                  highlight={Boolean(workerStatus?.sharedSessionActive)}
                />
                <StatCard label={t("openclaw.panel.session")} value={textValue(workerStatus?.sharedSessionId || workbuddyConfig?.sessionId)} />
                <StatCard label={t("openclaw.panel.endpoint")} value={textValue(workerStatus?.endpoint || workbuddyConfig?.workerEndpoint)} />
              </>
            ) : isCodex ? (
              <>
                <StatCard label={t("openclaw.panel.uptime")} value={formatDurationFrom(status?.lastConnectedAt || status?.hub53ai?.lastConnectedAt)} />
                <StatCard label={t("openclaw.panel.workspace_root")} value={textValue(codexWorkspaceRoot || codexConfig?.workspaceRoot, "~/.53ai/codex-workspaces")} />
                <StatCard label={t("openclaw.panel.last_heartbeat")} value={formatDateTime(status?.lastHeartbeatAt || status?.hub53ai?.lastHeartbeatAt)} />
              </>
            ) : (
              <>
                <StatCard label={t("openclaw.panel.uptime")} value={formatDurationFrom(status?.hub53ai?.lastConnectedAt)} />
                <StatCard label={t("openclaw.panel.tick_interval")} value="30s" />
                <StatCard label={t("openclaw.panel.last_heartbeat")} value={formatDateTime(status?.hub53ai?.lastHeartbeatAt)} />
              </>
            )}
          </div>
          <div className="mt-3 text-xs leading-5 text-[#C0C6D2]">
            {isWorkBuddy
              ? t("openclaw.panel.workbuddy_api", { value: textValue(workbuddyConfig?.mainEndpoint || workerStatus?.mainEndpoint) })
              : isCodex
                ? t("openclaw.panel.codex_app_server", { value: textValue(status?.runnerCommand || state.config?.gateway?.runnerCommand, "codex-app-server") })
              : t("openclaw.panel.channel_connection_desc")}
          </div>
          <div className="mt-5 text-xs font-medium text-[#BEC4D0]">{t("openclaw.panel.version")}</div>
          <div className="mt-3 flex items-center gap-3 rounded-lg bg-[#F7F8FA] px-4 py-3">
            <span className="flex size-8 items-center justify-center rounded-full bg-[#5AA7FF] text-white">
              <img className="size-4" src={getPublicPath(VERSION_ICON)} alt={t("openclaw.panel.current_version")} />
            </span>
            <span className="flex-1 text-sm font-semibold text-[#3F4248]">{t("openclaw.panel.current_version")}</span>
            <span className="text-xs font-medium text-[#AEB5C2]">
              {textValue(
                status?.workbuddyVersion ||
                  workbuddyConfig?.version ||
                  status?.codexVersion ||
                  codexConfig?.version ||
                  status?.serviceVersion ||
                  status?.pluginVersion,
                "v2025.4.21"
              )}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: "model",
      label: <SectionTitle iconSrc={MODEL_ICON} title={t("openclaw.panel.model")} />,
      children: (
        <div className="grid grid-cols-2 gap-2 px-1 pb-1">
          <StatCard label={t("openclaw.panel.model_name")} value={textValue(modelName)} />
          <StatCard label={t("openclaw.panel.max_context")} value={textValue(maxContext)} />
          {isWorkBuddy && <StatCard label="Expert" value={textValue(expertName)} />}
          {isWorkBuddy && <StatCard label={t("openclaw.panel.permission_mode")} value={textValue(permissionMode)} />}
        </div>
      ),
    },
    {
      key: "cron",
      label: <SectionTitle iconSrc={CRON_ICON} title={t("openclaw.panel.cron_tasks")} />,
      children: (
        <div className="px-1 pb-1">
          <div className="text-xs font-medium text-[#BEC4D0]">{t("openclaw.panel.task_overview")}</div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <StatCard label={t("openclaw.panel.total_tasks")} value={cronTotal} />
            <StatCard label={t("openclaw.panel.enabled")} value={enabledCronCount} highlight={enabledCronCount > 0} />
            <StatCard label={t("openclaw.panel.disabled")} value={Math.max(cronTotal - enabledCronCount, 0)} />
          </div>

          <div className="mt-4 text-xs font-medium text-[#BEC4D0]">{t("openclaw.panel.enabled_section")}</div>
          <div className="mt-3 space-y-3">
            {cronTasks.length > 0 ? (
              cronTasks.map((task: any, index: number) => {
                const taskState = getTaskState(task);
                const label = getTaskLabel(taskState);
                return (
                  <div key={task?.id || index} className="rounded-xl border border-[#EEF0F5] bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[#3F4248]">
                          {textValue(task?.title || task?.name || task?.id, t("openclaw.panel.task_fallback", { index: index + 1 }))}
                        </div>
                        <div className="mt-2 text-xs leading-5 text-[#AEB5C2]">
                          {t("openclaw.panel.frequency", { value: textValue(task?.frequency || task?.schedule || task?.cron, t("openclaw.panel.every_day")) })}
                          <br />
                          {t("openclaw.panel.last_run", { value: textValue(task?.lastRunAt || task?.last_run_at, t("openclaw.panel.no_record")) })}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded px-2 py-1 text-xs ${getTaskBadgeClass(taskState)}`}>{label}</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("openclaw.panel.no_cron_tasks")} />
            )}
          </div>
        </div>
      ),
    },
    {
      key: "skills",
      label: <SectionTitle iconSrc={SKILLS_ICON} title={t("openclaw.panel.skills")} />,
      children: (
        <div className="openclaw-skills-scroll max-h-[320px] space-y-2 overflow-y-auto px-1 pb-1 pr-2">
          {skills.length > 0 ? (
            skills.map((item: any, index: number) => {
              const title = typeof item === "string" ? item : textValue(item?.display_name || item?.title || item?.name || item?.skill_name || item?.id);
              const subtitle = typeof item === "string" ? item : textValue(item?.skill_id || item?.id || item?.description, "");
              return (
                <div key={`${title}-${index}`} className="flex items-center gap-3 rounded-xl bg-[#F7F8FA] px-4 py-3">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-white">
                    <img className="size-6" src={getPublicPath(SKILL_ITEM_ICON)} alt={t("openclaw.panel.skill_icon", { title })} />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[#3F4248]">{title}</div>
                    {subtitle && <div className="mt-1 truncate text-xs text-[#9CA3B0]">{subtitle}</div>}
                  </div>
                </div>
              );
            })
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("openclaw.panel.no_skills")} />
          )}
        </div>
      ),
    },
  ];

  if (!open) return null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="h-16 flex items-center justify-between px-5 border-b">
        <h4 className="text-lg text-primary">{t("openclaw.panel.settings")}</h4>
        <button
          type="button"
          aria-label={t("openclaw.panel.close_settings")}
          className="flex-center size-6 rounded cursor-pointer border-0 bg-transparent p-0 hover:bg-[#ECEDEE]"
          onClick={onClose}
        >
          <CloseOutlined />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {state.error && <Alert className="mb-3" type="warning" showIcon message={state.error} />}
        <Spin spinning={statusLoading || state.detailLoading}>
          <div className="space-y-2">
            <div className="flex h-12 items-center gap-3 rounded-xl border border-[#EEF0F5] bg-white px-4">
              <span className="flex size-8 items-center justify-center rounded-full bg-[#F7F8FA]">
                <img className="size-[18px]" src={getPublicPath(gatewayLogo)} alt={gatewayName} />
              </span>
              <span className="flex-1 text-[15px] font-semibold text-[#3F4248]">{gatewayName}</span>
              <ConnectionBadge connectionState={connectionState} />
            </div>

            {connectionState === "disconnected" && (
              <Alert
                className="mb-2"
                type="warning"
                showIcon
                message={getOpenClawInputDisabledReason(connectionState, gatewayName, t)}
              />
            )}

            <Collapse
              bordered={false}
              activeKey={activeKeys}
              onChange={(keys) => setActiveKeys(Array.isArray(keys) ? keys.map(String) : [String(keys)])}
              expandIcon={({ isActive }) =>
                isActive ? <UpOutlined className="text-[#C9CED8]" /> : <DownOutlined className="text-[#C9CED8]" />
              }
              expandIconPosition="end"
              className="bg-transparent [&_.ant-collapse-content-box]:!px-4 [&_.ant-collapse-content-box]:!pb-4 [&_.ant-collapse-content-box]:!pt-0 [&_.ant-collapse-header]:!items-center [&_.ant-collapse-header]:!px-4 [&_.ant-collapse-header]:!py-3 [&_.ant-collapse-item:last-child]:!border-b [&_.ant-collapse-item:last-child]:!border-b-[#EEF0F5] [&_.ant-collapse-item]:!mb-2 [&_.ant-collapse-item]:!rounded-xl [&_.ant-collapse-item]:!border [&_.ant-collapse-item]:!border-[#EEF0F5] [&_.ant-collapse-item]:!bg-white"
              items={collapseItems}
            />
          </div>
        </Spin>
      </div>
    </div>
  );
}
