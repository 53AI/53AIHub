import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DownOutlined, UpOutlined } from "@ant-design/icons";
import { Popover } from "antd";
import type { ChatCompletionParams, IAgentInfo } from "../../adapters/types";
// unify-chat-adapters：ChatPluginProvider 已删除，所有 adapter 合并到 ChatConfigProvider.adapters。
import { ChatConfigProvider, type Lang } from "../../i18n";
import { useConversationStore } from "../../stores";
import { ChatView } from "../ChatView";
import {
  buildOpenClawConversation,
  createOpenClawConversationApiAdapter,
  getOpenClawPayload,
  type OpenClawApiLike,
  type OpenClawSession,
} from "../../utils/openclaw-adapter";
import "./style.css";

interface UploadedFileLike {
  id: string | number;
  url?: string;
  name?: string;
  file_name?: string;
  size?: number;
  file_size?: number;
  mime_type?: string;
  preview_key?: string;
}

export interface OpenClawPreviewWorkspaceProps {
  agentId: string | number;
  agentInfo: IAgentInfo;
  className?: string;
  apiHost: string;
  openclawApi: OpenClawApiLike;
  completions: (
    params: ChatCompletionParams,
    options: {
      responseType: "stream";
      onDownloadProgress: (e: any) => void;
      signal?: AbortSignal;
    }
  ) => Promise<any>;
  uploadFile?: (file: File) => Promise<UploadedFileLike>;
  getPublicPath?: (path: string) => string;
  lang?: Lang;
  requestSource?: string;
  boxClassName?: string
}

const OPENCLAW_HISTORY_FETCH_LIMIT = 20;
const OPENCLAW_CONNECTED_STATUSES = ["connected", "running", "healthy", "ok"];
const DEFAULT_OPENCLAW_LOGO = "/images/vibe/openclaw.svg";

function readOpenClawCurrentSession(response: any): OpenClawSession | null {
  const payload = getOpenClawPayload(response);
  const candidate = payload?.session || payload?.conversation || payload;
  if (!candidate || typeof candidate !== "object") return null;

  const id = candidate.id || candidate.session_id || candidate.sessionId || candidate.conversation_id || candidate.conversationId;
  if (typeof id !== "string" || !id.trim()) return null;

  return {
    ...(candidate as OpenClawSession),
    id,
  };
}

function isHubManagedOpenClawSession(session: OpenClawSession) {
  const title = String(session.title || "").trim();
  if (!title) return true;
  return title.startsWith("53AI Hub-") || title.startsWith("53AIHub ") || title.startsWith("53AIHub:") || title.startsWith("53AIHub-");
}

function isOpenClawStatusHealthy(payload: any) {
  const hubStatus = String(payload?.hub53ai?.connectionStatus || payload?.connectionStatus || "").toLowerCase();
  return Boolean(payload?.connectionHealthy === true || OPENCLAW_CONNECTED_STATUSES.includes(hubStatus));
}

function formatOpenClawGatewayName(value: unknown) {
  const hostKind = String(value || "").toLowerCase();
  if (hostKind === "qclaw") return "QClaw";
  if (hostKind === "codex") return "Codex";
  if (hostKind === "manus") return "Manus";
  if (hostKind === "hermes") return "Hermes";
  return "OpenClaw";
}

function getOpenClawGatewayDisplayName(payload: any, agentInfo?: any) {
  const customConfig = agentInfo?.custom_config_obj || agentInfo?.custom_config || {};
  return formatOpenClawGatewayName(
    payload?.hostKind ||
    payload?.host_kind ||
    payload?.gateway?.hostKind ||
    payload?.gateway?.host_kind ||
    payload?.hub53ai?.hostKind ||
    payload?.hub53ai?.host_kind ||
    customConfig?.hostKind ||
    customConfig?.host_kind ||
    customConfig?.agent_type ||
    agentInfo?.hostKind ||
    agentInfo?.host_kind ||
    agentInfo?.agent_type
  );
}

function getOpenClawInputDisabledReason(healthy: boolean | null, gatewayName = "OpenClaw") {
  return healthy === null ? `正在检测 ${gatewayName} 连接...` : `${gatewayName} 插件未连接，正在重连...`;
}

function readOpenClawSessions(response: any): OpenClawSession[] {
  const payload = getOpenClawPayload(response);
  return Array.isArray(payload.sessions) ? payload.sessions : [];
}

export function OpenClawPreviewWorkspace({
  agentId,
  agentInfo,
  className,
  apiHost,
  openclawApi,
  completions,
  uploadFile,
  getPublicPath = (path: string) => path,
  lang,
  requestSource = "web",
  boxClassName = ""
}: OpenClawPreviewWorkspaceProps) {
  const addConversation = useConversationStore((state) => state.addConversation);
  const setCurrentState = useConversationStore((state) => state.setCurrentState);
  const clearCurrentState = useConversationStore((state) => state.clearCurrentState);
  const selectedConversationId = useConversationStore((state) => state.current_conversationid);
  const sharedConversations = useConversationStore((state) => state.conversations);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [conversationCache, setConversationCache] = useState<any[]>([]);
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [statusPayload, setStatusPayload] = useState<any>(null);
  const [initialConversationId, setInitialConversationId] = useState<string | number | undefined>();
  const [currentResolving, setCurrentResolving] = useState(false);
  const loadedAgentKeyRef = useRef<string>("");

  const agentIdKey = String(agentId || "");
  const currentConv = useMemo(() => {
    const current = [...sharedConversations, ...conversationCache].find(
      (item) => String(item?.conversation_id || "") === String(selectedConversationId || "")
    );
    return current;
  }, [conversationCache, selectedConversationId, sharedConversations]);

  const currentAgentInfo = useMemo(
    () => ({
      ...agentInfo,
      logo: agentInfo.logo || getPublicPath(DEFAULT_OPENCLAW_LOGO),
    }),
    [agentInfo, getPublicPath]
  );

  const conversationApi = useMemo(
    () =>
      createOpenClawConversationApiAdapter({
        agentId,
        openclawApi,
        completions,
        requestSource,
        canonicalOnly: true,
      }),
    [agentId, completions, openclawApi, requestSource]
  );

  // unify-chat-adapters：原 ChatPluginProvider 已被并入 ChatConfigProvider。
  // 所有 adapter 合并到单个对象里传。
  // 注：uploadApi / workflowApi 在 OpenClaw 预览场景下没有真实实现，不注入占位（no-op），
  // 让 useChatSend/useWorkflowSend 在错误路径上 throw actionable 错误，而不是
  // 静默吞掉 { data: null } 再被 JSON.parse 炸掉。
  const adapters = useMemo(
    () => ({
      conversationApi,
      agentApi: {
        detail: async () => currentAgentInfo,
        list: async () => [],
        myDetail: async () => currentAgentInfo,
        myList: async () => [],
      },
    }),
    [conversationApi, currentAgentInfo]
  );

  // unify-chat-adapters：pluginConfig 已被 ChatView 移除依赖，
  // 这里仅保留 features 元数据供 ChatView 内部使用（如有）。
  // 当前 ChatView 不再消费 pluginConfig，因此本块不再需要。

  const loadConversationPage = useCallback(async () => {
    if (!agentIdKey) return;
    setHistoryLoading(true);
    try {
      const response = await openclawApi.conversations(agentId, { limit: OPENCLAW_HISTORY_FETCH_LIMIT, offset: 0 });
      const page = readOpenClawSessions(response).map((session) => buildOpenClawConversation(session, agentId));
      setConversationCache(page);
    } catch (error) {
      console.error("Failed to load OpenClaw conversations:", error);
    } finally {
      setHistoryLoading(false);
    }
  }, [agentId, agentIdKey, openclawApi]);

  useEffect(() => {
    if (!agentIdKey) return;
    if (!openclawApi.status) {
      setHealthy(true);
      return;
    }

    let disposed = false;
    setHealthy(null);
    setStatusPayload(null);
    openclawApi
      .status(agentId, { ignoreMessage: true })
      .then((response) => {
        if (disposed) return;
        const payload = getOpenClawPayload(response);
        setStatusPayload(payload);
        setHealthy(isOpenClawStatusHealthy(payload));
      })
      .catch(() => {
        if (disposed) return;
        setStatusPayload(null);
        setHealthy(false);
      });

    return () => {
      disposed = true;
    };
  }, [agentId, agentIdKey, openclawApi]);

  useEffect(() => {
    if (!agentIdKey || healthy !== true || !openclawApi.currentConversation) return;
    if (loadedAgentKeyRef.current === agentIdKey) return;

    let disposed = false;
    loadedAgentKeyRef.current = agentIdKey;
    setCurrentResolving(true);
    openclawApi
      .currentConversation(agentId)
      .then((response) => {
        if (disposed) return;
        const session = readOpenClawCurrentSession(response);
        if (!session || !isHubManagedOpenClawSession(session)) {
          setInitialConversationId(undefined);
          return;
        }
        const conversation = buildOpenClawConversation(session, agentId);
        addConversation(conversation);
        setCurrentState(agentId, conversation.conversation_id);
        setInitialConversationId(conversation.conversation_id);
      })
      .catch((error) => {
        console.error("Failed to resolve current OpenClaw conversation:", error);
        setInitialConversationId(undefined);
      })
      .finally(() => {
        if (!disposed) setCurrentResolving(false);
      });

    return () => {
      disposed = true;
    };
  }, [addConversation, agentId, agentIdKey, healthy, openclawApi, setCurrentState]);

  useEffect(() => {
    if (historyOpen) void loadConversationPage();
  }, [historyOpen, loadConversationPage]);

  useEffect(() => {
    return () => {
      clearCurrentState();
      loadedAgentKeyRef.current = "";
    };
  }, [clearCurrentState]);

  const handleConversationSelect = useCallback(
    (conversation: any) => {
      setCurrentState(agentId, conversation.conversation_id);
      setHistoryOpen(false);
    },
    [agentId, setCurrentState]
  );

  const uploadRequest = useCallback(
    async (file: File) => {
      if (!uploadFile) return {};
      const res = await uploadFile(file);
      return {
        id: res.id,
        url: res.url || `${apiHost}/api/preview/${res.preview_key || ""}`,
        name: res.name || res.file_name,
        size: res.size || res.file_size,
        mime_type: res.mime_type,
        preview_key: res.preview_key,
      };
    },
    [apiHost, uploadFile]
  );

  const acceptTypes = useMemo(() => {
    let accept = "";
    const settingsObj = currentAgentInfo.settings_obj || {};
    if (settingsObj.file_parse?.enable) {
      accept += ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.html,.json,.xml,.md";
    }
    if (settingsObj.image_parse?.enable) {
      accept += ",image/*";
    }
    return accept || "*/*";
  }, [currentAgentInfo]);

  const features = useMemo(
    () => ({
      history: false,
      newConversation: false,
      languageSwitcher: false,
      fileUpload: Boolean(currentAgentInfo.settings_obj?.file_parse?.enable || currentAgentInfo.settings_obj?.image_parse?.enable),
      guide: true,
      share: false,
      messageMenu: true,
      skipInitialLoad: false,
      enableDragUpload: true,
      allowMultiple: true,
      allowSendWithFiles: false,
      enablePasteUpload: true,
      openclaw: true,
      openclawInputDisabled: healthy !== true,
      openclawInputDisabledReason: healthy !== true
        ? getOpenClawInputDisabledReason(healthy, getOpenClawGatewayDisplayName(statusPayload, currentAgentInfo))
        : undefined,
      initialConversationResolving: healthy === null || currentResolving,
      showWelcome: true,
      indexWelcomeLayout: false,
    }),
    [currentAgentInfo, currentResolving, healthy, statusPayload]
  );

  const renderHeader = useCallback(() => {
    const gatewayName = getOpenClawGatewayDisplayName(statusPayload, currentAgentInfo);
    const statusText = healthy === true
      ? `${gatewayName} 已连接`
      : healthy === false
        ? `${gatewayName} 未连接`
        : `${gatewayName} 检测中`;
    const historyItems = conversationCache.length ? conversationCache : sharedConversations;

    return (
      <header className="flex-none h-[60px] border-b bg-white">
        <div className="openclaw-preview-header grid h-full items-center gap-3 px-4">
          <div className="openclaw-preview-header-title flex min-w-0 items-center text-base font-medium text-[#1F2123]">
            预览与调试
          </div>
          <div className="openclaw-preview-history-selector min-w-0 justify-self-center w-full max-w-[240px]">
            <Popover
              rootClassName="openclaw-history-popover-root"
              trigger="click"
              placement="bottom"
              open={historyOpen}
              onOpenChange={setHistoryOpen}
              arrow={false}
              overlayInnerStyle={{ padding: 0 }}
              content={
                <div className="openclaw-history-popover w-full rounded-[14px] bg-white p-3 shadow-[0_12px_30px_rgba(31,33,35,0.10)]">
                  {healthy !== true ? (
                    <div className="px-3 py-5 text-center text-sm text-[#A0A7B5]">
                      {getOpenClawInputDisabledReason(healthy, gatewayName)}
                    </div>
                  ) : historyItems.length > 0 ? (
                    <div className="max-h-[440px] overflow-y-auto pr-1">
                      {historyItems.map((item, index) => {
                        const selected = String(item.conversation_id) === String(selectedConversationId);
                        return (
                          <button
                            key={item.conversation_id || `openclaw-preview-conv-${index}`}
                            type="button"
                            className={`openclaw-history-row flex h-11 w-full items-center gap-3 rounded-[10px] px-3 text-left text-[15px] leading-5 transition ${
                              selected ? "bg-[#F4F5F7] text-[#2F3136]" : "text-[#2F3136] hover:bg-[#F7F8FA]"
                            }`}
                            onClick={() => handleConversationSelect(item)}
                          >
                            <span className="size-4 shrink-0 rounded-full border border-[#B8C2D2] text-center text-[10px] leading-[14px] text-[#6B7280]">#</span>
                            <span className="truncate">{item.title || "无标题会话"}</span>
                          </button>
                        );
                      })}
                      {historyLoading && (
                        <div className="px-3 py-2 text-center text-xs text-[#A0A7B5]">正在加载...</div>
                      )}
                    </div>
                  ) : (
                    <div className="px-3 py-5 text-center text-sm text-[#A0A7B5]">暂无历史会话</div>
                  )}
                </div>
              }
            >
              <button
                type="button"
                className="openclaw-history-trigger flex h-10 w-full min-w-0 items-center gap-3 rounded-[12px] border border-[#E6EBF2] bg-[#F5F7FA] px-4 text-left text-[15px] leading-5 text-[#2F3136] shadow-[0_2px_8px_rgba(31,33,35,0.04)] transition hover:bg-[#EEF1F5]"
              >
                <span className="size-4 shrink-0 rounded-full border border-[#6B7280] text-center text-[11px] leading-[14px] text-[#4B5563]">#</span>
                <span className="min-w-0 flex-1 truncate">
                  {selectedConversationId && currentConv ? currentConv.title || "当前会话" : "新对话"}
                </span>
                {historyOpen ? (
                  <UpOutlined className="shrink-0 text-xs text-[#333333]" />
                ) : (
                  <DownOutlined className="shrink-0 text-xs text-[#333333]" />
                )}
              </button>
            </Popover>
          </div>
          <div className="flex min-w-0 justify-end">
            <span
              className={`openclaw-preview-status-badge inline-flex max-w-full items-center rounded-md px-2.5 py-1 text-xs font-medium ${
                healthy === true
                  ? "bg-[#EAFBF1] text-[#24A860]"
                  : healthy === false
                    ? "bg-[#FFF1F0] text-[#D9363E]"
                    : "bg-[#F4F6FA] text-[#7A8494]"
              }`}
              title={statusText}
            >
              <span className="openclaw-preview-status-dot mr-1 text-sm leading-none">•</span>
              <span className="openclaw-preview-status-text min-w-0 truncate">{statusText}</span>
            </span>
          </div>
        </div>
      </header>
    );
  }, [
    conversationCache,
    currentConv,
    currentAgentInfo,
    handleConversationSelect,
    healthy,
    historyLoading,
    historyOpen,
    selectedConversationId,
    sharedConversations,
    statusPayload,
  ]);

  if (!agentId || agentId === "0") {
    return (
      <div className={`flex h-full flex-col bg-white ${className || ""}`}>
        <div className="flex-none h-[60px] border-b px-6 flex items-center text-base font-medium text-[#1F2123]">
          预览与调试
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
          <div className="text-base font-medium text-[#2F3136]">请先保存后调试</div>
          <div className="mt-2 text-sm leading-6 text-[#8B95A5]">
            保存智能体后，会在此处加载 OpenClaw 会话、历史记录与连接状态。
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`openclaw-preview-workspace h-full max-w-full ${className || ""}`}>
      <ChatConfigProvider lang={lang} adapters={adapters as any}>
        <ChatView
          agentId={String(agentId)}
          initialConversationId={initialConversationId}
          syncToUrl={false}
          agentInfo={currentAgentInfo}
          slots={{
            header: renderHeader,
          }}
          history={{ enabled: features.history }}
          newConversation={{ enabled: features.newConversation }}
          languageSwitcher={{ enabled: features.languageSwitcher }}
          guide={{ enabled: features.guide }}
          welcome={{ show: features.showWelcome, indexLayout: features.indexWelcomeLayout }}
          fileUpload={{
            enabled: features.fileUpload,
            request: uploadRequest,
            acceptTypes: acceptTypes,
            enableDrag: features.enableDragUpload,
            enablePaste: features.enablePasteUpload,
            allowMultiple: features.allowMultiple,
            allowSendWithFiles: features.allowSendWithFiles,
          }}
          openclaw={{
            enabled: features.openclaw,
            inputDisabled: features.openclawInputDisabled,
            inputDisabledReason: features.openclawInputDisabledReason,
            initialConversationResolving: features.initialConversationResolving,
            skipInitialLoad: features.skipInitialLoad,
          }}
          message={{
            showMenu: features.messageMenu,
          }}
          boxClassName={boxClassName}
        />
      </ChatConfigProvider>
    </div>
  );
}

export default OpenClawPreviewWorkspace;
