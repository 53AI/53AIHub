import type { ChatCompletionParams, ConversationControlParams, IConversationApi } from "../adapters/types";
import type { OpenClawTurnEvent, OutputFile } from "../types";
import {
  getOpenClawEventReasoningText,
  isOpenClawActivityEvent,
  mergeOpenClawActivities,
  type OpenClawTimelineEvent,
} from "./openclaw-activities";
import {
  isOpenClawDiscardableAssistantContent,
  isOpenClawStatusAssistantContent,
  sanitizeOpenClawAnswer,
} from "./openclaw";
import {
  buildOpenClawAnswerTimelineItem,
  getOutputFileKeys,
  mergeOutputFiles,
} from "./openclaw-timeline";
import {
  appendOpenClawEvents,
  buildOpenClawTurnKey,
  createOpenClawTurnState,
  projectOpenClawTurn,
  syncOpenClawProjectionToMessage,
} from "./openclaw-turn";
import { getOpenClawTimelineEventsFromLedgerPayload } from "./openclaw-ledger";
import { decodeOutputFiles } from "./openclaw-transport";

export const OPENCLAW_CONVERSATION_LIST_LIMIT = 10;

function hashOpenClawText(value?: string | null): string {
  const text = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export interface OpenClawPaginationParams {
  limit?: number;
  offset?: number;
  after_seq?: number;
  fresh?: boolean;
}

export interface OpenClawSession {
  id: string;
  title?: string;
  status?: string;
  hostKind?: string;
  runnerCommand?: string;
  createdAt?: string;
  updatedAt?: string;
  lastEventSeq?: number;
  has_cached_history?: boolean;
  hasCachedHistory?: boolean;
}

export interface OpenClawMessage {
  id: string;
  sessionId?: string;
  role: string;
  content?: string;
  createdAt?: string;
  reasoning?: string;
  reasoningText?: string;
  reasoning_content?: string;
  thinking?: string;
  thinkingText?: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

export interface OpenClawApiLike {
  conversations(agentId: string | number, params?: OpenClawPaginationParams): Promise<any>;
  currentConversation?(agentId: string | number, options?: { fresh?: boolean; ignoreMessage?: boolean }): Promise<any>;
  messages(agentId: string | number, conversationId: string, params?: OpenClawPaginationParams): Promise<any>;
  events(agentId: string | number, conversationId: string, params?: OpenClawPaginationParams): Promise<any>;
  snapshot?(agentId: string | number, conversationId: string, params?: { after_seq?: number; fresh?: boolean }): Promise<any>;
  control(agentId: string | number, conversationId: string, params: ConversationControlParams): Promise<any>;
  ensureSkill?(agentId: string | number, skillIdentifier: string | number): Promise<any>;
  status?(agentId: string | number, options?: { ignoreMessage?: boolean }): Promise<any>;
}

export interface CreateOpenClawConversationApiAdapterOptions {
  agentId: string | number;
  openclawApi: OpenClawApiLike;
  completions: (
    params: ChatCompletionParams,
    options: {
      responseType: "stream";
      onDownloadProgress: (e: any) => void;
      signal?: AbortSignal;
    }
  ) => Promise<any>;
  requestSource?: string;
  canonicalOnly?: boolean;
}

export function getOpenClawPayload(response: any) {
  return response?.data || response || {};
}

function isOpenClawMirrorPayload(payload: any): boolean {
  return String(payload?.source || "") === "mirror" || (payload?.cached === true && String(payload?.source || "") === "mirror");
}

function openClawHistoryMeta(payload: any) {
  const source = String(payload?.source || "");
  const messagesLastSeq = typeof payload?.messages_last_seq === "number" ? payload.messages_last_seq : Number(payload?.messages_last_seq);
  const mirrorLastSeq = typeof payload?.mirror_last_seq === "number" ? payload.mirror_last_seq : Number(payload?.mirror_last_seq);
  return {
    ...(source ? { source } : {}),
    ...(typeof payload?.stale === "boolean" ? { stale: payload.stale } : {}),
    ...(typeof payload?.last_seq === "number" ? { last_seq: payload.last_seq } : {}),
    ...(Number.isFinite(messagesLastSeq) && messagesLastSeq > 0 ? { messages_last_seq: messagesLastSeq } : {}),
    ...(Number.isFinite(mirrorLastSeq) && mirrorLastSeq > 0 ? { mirror_last_seq: mirrorLastSeq } : {}),
    ...(typeof payload?.refresh_recommended === "boolean" ? { refresh_recommended: payload.refresh_recommended } : {}),
  };
}

export function toOpenClawTimestampMs(value?: string | number) {
  if (!value) return Date.now();
  const timestamp = typeof value === "number" ? value : new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
}

function toOpenClawOptionalTimestampMs(value?: string | number) {
  if (!value) return 0;
  const timestamp = typeof value === "number" ? value : new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

function readStringValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
    if (!Array.isArray(value)) continue;

    const text = value
      .flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const record = entry as Record<string, unknown>;
        return [record.text, record.content, record.thinking, record.reasoning].filter(
          (item): item is string => typeof item === "string"
        );
      })
      .map((item) => item.trim())
      .filter(Boolean)
      .join("\n\n");
    if (text.trim()) return text;
  }

  return "";
}

function readMessageSeqFromMetadata(message?: OpenClawMessage | null): number {
  if (!message || typeof message !== "object") return 0;
  const record = message as OpenClawMessage & { __openclaw?: Record<string, unknown>; seq?: unknown; messageSeq?: unknown; message_seq?: unknown };
  const payload = message.payload || {};
  const metadata = message.metadata || {};
  const data = message.data || {};
  const rawMeta = record.__openclaw && typeof record.__openclaw === "object" ? record.__openclaw : {};
  return readNumberValue(
    record.seq,
    record.messageSeq,
    record.message_seq,
    rawMeta.seq,
    rawMeta.messageSeq,
    rawMeta.message_seq,
    payload.rawSeq,
    payload.seq,
    payload.messageSeq,
    payload.message_seq,
    metadata.rawSeq,
    metadata.seq,
    metadata.messageSeq,
    metadata.message_seq,
    data.rawSeq,
    data.seq,
    data.messageSeq,
    data.message_seq
  );
}

function getMessageSeq(message?: OpenClawMessage | null): number {
  const metadataSeq = readMessageSeqFromMetadata(message);
  if (metadataSeq > 0) return metadataSeq;
  const id = String(message?.id || "");
  const match =
    id.match(/:(?:assistant|user|message|thinking):(\d+)$/) ||
    id.match(/^(?:assistant|user|message|thinking|assistant-derived)-(\d+)$/);
  return match ? Number(match[1]) : 0;
}

/**
 * 从消息 id 提取它所属的 turn 标识。
 *
 * 用途：消息流不保证按 createdAt 排序，orphan assistant（如
 * `turn:agent:main:main:turn:1783499340404:assistant`）可能出现在其 user 之前。
 * 仅靠 seq / 时间判定（assistantMessageBelongsToUserTurn）会把 orphan 错挂到上一个
 * turn 的 user 上。一旦能可靠提取 turn key，就在合并前先用它匹配，seq/时间仅作为
 * turn key 无法解析时的兜底。
 *
 * 解析规则（按消息 id 命名空间）：
 * - `turn:<session>:<kind>:<id>:<role>` → `turn:<session>:<kind>:<id>`
 * - `ws-<seq>:<role>` → `ws:<seq>`
 * - 其它（恢复 / 派生消息）：返回 ""，回退到现有 seq/时间判定
 */
export function getOpenClawMessageTurnKey(message?: OpenClawMessage | null): string {
  if (!message) return "";
  const id = String(message.id || "");
  if (!id) return "";

  // turn:<session>:<kind>:<id>:<role> —— session 内部用 ":" 分段，kind 也可能含 ":"
  // （如 ws kind 或 history kind），所以这里不强行限定 ":" 段数，用贪婪匹配。
  const turnMatch = id.match(/^turn:(.+):(?:user|assistant)$/);
  if (turnMatch) return `turn:${turnMatch[1]}`;

  // ws-<seq>:<role>
  const wsMatch = id.match(/^(ws-\d+):(?:user|assistant)$/);
  if (wsMatch) return `ws:${wsMatch[1]}`;

  return "";
}

/**
 * 把任意输入归一化成"用于文本匹配的小写、空白折叠串"。
 *
 * 用在跨数据源的合并/挂载里：当 ws-* 原始帧的 user content 是整段 JSON 字符串、
 * 而 ledger 事件里的 content 是解出来后的纯文本时，先各自归一化再比较，
 * 才能让"内容相同"的判定不被尾随空格/换行干扰。
 *
 * 不做大小写转换（区分中英文大小写敏感场景），只折叠空白。
 */
export function normalizeOpenClawMergeText(value: unknown): string {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function getEventSeq(event?: OpenClawTimelineEvent | null): number {
  return typeof event?.seq === "number" ? event.seq : 0;
}

function getEventHistoryMessageSeq(event?: OpenClawTimelineEvent | null): number | undefined {
  const id = String(event?.id || "");
  const match = id.match(/:history:(\d+)(?::|$)/);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function readNumberValue(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return 0;
}

function getEventMessageSeq(event?: OpenClawTimelineEvent | null): number {
  const payload = event?.payload || {};
  return readNumberValue(
    getEventHistoryMessageSeq(event),
    payload.messageSeq,
    payload.message_seq,
    payload.rawSeq
  );
}

function getEventPayloadMessageSeq(event?: OpenClawTimelineEvent | null): number {
  const payload = event?.payload || {};
  return readNumberValue(payload.messageSeq, payload.message_seq, payload.rawSeq);
}

function normalizeThinkingContentForDedupe(event: OpenClawTimelineEvent): string {
  if (event.kind !== "assistant.thinking") return "";
  const payload = event.payload || {};
  const content = typeof payload.content === "string" ? payload.content : "";
  return content.replace(/\s+/g, " ").trim();
}

function getStandaloneThinkingMessageSeq(event: OpenClawTimelineEvent): number {
  if (event.kind !== "assistant.thinking") return 0;
  if (getEventHistoryMessageSeq(event)) return 0;

  const id = String(event.id || "");
  const match = id.match(/(?::|^)thinking:(\d+)$/);
  if (match) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  return getEventSeq(event);
}

function filterSupersededHistoryThinkingEvents(events: OpenClawTimelineEvent[]): OpenClawTimelineEvent[] {
  const canonicalHistoryThinking = new Set<string>();
  const canonicalHistoryThinkingMessageSeqs = new Set<string>();

  for (const event of events) {
    if (event.kind !== "assistant.thinking") continue;
    const historyMessageSeq = getEventHistoryMessageSeq(event);
    const content = normalizeThinkingContentForDedupe(event);
    if (!historyMessageSeq || !content) continue;
    canonicalHistoryThinking.add(`${event.sessionId || ""}:${historyMessageSeq}:${content}`);
    canonicalHistoryThinkingMessageSeqs.add(`${event.sessionId || ""}:${historyMessageSeq}`);
  }

  if (canonicalHistoryThinking.size === 0) return events;

  return events.filter((event) => {
    if (event.kind !== "assistant.thinking") return true;
    if (getEventHistoryMessageSeq(event)) return true;

    const content = normalizeThinkingContentForDedupe(event);
    if (!content) return true;

    const standaloneThinkingSeq = getStandaloneThinkingMessageSeq(event);
    if (standaloneThinkingSeq > 0 && canonicalHistoryThinkingMessageSeqs.has(`${event.sessionId || ""}:${standaloneThinkingSeq}`)) {
      return false;
    }

    const messageSeq = getEventPayloadMessageSeq(event);
    if (messageSeq <= 0) return true;

    return !canonicalHistoryThinking.has(`${event.sessionId || ""}:${messageSeq}:${content}`);
  });
}

function getOpenClawMessageReasoning(message?: OpenClawMessage | null): string {
  if (!message) return "";
  const payload = message.payload || {};
  const metadata = message.metadata || {};
  const data = message.data || {};
  return readStringValue(
    message.reasoning,
    message.reasoningText,
    message.reasoning_content,
    message.thinking,
    message.thinkingText,
    payload.reasoning,
    payload.reasoningText,
    payload.reasoning_content,
    payload.thinking,
    payload.thinkingText,
    metadata.reasoning,
    metadata.reasoningText,
    metadata.reasoning_content,
    metadata.thinking,
    metadata.thinkingText,
    data.reasoning,
    data.reasoningText,
    data.reasoning_content,
    data.thinking,
    data.thinkingText
  );
}

function mergeReasoningParts(parts: string[]): string {
  const seen = new Set<string>();
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => {
      if (seen.has(part)) return false;
      seen.add(part);
      return true;
    })
    .join("\n\n");
}

function isOpenClawSenderMetadataContent(content?: string | null): boolean {
  return String(content || "").trimStart().startsWith("Sender (untrusted metadata):");
}

function isOpenClawInternalControlUserContent(content?: string | null): boolean {
  const normalized = String(content || "").trim().replace(/\s+/g, " ").toLowerCase();
  return normalized.startsWith(
    "an async command you ran earlier has completed. the result is shown in the system messages above. handle the result internally."
  );
}

/**
 * 识别 ws-* 原始帧里的 user content：整段是 OpenAI ChatCompletionRequest body 的 JSON。
 * 命中则把 `messages[0].content`（role 必须是 "user"）作为真正的 user 文本返回；
 * 不命中返回 null，由上层原样保留 content。
 *
 * 守卫很严：必须有 `model` 字符串 + `messages[0].role === "user"`，避免误伤真实用户发的 JSON。
 */
function tryParseOpenClawRawChatCompletionFrame(content: string | null | undefined): string | null {
  if (!content) return null;
  const trimmed = String(content).trim();
  if (!trimmed || trimmed[0] !== "{") return null;
  if (trimmed.length > 32 * 1024) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (typeof parsed.model !== "string" || !parsed.model.trim()) return null;

  const messages = Array.isArray(parsed.messages) ? parsed.messages : null;
  if (!messages || messages.length !== 1) return null;

  const firstMessage = messages[0];
  if (!firstMessage || typeof firstMessage !== "object") return null;
  if (firstMessage.role !== "user") return null;

  const userText = typeof firstMessage.content === "string" ? firstMessage.content.trim() : "";
  return userText || null;
}

function extractOpenClawSenderMetadataPrompt(content?: string | null): string {
  if (!isOpenClawSenderMetadataContent(content)) return "";

  const raw = String(content || "");
  const firstFenceIndex = raw.indexOf("```");
  const secondFenceIndex = firstFenceIndex >= 0 ? raw.indexOf("```", firstFenceIndex + 3) : -1;
  const tail = (secondFenceIndex >= 0 ? raw.slice(secondFenceIndex + 3) : "")
    .replace(/^\s*\[[^\]\n]+\]\s*/, "")
    .trim();

  return tail;
}

function isOpenClawSenderMetadataMessage(message?: OpenClawMessage | null): boolean {
  return message?.role === "user" && isOpenClawSenderMetadataContent(message.content);
}

function isOpenClawInternalControlUserMessage(message?: OpenClawMessage | null): boolean {
  return message?.role === "user" && isOpenClawInternalControlUserContent(message.content);
}

function buildRecoveredOpenClawSenderUserMessage(message: OpenClawMessage): OpenClawMessage | null {
  const recoveredPrompt = extractOpenClawSenderMetadataPrompt(message.content);
  if (!recoveredPrompt) return null;

  return {
    ...message,
    content: recoveredPrompt,
  };
}

function isOpenClawRecoveredEventUserMessage(message?: OpenClawMessage | null): boolean {
  const payload = message?.payload || {};
  return Boolean((payload as any).recoveredFromEvent) || String(message?.id || "").endsWith(":recovered-user");
}

function mergeRecoveredOpenClawUserMessage(
  recoveredMessage: OpenClawMessage,
  incomingMessage: OpenClawMessage
): OpenClawMessage {
  if (getMessageSeq(incomingMessage) > 0 || getMessageSeq(recoveredMessage) <= 0) {
    return incomingMessage;
  }

  return {
    ...incomingMessage,
    payload: {
      ...(incomingMessage.payload || {}),
      rawSeq: getMessageSeq(recoveredMessage),
    },
  };
}

function shouldMergeRecoveredOpenClawUserTurn(
  pendingUserMessage: OpenClawMessage | null,
  pendingAssistantMessage: OpenClawMessage | null,
  incomingUserMessage: OpenClawMessage
): pendingUserMessage is OpenClawMessage {
  if (!pendingUserMessage || !pendingAssistantMessage) return false;
  if (!isOpenClawRecoveredEventUserMessage(pendingUserMessage)) return false;

  const pendingContent = String(pendingUserMessage.content || "").trim();
  const incomingContent = String(incomingUserMessage.content || "").trim();
  if (!pendingContent || pendingContent !== incomingContent) return false;

  const assistantSeq = getMessageSeq(pendingAssistantMessage);
  const incomingSeq = getMessageSeq(incomingUserMessage);
  const pendingSeq = getMessageSeq(pendingUserMessage);
  if (assistantSeq > 0 && incomingSeq > 0) {
    return incomingSeq <= assistantSeq;
  }

  if (pendingSeq > 0 && incomingSeq > 0) {
    return Math.abs(pendingSeq - incomingSeq) <= 3;
  }

  const assistantTime = toOpenClawTimestampMs(pendingAssistantMessage.createdAt);
  const incomingTime = toOpenClawTimestampMs(incomingUserMessage.createdAt);
  const pendingTime = toOpenClawTimestampMs(pendingUserMessage.createdAt);
  return incomingTime <= assistantTime + 1_000 || Math.abs(incomingTime - pendingTime) <= 15_000;
}

function applyOpenClawSenderMetadataSeqToUserMessage(
  userMessage: OpenClawMessage,
  senderMessage: OpenClawMessage
): OpenClawMessage {
  if (getMessageSeq(userMessage) > 0) return userMessage;

  const senderSeq = getMessageSeq(senderMessage);
  if (senderSeq <= 0) return userMessage;

  return {
    ...userMessage,
    payload: {
      ...(userMessage.payload || {}),
      rawSeq: senderSeq,
    },
  };
}

function applyOpenClawUserEventSeqToMessage(
  userMessage: OpenClawMessage,
  event: OpenClawTimelineEvent | null
): OpenClawMessage {
  if (getMessageSeq(userMessage) > 0) return userMessage;

  const seq = getEventSeq(event);
  if (seq <= 0) return userMessage;

  return {
    ...userMessage,
    payload: {
      ...(userMessage.payload || {}),
      rawSeq: seq,
    },
  };
}

function getOpenClawUserEventContent(event?: OpenClawTimelineEvent | null): string {
  const payload = event?.payload || {};
  const content = payload.content ?? payload.text ?? payload.message;
  return typeof content === "string" ? content.trim() : "";
}

function getOpenClawTimelineEventLedger(event?: OpenClawTimelineEvent | null): Record<string, any> {
  const ledger = event?.payload?.openclaw_ledger;
  return ledger && typeof ledger === "object" && !Array.isArray(ledger) ? ledger as Record<string, any> : {};
}

function getOpenClawTimelineTurnId(event: OpenClawTimelineEvent): string {
  const ledger = getOpenClawTimelineEventLedger(event);
  const payload = event.payload || {};
  return String(
    ledger.turn_id ||
      (payload as any).turn_id ||
      (payload as any).turnId ||
      ledger.active_request_id ||
      (payload as any).active_request_id ||
      (payload as any).activeRequestId ||
      event.id ||
      ""
  );
}

function isOpenClawQuestionSeedEvent(event?: OpenClawTimelineEvent | null): boolean {
  if (!event) return false;
  const ledger = getOpenClawTimelineEventLedger(event);
  const payload = event.payload || {};
  const sourceKind = String(ledger?.payload?.source_kind || (payload as any).source_kind || event.kind || "");
  return event.kind === "user.message" || sourceKind === "user.message" || event.kind === "run.started";
}

function isOpenClawUserMessageEvent(event?: OpenClawTimelineEvent | null): boolean {
  return event?.kind === "user.message";
}

function findOpenClawUserEventForMessage(
  events: OpenClawTimelineEvent[],
  userMessage: OpenClawMessage
): OpenClawTimelineEvent | null {
  const content = String(userMessage.content || "").trim();
  if (!content || isOpenClawSenderMetadataContent(content)) return null;

  const messageTime = toOpenClawTimestampMs(userMessage.createdAt);
  let bestEvent: OpenClawTimelineEvent | null = null;
  let bestDistance = Number.MAX_SAFE_INTEGER;

  for (const event of events) {
    if (!isOpenClawUserMessageEvent(event)) continue;

    const eventContent = getOpenClawUserEventContent(event);
    if (eventContent !== content || isOpenClawSenderMetadataContent(eventContent)) continue;

    const eventTime = toOpenClawTimestampMs(event.createdAt);
    const distance = Math.abs(eventTime - messageTime);
    if (distance > 15_000 || distance >= bestDistance) continue;

    bestEvent = event;
    bestDistance = distance;
  }

  return bestEvent;
}

function enrichOpenClawUserMessageFromEvents(
  userMessage: OpenClawMessage,
  events: OpenClawTimelineEvent[]
): OpenClawMessage {
  const seqEnriched = applyOpenClawUserEventSeqToMessage(
    userMessage,
    findOpenClawUserEventForMessage(events, userMessage)
  );

  // ws-* 原始帧：把整段 ChatCompletionRequest JSON 还原成 user 文本
  const parsedText = tryParseOpenClawRawChatCompletionFrame(seqEnriched.content);
  if (parsedText !== null && parsedText !== seqEnriched.content) {
    return { ...seqEnriched, content: parsedText };
  }
  return seqEnriched;
}

function findOpenClawUserEventForAssistant(
  events: OpenClawTimelineEvent[],
  assistantMessage: OpenClawMessage
): OpenClawTimelineEvent | null {
  const assistantSeq = getMessageSeq(assistantMessage);
  const assistantTime = toOpenClawTimestampMs(assistantMessage.createdAt);
  let bestEvent: OpenClawTimelineEvent | null = null;

  for (const event of events) {
    if (!isOpenClawUserMessageEvent(event)) continue;

    const content = getOpenClawUserEventContent(event);
    if (!content || isOpenClawSenderMetadataContent(content)) continue;

    const eventSeq = getEventSeq(event);
    const eventTime = toOpenClawTimestampMs(event.createdAt);
    const beforeAssistantBySeq = assistantSeq > 0 && eventSeq > 0 && eventSeq < assistantSeq;
    const beforeAssistantByTime = eventTime <= assistantTime;
    if (!beforeAssistantBySeq && !beforeAssistantByTime) continue;

    if (!bestEvent) {
      bestEvent = event;
      continue;
    }

    const bestSeq = getEventSeq(bestEvent);
    if (eventSeq > 0 && bestSeq > 0) {
      if (eventSeq > bestSeq) bestEvent = event;
      continue;
    }

    if (eventTime > toOpenClawTimestampMs(bestEvent.createdAt)) {
      bestEvent = event;
    }
  }

  return bestEvent;
}

function buildRecoveredOpenClawUserMessageFromEvent(
  event: OpenClawTimelineEvent | null,
  assistantMessage: OpenClawMessage
): OpenClawMessage | null {
  if (!event) return null;

  const content = getOpenClawUserEventContent(event);
  if (!content) return null;

  const seq = getEventSeq(event);
  return {
    id: event.id || `${assistantMessage.id}:recovered-user`,
    sessionId: event.sessionId || assistantMessage.sessionId,
    role: "user",
    content,
    createdAt: event.createdAt || assistantMessage.createdAt,
    payload: {
      ...(seq > 0 ? { rawSeq: seq } : {}),
      recoveredFromEvent: true,
    },
  };
}

function isOpenClawDerivedAssistantMessage(message?: OpenClawMessage | null): boolean {
  return String(message?.id || "").startsWith("assistant-derived-");
}

function shouldReplaceOpenClawPendingAssistant(
  currentMessage: OpenClawMessage | null,
  incomingMessage: OpenClawMessage
): boolean {
  if (!currentMessage) return true;

  const currentDerived = isOpenClawDerivedAssistantMessage(currentMessage);
  const incomingDerived = isOpenClawDerivedAssistantMessage(incomingMessage);
  if (!currentDerived && incomingDerived) return false;
  if (currentDerived && !incomingDerived) return true;

  const currentContent = String(currentMessage.content || "").trim();
  const incomingContent = String(incomingMessage.content || "").trim();
  if (currentContent && incomingContent && currentContent.includes(incomingContent) && incomingContent.length < currentContent.length) {
    return false;
  }

  return true;
}

function assistantMessageBelongsToUserTurn(
  userMessage: OpenClawMessage,
  assistantMessage: OpenClawMessage
): boolean {
  const userSeq = getMessageSeq(userMessage);
  const assistantSeq = getMessageSeq(assistantMessage);
  if (userSeq > 0 && assistantSeq > 0) {
    return assistantSeq > userSeq;
  }

  const userTime = toOpenClawTimestampMs(userMessage.createdAt);
  const assistantTime = toOpenClawTimestampMs(assistantMessage.createdAt);
  return assistantTime >= userTime - 1_000;
}

function hasTerminalEventBetweenOpenClawMessages(
  events: OpenClawTimelineEvent[],
  previousMessage: OpenClawMessage | null,
  incomingMessage: OpenClawMessage
): boolean {
  if (!previousMessage || isOpenClawDerivedAssistantMessage(incomingMessage)) return false;

  const previousSeq = getMessageSeq(previousMessage);
  const incomingSeq = getMessageSeq(incomingMessage);
  const previousTime = toOpenClawTimestampMs(previousMessage.createdAt);
  const incomingTime = toOpenClawTimestampMs(incomingMessage.createdAt);

  return events.some((event) => {
    if (event.kind !== "run.completed" && event.kind !== "run.failed" && event.kind !== "run.interrupted") {
      return false;
    }

    const eventSeq = getEventSeq(event);
    if (previousSeq > 0 && incomingSeq > 0 && eventSeq > previousSeq && eventSeq < incomingSeq) {
      return true;
    }

    const eventTime = toOpenClawTimestampMs(event.createdAt);
    return eventTime >= previousTime && eventTime < incomingTime;
  });
}

function hasOpenClawLedgerEvent(event: OpenClawTimelineEvent): boolean {
  const ledger = event.payload?.openclaw_ledger;
  return Boolean(ledger && typeof ledger === "object" && (ledger as any).protocol_version === "openclaw.ledger.v1");
}

function hasOpenClawLedgerAnswerEvent(event: OpenClawTimelineEvent): boolean {
  const ledger = event.payload?.openclaw_ledger;
  return Boolean(
    ledger &&
      typeof ledger === "object" &&
      (ledger as any).protocol_version === "openclaw.ledger.v1" &&
      (ledger as any).part_type === "answer"
  );
}

function getOpenClawLedgerTurnId(event: OpenClawTimelineEvent): string {
  const ledger = event.payload?.openclaw_ledger;
  if (!ledger || typeof ledger !== "object") return "";
  return String((ledger as any).turn_id || "");
}

function getOpenClawLedgerRunId(event: OpenClawTimelineEvent): string {
  const ledger = event.payload?.openclaw_ledger;
  if (!ledger || typeof ledger !== "object") return "";
  return String((ledger as any).run_id || "");
}

function getOpenClawLedgerActiveRequestId(event: OpenClawTimelineEvent): string {
  const ledger = event.payload?.openclaw_ledger;
  if (!ledger || typeof ledger !== "object") return "";
  return String((ledger as any).active_request_id || "");
}

function parseOpenClawActiveRequestTimestampMs(activeRequestId: string): number {
  const parsed = Number(activeRequestId);
  if (!Number.isFinite(parsed)) return 0;
  // OpenClaw/Hub client request ids are epoch milliseconds for live turns.
  return parsed >= 946684800000 && parsed <= 4102444800000 ? parsed : 0;
}

function filterOpenClawEventsToPrimaryLedgerTurn(events: OpenClawTimelineEvent[]): OpenClawTimelineEvent[] {
  const ledgerRunIds = new Set(events.map(getOpenClawLedgerRunId).filter(Boolean));
  if (ledgerRunIds.size === 1) return events;

  const scores = new Map<string, { maxSeq: number; answerSeq: number; terminalSeq: number; count: number }>();

  for (const event of events) {
    if (!hasOpenClawLedgerEvent(event)) continue;
    const turnId = getOpenClawLedgerTurnId(event);
    if (!turnId) continue;

    const current = scores.get(turnId) || { maxSeq: 0, answerSeq: 0, terminalSeq: 0, count: 0 };
    const seq = getEventSeq(event);
    current.maxSeq = Math.max(current.maxSeq, seq);
    current.count += 1;
    if (hasOpenClawLedgerAnswerEvent(event)) {
      current.answerSeq = Math.max(current.answerSeq, seq);
    }
    if (event.kind === "run.completed" || event.kind === "run.failed" || event.kind === "run.interrupted") {
      current.terminalSeq = Math.max(current.terminalSeq, seq);
    }
    scores.set(turnId, current);
  }

  if (scores.size <= 1) return events;

  const primaryTurnId = [...scores.entries()].sort((left, right) => {
    const leftScore = Math.max(left[1].terminalSeq, left[1].answerSeq, left[1].maxSeq);
    const rightScore = Math.max(right[1].terminalSeq, right[1].answerSeq, right[1].maxSeq);
    if (leftScore !== rightScore) return rightScore - leftScore;
    if (left[1].count !== right[1].count) return right[1].count - left[1].count;
    return right[0].localeCompare(left[0]);
  })[0]?.[0];

  if (!primaryTurnId) return events;
  return events.filter((event) => {
    if (!hasOpenClawLedgerEvent(event)) return true;
    const turnId = getOpenClawLedgerTurnId(event);
    return !turnId || turnId === primaryTurnId;
  });
}

function eventBelongsToTurn(
  event: OpenClawTimelineEvent,
  userMessage: OpenClawMessage,
  assistantMessage: OpenClawMessage | null,
  nextUserMessage: OpenClawMessage | null = null
): boolean {
  const userSeq = getMessageSeq(userMessage);
  const assistantSeq = getMessageSeq(assistantMessage);
  const nextUserSeq = getMessageSeq(nextUserMessage);
  const hasAssistantBoundary = Boolean(assistantMessage);
  const userTime = toOpenClawTimestampMs(userMessage.createdAt);
  const assistantTime = assistantMessage ? toOpenClawTimestampMs(assistantMessage.createdAt) : Number.MAX_SAFE_INTEGER;
  const nextUserTime = nextUserMessage ? toOpenClawTimestampMs(nextUserMessage.createdAt) : Number.MAX_SAFE_INTEGER;
  const eventSeq = getEventSeq(event);
  const eventMessageSeq = getEventMessageSeq(event);
  const hasEventMessageSeq = eventMessageSeq > 0;
  const eventTime = toOpenClawTimestampMs(event.createdAt);
  const terminalEvent = event.kind === "run.completed" || event.kind === "run.failed" || event.kind === "run.interrupted";
  const upperSeqMatches = terminalEvent
    ? assistantSeq <= 0 || eventSeq >= assistantSeq
    : assistantSeq <= 0 || eventSeq <= assistantSeq;
  const upperMessageSeqMatches = terminalEvent
    ? assistantSeq <= 0 || eventMessageSeq >= assistantSeq
    : assistantSeq <= 0 || eventMessageSeq <= assistantSeq;
  const upperTimeBuffer = terminalEvent ? 60_000 : 1_000;
  const upperTimeLimit = Math.min(assistantTime + upperTimeBuffer, nextUserTime - 1);
  const beforeNextUserBySeq = nextUserSeq > 0 ? eventSeq < nextUserSeq : !nextUserMessage || eventTime < nextUserTime;
  const beforeNextUserByMessageSeq = nextUserSeq > 0 ? eventMessageSeq < nextUserSeq : !nextUserMessage || eventTime < nextUserTime;
  const lowerTimeTolerance = hasAssistantBoundary ? 8_000 : 500;
  const ledgerEventBelongs =
    hasOpenClawLedgerEvent(event) &&
    eventTime >= userTime - lowerTimeTolerance &&
    beforeNextUserBySeq;
  if (ledgerEventBelongs) {
    return true;
  }

  const matchesBySeq =
    hasAssistantBoundary &&
    !hasEventMessageSeq &&
    eventSeq > 0 &&
    userSeq > 0 &&
    eventSeq > userSeq &&
    beforeNextUserBySeq &&
    upperSeqMatches;
  const matchesByMessageSeq =
    eventMessageSeq > 0 &&
    (hasAssistantBoundary
      ? userSeq > 0 &&
        eventMessageSeq > userSeq &&
        beforeNextUserByMessageSeq &&
        upperMessageSeqMatches
      : userSeq > 0 && eventMessageSeq === userSeq);
  const hasEarlierSequencedEvent =
    userSeq > 0 &&
    (hasEventMessageSeq ? eventMessageSeq < userSeq : eventSeq > 0 && eventSeq < userSeq);
  const matchesByTime =
    !hasEarlierSequencedEvent &&
    eventTime >= userTime - lowerTimeTolerance &&
    eventTime <= upperTimeLimit;

  return matchesBySeq || matchesByMessageSeq || matchesByTime;
}

function getOpenClawEventKey(event: OpenClawTimelineEvent, fallback = ""): string {
  return event.id || `${event.sessionId || ""}:${event.seq || ""}:${event.kind || ""}:${event.createdAt || ""}:${fallback}`;
}

function collectOpenClawEventsForAssistant(
  events: OpenClawTimelineEvent[],
  consumedEventIds: Set<string>,
  userMessage: OpenClawMessage,
  assistantMessage: OpenClawMessage | null,
  nextUserMessage: OpenClawMessage | null = null
): OpenClawTimelineEvent[] {
  const turnEvents: OpenClawTimelineEvent[] = [];

  for (const event of events) {
    if (!isOpenClawActivityEvent(event) && !isOpenClawOutputFilesEvent(event) && !isOpenClawAnswerEvent(event)) {
      continue;
    }

    const content = getOpenClawEventReasoningText(event);
    const eventKey = getOpenClawEventKey(event, content);
    if (consumedEventIds.has(eventKey)) continue;
    if (!eventBelongsToTurn(event, userMessage, assistantMessage, nextUserMessage)) continue;

    consumedEventIds.add(eventKey);
    turnEvents.push(event);
  }

  return turnEvents;
}

function collectReasoningFromEvents(events: OpenClawTimelineEvent[]): string {
  return mergeReasoningParts(events.map((event) => getOpenClawEventReasoningText(event)));
}

function getOpenClawLedgerGroupKey(event: OpenClawTimelineEvent): string {
  return getOpenClawLedgerTurnId(event) || getOpenClawLedgerActiveRequestId(event) || getOpenClawLedgerRunId(event);
}

function collectCanonicalLedgerTurnGroups(events: OpenClawTimelineEvent[]): OpenClawTimelineEvent[][] {
  const groups = new Map<string, OpenClawTimelineEvent[]>();
  for (const event of events) {
    if (!hasOpenClawLedgerEvent(event)) continue;
    const groupKey = getOpenClawLedgerGroupKey(event);
    if (!groupKey) continue;
    const current = groups.get(groupKey) || [];
    current.push(event);
    groups.set(groupKey, current);
  }

  return [...groups.values()]
    .map((group) => group.sort((left, right) => getEventSeq(left) - getEventSeq(right)))
    .filter((group) =>
      group.some(
        (event) =>
          hasOpenClawLedgerAnswerEvent(event) ||
          event.kind === "assistant.thinking" ||
          event.kind === "tool.call" ||
          event.kind === "tool.result" ||
          event.kind === "process.step" ||
          event.kind === "run.failed" ||
          event.kind === "run.interrupted"
      )
    )
    .sort((left, right) => getEventSeq(left[0]) - getEventSeq(right[0]));
}

type OpenClawVisibleMessageTurn = {
  userMessage: OpenClawMessage;
  assistantMessage: OpenClawMessage | null;
};

type CanonicalLedgerTurnGroup = {
  events: OpenClawTimelineEvent[];
  key: string;
  activeRequestId: string;
  activeRequestTime: number;
  firstTime: number;
  lastTime: number;
  firstSeq: number;
  hasAnswer: boolean;
};

function summarizeCanonicalLedgerTurnGroup(events: OpenClawTimelineEvent[]): CanonicalLedgerTurnGroup {
  const sortedEvents = [...events].sort((left, right) => getEventSeq(left) - getEventSeq(right));
  const firstEvent = sortedEvents[0];
  const key = firstEvent ? getOpenClawLedgerGroupKey(firstEvent) : "";
  const activeRequestId = sortedEvents.map(getOpenClawLedgerActiveRequestId).find(Boolean) || "";
  const eventTimes = sortedEvents
    .map((event) => toOpenClawOptionalTimestampMs(event.createdAt))
    .filter((time) => time > 0);

  return {
    events: sortedEvents,
    key,
    activeRequestId,
    activeRequestTime: parseOpenClawActiveRequestTimestampMs(activeRequestId),
    firstTime: eventTimes.length ? Math.min(...eventTimes) : 0,
    lastTime: eventTimes.length ? Math.max(...eventTimes) : 0,
    firstSeq: firstEvent ? getEventSeq(firstEvent) : 0,
    hasAnswer: sortedEvents.some(hasOpenClawLedgerAnswerEvent),
  };
}

function scoreCanonicalLedgerGroupForMessageTurn(
  group: CanonicalLedgerTurnGroup,
  turn: OpenClawVisibleMessageTurn,
  nextTurn?: OpenClawVisibleMessageTurn
): number {
  const userTime = toOpenClawOptionalTimestampMs(turn.userMessage.createdAt);
  const assistantTime = toOpenClawOptionalTimestampMs(turn.assistantMessage?.createdAt);
  const nextUserTime = toOpenClawOptionalTimestampMs(nextTurn?.userMessage.createdAt);
  const anchorTime = group.activeRequestTime || group.firstTime;
  if (!userTime || !anchorTime) return 0;

  const nextBoundary = nextUserTime || Number.POSITIVE_INFINITY;
  if (anchorTime >= nextBoundary - 250) return 0;
  if (group.lastTime && group.lastTime < userTime - 60_000) return 0;

  let score = 0;
  if (group.activeRequestTime) {
    const distance = Math.abs(group.activeRequestTime - userTime);
    if (distance > 30_000) return 0;
    score += 1_000 - Math.min(distance / 10, 300);
  }

  if (group.firstTime >= userTime - 15_000 && group.firstTime < nextBoundary) {
    score += 240;
    score -= Math.min(Math.abs(group.firstTime - userTime) / 1_000, 120);
  } else if (!group.activeRequestTime) {
    return 0;
  }

  if (assistantTime && group.hasAnswer && group.lastTime) {
    const assistantDistance = Math.abs(group.lastTime - assistantTime);
    if (assistantDistance <= 90_000) {
      score += 320 - Math.min(assistantDistance / 1_000, 180);
    }
  }

  const userSeq = getMessageSeq(turn.userMessage);
  const assistantSeq = getMessageSeq(turn.assistantMessage);
  if (userSeq > 0 && assistantSeq > 0 && group.firstSeq > 0 && group.firstSeq > userSeq && group.firstSeq <= assistantSeq + 5) {
    score += 120;
  }

  // 内容匹配 boost：ledger group 里有 user.message 事件，其 content 与 turn 的 user
  // 内容一致时，给一个很重的加分（500）。这条规则用来压过时间启发式导致的错挂
  // （例如 ws-17150 的内容 "✅ emoji 就是这个" 与 legacy:1 "✅ emoji 就是这个" 同时段，
  // 仅靠时间会挂错；内容一致能让正确 group 胜出）。
  //
  // ws-* 原始帧里 turn.userMessage.content 是整段 ChatCompletionRequest JSON，需要先
  // 解出 messages[0].content 再比对，否则 ledger user.message 的纯文本永远对不上。
  const rawUserContent = String(turn.userMessage.content || "");
  const unwrappedUserContent = tryParseOpenClawRawChatCompletionFrame(rawUserContent) || rawUserContent;
  const userQuestion = normalizeOpenClawMergeText(unwrappedUserContent);
  if (userQuestion) {
    for (const event of group.events) {
      if (!isOpenClawUserMessageEvent(event)) continue;
      const eventContent = normalizeOpenClawMergeText(getOpenClawUserEventContent(event));
      if (eventContent && eventContent === userQuestion) {
        score += 500;
        break;
      }
    }
  }

  return Math.max(0, score);
}

function findCanonicalLedgerGroupForMessageTurn(
  turn: OpenClawVisibleMessageTurn,
  index: number,
  messageTurns: OpenClawVisibleMessageTurn[],
  groups: CanonicalLedgerTurnGroup[],
  consumedGroups: Set<string>
): { group: CanonicalLedgerTurnGroup } | null {
  const scored = groups
    .map((group) => {
      const score = scoreCanonicalLedgerGroupForMessageTurn(group, turn, messageTurns[index + 1]);
      return { group, score };
    })
    .filter((candidate) => !consumedGroups.has(candidate.group.key) && candidate.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.group.firstSeq - right.group.firstSeq;
    });

  if (scored.length > 0) {
    return { group: scored[0]!.group };
  }

  if (messageTurns.length === 1 && groups.length === 1 && !consumedGroups.has(groups[0]!.key)) {
    return { group: groups[0]! };
  }

  return null;
}

function collectOpenClawVisibleMessageTurns(
  messages: OpenClawMessage[],
  scopedEvents: OpenClawTimelineEvent[] = [],
) {
  const turns: OpenClawVisibleMessageTurn[] = [];
  let pendingUserMessage: OpenClawMessage | null = null;
  let pendingAssistantMessage: OpenClawMessage | null = null;
  // Orphan assistant 缓冲：消息流不保证 createdAt 顺序时，assistant 可能先于其 user
  // 到达。挂到错误 turn 的 assistant 会在 flush 时污染上一个 user。先按 turnKey 收着，
  // 等匹配的 user 出现再挂回去；同一 turn 内仍出现多个 assistant 时，沿用
  // shouldReplaceOpenClawPendingAssistant 的"取更完整内容"语义。
  const orphanAssistantByTurnKey = new Map<string, OpenClawMessage>();

  const flush = () => {
    if (!pendingUserMessage) return;
    turns.push({ userMessage: pendingUserMessage, assistantMessage: pendingAssistantMessage });
    pendingUserMessage = null;
    pendingAssistantMessage = null;
  };

  for (const item of messages) {
    if (item.role === "user") {
      if (isOpenClawInternalControlUserMessage(item)) {
        flush();
        continue;
      }

      if (isOpenClawSenderMetadataMessage(item)) {
        if (pendingUserMessage) {
          pendingUserMessage = applyOpenClawSenderMetadataSeqToUserMessage(pendingUserMessage, item);
        }
        continue;
      }

      flush();
      pendingUserMessage = enrichOpenClawUserMessageFromEvents(item, scopedEvents);
      pendingAssistantMessage = null;

      // 之前到达的 orphan assistant 现在能挂回对应 turn 了。
      const userTurnKey = getOpenClawMessageTurnKey(pendingUserMessage);
      if (userTurnKey) {
        const buffered = orphanAssistantByTurnKey.get(userTurnKey);
        if (buffered && shouldReplaceOpenClawPendingAssistant(pendingAssistantMessage, buffered)) {
          pendingAssistantMessage = buffered;
          orphanAssistantByTurnKey.delete(userTurnKey);
        }
      }
      continue;
    }

    if (item.role === "assistant") {
      if (isOpenClawStatusAssistantContent(item.content)) {
        continue;
      }

      const assistantTurnKey = getOpenClawMessageTurnKey(item);

      if (!pendingUserMessage) {
        // 真孤儿（当前没有 pending user）：缓冲给可能稍后到达的 user。
        if (assistantTurnKey) orphanAssistantByTurnKey.set(assistantTurnKey, item);
        continue;
      }

      // 关键判定：两条消息都解出了 turnKey 时，必须 turnKey 一致才挂载，
      // 否则这是 orphan assistant（其 user 还在流后面），不能污染上一个 turn。
      // 仅在 turnKey 无法解析时回退到原有的 seq/时间检查，避免破坏旧数据路径。
      if (assistantTurnKey) {
        const userTurnKey = getOpenClawMessageTurnKey(pendingUserMessage);
        if (userTurnKey && userTurnKey !== assistantTurnKey) {
          orphanAssistantByTurnKey.set(assistantTurnKey, item);
          continue;
        }
      }

      if (!assistantMessageBelongsToUserTurn(pendingUserMessage, item)) {
        continue;
      }

      if (shouldReplaceOpenClawPendingAssistant(pendingAssistantMessage, item)) {
        pendingAssistantMessage = item;
      }
    }
  }

  flush();
  return turns;
}

function buildOpenClawMessagesFromCanonicalLedger(
  messages: OpenClawMessage[],
  conversationId: string,
  agentId: string | number,
  scopedEvents: OpenClawTimelineEvent[],
  options?: { canonicalOnly?: boolean }
) {
  const messageTurns = collectOpenClawVisibleMessageTurns(messages, scopedEvents);
  const ledgerGroups = collectCanonicalLedgerTurnGroups(scopedEvents).map(summarizeCanonicalLedgerTurnGroup);
  if (!messageTurns.length || !ledgerGroups.length) {
    return null;
  }

  const consumedGroups = new Set<string>();
  const rows = messageTurns
    .map((turn, index) => {
      const matchResult = findCanonicalLedgerGroupForMessageTurn(
        turn,
        index,
        messageTurns,
        ledgerGroups,
        consumedGroups
      );
      const matchedGroup = matchResult?.group || null;
      const turnEvents = matchedGroup?.events || [];
      if (matchedGroup) {
        consumedGroups.add(matchedGroup.key);
      }
      const reasoning = collectReasoningFromEvents(turnEvents);
      const interrupted = turnEvents.some((event) => event.kind === "run.interrupted");
      return buildOpenClawMessageRow(
        turn.userMessage,
        turn.assistantMessage,
        conversationId,
        agentId,
        reasoning,
        interrupted,
        turnEvents,
        options
      );
    });

  return rows.filter(shouldKeepOpenClawMessageRow);
}

function buildOpenClawMessagesFromLedgerOnly(
  events: OpenClawTimelineEvent[],
  conversationId: string,
  agentId: string | number,
  options?: { canonicalOnly?: boolean }
) {
  const scopedEvents = filterSupersededHistoryThinkingEvents(
    events
      .filter((event) => event.sessionId === conversationId)
      .sort((left, right) => getEventSeq(left) - getEventSeq(right))
  );
  const groups = new Map<string, OpenClawTimelineEvent[]>();

  for (const event of scopedEvents) {
    const turnId = getOpenClawTimelineTurnId(event);
    if (!turnId) continue;
    const group = groups.get(turnId) || [];
    group.push(event);
    groups.set(turnId, group);
  }

  const rows = [...groups.entries()]
    .map(([turnId, turnEvents]) => {
      const orderedTurnEvents = [...turnEvents].sort((left, right) => getEventSeq(left) - getEventSeq(right));
      const firstEvent = orderedTurnEvents[0];
      if (!firstEvent) return null;

      const questionEvent =
        orderedTurnEvents.find((event) => isOpenClawQuestionSeedEvent(event) && getOpenClawUserEventContent(event)) ||
        orderedTurnEvents.find(isOpenClawQuestionSeedEvent);
      const question = getOpenClawUserEventContent(questionEvent) || "";
      if (!question.trim()) return null;
      const questionSeq = getEventSeq(questionEvent || firstEvent);
      const reasoning = collectReasoningFromEvents(orderedTurnEvents);
      const interrupted = orderedTurnEvents.some((event) => event.kind === "run.interrupted");

      return buildOpenClawMessageRow(
        {
          id: `${turnId}:ledger-user`,
          sessionId: conversationId,
          role: "user",
          content: question,
          createdAt: questionEvent?.createdAt || firstEvent.createdAt,
          payload: {
            ...(questionSeq > 0 ? { rawSeq: questionSeq } : {}),
            recoveredFromEvent: true,
          },
        },
        null,
        conversationId,
        agentId,
        reasoning,
        interrupted,
        orderedTurnEvents,
        options
      );
    })
    .filter((row): row is any => Boolean(row))
    .filter(shouldKeepOpenClawMessageRow);

  return rows.length ? rows : null;
}

function paginateOpenClawProjectedRows(rows: any[], params?: { offset?: number; limit?: number }) {
  const total = rows.length;
  const requestedOffset = Number(params?.offset || 0);
  const offset = Number.isFinite(requestedOffset) && requestedOffset > 0 ? Math.floor(requestedOffset) : 0;
  const requestedLimit = Number(params?.limit || 0);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.floor(requestedLimit) : total;
  const pageRows = rows.slice(offset, offset + limit);
  const nextOffset = offset + pageRows.length;

  return {
    rows: pageRows,
    pagination: {
      limit,
      offset,
      total,
      hasMore: nextOffset < total,
      nextOffset,
    },
  };
}

function readOpenClawProcessStep(event: OpenClawTimelineEvent): any {
  const payload = event.payload || {};
  return (payload as any).process_step || (payload as any).data?.process_step || {};
}

function isOpenClawAnswerEvent(event?: OpenClawTimelineEvent | null): boolean {
  return Boolean(
    event &&
      (event.kind === "assistant.message" ||
        event.kind === "assistant.message.delta" ||
        event.kind === "assistant.delta")
  );
}

function isOpenClawTimelineReplaceEvent(event: OpenClawTimelineEvent): boolean {
  const payload = event.payload || {};
  return (
    (event as any).replace === true ||
    (event as any).mode === "replace" ||
    (payload as any).replace === true ||
    (payload as any).mode === "replace"
  );
}

function isOpenClawOutputFilesEvent(event?: OpenClawTimelineEvent | null): boolean {
  if (!event || event.kind !== "process.step") return false;
  const step = readOpenClawProcessStep(event);
  return step?.step_code === "output_files" && step?.status === "completed";
}

function normalizeOpenClawOutputFiles(value: unknown): OutputFile[] {
  return decodeOutputFiles(value);
}

function buildOpenClawOutputProcessRecords(events: OpenClawTimelineEvent[]): any[] {
  return events
    .filter(isOpenClawOutputFilesEvent)
    .map((event) => {
      const step = readOpenClawProcessStep(event);
      return {
        step_code: "output_files",
        status: "completed",
        message: step.message || "生成文件",
        data: step.data || {},
        _timeline_event_id: event.id,
        _timeline_seq: getEventSeq(event),
        _timeline_created_at: event.createdAt,
      };
    });
}

function outputFilesFromOpenClawProcessRecords(records: any[]): any[] {
  const files: any[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const data = record?.data || {};
    const candidates = [
      ...normalizeOpenClawOutputFiles(data.files),
      ...normalizeOpenClawOutputFiles(data.media_attachments),
    ];
    for (const file of candidates) {
      const key = `${file.id || ""}|${file.url || ""}|${file.file_name || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      files.push(file);
    }
  }
  return files;
}

function isOpenClawHistoricalFileReference(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^https?:\/\//i.test(trimmed) || /^file:\/\//i.test(trimmed)) return true;
  return /^\/[^:]+/.test(trimmed);
}

function getOpenClawFileNameFromReference(value: string): string {
  const fallback = "附件";
  try {
    const parsed = new URL(value);
    const fromPath = parsed.pathname.split("/").filter(Boolean).pop();
    return fromPath ? decodeURIComponent(fromPath) : fallback;
  } catch {
    const fromPath = value.split(/[\\/]/).filter(Boolean).pop();
    return fromPath ? decodeURIComponent(fromPath) : fallback;
  }
}

function inferOpenClawFileMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const mimeByExt: Record<string, string> = {
    csv: "text/csv",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    gif: "image/gif",
    htm: "text/html",
    html: "text/html",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    json: "application/json",
    md: "text/markdown",
    pdf: "application/pdf",
    png: "image/png",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain",
    webp: "image/webp",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  return mimeByExt[ext] || "application/octet-stream";
}

function buildOpenClawHistoricalUploadedFile(ref: string, localPath = "") {
  const isUrl = /^https?:\/\//i.test(ref) || /^file:\/\//i.test(ref);
  const fileName = getOpenClawFileNameFromReference(localPath || ref);
  return {
    id: ref,
    name: fileName,
    file_name: fileName,
    filename: fileName,
    mime_type: inferOpenClawFileMimeType(fileName),
    ...(localPath ? { file_path: localPath } : {}),
    ...(isUrl ? { url: ref, preview_url: ref, download_url: ref } : { file_path: ref }),
  };
}

function asOpenClawRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readOpenClawMessageMetadata(message: OpenClawMessage): Record<string, unknown> {
  return {
    ...asOpenClawRecord(message.payload),
    ...asOpenClawRecord(message.data),
    ...asOpenClawRecord(message.metadata),
  };
}

function normalizeOpenClawSkillFromMessage(message: OpenClawMessage): any | null {
  const metadata = readOpenClawMessageMetadata(message);
  const skill = asOpenClawRecord(metadata.openclaw_skill);
  const skillName = readStringValue(skill.skill_name, skill.name);
  const displayName = readStringValue(skill.display_name, skill.displayName, skillName);
  if (!skillName && !displayName) {
    return null;
  }
  return {
    ...(skill.id ? { id: skill.id } : {}),
    ...(skill.skill_id ? { skill_id: skill.skill_id } : {}),
    skill_name: skillName,
    display_name: displayName,
  };
}

function normalizeOpenClawInputFilesFromMessage(message: OpenClawMessage): any[] {
  const metadata = readOpenClawMessageMetadata(message);
  const rawFiles = Array.isArray(metadata.openclaw_input_files) ? metadata.openclaw_input_files : [];
  return rawFiles
    .map((file) => normalizeOpenClawInputFile(file))
    .filter(Boolean);
}

function normalizeOpenClawInputFile(value: unknown): any | null {
  const file = asOpenClawRecord(value);
  if (!Object.keys(file).length) {
    return null;
  }
  const localPath = readStringValue(file.local_path, file.file_path, file.path);
  const previewUrl = readStringValue(file.preview_url, file.previewUrl, file.url);
  const downloadUrl = readStringValue(file.download_url, file.signed_download_url, file.downloadUrl, file.url);
  const url = previewUrl || downloadUrl || readStringValue(file.url);
  const explicitFileName = readStringValue(file.file_name, file.filename, file.name);
  const fileName = explicitFileName || getOpenClawFileNameFromReference(localPath || url || readStringValue(file.id));
  const size = readNumberValue(file.size, file.file_size);
  return {
    id: readStringValue(file.id, file.file_id, file.upload_file_id, file.artifact_id, url, localPath, fileName),
    name: fileName,
    file_name: fileName,
    filename: fileName,
    mime_type: readStringValue(file.mime_type, file.file_mime) || inferOpenClawFileMimeType(fileName),
    ...(size > 0 ? { size } : {}),
    ...(localPath ? { file_path: localPath, local_path: localPath } : {}),
    ...(url ? { url } : {}),
    ...(previewUrl || url ? { preview_url: previewUrl || url } : {}),
    ...(downloadUrl || url ? { download_url: downloadUrl || url } : {}),
    ...(file.signed_download_url ? { signed_download_url: file.signed_download_url } : {}),
    ...(file.upload_file_id ? { upload_file_id: file.upload_file_id } : {}),
    ...(file.artifact_id ? { artifact_id: file.artifact_id } : {}),
  };
}

function dedupeOpenClawFiles(files: any[]): any[] {
  const seen = new Set<string>();
  const output: any[] = [];
  for (const file of files) {
    const key = `${file?.id || ""}|${file?.url || ""}|${file?.preview_url || ""}|${file?.file_path || ""}|${file?.file_name || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(file);
  }
  return output;
}

function stripOpenClawRuntimePromptSections(content: string): string {
  const selectedSkillMatch = content.match(/(?:^|\n)\s*Selected skill:\s*\/?([^\s\n]+)/i);
  const selectedSkillName = selectedSkillMatch?.[1] || "";
  let stripped = content.replace(/<53aihub-openclaw-runtime-context>[\s\S]*?<\/53aihub-openclaw-runtime-context>/gi, "");
  const lines = stripped.split(/\r?\n/);
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || "";
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("53aihub selected skill instructions for ")) {
      break;
    }
    if (lower === "attached files:" || lower === "selected local files:" || lower === "local input files:") {
      while (index + 1 < lines.length && (lines[index + 1] || "").trim()) {
        index += 1;
      }
      continue;
    }
    if (lower.startsWith("selected skill:")) {
      continue;
    }
    if (lower.startsWith("follow these instructions for this turn")) {
      continue;
    }
    if (/^@(?:\/|~\/)/.test(trimmed)) {
      continue;
    }
    kept.push(line);
  }
  stripped = kept.join("\n").trim();
  if (selectedSkillName) {
    stripped = stripped.replace(new RegExp(`^/${selectedSkillName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`), "");
  }
  return stripped.trim();
}

function stripSelectedOpenClawSkillPrefix(question: string, sourceContent: string): string {
  const selectedSkillMatch = sourceContent.match(/(?:^|\n)\s*Selected skill:\s*\/?([^\s\n]+)/i);
  const selectedSkillName = selectedSkillMatch?.[1] || "";
  if (!selectedSkillName) {
    return question.trim();
  }
  return question
    .replace(new RegExp(`^/${selectedSkillName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`), "")
    .trim();
}

function extractOpenClawHistoricalUserFiles(content?: string | null): { question: string; files: any[] } {
  const raw = String(content || "");
  const lines = raw.split(/\r?\n/);
  let filesLineIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const marker = lines[index]?.trim().toLowerCase();
    if (marker === "files:" || marker === "attached files:") {
      filesLineIndex = index;
      break;
    }
  }
  if (filesLineIndex < 0) {
    return { question: stripOpenClawRuntimePromptSections(raw), files: [] };
  }

  const refs = lines
    .slice(filesLineIndex + 1)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(isOpenClawHistoricalFileReference);
  if (!refs.length) {
    return { question: stripOpenClawRuntimePromptSections(raw), files: [] };
  }

  const pendingLocalPaths: string[] = [];
  const files: any[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const isUrl = /^https?:\/\//i.test(ref) || /^file:\/\//i.test(ref);
    if (!isUrl) {
      pendingLocalPaths.push(ref);
      continue;
    }
    const localPath = pendingLocalPaths.shift() || "";
    const key = `${ref}|${localPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    files.push(buildOpenClawHistoricalUploadedFile(ref, localPath));
  }

  for (const localPath of pendingLocalPaths) {
    if (seen.has(localPath)) continue;
    seen.add(localPath);
    files.push(buildOpenClawHistoricalUploadedFile(localPath));
  }

  if (!files.length) {
    return { question: stripOpenClawRuntimePromptSections(raw), files: [] };
  }

  return {
    question: stripSelectedOpenClawSkillPrefix(
      stripOpenClawRuntimePromptSections(lines.slice(0, filesLineIndex).join("\n")),
      raw
    ),
    files,
  };
}

function getOpenClawAnswerSeq(
  turnEvents: OpenClawTimelineEvent[],
  assistantMessage: OpenClawMessage | null,
  userMessage: OpenClawMessage
): number | undefined {
  const answerEvent = [...turnEvents].reverse().find(isOpenClawAnswerEvent);
  if (typeof answerEvent?.seq === "number" && Number.isFinite(answerEvent.seq)) {
    return answerEvent.seq;
  }

  const maxTurnSeq = turnEvents.reduce((maxSeq, event) => {
    const seq = getEventSeq(event);
    return seq > maxSeq ? seq : maxSeq;
  }, 0);
  if (maxTurnSeq > 0) {
    return maxTurnSeq + 1;
  }

  const assistantSeq = getMessageSeq(assistantMessage);
  if (assistantSeq > 0) return assistantSeq;

  const userSeq = getMessageSeq(userMessage);
  return userSeq > 0 ? userSeq + 1 : undefined;
}

function hasInterruptedEventForAssistant(
  events: OpenClawTimelineEvent[],
  userMessage: OpenClawMessage,
  assistantMessage: OpenClawMessage | null
): boolean {
  const userSeq = getMessageSeq(userMessage);
  const assistantSeq = getMessageSeq(assistantMessage);
  const hasAssistantBoundary = Boolean(assistantMessage);
  const userTime = toOpenClawTimestampMs(userMessage.createdAt);
  const assistantTime = assistantMessage ? toOpenClawTimestampMs(assistantMessage.createdAt) : Number.MAX_SAFE_INTEGER;

  return events.some((event) => {
    if (event.kind !== "run.interrupted") return false;

    const eventSeq = getEventSeq(event);
    const eventMessageSeq = getEventMessageSeq(event);
    const hasEventMessageSeq = eventMessageSeq > 0;
    const eventTime = toOpenClawTimestampMs(event.createdAt);
    const matchesBySeq =
      hasAssistantBoundary &&
      !hasEventMessageSeq &&
      eventSeq > 0 &&
      (userSeq <= 0 || eventSeq > userSeq) &&
      (assistantSeq <= 0 || eventSeq >= assistantSeq);
    const matchesByMessageSeq =
      eventMessageSeq > 0 &&
      (hasAssistantBoundary
        ? (userSeq <= 0 || eventMessageSeq > userSeq) &&
          (assistantSeq <= 0 || eventMessageSeq >= assistantSeq)
        : userSeq > 0 && eventMessageSeq === userSeq);
    const hasEarlierSequencedEvent =
      userSeq > 0 &&
      (hasEventMessageSeq ? eventMessageSeq < userSeq : eventSeq > 0 && eventSeq < userSeq);
    const matchesByTime =
      !hasEarlierSequencedEvent &&
      eventTime >= userTime - 8000 &&
      eventTime <= assistantTime + 60_000;

    return matchesBySeq || matchesByMessageSeq || matchesByTime;
  });
}

export function buildOpenClawConversation(session: OpenClawSession, agentId: string | number) {
  const createdTime = toOpenClawTimestampMs(session.createdAt || session.updatedAt);
  const updatedTime = toOpenClawTimestampMs(session.updatedAt || session.createdAt);

  return {
    conversation_id: session.id,
    agent_id: agentId,
    title: session.title || session.id || "OpenClaw 会话",
    created_time: createdTime,
    updated_time: updatedTime,
    top: 0,
    is_valid: 1,
    openclaw_status: session.status,
    openclaw_host_kind: session.hostKind,
    has_cached_history: session.has_cached_history ?? session.hasCachedHistory,
    raw: session,
  };
}

function buildOpenClawMessageRow(
  userMessage: OpenClawMessage,
  assistantMessage: OpenClawMessage | null,
  conversationId: string,
  agentId: string | number,
  reasoning = "",
  interrupted = false,
  turnEvents: OpenClawTimelineEvent[] = [],
  options?: { canonicalOnly?: boolean }
) {
  const createdMs = toOpenClawTimestampMs(userMessage.createdAt || assistantMessage?.createdAt);
  const updatedMs = toOpenClawTimestampMs(assistantMessage?.createdAt || userMessage.createdAt);
  const reasoningContent = mergeReasoningParts([reasoning, getOpenClawMessageReasoning(assistantMessage)]);
  const primaryTurnEvents = filterOpenClawEventsToPrimaryLedgerTurn(turnEvents);
  const outputProcessRecords = buildOpenClawOutputProcessRecords(primaryTurnEvents);
  const answerSeq = getOpenClawAnswerSeq(primaryTurnEvents, assistantMessage, userMessage);
  const historicalUserContent = extractOpenClawHistoricalUserFiles(userMessage.content || "");
  const persistedAssistantAnswer = sanitizeOpenClawAnswer(assistantMessage?.content || "", reasoningContent).trim();
  const hasPersistedAssistantAnswer = !isOpenClawDiscardableAssistantContent(persistedAssistantAnswer);
  const hasCanonicalAnswerEvent = primaryTurnEvents.some(hasOpenClawLedgerAnswerEvent);
  const historicalUserFiles = dedupeOpenClawFiles([
    ...normalizeOpenClawInputFilesFromMessage(userMessage),
    ...historicalUserContent.files,
  ]);
  const historicalUserSkill = normalizeOpenClawSkillFromMessage(userMessage);

  const normalizedTurnEvents: OpenClawTurnEvent[] = primaryTurnEvents
    .filter((event) => !(hasPersistedAssistantAnswer && !hasCanonicalAnswerEvent && isOpenClawAnswerEvent(event)))
    .map((event) => ({
      eventId: event.id || `${conversationId}:${event.kind}:${event.seq || ""}:${event.createdAt || ""}`,
      sessionId: event.sessionId || conversationId,
      seq: event.seq,
      kind: event.kind,
      payload: event.payload,
      createdAt: event.createdAt,
      source: "history" as const,
      replace: isOpenClawTimelineReplaceEvent(event),
      messageSeq: getEventMessageSeq(event),
    }));

  if (reasoningContent && !normalizedTurnEvents.some((event) => event.kind === "assistant.thinking")) {
    normalizedTurnEvents.unshift({
      eventId: `${conversationId}:history:thinking:${answerSeq || userMessage.id}`,
      sessionId: conversationId,
      seq: answerSeq ? Math.max(answerSeq - 1, 1) : 1,
      kind: "assistant.thinking",
      payload: { content: reasoningContent },
      createdAt: assistantMessage?.createdAt || userMessage.createdAt,
      source: "history",
    });
  }

  if (hasPersistedAssistantAnswer && !hasCanonicalAnswerEvent) {
    normalizedTurnEvents.push({
      eventId: `${conversationId}:history:answer:${assistantMessage?.id || userMessage.id}`,
      sessionId: conversationId,
      seq: answerSeq || undefined,
      kind: "assistant.message",
      payload: {
        content: persistedAssistantAnswer,
      },
      createdAt: assistantMessage?.createdAt || userMessage.createdAt,
      source: "history",
      messageId: assistantMessage?.id || userMessage.id,
      messageSeq: answerSeq || undefined,
    });
  }

  const replayStatus = interrupted
    ? "interrupted"
    : normalizedTurnEvents.some((event) => event.kind === "run.failed")
      ? "failed"
      : assistantMessage || normalizedTurnEvents.some((event) => event.kind === "run.completed")
        ? "completed"
        : normalizedTurnEvents.length
          ? "streaming"
          : "completed";
  const turn = appendOpenClawEvents(
    createOpenClawTurnState({
      sessionId: conversationId,
      turnKey: buildOpenClawTurnKey({
        sessionId: conversationId,
        messageId: assistantMessage?.id || userMessage.id,
        turnStartSeq: getMessageSeq(userMessage),
      }),
      status: replayStatus,
    }),
    normalizedTurnEvents
  );
  let projection = projectOpenClawTurn(turn, {
    isStreaming: false,
    canonicalOnly: Boolean(options?.canonicalOnly),
  });
  if (hasPersistedAssistantAnswer && shouldPreferPersistedOpenClawAnswer(projection, persistedAssistantAnswer)) {
    projection = applyPersistedAnswerToOpenClawProjection(projection, persistedAssistantAnswer);
  }

  const row = {
    id: assistantMessage?.id || userMessage.id,
    role: "assistant" as const,
    agent_id: agentId,
    conversation_id: conversationId,
    question: historicalUserContent.question,
    message: JSON.stringify([{ role: "user", content: historicalUserContent.question }]),
    answer: projection.visibleAnswer,
    interrupted,
    reasoning_content: "",
    reasoning_expanded: false,
    openclawTurn: turn,
    openclawProjection: projection,
    openclawActivities: projection.activities,
    openclawTimelineItems: projection.timelineItems,
    created_time: createdMs,
    updated_time: updatedMs,
    created_at: Math.floor(createdMs / 1000),
    updated_at: Math.floor(updatedMs / 1000),
    process_records: outputProcessRecords,
    outputFiles: outputFilesFromOpenClawProcessRecords(outputProcessRecords),
    uploaded_files: historicalUserFiles,
    ...(historicalUserSkill ? { skill: historicalUserSkill } : {}),
    rag_stats: null,
    raw_user_message: userMessage,
    raw_assistant_message: assistantMessage,
    _openclawTurnStartSeq: getMessageSeq(userMessage) || undefined,
  };
  syncOpenClawProjectionToMessage(row as any, projection);
  row.reasoning_content = "";
  return row;
}

function isOpenClawSyntheticQuestionRow(row: any): boolean {
  const rawQuestion = row?.raw_user_message?.content;
  if (typeof rawQuestion === "string") {
    return rawQuestion.trim() === "" ||
      isOpenClawSenderMetadataContent(rawQuestion) ||
      isOpenClawInternalControlUserContent(rawQuestion);
  }

  try {
    const messages = JSON.parse(row?.message || "[]");
    return Array.isArray(messages) && messages.every((item) => !String(item?.content || "").trim());
  } catch {
    return false;
  }
}

function canMergeOpenClawSyntheticQuestionRow(row: any): boolean {
  const rawQuestion = row?.raw_user_message?.content;
  return typeof rawQuestion === "string" && isOpenClawSenderMetadataContent(rawQuestion);
}

function hasRenderableOpenClawAssistantSurface(row: any): boolean {
  return Boolean(
    String(row?.answer || "").trim() ||
      row?.openclawProjection?.visibleAnswer?.trim() ||
      row?.openclawProjection?.timelineItems?.length ||
      row?.openclawProjection?.outputFiles?.length ||
      row?.openclawTimelineItems?.length ||
      row?.outputFiles?.length ||
      row?.loading
  );
}

function shouldKeepOpenClawMessageRow(row: any): boolean {
  const question = String(row?.question || row?.raw_user_message?.content || "").trim();
  if (isOpenClawInternalControlUserContent(question) && !hasRenderableOpenClawAssistantSurface(row)) {
    return false;
  }
  // legacy in-progress running 快照（messages.txt legacy:4 形态）：
  // 原 assistantMessage.payload.openclawProjection.status="running" 且没有可渲染表面 → 丢弃。
  // 投影本身（row.openclawProjection）只在 isStreaming/interrupted/failed 上有信号，
  // status 字段在 rebuild 时被丢掉；这里直接回查 raw_assistant_message 上的原 status。
  // 实时流式 row 通常带 `row.loading=true`，hasRenderable 已覆盖 loading 分支，
  // 这里只命中「cached + running + 空回答」这条具体死路径。
  const cachedAssistantStatus = row?.raw_assistant_message?.payload?.openclawProjection?.status;
  if (cachedAssistantStatus === "running" && !hasRenderableOpenClawAssistantSurface(row)) {
    return false;
  }
  // messages.txt 实际返回里 legacy:4 的 assistant 帧没有 payload（status 字段缺失），
  // 投影时只能拿到 question 没 assistant；原 ws-* 流里它就是「问了同一句但没回答」的孤儿
  // user 帧。这种"问题有 / 回答完全空 / 不是实时流"的 row 也直接丢，靠后续的
  // collapseDuplicateIntermediate 反向窗口兜底同 question 的更完整 row。
  const isLiveStreamingRow = Boolean(row?.loading);
  if (
    !isLiveStreamingRow &&
    !hasRenderableOpenClawAssistantSurface(row) &&
    !row?.raw_assistant_message?.content?.trim?.()
  ) {
    return false;
  }
  return Boolean(question || hasRenderableOpenClawAssistantSurface(row));
}

function mergeAdjacentOpenClawAssistantRows(rows: any[]): any[] {
  const merged: any[] = [];

  for (const row of rows) {
    const previous = merged[merged.length - 1];
    if (previous && isOpenClawSyntheticQuestionRow(row) && canMergeOpenClawSyntheticQuestionRow(row)) {
      if (previous.openclawTurn && row.openclawTurn) {
        previous.openclawTurn = appendOpenClawEvents(previous.openclawTurn, row.openclawTurn.events);
        previous.openclawProjection = projectOpenClawTurn(previous.openclawTurn, { isStreaming: false });
        syncOpenClawProjectionToMessage(previous, previous.openclawProjection);
        previous.reasoning_content = "";
      } else {
        previous.answer = row.answer || previous.answer;
        previous.reasoning_content = mergeReasoningParts([
          previous.reasoning_content || "",
          row.reasoning_content || "",
        ]);
        previous.openclawActivities = mergeOpenClawActivities(previous.openclawActivities || [], row.openclawActivities || []);
      }
      previous.process_records = [
        ...(previous.process_records || []),
        ...(row.process_records || []),
      ];
      previous.outputFiles = mergeOutputFiles(previous.outputFiles || [], row.outputFiles || [], { logicalIdentity: true });
      previous.interrupted = Boolean(previous.interrupted || row.interrupted);
      previous.updated_time = Math.max(previous.updated_time || 0, row.updated_time || 0);
      previous.updated_at = Math.max(previous.updated_at || 0, row.updated_at || 0);
      previous.raw_assistant_message = row.raw_assistant_message || previous.raw_assistant_message;
      continue;
    }

    merged.push(row);
  }

  return merged;
}

function getOpenClawRowOutputFiles(row: any): any[] {
  return [
    ...(Array.isArray(row?.openclawProjection?.outputFiles) ? row.openclawProjection.outputFiles : []),
    ...(Array.isArray(row?.outputFiles) ? row.outputFiles : []),
  ];
}

function rowsShareOpenClawOutputFile(left: any, right: any): boolean {
  const leftKeys = new Set<string>();
  for (const file of getOpenClawRowOutputFiles(left)) {
    for (const key of getOutputFileKeys(file, { logicalIdentity: true })) {
      if (key) leftKeys.add(key);
    }
  }
  if (leftKeys.size === 0) return false;

  for (const file of getOpenClawRowOutputFiles(right)) {
    for (const key of getOutputFileKeys(file, { logicalIdentity: true })) {
      if (key && leftKeys.has(key)) return true;
    }
  }

  return false;
}

function getOpenClawRowTurnStartSeq(row: any): number {
  return readNumberValue(
    row?._openclawTurnStartSeq,
    row?.openclawTurn?.turnStartSeq,
    row?.raw_user_message?.seq,
    row?.raw_user_message?.messageSeq,
    row?.raw_user_message?.message_seq,
    row?.raw_user_message?.payload?.rawSeq,
    row?.raw_user_message?.payload?.messageSeq,
    row?.raw_user_message?.metadata?.rawSeq,
    row?.raw_user_message?.metadata?.messageSeq
  );
}

function rowsShareOpenClawTurnIdentity(left: any, right: any): boolean {
  const leftSeq = getOpenClawRowTurnStartSeq(left);
  const rightSeq = getOpenClawRowTurnStartSeq(right);
  if (leftSeq > 0 && rightSeq > 0) return leftSeq === rightSeq;

  const leftUserId = String(left?.raw_user_message?.id || "");
  const rightUserId = String(right?.raw_user_message?.id || "");
  if (leftUserId && rightUserId) return leftUserId === rightUserId;

  const leftTurnKey = String(left?.openclawTurn?.turnKey || "");
  const rightTurnKey = String(right?.openclawTurn?.turnKey || "");
  return Boolean(leftTurnKey && rightTurnKey && leftTurnKey === rightTurnKey);
}

function isLikelyOpenClawIntermediatePersistedAnswer(answer: string): boolean {
  const normalized = String(answer || "").trim().replace(/\s+/g, " ");
  if (!normalized) return true;
  if (extractOpenClawAnswerFileRefs(normalized).length > 0) return false;
  if (/任务完成|已成功|文件详情|SHA256|输出产物清单已更新/.test(normalized)) return false;
  if (normalized.length <= 80 && /(?:验证|检查|确认|计算|更新).*(?:文件|内容|哈希|SHA256|输出产物|清单)/.test(normalized)) {
    return true;
  }
  return normalized.length <= 60;
}

function isStrongerOpenClawFinalAnswer(answer: string): boolean {
  const normalized = String(answer || "").trim();
  if (isLikelyOpenClawIntermediatePersistedAnswer(normalized)) return false;
  return normalized.length > 80 || extractOpenClawAnswerFileRefs(normalized).length > 0 || /任务完成|已成功|文件详情/.test(normalized);
}

function areOpenClawRowsNearInTime(left: any, right: any): boolean {
  const leftTime = toOpenClawOptionalTimestampMs(left?.updated_time ?? left?.created_time);
  const rightTime = toOpenClawOptionalTimestampMs(right?.created_time ?? right?.updated_time);
  if (!leftTime || !rightTime) return true;
  return Math.abs(rightTime - leftTime) <= 5 * 60 * 1000;
}

function shouldDropDuplicateOpenClawIntermediateRow(row: any, laterRow: any): boolean {
  const rowQuestion = String(row?.question || row?.raw_user_message?.content || "").trim();
  const laterQuestion = String(laterRow?.question || laterRow?.raw_user_message?.content || "").trim();
  if (!rowQuestion || rowQuestion !== laterQuestion) return false;
  if (!areOpenClawRowsNearInTime(row, laterRow)) return false;
  if (!rowsShareOpenClawOutputFile(row, laterRow) && !rowsShareOpenClawTurnIdentity(row, laterRow)) return false;

  const answer = String(row?.answer || row?.openclawProjection?.visibleAnswer || "").trim();
  const laterAnswer = String(laterRow?.answer || laterRow?.openclawProjection?.visibleAnswer || "").trim();
  return isLikelyOpenClawIntermediatePersistedAnswer(answer) && isStrongerOpenClawFinalAnswer(laterAnswer);
}

export function collapseDuplicateOpenClawIntermediateRows(rows: any[]): any[] {
  const collapsed: any[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const duplicateFinalRow = rows
      .slice(index + 1, index + 4)
      .find((candidate) => shouldDropDuplicateOpenClawIntermediateRow(row, candidate));

    if (duplicateFinalRow) {
      continue;
    }

    collapsed.push(row);
  }

  // 反向再过一遍：messages.txt 里出现 legacy:2 (有回答) 之后才是 legacy:4 (空回答)，
  // 都是 user "你可以叫我政哥"。前向窗口只会找"早于自身"的更强 row，反向窗口才能捕获
  // "自身是空快照、同 turn 已经有更完整的旧 row" 这条路径。
  const backward: any[] = [];
  for (let index = 0; index < collapsed.length; index += 1) {
    const row = collapsed[index];
    const earlierStrongerRow = collapsed
      .slice(Math.max(0, index - 4), index)
      .reverse()
      .find((candidate) => shouldDropDuplicateOpenClawIntermediateRow(candidate, row));

    if (earlierStrongerRow) {
      continue;
    }

    backward.push(row);
  }

  return backward;
}

/**
 * 按用户视角时间排序 row 列表。
 *
 * assistantCreatedAt 是 mirror 入库时间、不可信（多个 assistant 的 timestamp 会落在同
 * 一个 mirror batch 上，相差毫秒但实际回答相隔几天）。row 的 UI 顺序必须用
 * raw_user_message.createdAt（用户发消息的时间）。相同 user time 时退到 id 字典序保证
 * 稳定输出。
 *
 * 注意：Hub 后端 / 测试数据返回的是 ISO 字符串而不是 epoch ms，必须用
 * `toOpenClawOptionalTimestampMs`（支持两种格式）而不是 `readNumberValue`（仅支持数字）。
 */
function getOpenClawRowUserTimeMs(row: any): number {
  const userMessage = row?.raw_user_message;
  const candidates = [
    userMessage?.createdAt,
    userMessage?.created_at,
    userMessage?.created_time,
    row?.created_time,
    row?.created_at,
  ];
  for (const candidate of candidates) {
    const parsed = toOpenClawOptionalTimestampMs(candidate);
    if (parsed > 0) return parsed;
  }
  return 0;
}

export function sortOpenClawRowsByUserTime(rows: any[]): any[] {
  return [...rows].sort((left, right) => {
    const leftTime = getOpenClawRowUserTimeMs(left);
    const rightTime = getOpenClawRowUserTimeMs(right);
    if (leftTime !== rightTime) return leftTime - rightTime;
    return String(left?.id || "").localeCompare(String(right?.id || ""));
  });
}

function extractOpenClawAnswerFileRefs(answer: string): string[] {
  const matches = String(answer || "").match(/[A-Za-z0-9._-]+\.(?:txt|md|pdf|docx|xlsx|pptx|csv|json|html|zip|png|jpg|jpeg|webp)/gi) || [];
  return [...new Set(matches.map((item) => item.toLowerCase()))];
}

function extractPrimaryOpenClawAnswerFileRef(answer: string): string {
  return extractOpenClawAnswerFileRefs(answer)[0] || "";
}

function shouldPreferPersistedOpenClawAnswer(projection: any, answer: string): boolean {
  const persistedAnswer = String(answer || "").trim();
  const projectedAnswer = String(projection?.visibleAnswer || "").trim();
  if (!persistedAnswer) return false;
  if (!projectedAnswer) return true;
  if (persistedAnswer === projectedAnswer) return true;

  const persistedFiles = extractOpenClawAnswerFileRefs(persistedAnswer);
  if (persistedFiles.length === 0) return false;
  const persistedPrimaryFile = extractPrimaryOpenClawAnswerFileRef(persistedAnswer);
  const projectedPrimaryFile = extractPrimaryOpenClawAnswerFileRef(projectedAnswer);
  if (persistedPrimaryFile && projectedPrimaryFile && persistedPrimaryFile !== projectedPrimaryFile) return true;
  const projectedFiles = new Set(extractOpenClawAnswerFileRefs(projectedAnswer));
  return persistedFiles.some((fileName) => !projectedFiles.has(fileName));
}

function applyPersistedAnswerToOpenClawProjection(projection: any, answer: string) {
  const persistedAnswer = String(answer || "").trim();
  if (!persistedAnswer) return projection;

  let replacedAnswerItem = false;
  const timelineItems = Array.isArray(projection?.timelineItems) ? projection.timelineItems : [];
  const nextTimelineItems = timelineItems.map((item: any) => {
    if (item?.type !== "answer" || replacedAnswerItem) return item;
    replacedAnswerItem = true;
    return {
      ...item,
      content: persistedAnswer,
    };
  });
  if (!replacedAnswerItem && timelineItems.length > 0) {
    const anchorItem = timelineItems[0];
    nextTimelineItems.push(
      buildOpenClawAnswerTimelineItem({
        key: `${anchorItem?.sessionId || "openclaw"}:persisted-answer:${hashOpenClawText(persistedAnswer)}`,
        sessionId: anchorItem?.sessionId,
        seq: anchorItem?.seq,
        createdAt: anchorItem?.createdAt,
        content: persistedAnswer,
        replace: true,
        identityKey: `persisted:${hashOpenClawText(persistedAnswer)}`,
      })
    );
  }

  return {
    ...projection,
    visibleAnswer: persistedAnswer,
    timelineItems: nextTimelineItems,
  };
}

export function buildOpenClawMessages(
  messages: OpenClawMessage[],
  conversationId: string,
  agentId: string | number,
  events: OpenClawTimelineEvent[] = [],
  options?: { canonicalOnly?: boolean }
) {
  const rows: any[] = [];
  let pendingUserMessage: OpenClawMessage | null = null;
  let pendingAssistantMessage: OpenClawMessage | null = null;
  // Orphan assistant 缓冲：消息流不保证 createdAt 顺序时，assistant 可能先于其 user
  // 到达。挂到错误 turn 的 assistant 会在 flush 时污染上一个 user。先按 turnKey 收着，
  // 等匹配的 user 出现再挂回去。
  const orphanAssistantByTurnKey = new Map<string, OpenClawMessage>();
  const consumedEventIds = new Set<string>();
  const scopedEvents = filterSupersededHistoryThinkingEvents(events.filter((event) => event.sessionId === conversationId));
  const hasLedger = scopedEvents.some(hasOpenClawLedgerEvent);
  if (options?.canonicalOnly && hasLedger) {
    const canonicalRows = buildOpenClawMessagesFromCanonicalLedger(messages, conversationId, agentId, scopedEvents, options);
    if (canonicalRows) {
      return sortOpenClawRowsByUserTime(collapseDuplicateOpenClawIntermediateRows(canonicalRows));
    }
  }

  const flushPendingTurn = (nextUserMessage: OpenClawMessage | null = null) => {
    if (!pendingUserMessage) return;

    const turnEvents = collectOpenClawEventsForAssistant(
      scopedEvents,
      consumedEventIds,
      pendingUserMessage,
      pendingAssistantMessage,
      nextUserMessage
    );
    const reasoning = collectReasoningFromEvents(turnEvents);
    const interrupted = hasInterruptedEventForAssistant(scopedEvents, pendingUserMessage, pendingAssistantMessage);
    rows.push(
      buildOpenClawMessageRow(
        pendingUserMessage,
        pendingAssistantMessage,
        conversationId,
        agentId,
        reasoning,
        interrupted,
        turnEvents,
        options
      )
    );
    pendingUserMessage = null;
    pendingAssistantMessage = null;
  };

  for (const item of messages) {
    if (item.role === "user") {
      if (isOpenClawInternalControlUserMessage(item)) {
        flushPendingTurn(item);
        continue;
      }

      if (isOpenClawSenderMetadataMessage(item)) {
        if (!pendingUserMessage) {
          const recoveredUserMessage = buildRecoveredOpenClawSenderUserMessage(item);
          if (recoveredUserMessage) {
            pendingUserMessage = recoveredUserMessage;
            pendingAssistantMessage = null;
          }
        } else {
          pendingUserMessage = applyOpenClawSenderMetadataSeqToUserMessage(pendingUserMessage, item);
        }
        continue;
      }

      const userMessage = enrichOpenClawUserMessageFromEvents(item, scopedEvents);
      if (shouldMergeRecoveredOpenClawUserTurn(pendingUserMessage, pendingAssistantMessage, userMessage)) {
        pendingUserMessage = mergeRecoveredOpenClawUserMessage(pendingUserMessage, userMessage);
        continue;
      }

      flushPendingTurn(userMessage);
      pendingUserMessage = userMessage;
      pendingAssistantMessage = null;

      // 之前到达的 orphan assistant 现在能挂回对应 turn 了。
      const userTurnKey = getOpenClawMessageTurnKey(pendingUserMessage);
      if (userTurnKey) {
        const buffered = orphanAssistantByTurnKey.get(userTurnKey);
        if (buffered && shouldReplaceOpenClawPendingAssistant(pendingAssistantMessage, buffered)) {
          pendingAssistantMessage = buffered;
          orphanAssistantByTurnKey.delete(userTurnKey);
        }
      }
      continue;
    }

    if (item.role === "assistant") {
      if (isOpenClawStatusAssistantContent(item.content)) {
        continue;
      }

      const assistantTurnKey = getOpenClawMessageTurnKey(item);

      if (pendingUserMessage) {
        // 关键判定：两条消息都解出了 turnKey 时，必须 turnKey 一致才挂载，
        // 否则这是 orphan assistant（其 user 还在流后面），不能污染上一个 turn。
        // 仅在 turnKey 无法解析时回退到原有的 seq/时间检查，避免破坏旧数据路径。
        if (assistantTurnKey) {
          const userTurnKey = getOpenClawMessageTurnKey(pendingUserMessage);
          if (userTurnKey && userTurnKey !== assistantTurnKey) {
            orphanAssistantByTurnKey.set(assistantTurnKey, item);
            continue;
          }
        }

        if (!assistantMessageBelongsToUserTurn(pendingUserMessage, item)) {
          continue;
        }

        if (hasTerminalEventBetweenOpenClawMessages(scopedEvents, pendingAssistantMessage, item)) {
          flushPendingTurn();
          const recoveredUserMessage = buildRecoveredOpenClawUserMessageFromEvent(
            findOpenClawUserEventForAssistant(scopedEvents, item),
            item
          );
          pendingUserMessage = recoveredUserMessage || {
            id: `${item.id}:question`,
            sessionId: item.sessionId,
            role: "user",
            content: "",
            createdAt: item.createdAt,
          };
          pendingAssistantMessage = item;
          continue;
        }

        if (shouldReplaceOpenClawPendingAssistant(pendingAssistantMessage, item)) {
          pendingAssistantMessage = item;
        }
        continue;
      }

      // 没有 pending user —— orphan assistant，按 turnKey 缓冲，等匹配的 user 出现。
      if (assistantTurnKey) {
        orphanAssistantByTurnKey.set(assistantTurnKey, item);
        continue;
      }

      const recoveredUserMessage = buildRecoveredOpenClawUserMessageFromEvent(
        findOpenClawUserEventForAssistant(scopedEvents, item),
        item
      );
      pendingUserMessage = recoveredUserMessage || {
        id: `${item.id}:question`,
        sessionId: item.sessionId,
        role: "user",
        content: "",
        createdAt: item.createdAt,
      };
      pendingAssistantMessage = item;
    }
  }

  flushPendingTurn();

  return sortOpenClawRowsByUserTime(
    collapseDuplicateOpenClawIntermediateRows(
      mergeAdjacentOpenClawAssistantRows(rows).filter(shouldKeepOpenClawMessageRow)
    )
  );
}

function omitEmptyOpenClawConversationId(params: ChatCompletionParams, requestSource: string) {
  const payload: Record<string, any> = { ...params, request_source: requestSource };
  const conversationId = payload.conversation_id;

  if (
    conversationId === undefined ||
    conversationId === null ||
    conversationId === "" ||
    conversationId === 0 ||
    conversationId === "0"
  ) {
    delete payload.conversation_id;
  }

  return payload;
}

export function createOpenClawConversationApiAdapter({
  agentId,
  openclawApi,
  completions,
  requestSource = "web",
  canonicalOnly = true,
}: CreateOpenClawConversationApiAdapterOptions): IConversationApi {
  return {
    create: async (_agentId: string, question: string, title?: string) => {
      const now = Date.now();
      return {
        data: {
          conversation_id: "",
          agent_id: agentId,
          title: title || question.slice(0, 20),
          created_time: now,
          updated_time: now,
          top: 0,
          is_valid: 1,
          virtual_id: now.toString(),
        },
      };
    },

    list: async (_agentId: string, params?: { offset?: number; limit?: number }) => {
      const response = await openclawApi.conversations(agentId, {
        limit: params?.limit || OPENCLAW_CONVERSATION_LIST_LIMIT,
        offset: params?.offset,
        fresh: (params as any)?.fresh,
      });
      const payload = getOpenClawPayload(response);
      const sessions: OpenClawSession[] = payload.sessions || [];

      return {
        data: {
          conversations: sessions.map((session) => buildOpenClawConversation(session, agentId)),
          pagination: payload.pagination,
          ...openClawHistoryMeta(payload),
        },
      };
    },

    messages: async (conversationId: string, params?: { offset?: number; limit?: number; fresh?: boolean }) => {
      const response = await openclawApi.messages(agentId, conversationId, {
        limit: params?.limit,
        offset: params?.offset,
        fresh: params?.fresh,
      });
      const payload = getOpenClawPayload(response);
      const messages: OpenClawMessage[] = payload.messages || [];
      const ledgerEvents = getOpenClawTimelineEventsFromLedgerPayload(payload);
      const events: OpenClawTimelineEvent[] = ledgerEvents.length ? ledgerEvents : canonicalOnly ? [] : payload.events || [];

      let projectedMessages = buildOpenClawMessages(messages, conversationId, agentId, events, { canonicalOnly });
      let pagination = payload.pagination;

      if (isOpenClawMirrorPayload(payload) && projectedMessages.length === 0) {
        const ledgerRows = buildOpenClawMessagesFromLedgerOnly(events, conversationId, agentId, { canonicalOnly });
        if (ledgerRows && ledgerRows.length > 0) {
          const page = paginateOpenClawProjectedRows(ledgerRows, params);
          projectedMessages = page.rows;
          pagination = page.pagination;
        } else if (openclawApi.snapshot) {
          try {
            const snapshotResponse = await openclawApi.snapshot(agentId, conversationId);
            const snapshotPayload = getOpenClawPayload(snapshotResponse);
            const snapshotEvents = getOpenClawTimelineEventsFromLedgerPayload(snapshotPayload);
            const snapshotRows = buildOpenClawMessagesFromLedgerOnly(snapshotEvents, conversationId, agentId, { canonicalOnly });
            if (snapshotRows && snapshotRows.length > 0) {
              const page = paginateOpenClawProjectedRows(snapshotRows, params);
              projectedMessages = page.rows;
              pagination = page.pagination;
            }
          } catch {
            // Cached messages are still usable when the mirrored snapshot is unavailable.
          }
        }
      }

      return {
        data: {
          messages: projectedMessages,
          pagination,
          ...openClawHistoryMeta(payload),
        },
      };
    },

    events: async (conversationId: string, params?: { offset?: number; limit?: number; after_seq?: number; fresh?: boolean }) => {
      const response = await openclawApi.events(agentId, conversationId, params);
      return {
        data: getOpenClawPayload(response),
      };
    },

    snapshot: async (conversationId: string, params?: { after_seq?: number; fresh?: boolean }) => {
      if (!openclawApi.snapshot) {
        return { data: null };
      }
      const response = await openclawApi.snapshot(agentId, conversationId, params);
      return {
        data: getOpenClawPayload(response),
      };
    },

    control: async (conversationId: string, data: ConversationControlParams) => {
      return openclawApi.control(agentId, conversationId, data);
    },

    ensureSkill: async (skill) => {
      const skillIdentifier = skill.skill_id || skill.id || skill.skill_name;
      if (!skillIdentifier || !openclawApi.ensureSkill) {
        return null;
      }
      return openclawApi.ensureSkill(agentId, skillIdentifier);
    },

    edit: async () => Promise.resolve({ data: null }),

    del: async () => Promise.resolve({ data: null }),

    completions: async (
      params: ChatCompletionParams,
      options: {
        responseType: "stream";
        onDownloadProgress: (e: any) => void;
        signal?: AbortSignal;
      }
    ) => {
      return completions(omitEmptyOpenClawConversationId(params, requestSource) as ChatCompletionParams, options);
    },
  };
}
