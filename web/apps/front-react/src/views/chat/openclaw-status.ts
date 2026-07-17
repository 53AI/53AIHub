export type OpenClawConnectionState = "checking" | "connected" | "disconnected";

export const OPENCLAW_STATUS_RETRY_POLL_INTERVAL = 2_000;
export const OPENCLAW_STATUS_CONNECTED_POLL_INTERVAL = 15_000;
export const OPENCLAW_STATUS_CHECKING_MESSAGE = "正在检测 OpenClaw 连接...";
export const OPENCLAW_STATUS_OFFLINE_MESSAGE = "OpenClaw 插件未连接，正在重连...";

export type OpenClawTranslate = (key: string, params?: Record<string, unknown>) => string;

export const DISCONNECTED_OPENCLAW_STATUS = {
  healthy: false,
  connectionHealthy: false,
  hub53ai: { connectionStatus: "disconnected" },
};

const OPENCLAW_CONNECTED_STATUSES = ["connected", "running", "healthy", "enabled", "ok"];
const OPENCLAW_BRAND_NAMES: Record<string, string> = {
  qclaw: "QClaw",
  openclaw: "OpenClaw",
  hermes: "Hermes",
  workbuddy: "WorkBuddy",
  codex: "Codex",
  manus: "Manus",
};

function readConnectedStatus(payload: any) {
  return String(payload?.hub53ai?.connectionStatus || payload?.connectionStatus || "").toLowerCase();
}

export function isOpenClawStatusConnected(payload: any) {
  return Boolean(
    payload?.connectionHealthy === true ||
      OPENCLAW_CONNECTED_STATUSES.includes(readConnectedStatus(payload))
  );
}

export function getOpenClawConnectionState(payload: any): OpenClawConnectionState {
  return isOpenClawStatusConnected(payload) ? "connected" : "disconnected";
}

function translateOpenClaw(
  translate: OpenClawTranslate | undefined,
  key: string,
  fallback: string,
  params?: Record<string, unknown>
) {
  const text = translate?.(key, params);
  return text && text !== key ? text : fallback;
}

export function getOpenClawInputDisabledReason(
  connectionState: OpenClawConnectionState,
  gatewayName = "OpenClaw",
  translate?: OpenClawTranslate
) {
  return connectionState === "checking"
    ? translateOpenClaw(
        translate,
        "openclaw.input.checking",
        `正在检测 ${gatewayName} 连接...`,
        { gatewayName }
      )
    : translateOpenClaw(
        translate,
        "openclaw.input.disconnected",
        `${gatewayName} 插件未连接，正在重连...`,
        { gatewayName }
      );
}

export function getOpenClawStatusText(
  connectionState: OpenClawConnectionState,
  gatewayName = "OpenClaw",
  translate?: OpenClawTranslate
) {
  if (connectionState === "connected") {
    return translateOpenClaw(
      translate,
      "openclaw.status.connected",
      `${gatewayName} 已连接`,
      { gatewayName }
    );
  }
  if (connectionState === "checking") {
    return translateOpenClaw(
      translate,
      "openclaw.status.checking",
      `${gatewayName} 检测中`,
      { gatewayName }
    );
  }
  return translateOpenClaw(
    translate,
    "openclaw.status.disconnected",
    `${gatewayName} 未连接`,
    { gatewayName }
  );
}

export function getOpenClawErrorStatus(error: unknown) {
  return Number((error as any)?.response?.status || (error as any)?.status || 0);
}

export function isOpenClawGatewayUnavailableError(error: unknown) {
  return getOpenClawErrorStatus(error) === 503;
}

export function formatOpenClawGatewayName(hostKind?: unknown) {
  const normalized = String(hostKind || "").trim().toLowerCase();
  return OPENCLAW_BRAND_NAMES[normalized] || "OpenClaw";
}

export function getOpenClawHostKind(status: any, config?: any) {
  return String(
    status?.hostKind ||
      status?.host_kind ||
      status?.gateway?.hostKind ||
      status?.gateway?.host_kind ||
      status?.hub53ai?.hostKind ||
      status?.hub53ai?.host_kind ||
      config?.custom_config_obj?.hostKind ||
      config?.custom_config_obj?.host_kind ||
      config?.custom_config_obj?.agent_type ||
      config?.custom_config?.hostKind ||
      config?.custom_config?.host_kind ||
      config?.custom_config?.agent_type ||
      config?.gateway?.hostKind ||
      config?.gateway?.host_kind ||
      config?.hostKind ||
      config?.host_kind ||
      ""
  ).trim().toLowerCase();
}

export function getOpenClawGatewayDisplayName(status: any, config?: any) {
  return formatOpenClawGatewayName(getOpenClawHostKind(status, config));
}
