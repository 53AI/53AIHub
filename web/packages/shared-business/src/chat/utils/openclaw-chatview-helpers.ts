// packages/shared-business/src/chat/utils/openclaw-chatview-helpers.ts
//
// ChatView 组件所需的全部纯辅助函数 + 一个对 store 的轻量读访问。
// 从 ChatView.tsx 顶层抽出,便于复用、独立测试与 review。
//
// 命名约定:
// - 与 utils/openclaw.ts / useChatSend.ts / useChatStream.ts 同名的函数签名保持一致,
//   这些函数之间目前互不依赖(本文件不导入上述三个),保留各自独立版本。

import type {
  Message,
  OpenClawActivityItem,
  OpenClawInteractionOption,
} from "../types/message";
import type { FileItem, OutputFile } from "../types/message";
import { useConversationStore } from "../stores";
import { getOpenClawTimelineEventsFromLedgerPayload } from "./openclaw-ledger";
import type {
  OpenClawSessionSnapshot,
  OpenClawSnapshotActiveTurn,
} from "./openclaw-ledger";
import { shouldUseOpenClawRouteType } from "./openclaw";
import {
  OPENCLAW_OPTIMISTIC_RESOLVED_VIRTUAL_ID,
  openClawOptimisticResolvedConversationIds,
} from "../components/ChatView/constants";

// ============================================================================
// Debug logging (URL/localStorage 开关,默认关)
// ============================================================================

/**
 * 是否启用 OpenClaw chatview 调试日志。
 * 通过 URL query (`openclaw_debug=1` 或 `OPENCLAW_LEDGER_DEBUG=1`)
 * 或 localStorage (`OPENCLAW_LEDGER_DEBUG=1`) 开启。
 */
export function isOpenClawChatViewDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return (
      params.get("openclaw_debug") === "1" ||
      params.get("OPENCLAW_LEDGER_DEBUG") === "1" ||
      window.localStorage?.getItem("OPENCLAW_LEDGER_DEBUG") === "1"
    );
  } catch {
    return false;
  }
}

export function traceOpenClawChatView(label: string, payload: Record<string, unknown>): void {
  if (!isOpenClawChatViewDebugEnabled()) return;
  console.info(`[openclaw-ui:${label}] ${JSON.stringify(payload)}`);
}

// ============================================================================
// URL / Conversation sync (ChatView 主体的 URL ↔ store 同步)
// ============================================================================

/**
 * 判断 URL 中 `agent_id` 是否允许被同步覆盖。
 * 仅当 URL 未携带 agent_id,或与目标 agentId 一致时才允许覆盖,避免误改从其他入口打开的页面。
 */
export function canSyncConversationUrlForAgent(agentId: string | number): boolean {
  const url = new URL(window.location.href);
  const currentAgentId = url.searchParams.get("agent_id");
  return !currentAgentId || currentAgentId === String(agentId);
}

/**
 * 同步 agent_id / conversation_id / type=openclaw 到 URL,并 dispatch popstate
 * 通知路由层(useSearchParams / PopState 监听器)。
 */
export function syncConversationIdToUrl(
  agentId: string | number,
  conversationId: string | number,
  isOpenClawMode = false,
): void {
  if (!canSyncConversationUrlForAgent(agentId)) return;
  const url = new URL(window.location.href);
  url.searchParams.set("agent_id", String(agentId));
  if (hasConversationId(conversationId)) {
    url.searchParams.set("conversation_id", String(conversationId));
  } else {
    url.searchParams.delete("conversation_id");
  }
  if (shouldUseOpenClawRouteType(isOpenClawMode, conversationId)) {
    url.searchParams.set("type", "openclaw");
  } else if (url.searchParams.get("type") === "openclaw") {
    url.searchParams.delete("type");
  }
  const nextUrl = url.toString();
  if (nextUrl === window.location.href) return;
  window.history.replaceState(null, "", nextUrl);
  try {
    window.dispatchEvent(typeof PopStateEvent === "function" ? new PopStateEvent("popstate", { state: null }) : new Event("popstate"));
  } catch {
    window.dispatchEvent(new Event("popstate"));
  }
}

/**
 * 判断 conversationId 是否"真实存在"(非 0 / "0" / 空)。
 * 与 utils/openclaw.ts 中同名未导出函数签名一致,本文件保留独立版本以避免跨模块耦合。
 */
export function hasConversationId(conversationId?: string | number | null): boolean {
  return Boolean(conversationId) && conversationId !== 0 && conversationId !== "0";
}

/**
 * 判断某个会话是否处于"乐观已解析"过渡态。
 * 同时检查模块级 Set 与 store.conversations 中带有 __openclaw_optimistic_resolved__ virtual_id 的条目。
 */
export function isOptimisticResolvedOpenClawConversation(
  conversationId?: string | number | null,
): boolean {
  if (!hasConversationId(conversationId)) return false;
  if (openClawOptimisticResolvedConversationIds.has(String(conversationId))) return true;
  return useConversationStore
    .getState()
    .conversations
    .some((item: any) =>
      String(item?.conversation_id || "") === String(conversationId) &&
      item?.virtual_id === OPENCLAW_OPTIMISTIC_RESOLVED_VIRTUAL_ID
    );
}

/**
 * 为乐观新建的 openclaw 会话构造一个截断的标题。
 * 超过 40 字符时取前 40 字符 + 省略号;空问题返回 "新对话"。
 */
export function buildOpenClawOptimisticConversationTitle(question: string): string {
  const normalized = question.replace(/\s+/g, " ").trim();
  if (!normalized) return "新对话";
  return normalized.length > 40 ? `${normalized.slice(0, 40)}...` : normalized;
}

// ============================================================================
// OpenClaw file conversion (用户文件 → OutputFile)
// ============================================================================

/**
 * 把 FileItem(用户上传/指定文件)转换为 OutputFile(助手输出文件)结构,
 * 主要用于 openclaw 模式下用户文件预览。
 */
export function openClawUserFileToOutputFile(file: FileItem): OutputFile {
  const record = file as FileItem & Record<string, any>;
  const fileName = record.file_name || record.name || record.filename || "attachment";
  const previewUrl = record.preview_url || record.previewUrl || record.file_url || record.url;
  return {
    id: record.id || record.upload_file_id || record.preview_key || fileName,
    file_name: fileName,
    mime_type: record.mime_type || record.file_mime,
    size: record.size ?? record.file_size,
    file_path: record.file_path,
    preview_key: record.preview_key,
    preview_url: previewUrl,
    url: previewUrl || record.url || record.file_url,
    download_url: record.download_url || record.downloadUrl,
    signed_download_url: record.signed_download_url || record.signedDownloadUrl,
    artifact_id: record.artifact_id || record.artifactId,
    upload_file_id: record.upload_file_id || record.uploadFileId,
    source_kind: "openclaw_input_file",
  };
}

// ============================================================================
// OpenClaw error recognition (HTTP / 业务错误识别)
// ============================================================================

/**
 * 从错误对象中提取"登录态失效"的提示文案。
 * 仅当 HTTP status = 401 或错误信息中包含 auth 关键字时返回中文提示。
 */
export function getOpenClawAuthBlockedReason(err: any): string {
  const status = err?.response?.status ?? err?.status;
  const errorMessage =
    err?.response?.data?.message ||
    err?.response?.data?.error?.message ||
    err?.message ||
    "";
  if (status === 401 || /authentication required|unauthorized|401/i.test(String(errorMessage))) {
    return "登录状态已失效，请刷新页面后重新登录";
  }
  return "";
}

/**
 * 判断错误是否为"资源不存在"(404 / NOT_FOUND / not_found 中英文)。
 */
export function isOpenClawNotFoundError(err: any): boolean {
  const status = err?.response?.status ?? err?.status;
  const code = String(
    err?.response?.data?.code ||
      err?.response?.data?.error?.code ||
      err?.data?.code ||
      err?.code ||
      ""
  ).toUpperCase();
  const errorMessage =
    err?.response?.data?.message ||
    err?.response?.data?.error?.message ||
    err?.data?.message ||
    err?.message ||
    "";
  return status === 404 || code.includes("NOT_FOUND") || /not[_\s-]?found|不存在|已删除/i.test(String(errorMessage));
}

/**
 * 从若干候选值中读取首个"非空字符串/数字/布尔"。
 * 用于从 openclaw option 等结构松散的对象中抽取稳定值。
 */
export function readOpenClawString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return "";
}

// ============================================================================
// OpenClaw interaction (用户选项识别 + control payload 构造)
// ============================================================================

/**
 * 从 option 中抽取稳定的 value。
 * 优先级:value → id → label/title/name 的非空字符串。
 */
export function getOpenClawOptionValue(option: OpenClawInteractionOption): string {
  if (option.value !== undefined) return String(option.value);
  if (option.id !== undefined) return String(option.id);
  return readOpenClawString(option.label, option.title, option.name);
}

/**
 * 构造 option 的 React key(保证稳定、唯一、非空)。
 * 优先级:id → value → label → title → name → index。
 */
export function getOpenClawOptionKey(option: OpenClawInteractionOption, index: number): string {
  return readOpenClawString(option.id, option.value, option.label, option.title, option.name, index);
}

/**
 * 构造 openclaw 用户交互(选项回答)对应的 control payload。
 * 对齐后端 respond_interaction 接口所需的字段集合。
 */
export function buildOpenClawInteractionControlPayload(
  activity: OpenClawActivityItem,
  option: OpenClawInteractionOption,
) {
  const interaction = activity.interaction || {};
  const firstQuestion = activity.questions?.[0] || {};
  const optionValue = getOpenClawOptionValue(option);
  const optionText = readOpenClawString(option.label, option.title, option.name, option.value, option.id);
  const interactionId = readOpenClawString(interaction.id, firstQuestion.id, activity.key);
  const requestId = readOpenClawString(interaction.requestId, firstQuestion.requestId);
  const toolCallId = readOpenClawString(interaction.toolCallId, firstQuestion.toolCallId, activity.tool?.toolCallId);
  const questionId = readOpenClawString(firstQuestion.id, interaction.id);
  const decision = readOpenClawString(option.decision, option.value, option.id, option.label, option.title, option.name);
  const answers = questionId ? { [questionId]: optionValue } : undefined;

  return {
    action: "respond_interaction" as const,
    interaction_id: interactionId,
    request_id: requestId,
    tool_call_id: toolCallId,
    question_id: questionId,
    method: readOpenClawString(interaction.method, firstQuestion.method),
    type: readOpenClawString(interaction.type, firstQuestion.type),
    option_id: readOpenClawString(option.id, option.value),
    option_key: getOpenClawOptionKey(option, 0),
    decision,
    answer: optionValue,
    answer_text: optionText,
    answers,
    interaction,
    question: firstQuestion,
    option,
  };
}

/**
 * 在 message 上把指定 activity 标记为已解决(resolved)。
 * 同时修改 openclawActivities / openclawTimelineItems / openclawProjection 三处镜像。
 */
export function markOpenClawInteractionResolved(message: Message, activityKey: string): Message {
  const markActivity = (activity: OpenClawActivityItem): OpenClawActivityItem =>
    activity.key === activityKey ? { ...activity, resolved: true, requiresUserInput: false } : activity;
  const markTimelineItem = (item: any) =>
    item.key === activityKey
      ? {
          ...item,
          resolved: true,
          requiresUserInput: false,
          activity: item.activity ? markActivity(item.activity) : item.activity,
        }
      : item;

  return {
    ...message,
    openclawActivities: message.openclawActivities?.map(markActivity),
    openclawTimelineItems: message.openclawTimelineItems?.map(markTimelineItem),
    openclawProjection: message.openclawProjection
      ? {
          ...message.openclawProjection,
          activities: message.openclawProjection.activities.map(markActivity),
          timelineItems: message.openclawProjection.timelineItems.map(markTimelineItem),
        }
      : message.openclawProjection,
  };
}

// ============================================================================
// OpenClaw timeline payload parsing (events / data.events 双形态)
// ============================================================================

/**
 * 从任意 payload 中抽取 timeline events 数组。
 * 支持 `payload.events` 与 `payload.data.events` 双形态,空时回退到 ledger payload 解析。
 */
export function getOpenClawTimelineEvents(payload: any): any[] {
  const events = payload?.events ?? payload?.data?.events;
  if (Array.isArray(events) && events.length) return events;
  return getOpenClawTimelineEventsFromLedgerPayload(payload);
}

/**
 * 过滤出 seq > afterSeq 的 events,返回新 payload(保持原结构)。
 * afterSeq = 0 时原样返回。
 */
export function withOpenClawEventsAfterSeq(payload: any, afterSeq: number): any {
  if (!afterSeq) return payload;

  const events = getOpenClawTimelineEvents(payload);
  if (!events.length) return payload;

  const nextEvents = events.filter((event) => {
    const seq = typeof event?.seq === "number" ? event.seq : Number(event?.seq);
    return Number.isFinite(seq) && seq > afterSeq;
  });

  if (payload?.data && Array.isArray(payload.data.events)) {
    return {
      ...payload,
      data: {
        ...payload.data,
        events: nextEvents,
      },
    };
  }

  return {
    ...payload,
    events: nextEvents,
  };
}

/**
 * 从 payload 中过滤出 seq > afterSeq 的 events(直接返回数组)。
 */
export function getOpenClawTimelineEventsAfterSeq(payload: any, afterSeq: number): any[] {
  return getOpenClawTimelineEvents(payload).filter((event) => {
    const seq = typeof event?.seq === "number" ? event.seq : Number(event?.seq);
    return Number.isFinite(seq) && seq > afterSeq;
  });
}

/**
 * 替换 payload 中的 events 为指定数组(保持 events / data.events 原结构)。
 */
export function withOpenClawTimelineEvents(payload: any, events: any[]): any {
  if (payload?.data && Array.isArray(payload.data.events)) {
    return {
      ...payload,
      data: {
        ...payload.data,
        events,
      },
    };
  }

  return {
    ...payload,
    events,
  };
}

/**
 * 判断 event 是否为终态事件(run.completed / failed / interrupted 或 ledger turn.completed 等)。
 */
export function isOpenClawTerminalTimelineEvent(event: any): boolean {
  const kind = String(event?.kind || "");
  if (kind === "run.completed" || kind === "run.failed" || kind === "run.interrupted") {
    return true;
  }
  const ledger = event?.payload?.openclaw_ledger;
  const eventType = ledger && typeof ledger === "object"
    ? String((ledger as Record<string, unknown>).event_type || "")
    : "";
  return eventType === "turn.completed" || eventType === "turn.failed" || eventType === "turn.interrupted";
}

/** 从 payload 中抽取所有终态事件。 */
export function getOpenClawTerminalEvents(payload: any): any[] {
  return getOpenClawTimelineEvents(payload).filter(isOpenClawTerminalTimelineEvent);
}

/** 读取 event.seq(非有限数时回退 0)。 */
export function readOpenClawTimelineEventSeq(event: any): number {
  const seq = typeof event?.seq === "number" ? event.seq : Number(event?.seq);
  return Number.isFinite(seq) ? seq : 0;
}

// ============================================================================
// OpenClaw ledger id extraction from timeline event
// ============================================================================

/** 从 timeline event 的 openclaw_ledger 字段抽取 turn_id。 */
export function getOpenClawLedgerTurnIdFromTimelineEvent(event: any): string {
  const ledger = event?.payload?.openclaw_ledger;
  if (!ledger || typeof ledger !== "object") return "";
  return String((ledger as Record<string, unknown>).turn_id || "");
}

/** 从 timeline event 的 openclaw_ledger 字段抽取 active_request_id。 */
export function getOpenClawLedgerActiveRequestIdFromTimelineEvent(event: any): string {
  const ledger = event?.payload?.openclaw_ledger;
  if (!ledger || typeof ledger !== "object") return "";
  return String((ledger as Record<string, unknown>).active_request_id || "");
}

/** 从 timeline event 的 openclaw_ledger 字段抽取 run_id。 */
export function getOpenClawLedgerRunIdFromTimelineEvent(event: any): string {
  const ledger = event?.payload?.openclaw_ledger;
  if (!ledger || typeof ledger !== "object") return "";
  return String((ledger as Record<string, unknown>).run_id || "");
}

// ============================================================================
// OpenClaw snapshot turns (snapshot 接口的 active_turns 字段)
// ============================================================================

/**
 * 从 snapshot payload 中抽取 active_turns 数组(兼容 snake/camel / 顶层/data 双层)。
 */
export function getOpenClawSnapshotActiveTurns(
  payload: OpenClawSessionSnapshot | null | undefined
): OpenClawSnapshotActiveTurn[] {
  const candidates = [
    payload?.active_turns,
    payload?.activeTurns,
    payload?.data?.active_turns,
    payload?.data?.activeTurns,
  ];
  const activeTurns = candidates.find(Array.isArray);
  return Array.isArray(activeTurns) ? (activeTurns as OpenClawSnapshotActiveTurn[]) : [];
}

/** 判断 turn 是否处于运行态(status ∈ {running, streaming})。 */
export function isOpenClawRunningActiveTurn(turn: OpenClawSnapshotActiveTurn | null | undefined): boolean {
  const status = String(turn?.status || turn?.terminal_status || turn?.terminalStatus || "").toLowerCase();
  return status === "running" || status === "streaming";
}

/** 从 turn 中抽取稳定的 turn_id(支持 turn_id / turnId)。 */
export function getOpenClawSnapshotTurnId(turn: OpenClawSnapshotActiveTurn | null | undefined): string {
  return String(turn?.turn_id || turn?.turnId || "");
}

/** 判断 snapshot 中的某个 active turn 是否归属于指定 message(用于把 running turn 投影到对应消息上)。 */
export function openClawSnapshotActiveTurnBelongsToMessage(
  turn: any,
  message?: Message | null,
): boolean {
  if (!message) return false;
  const turnId = getOpenClawSnapshotTurnId(turn);
  const activeRequestId = String(turn?.active_request_id || turn?.activeRequestId || "");
  const runId = String(turn?.run_id || turn?.runId || "");
  const candidates = collectOpenClawMessageIdentityCandidates(message);

  if (activeRequestId && candidates.has(activeRequestId)) return true;
  if (turnId && candidates.has(turnId)) return true;
  if (runId && candidates.has(runId)) return true;

  for (const candidate of candidates) {
    if (candidate && turnId && turnId.includes(candidate)) return true;
  }
  return false;
}

/** 返回 active_turns 中所有 running turn 的 turn_id 集合。 */
export function getOpenClawSnapshotRunningTurnIds(activeTurns: any[]): Set<string> {
  return new Set(activeTurns.filter(isOpenClawRunningActiveTurn).map(getOpenClawSnapshotTurnId).filter(Boolean));
}

// ============================================================================
// OpenClaw message identity / recovery classification
// ============================================================================

/**
 * 收集 message 的所有"身份候选"(client messageId / active requestId / turnKey / messageId / 事件中的 turnId / runId)。
 * 用于判断某个 timeline event 是否归属于该 message。
 */
export function collectOpenClawMessageIdentityCandidates(message?: Message | null): Set<string> {
  const candidates = new Set<string>();
  if (!message) return candidates;

  for (const value of [
    (message as any)._openclawActiveRequestId,
    (message as any)._openclawClientMessageId,
    message.openclawTurn?.turnKey,
    message.id,
  ]) {
    const text = value == null ? "" : String(value).trim();
    if (text) candidates.add(text);
  }

  for (const event of message.openclawTurn?.events || []) {
    const turnId = getOpenClawLedgerTurnIdFromTimelineEvent(event);
    const runId = getOpenClawLedgerRunIdFromTimelineEvent(event);
    if (turnId) candidates.add(turnId);
    if (runId) candidates.add(runId);
  }

  return candidates;
}

/** 判断 message 是否处于"恢复中"状态(loading 或带 openclaw active 标记)。 */
export function isOpenClawActiveRecoveryMessage(message?: Message | null): boolean {
  if (!message) return false;
  return Boolean(
    message.loading ||
      (message as any)._openclawActiveRequestId ||
      (message as any)._openclawClientMessageId ||
      message.openclawTurn?.status === "streaming"
  );
}

/** 判断 message 是否含有可渲染的最终内容(answer / projection / timeline items / outputFiles)。 */
export function hasOpenClawRenderableFinalContent(message?: Message | null): boolean {
  if (!message) return false;
  return Boolean(
    String(message.answer || "").trim() ||
      String(message.openclawProjection?.visibleAnswer || "").trim() ||
      message.openclawTimelineItems?.some((item: any) => item?.type === "answer" && String(item?.content || "").trim()) ||
      message.outputFiles?.length ||
      message.openclawProjection?.outputFiles?.length
  );
}

/** 判断 message 是否为已完成的、含最终内容的助手消息(用于快照合并时跳过)。 */
export function isOpenClawCompletedRenderableMessage(message?: Message | null): boolean {
  if (!message || message.loading || !hasOpenClawRenderableFinalContent(message)) return false;
  const status = String(message.openclawTurn?.status || "");
  return status === "completed" || status === "interrupted" || status === "failed" || message.openclawProjection?.isStreaming === false;
}

/**
 * 判断 timeline event 是否归属于指定 message(基于 turnId / activeRequestId / runId 候选匹配)。
 * 无 scoped identity 时,仅对处于恢复中的 message 返回 true。
 */
export function openClawTimelineEventBelongsToMessage(
  event: any,
  message?: Message | null,
): boolean {
  if (!message) return false;

  const turnId = getOpenClawLedgerTurnIdFromTimelineEvent(event);
  const activeRequestId = getOpenClawLedgerActiveRequestIdFromTimelineEvent(event);
  const runId = getOpenClawLedgerRunIdFromTimelineEvent(event);
  const candidates = collectOpenClawMessageIdentityCandidates(message);

  if (activeRequestId && candidates.has(activeRequestId)) return true;
  if (turnId && candidates.has(turnId)) return true;
  if (runId && candidates.has(runId)) return true;

  for (const candidate of candidates) {
    if (candidate && turnId && turnId.includes(candidate)) return true;
  }

  const hasScopedLedgerIdentity = Boolean(turnId || activeRequestId || runId);
  return !hasScopedLedgerIdentity && isOpenClawActiveRecoveryMessage(message);
}

/** 从消息列表中找出属于指定 conversationId 的最后一条消息(无则 undefined)。 */
export function getLatestOpenClawMessageForConversation(
  messages: Message[],
  conversationId: string,
): Message | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (String(message?.conversation_id || "") === conversationId) return message;
  }
  return undefined;
}
