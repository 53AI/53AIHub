import { useRef, useCallback } from "react";
import type {
  SkillRunItem,
  SkillRunSkillItem,
  ProcessRecord,
  IntentData,
  Message,
  OutputFile,
  AgentRunReplayEvent,
  OpenClawActivityItem,
} from "../types";
import { useChatAdapters } from "../i18n";
import {
  isOpenClawPendingConversationId,
  isOpenClawStatusAssistantContent,
  sanitizeOpenClawAnswer
} from "../utils/openclaw";
import {
  buildOpenClawActivity,
  isOpenClawToolPlaceholderThinkingText
} from "../utils/openclaw-activities";
import { getOpenClawTimelineEventsFromLedgerPayload } from "../utils/openclaw-ledger";
import {
  getOutputFileKey,
  getOpenClawTimelineMaxSeq as getOpenClawTimelineItemMaxSeq,
  mergeOutputFiles,
  rebaseOpenClawMessageConversation,
  syncOpenClawMessageDerivedState
} from "../utils/openclaw-timeline";
import {
  appendOpenClawEvents,
  buildOpenClawTurnKey,
  createOpenClawTurnState,
  createOpenClawTurnEvent,
  ensureOpenClawTurnState,
  projectOpenClawTurn,
  rebaseOpenClawTurnStateConversation,
  syncOpenClawProjectionToMessage,
} from "../utils/openclaw-turn";

// ============ 工具函数 ============

export function parseJson<T>(json: string, defaultValue: T | null = null): T | null {
  try {
    return JSON.parse(json);
  } catch {
    return defaultValue;
  }
}

export function formatBash(code: string, language: string): string {
  const trimmed = (code || "").trim();
  return trimmed ? (language === "bash" || !language ? `$ ${trimmed}` : trimmed) : "";
}

export function getIntentData(raw: unknown): IntentData | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  return {
    intent: r.intent != null ? String(r.intent) : undefined,
    skill_name: r.skill_name != null ? String(r.skill_name) : undefined,
    confidence: typeof r.confidence === "number" ? r.confidence : undefined,
    reasoning: r.reasoning != null ? String(r.reasoning) : undefined,
    keywords: Array.isArray(r.keywords) ? r.keywords.map(String) : undefined,
    answer: r.answer != null ? String(r.answer) : undefined,
    expanded_queries: r.expanded_queries,
  };
}

function isOpenClawStreamDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search || "");
    return (
      params.get("openclaw_debug") === "1" ||
      params.get("OPENCLAW_LEDGER_DEBUG") === "1" ||
      window.localStorage?.getItem("OPENCLAW_LEDGER_DEBUG") === "1"
    );
  } catch {
    return false;
  }
}

function hashOpenClawStreamText(value?: string | null): string {
  const text = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function traceOpenClawStream(label: string, payload: Record<string, unknown>) {
  if (!isOpenClawStreamDebugEnabled()) return;
  console.info(`[openclaw-ui:${label}] ${JSON.stringify(payload)}`);
}

function countOpenClawValues<T extends string>(values: T[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    const key = value || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function summarizeOpenClawStreamChunk(data: any, streamPayload: any): Record<string, unknown> {
  const payload = getOpenClawEventPayload(data);
  const ledger = readOpenClawLedgerRecord(payload);
  const delta = streamPayload?.choices?.[0]?.delta || {};
  const content = cleanStreamText(delta.content);
  const reasoning = cleanStreamText(delta.reasoning_content);
  return {
    id: String(streamPayload?.id || data?.id || data?.data?.id || ""),
    status: String(data?.status || data?.data?.status || streamPayload?.status || ""),
    object: String(data?.object || data?.data?.object || streamPayload?.object || ""),
    event_kind: getOpenClawEventKind(data),
    finish_reason: String(streamPayload?.choices?.[0]?.finish_reason || ""),
    session_id_hash: hashOpenClawStreamText(readOpenClawResolvedConversationId(data, streamPayload)),
    ledger_event_type: String(ledger.event_type || ""),
    ledger_part_type: String(ledger.part_type || ""),
    ledger_operation: String(ledger.operation || ""),
    ledger_visibility: String(ledger.visibility || ""),
    ledger_seq: Number(ledger.seq || 0),
    content_length: content.length,
    content_hash: hashOpenClawStreamText(content),
    reasoning_length: reasoning.length,
    reasoning_hash: hashOpenClawStreamText(reasoning),
    has_payload: Object.keys(payload).length > 0,
  };
}

function summarizeOpenClawMessageProjectionTrace(message: Message): Record<string, unknown> {
  const activities = message.openclawActivities || [];
  const timelineItems = message.openclawTimelineItems || [];
  const projection = message.openclawProjection;
  const answer = message.answer || "";
  const reasoning = message.reasoning_content || "";
  return {
    message_id: String(message.id || ""),
    conversation_id_hash: hashOpenClawStreamText(String(message.conversation_id || "")),
    active_request_id_hash: hashOpenClawStreamText(String(message._openclawActiveRequestId || "")),
    client_message_id_hash: hashOpenClawStreamText(String(message._openclawClientMessageId || "")),
    loading: Boolean(message.loading),
    error: Boolean(message.error),
    answer_length: answer.length,
    answer_hash: hashOpenClawStreamText(answer),
    reasoning_length: reasoning.length,
    reasoning_hash: hashOpenClawStreamText(reasoning),
    activity_count: activities.length,
    activity_kind_counts: countOpenClawValues(activities.map((item) => String(item.kind || ""))),
    timeline_count: timelineItems.length,
    timeline_type_counts: countOpenClawValues(timelineItems.map((item) => String(item.type || ""))),
    projection_activity_count: projection?.activities?.length || 0,
    projection_timeline_count: projection?.timelineItems?.length || 0,
    projection_answer_length: projection?.visibleAnswer?.length || 0,
    projection_answer_hash: hashOpenClawStreamText(projection?.visibleAnswer || ""),
    turn_status: String(message.openclawTurn?.status || ""),
    turn_event_count: message.openclawTurn?.events?.length || 0,
    turn_max_seq: Number(message.openclawTurn?.maxSeq || 0),
  };
}

// ============ 列表更新辅助函数 ============

export function updateSkillItem(
  items: SkillRunItem[],
  predicate: (item: SkillRunItem) => boolean,
  updater: (item: SkillRunSkillItem) => Partial<SkillRunSkillItem>
): SkillRunItem[] {
  const idx = items.findIndex(predicate);
  if (idx === -1) return items;
  const item = items[idx] as SkillRunSkillItem;
  return [
    ...items.slice(0, idx),
    { ...item, ...updater(item) },
    ...items.slice(idx + 1),
  ];
}

// ============ 流程步骤处理函数 ============

function handleIntentClassification(
  step: ProcessRecord,
  skillRunItems: SkillRunItem[]
): SkillRunItem[] {
  if (step.status === "start") {
    return [
      ...skillRunItems,
      { type: "skill", title: step.message || "正在识别意图...", status: "running" },
    ];
  }
  if (step.status === "completed") {
    const data = step.data as { intent?: unknown } | undefined;
    const intentData = getIntentData(data?.intent);
    return updateSkillItem(
      skillRunItems,
      (item) => item.type === "skill",
      () => ({
        title: step.message,
        status: "completed",
        skillName: intentData?.skill_name,
        intentData,
      })
    );
  }
  return skillRunItems;
}

function handleSkillRouting(step: ProcessRecord, skillRunItems: SkillRunItem[]): SkillRunItem[] {
  if (step.status === "completed") {
    return updateSkillItem(
      skillRunItems,
      (item) => item.type === "skill",
      (item) => ({
        title: item.skillName ? `技能加载完成` : step.message,
        status: "completed",
      })
    );
  }
  return skillRunItems;
}

function handleToolExecutionStart(step: ProcessRecord, skillRunItems: SkillRunItem[]): SkillRunItem[] {
  if (step.status !== "start" || !step.data) return skillRunItems;

  const data = step.data as {
    skill_name?: string;
    tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
  };
  const calls = data?.tool_calls ?? [];
  if (calls.length === 0) return skillRunItems;

  const firstSkill = skillRunItems.find(
    (item) => item.type === "skill"
  ) as SkillRunSkillItem | undefined;
  const firstCall = calls[0];
  const args =
    parseJson<{ code?: string; language?: string }>(
      firstCall.function?.arguments ?? "{}"
    ) ?? {};
  const bash = formatBash(args.code ?? "", args.language ?? "bash");
  const toolCallId = (firstCall.id ?? "") + "_running";

  const exists = skillRunItems.some(
    (item) => item.type === "skill" && (item as SkillRunSkillItem)._toolCallId === toolCallId
  );
  if (exists) return skillRunItems;

  return [
    ...skillRunItems,
    {
      type: "skill",
      title: "正在使用技能...",
      status: "running",
      skillName: data?.skill_name,
      intentData: firstSkill?.intentData,
      _bash: bash,
      _toolCallId: toolCallId,
    },
  ];
}

function handleToolResult(step: ProcessRecord, skillRunItems: SkillRunItem[]): SkillRunItem[] {
  if (step.status !== "completed" || !step.data) return skillRunItems;

  const data = step.data as { tool_call_id?: string; result?: string; skill_name?: string };
  const toolCallId = (data?.tool_call_id ?? "") + "_running";
  const result = typeof data?.result === "string" ? data.result : "";

  let bash = "";
  let newItems = [...skillRunItems];
  const idx = newItems.findIndex(
    (item) => item.type === "skill" && (item as SkillRunSkillItem)._toolCallId === toolCallId
  );
  if (idx !== -1) {
    const item = newItems[idx] as SkillRunSkillItem;
    bash = item._bash ?? "";
    newItems = [
      ...newItems.slice(0, idx),
      { ...item, status: "completed" },
      ...newItems.slice(idx + 1),
    ];
  }

  return [
    ...newItems,
    {
      type: "script",
      title: data?.skill_name ? `技能 ${data.skill_name} 执行完成` : "技能执行完成",
      bash,
      output: result,
      status: "completed",
    },
  ];
}

function handleLlmDelta(step: ProcessRecord, skillRunItems: SkillRunItem[]): SkillRunItem[] {
  if (step.status !== "streaming" || !step.data) return skillRunItems;

  const data = step.data as { content?: string };
  const content = data?.content || "";

  const existingIdx = skillRunItems.findIndex(
    (item) => item.type === "llm" && item.status === "running"
  );

  if (existingIdx !== -1) {
    const existing = skillRunItems[existingIdx] as { type: "llm"; title: string; content: string; status: "running" | "completed" };
    return [
      ...skillRunItems.slice(0, existingIdx),
      { ...existing, content: existing.content + content },
      ...skillRunItems.slice(existingIdx + 1),
    ];
  }

  return [
    ...skillRunItems,
    {
      type: "llm",
      title: "思考中...",
      content,
      status: "running",
    },
  ];
}

function finishLlmDelta(skillRunItems: SkillRunItem[]): SkillRunItem[] {
  const llmIdx = skillRunItems.findIndex(
    (item) => item.type === "llm" && item.status === "running"
  );
  if (llmIdx === -1) return skillRunItems;

  const llmItem = skillRunItems[llmIdx] as { type: "llm"; title: string; content: string; status: "running" | "completed" };
  return [
    ...skillRunItems.slice(0, llmIdx),
    { ...llmItem, status: "completed", title: "思考完成" },
    ...skillRunItems.slice(llmIdx + 1),
  ];
}

export function applyProcessStep(step: ProcessRecord, items: SkillRunItem[]): { items: SkillRunItem[]; hasUpdate: boolean } {
  let newItems = [...items];

  if (step.step_code !== "llm_delta") {
    newItems = finishLlmDelta(newItems);
  }

  switch (step.step_code) {
    case "intent_classification":
      newItems = handleIntentClassification(step, newItems);
      break;
    case "skill_routing":
      newItems = handleSkillRouting(step, newItems);
      break;
    case "tool_execution":
      newItems = handleToolExecutionStart(step, newItems);
      break;
    case "tool_result":
      newItems = handleToolResult(step, newItems);
      break;
    case "llm_delta":
      newItems = handleLlmDelta(step, newItems);
      break;
    default:
      return { items: newItems, hasUpdate: newItems !== items };
  }

  return { items: newItems, hasUpdate: newItems !== items };
}

// ============ Replay 事件转换 ============

export function convertReplayEventToSSE(
  event: AgentRunReplayEvent,
  actualMessageId?: string | number
): any | null {
  const event_type = event.event_type || (event as any).type;
  const { payload, message_id } = event;
  const effectiveMessageId = actualMessageId || message_id || undefined;

  switch (event_type) {
    case "run.created":
      return effectiveMessageId ? { message_id: effectiveMessageId } : null;
    case "run.status_changed":
      return effectiveMessageId ? { message_id: effectiveMessageId } : null;
    case "process.step":
      return { ...payload, message_id: effectiveMessageId };
    case "message.delta":
      return { message_id: effectiveMessageId, ...payload };
    case "run.completed":
      return effectiveMessageId ? { message_id: effectiveMessageId } : null;
    case "run.failed":
      return {
        message_id: effectiveMessageId,
        error: true,
        error_message: payload.error_message || "运行失败",
      };
    case "run.cancelled":
      return effectiveMessageId ? { message_id: effectiveMessageId } : null;
    default:
      return null;
  }
}

// ============ 流数据处理 ============

export interface StreamProcessOptions {
  openclaw?: boolean;
  canonicalOnly?: boolean;
}

type MessageWithStreamState = Message & {
  _openclawThinkTagOpen?: boolean;
  _openclawLastAnswerItemKey?: string;
  _openclawNeedNewAnswerBlock?: boolean;
  _openclawAnswerBlockIndex?: number;
  _openclawCanonicalOnly?: boolean;
};

function syncProjectedOpenClawMessage(message: MessageWithStreamState) {
  if (!message.openclawTurn) return;
  const projection = projectOpenClawTurn(message.openclawTurn, {
    isStreaming: Boolean(message.loading),
    canonicalOnly: Boolean(message._openclawCanonicalOnly),
  });
  syncOpenClawProjectionToMessage(message, projection);
  if (message.answer?.trim() && projection.activities.length > 0 && message.reasoning_expanded) {
    message.reasoning_expanded = false;
  }
}

function isOpenClawStreamSupportTurnEvent(event: ReturnType<typeof createOpenClawTurnEvent>) {
  if (event.turnId || event.source !== "stream") return false;
  if (isOpenClawAnswerEventKind(event.kind) || event.segmentType === "answer") return false;
  return (
    event.kind === "assistant.thinking" ||
    event.kind === "tool.call" ||
    event.kind === "tool.result" ||
    event.kind === "process.step" ||
    event.segmentType === "output_files"
  );
}

function inferExistingStreamSupportEventsTurnId(
  turn: ReturnType<typeof ensureOpenClawTurnState>,
  incomingEvents: ReturnType<typeof createOpenClawTurnEvent>[]
) {
  const incomingProtocolTurnIds = getProtocolTurnIds(incomingEvents);
  if (incomingProtocolTurnIds.size !== 1) return turn;

  const existingProtocolTurnIds = getProtocolTurnIds(turn.events);
  if (existingProtocolTurnIds.size > 0) return turn;

  const inferredTurnId = [...incomingProtocolTurnIds][0] || "";
  if (!inferredTurnId) return turn;

  let changed = false;
  const events = turn.events.map((event) => {
    if (!isOpenClawStreamSupportTurnEvent(event)) return event;
    changed = true;
    return {
      ...event,
      turnId: inferredTurnId,
    };
  });
  if (!changed) return turn;

  return createOpenClawTurnState({
    ...turn,
    events,
  });
}

function appendOpenClawTurnEventsToMessage(
  message: MessageWithStreamState,
  events: ReturnType<typeof createOpenClawTurnEvent>[]
) {
  if (!events.length) return;
  const turn = ensureOpenClawTurnState(message, {
    sessionId: String(message.conversation_id || ""),
    turnKey: buildOpenClawTurnKey({
      sessionId: String(message.conversation_id || ""),
      clientMessageId: message._openclawClientMessageId,
      messageId: message.id,
      turnStartSeq: message._openclawTurnStartSeq,
    }),
  });
  message.openclawTurn = appendOpenClawEvents(
    inferExistingStreamSupportEventsTurnId(turn, events),
    events
  );
  syncProjectedOpenClawMessage(message);
}

function cleanStreamText(value: unknown): string {
  return typeof value === "string" ? value.replaceAll("<decision>DONE</decision>", "") : "";
}

function joinOpenClawReasoningBlocks(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}

function splitThinkTagContent(content: string, initialThinkOpen = false): {
  content: string;
  reasoning: string;
  thinkOpen: boolean;
  sawThinkTag: boolean;
} {
  let remaining = content;
  let thinkOpen = initialThinkOpen;
  let sawThinkTag = initialThinkOpen;
  const contentParts: string[] = [];
  const reasoningParts: string[] = [];

  while (remaining) {
    if (thinkOpen) {
      const closeMatch = remaining.match(/<\/think>/i);
      if (!closeMatch || closeMatch.index === undefined) {
        reasoningParts.push(remaining);
        remaining = "";
        break;
      }

      reasoningParts.push(remaining.slice(0, closeMatch.index));
      remaining = remaining.slice(closeMatch.index + closeMatch[0].length);
      thinkOpen = false;
      continue;
    }

    const openMatch = remaining.match(/<think\b[^>]*>/i);
    if (!openMatch || openMatch.index === undefined) {
      contentParts.push(remaining);
      break;
    }

    sawThinkTag = true;
    contentParts.push(remaining.slice(0, openMatch.index));
    remaining = remaining.slice(openMatch.index + openMatch[0].length);
    thinkOpen = true;
  }

  return {
    content: contentParts.join(""),
    reasoning: joinOpenClawReasoningBlocks(reasoningParts),
    thinkOpen,
    sawThinkTag,
  };
}

function getStreamPayload(data: any): any {
  return data?.data?.choices ? data.data : data;
}

function normalizeOutputFiles(value: unknown): OutputFile[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((file: any): OutputFile | null => {
      if (!file || typeof file !== "object") return null;
      const fileName = file.file_name ?? file.fileName ?? file.filename ?? file.name;
      const mimeType = file.mime_type ?? file.mimeType ?? file.mime;
      const base64 = typeof file.base64 === "string" && file.base64.trim() ? file.base64.trim() : "";
      const content = typeof file.content === "string" ? file.content : undefined;
      const filePath = typeof file.file_path === "string" ? file.file_path : typeof file.path === "string" ? file.path : "";
      const previewUrl = typeof file.preview_url === "string" ? file.preview_url : typeof file.previewUrl === "string" ? file.previewUrl : "";
      const downloadUrl = typeof file.download_url === "string" ? file.download_url : typeof file.downloadUrl === "string" ? file.downloadUrl : "";
      const signedDownloadUrl = typeof file.signed_download_url === "string" ? file.signed_download_url : typeof file.signedDownloadUrl === "string" ? file.signedDownloadUrl : "";
      const rawUrl = typeof file.url === "string" ? file.url : typeof file.href === "string" ? file.href : "";
      const url = previewUrl || rawUrl || (base64 ? `data:${mimeType || "application/octet-stream"};base64,${base64}` : signedDownloadUrl || downloadUrl || undefined);
      const id = file.id ?? file.file_id ?? file.fileId ?? file.artifact_id ?? file.artifactId ?? file.upload_file_id ?? file.uploadFileId ?? url ?? fileName;
      if (id == null && !url && !fileName) return null;
      return {
        id: id ?? `${url || ""}|${fileName || ""}`,
        file_name: fileName != null ? String(fileName) : undefined,
        url: url != null ? String(url) : undefined,
        preview_key: typeof file.preview_key === "string" ? file.preview_key : typeof file.previewKey === "string" ? file.previewKey : undefined,
        preview_url: previewUrl || undefined,
        download_url: downloadUrl || undefined,
        signed_download_url: signedDownloadUrl || undefined,
        artifact_id: file.artifact_id ?? file.artifactId,
        upload_file_id: file.upload_file_id ?? file.uploadFileId,
        mime_type: mimeType,
        size: typeof file.size === "number" ? file.size : Number.isFinite(Number(file.size)) ? Number(file.size) : undefined,
        kind: file.kind,
        message_id: file.message_id ?? file.messageId,
        source_kind: file.source_kind ?? file.sourceKind,
        base64: base64 || undefined,
        content,
        file_path: filePath || undefined,
      };
    })
    .filter((file): file is OutputFile => Boolean(file));
}

function extractStreamOutputFiles(data: any, streamPayload: any): OutputFile[] {
  const candidates = [
    data?.output_files,
    data?.outputFiles,
    data?.media_attachments,
    data?.mediaAttachments,
    data?.data?.output_files,
    data?.data?.outputFiles,
    data?.data?.media_attachments,
    data?.data?.mediaAttachments,
    streamPayload?.output_files,
    streamPayload?.outputFiles,
    streamPayload?.media_attachments,
    streamPayload?.mediaAttachments,
  ];
  return candidates.flatMap(normalizeOutputFiles);
}

function appendOutputFilesToMessage(message: Message, files: OutputFile[], logicalIdentity = false): void {
  if (files.length === 0) return;
  message.outputFiles = mergeOutputFiles(message.outputFiles || [], files, { logicalIdentity });
}

function readOpenClawResolvedConversationId(data: any, streamPayload: any): string {
  const value =
    streamPayload?.session_id ??
    streamPayload?.sessionId ??
    streamPayload?.conversation_id ??
    streamPayload?.conversationId ??
    data?.session_id ??
    data?.sessionId ??
    data?.conversation_id ??
    data?.conversationId ??
    data?.data?.session_id ??
    data?.data?.sessionId ??
    data?.data?.conversation_id ??
    data?.data?.conversationId;
  return typeof value === "string" ? value : "";
}

function isOpenClawThinkingChunk(data: any, options?: StreamProcessOptions): boolean {
  return Boolean(options?.openclaw) && (data?.status === "thinking" || data?.data?.status === "thinking");
}

function readOpenClawStreamValue(data: any, delta: any, key: string): any {
  return delta?.[key] ?? data?.[key] ?? data?.data?.[key];
}

function isOpenClawReplaceChunk(data: any, delta: any, options?: StreamProcessOptions): boolean {
  if (!options?.openclaw) return false;
  const mode = readOpenClawStreamValue(data, delta, "mode");
  const replace = readOpenClawStreamValue(data, delta, "replace");
  return replace === true || mode === "replace";
}

function getOpenClawEventKind(data: any): string {
  return String(data?.kind || data?.data?.kind || data?.event?.kind || data?.event_kind || data?.data?.event_kind || "");
}

function getOpenClawEventPayload(data: any): Record<string, unknown> {
  const payload = data?.payload || data?.data?.payload || data?.event?.payload;
  return payload && typeof payload === "object" ? payload : {};
}

function readOpenClawPayloadRecord(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = payload[key];
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readOpenClawPayloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function readOpenClawLedgerRecord(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  const direct = payload?.openclaw_ledger;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }
  const processStep = payload?.process_step;
  const processData =
    processStep && typeof processStep === "object" && !Array.isArray(processStep)
      ? (processStep as Record<string, unknown>).data
      : undefined;
  if (processData && typeof processData === "object" && !Array.isArray(processData)) {
    const nested = (processData as Record<string, unknown>).openclaw_ledger;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return nested as Record<string, unknown>;
    }
  }
  return {};
}

function readOpenClawLedgerTurnId(payload: Record<string, unknown> | undefined): string {
  return readOpenClawPayloadString(readOpenClawLedgerRecord(payload), "turn_id");
}

function readOpenClawLedgerActiveRequestId(payload: Record<string, unknown> | undefined): string {
  return readOpenClawPayloadString(readOpenClawLedgerRecord(payload), "active_request_id");
}

function readOpenClawLedgerRunId(payload: Record<string, unknown> | undefined): string {
  return readOpenClawPayloadString(readOpenClawLedgerRecord(payload), "run_id");
}

function hasOpenClawLedgerProtocolPayload(payload: Record<string, unknown>): boolean {
  return readOpenClawPayloadString(readOpenClawLedgerRecord(payload), "protocol_version") === "openclaw.ledger.v1";
}

function collectOpenClawMessageIdentityCandidates(message: Message): Set<string> {
  const candidates = new Set<string>();
  for (const value of [
    message._openclawActiveRequestId,
    message._openclawClientMessageId,
    message.openclawTurn?.turnKey,
    message.id,
  ]) {
    const text = value == null ? "" : String(value).trim();
    if (text) candidates.add(text);
  }
  for (const runId of getMessageOpenClawLedgerRunIds(message)) {
    candidates.add(runId);
  }
  return candidates;
}

function doesOpenClawLedgerEventBelongToMessage(
  message: Message,
  payload: Record<string, unknown> | undefined
): boolean {
  const ledger = readOpenClawLedgerRecord(payload);
  if (readOpenClawPayloadString(ledger, "protocol_version") !== "openclaw.ledger.v1") {
    return false;
  }

  const candidates = collectOpenClawMessageIdentityCandidates(message);
  if (!candidates.size) return false;

  const turnId = readOpenClawPayloadString(ledger, "turn_id");
  const activeRequestId = readOpenClawPayloadString(ledger, "active_request_id");
  const runId = readOpenClawPayloadString(ledger, "run_id");

  if (activeRequestId && candidates.has(activeRequestId)) return true;
  if (turnId && candidates.has(turnId)) return true;
  if (runId && candidates.has(runId)) return true;

  for (const candidate of candidates) {
    if (turnId && turnId.includes(candidate)) return true;
  }
  return false;
}

function canBindOpenClawStreamLedgerEventToActiveMessage(
  message: Message,
  payload: Record<string, unknown> | undefined
): boolean {
  const ledger = readOpenClawLedgerRecord(payload);
  if (readOpenClawPayloadString(ledger, "protocol_version") !== "openclaw.ledger.v1") {
    return false;
  }
  if (doesOpenClawLedgerEventBelongToMessage(message, payload)) return true;

  const incomingTurnId = readOpenClawPayloadString(ledger, "turn_id");
  const incomingRunId = readOpenClawPayloadString(ledger, "run_id");
  const existingTurnIds = getMessageOpenClawLedgerTurnIds(message);
  const existingRunIds = getMessageOpenClawLedgerRunIds(message);
  if (existingTurnIds.size > 0) {
    return Boolean(incomingTurnId && existingTurnIds.has(incomingTurnId));
  }
  if (existingRunIds.size > 0) {
    return Boolean(incomingRunId && existingRunIds.has(incomingRunId));
  }

  return isOpenClawActiveLedgerBindCandidate(message);
}

function bindOpenClawLedgerIdentityToMessage(
  message: Message,
  payload: Record<string, unknown> | undefined
): void {
  const ledger = readOpenClawLedgerRecord(payload);
  if (readOpenClawPayloadString(ledger, "protocol_version") !== "openclaw.ledger.v1") {
    return;
  }

  const activeRequestId = readOpenClawPayloadString(ledger, "active_request_id");
  if (activeRequestId) {
    message._openclawActiveRequestId = activeRequestId;
    message._openclawClientMessageId = message._openclawClientMessageId || activeRequestId;
  }
}

function getMessageOpenClawLedgerTurnIds(message: Message): Set<string> {
  const ids = new Set<string>();
  for (const event of message.openclawTurn?.events || []) {
    const turnId = readOpenClawLedgerTurnId(event.payload as Record<string, unknown> | undefined);
    if (turnId) ids.add(turnId);
  }
  return ids;
}

function getMessageOpenClawLedgerRunIds(message: Message): Set<string> {
  const ids = new Set<string>();
  for (const event of message.openclawTurn?.events || []) {
    const runId = readOpenClawLedgerRunId(event.payload as Record<string, unknown> | undefined);
    if (runId) ids.add(runId);
  }
  return ids;
}

function hasExplicitOpenClawMessageIdentity(message: Message): boolean {
  return Boolean(message._openclawActiveRequestId || message._openclawClientMessageId);
}

function isOpenClawAnonymousLedgerBindCandidate(message: Message): boolean {
  if (hasExplicitOpenClawMessageIdentity(message)) return false;
  if (!getOpenClawMessageQuestion(message)) return false;
  if (hasOpenClawRenderableAnswer(message)) return false;

  const maxSeq = readOpenClawMessageMaxSeq(message);
  if (maxSeq > 0) return false;

  const status = String(message.openclawTurn?.status || "");
  return !status || status === "completed" || status === "streaming";
}

function isOpenClawActiveLedgerBindCandidate(message: Message): boolean {
  return Boolean(
    message.loading ||
      message._openclawClientMessageId ||
      message.openclawTurn?.status === "streaming" ||
      message.openclawTurn?.events?.some((event) => event.source === "stream")
  );
}

function shouldExposeOpenClawStreamAnswer(
  payload: Record<string, unknown>,
  kind: string,
  hasExplicitOpenClawEventKind = false,
  isReplaceChunk = false
): boolean {
  const timeline = readOpenClawPayloadRecord(payload, "openclaw_timeline");
  const hasTimelineProtocol =
    Object.keys(timeline).length > 0 ||
    Boolean(readOpenClawPayloadString(payload, "visibility")) ||
    payload.final === true;
  const visibility = readOpenClawPayloadString(timeline, "visibility") || readOpenClawPayloadString(payload, "visibility");
  const final = timeline.final === true || payload.final === true;
  if (!hasTimelineProtocol) {
    if (hasExplicitOpenClawEventKind) {
      return kind === "assistant.message";
    }
    return isReplaceChunk;
  }
  return visibility === "stream" || visibility === "final" || final;
}

function isOpenClawToolEventKind(kind: string): boolean {
  return kind === "tool.call" || kind === "tool.result";
}

function isOpenClawRealtimeSupportEventKind(kind: string): boolean {
  return (
    kind === "assistant.thinking" ||
    kind === "tool.call" ||
    kind === "tool.result" ||
    kind === "process.step"
  );
}

function isOpenClawInterruptedText(value: unknown): boolean {
  return typeof value === "string" && /run\.interrupted|interrupted|aborted|用户.*停止|已中断|已停止/i.test(value);
}

function markOpenClawInterrupted(message: Message): void {
  message.interrupted = true;
  message.error = false;
  message.loading = false;
  if (!message.answer?.trim()) {
    message.answer = "本次运行已中断";
  }
}

function getOpenClawActivitySummary(item: OpenClawActivityItem): string {
  return item.summary || item.detail || item.tool?.output || item.tool?.input || "";
}

function readOpenClawEventSeq(value: any): number | undefined {
  const candidates = [
    value?.seq,
    value?.data?.seq,
    value?.event?.seq,
    value?.data?.event?.seq,
    value?.payload?.seq,
    value?.data?.payload?.seq,
    value?.payload?.openclaw_ledger?.seq,
    value?.data?.payload?.openclaw_ledger?.seq,
  ];
  for (const candidate of candidates) {
    const seq = typeof candidate === "number" ? candidate : Number(candidate);
    if (Number.isFinite(seq)) return seq;
  }
  return undefined;
}

function hasOpenClawTimelineProtocolPayload(payload: Record<string, unknown>): boolean {
  const timeline = readOpenClawPayloadRecord(payload, "openclaw_timeline");
  return (
    readOpenClawPayloadString(timeline, "protocol_version") === "openclaw.timeline.v2" ||
    Boolean(
      readOpenClawPayloadString(timeline, "turn_id") ||
        readOpenClawPayloadString(timeline, "segment_id") ||
        readOpenClawPayloadString(payload, "turn_id") ||
        readOpenClawPayloadString(payload, "segment_id")
    )
  );
}

function isOpenClawAnswerEventKind(kind: string): boolean {
  return kind === "assistant.message" || kind === "assistant.message.delta" || kind === "assistant.delta";
}

function isOpenClawTerminalEventKind(kind: string): boolean {
  return kind === "run.completed" || kind === "run.failed" || kind === "run.interrupted";
}

function shouldProjectOpenClawStructuredStreamEvent(
  kind: string,
  payload: Record<string, unknown>,
  options?: { canonicalOnly?: boolean }
): boolean {
  if (!kind) return false;
  if (options?.canonicalOnly) return hasOpenClawLedgerProtocolPayload(payload);
  if (hasOpenClawTimelineProtocolPayload(payload)) return true;
  return isOpenClawTerminalEventKind(kind);
}

function readOpenClawStreamEventId(data: any, payload: Record<string, unknown>): string {
  const ledger = readOpenClawLedgerRecord(payload);
  const candidates = [
    payload.event_id,
    payload.eventId,
    payload.id,
    ledger.raw_event_ref,
    data?.event?.id,
    data?.data?.event?.id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return "";
}

function readOpenClawStreamCreatedAt(data: any, payload: Record<string, unknown>): string {
  const candidates = [
    payload.event_created_at,
    payload.createdAt,
    payload.created_at,
    data?.event?.createdAt,
    data?.data?.event?.createdAt,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return new Date().toISOString();
}

function getOpenClawStructuredStreamContent(
  kind: string,
  payload: Record<string, unknown>,
  delta: any
): string {
  const payloadContent = cleanStreamText(payload.content);
  if (payloadContent) return payloadContent;

  const deltaReasoning = cleanStreamText(delta?.reasoning_content);
  const deltaContent = cleanStreamText(delta?.content);
  if (kind === "assistant.thinking") return deltaReasoning || deltaContent;
  if (kind === "run.failed" || kind === "run.interrupted") {
    return readOpenClawFailureText(payload, deltaContent || kind);
  }
  return deltaContent || deltaReasoning;
}

function readOpenClawFailureText(payload: Record<string, unknown>, fallback = "OpenClaw 运行失败"): string {
  const classification =
    payload.failure_classification && typeof payload.failure_classification === "object"
      ? payload.failure_classification as Record<string, unknown>
      : {};
  const candidates = [
    payload.user_message,
    payload.error_message,
    classification.user_message,
    payload.failure_reason,
    payload.error,
    payload.message,
    payload.raw_error_message,
    classification.raw_message,
    fallback,
  ];
  for (const candidate of candidates) {
    const text = cleanStreamText(candidate);
    if (text && !isLowInformationOpenClawFailureText(text)) return text;
  }
  return fallback;
}

function isLowInformationOpenClawFailureText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  return !normalized || normalized === "error" || normalized === "failed" || normalized === "failure" || normalized === "run.failed";
}

function syncOpenClawProjectedReasoning(message: Message): void {
  const projectedReasoning = (message.openclawActivities || [])
    .filter((activity) => activity.kind === "assistant.thinking")
    .map((activity) => activity.summary || activity.detail || "")
    .filter(Boolean)
    .join("\n\n");
  if (projectedReasoning) {
    message.reasoning_content = projectedReasoning;
  }
}

function buildOpenClawStructuredStreamTurnEvent(
  data: any,
  message: Message,
  streamPayload: any,
  options?: { canonicalOnly?: boolean }
): ReturnType<typeof createOpenClawTurnEvent> | null {
  const kind = getOpenClawEventKind(data);
  const payload = getOpenClawEventPayload(data);
  if (!shouldProjectOpenClawStructuredStreamEvent(kind, payload, options)) return null;
  if (options?.canonicalOnly && !canBindOpenClawStreamLedgerEventToActiveMessage(message, payload)) return null;

  const delta = streamPayload?.choices?.[0]?.delta;
  const content = getOpenClawStructuredStreamContent(kind, payload, delta);
  if ((isOpenClawAnswerEventKind(kind) || kind === "assistant.thinking") && !content.trim()) {
    return null;
  }

  const eventPayload = {
    ...payload,
    ...(content ? { content } : {}),
  };
  const seq = readOpenClawEventSeq(data) ?? readOpenClawTimelineSeq(data, delta);
  const sessionId = readOpenClawResolvedConversationId(data, streamPayload) || String(message.conversation_id || "");
  const replace = isOpenClawTimelineReplaceEvent(data, payload) || isOpenClawReplaceChunk(data, delta, { openclaw: true });

  return createOpenClawTurnEvent({
    eventId: readOpenClawStreamEventId(data, payload),
    sessionId,
    seq,
    kind,
    createdAt: readOpenClawStreamCreatedAt(data, payload),
    payload: eventPayload,
    source: "stream",
    provisional: kind === "assistant.delta" || kind === "assistant.message.delta",
    replace,
    messageId: message.id,
    messageSeq: seq,
  });
}

function applyOpenClawStructuredStreamEvent(
  message: MessageWithStreamState,
  data: any,
  streamPayload: any,
  options?: { canonicalOnly?: boolean }
): boolean {
  const event = buildOpenClawStructuredStreamTurnEvent(data, message, streamPayload, options);
  if (!event) return false;

  bindOpenClawLedgerIdentityToMessage(message, event.payload as Record<string, unknown> | undefined);
  appendOpenClawTurnEventsToMessage(message, [event]);
  if (event.kind === "assistant.thinking") {
    syncOpenClawProjectedReasoning(message);
  }
  if (event.kind === "run.completed") {
    message.loading = false;
    message.error = false;
    syncProjectedOpenClawMessage(message);
  }
  if (event.kind === "run.interrupted") {
    markOpenClawInterrupted(message);
    syncProjectedOpenClawMessage(message);
  }
  if (event.kind === "run.failed") {
    const payloadRecord = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
    const errorText = readOpenClawFailureText(payloadRecord, String(event.payload?.content || "OpenClaw 运行失败"));
    message.error = true;
    message.loading = false;
    if (!message.answer?.trim()) {
      message.answer = errorText;
    }
    syncProjectedOpenClawMessage(message);
  }
  return true;
}

function appendOpenClawActivity(message: Message, kind: string, summary: string, rawData?: any): void {
  const normalizedKind = kind || "assistant.thinking";
  const normalized = summary.trim();
  if (!normalized && normalizedKind === "assistant.thinking") return;

  const timelineEventId =
    rawData?.event?.id ||
    rawData?.data?.event?.id ||
    rawData?.payload?.id ||
    rawData?.data?.payload?.id;
  const openclawTurn = ensureOpenClawTurnState(message, {
    sessionId: String(message.conversation_id || ""),
  });
  const seq = readOpenClawEventSeq(rawData) ?? (Number(openclawTurn.maxSeq || 0) + 1);
  const event = {
    id: timelineEventId,
    sessionId:
      rawData?.sessionId ||
      rawData?.data?.sessionId ||
      rawData?.event?.sessionId ||
      rawData?.data?.event?.sessionId ||
      message.conversation_id,
    seq,
    kind: normalizedKind,
    payload: {
      ...(rawData?.payload || rawData?.data?.payload || {}),
      content: normalized,
      summary: normalized,
    },
    createdAt: new Date().toISOString(),
  };
  appendOpenClawTurnEventsToMessage(message as MessageWithStreamState, [
    createOpenClawTurnEvent({
      eventId: timelineEventId,
      sessionId: String(event.sessionId || ""),
      seq,
      kind: normalizedKind,
      payload: event.payload as Record<string, unknown>,
      createdAt: event.createdAt,
      source: "stream",
    }),
  ]);
}

function getOpenClawActivityReasoning(message: Message): string {
  const activityText = (message.openclawActivities || [])
    .filter((item) => item.kind === "assistant.thinking")
    .map(getOpenClawActivitySummary)
    .filter(Boolean)
    .join("\n\n");
  return [message.reasoning_content || "", activityText].filter(Boolean).join("\n\n");
}

function getOpenClawAssistantEventContent(event: any): string {
  if (
    event?.kind !== "assistant.message" &&
    event?.kind !== "assistant.message.delta" &&
    event?.kind !== "assistant.delta"
  ) {
    return "";
  }
  const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
  const content = (payload as Record<string, unknown>).content;
  if (typeof content === "string" && !isOpenClawStatusAssistantContent(content)) return content.trim();
  return "";
}

function getOpenClawTimelineEvents(payload: any): any[] {
  const events = payload?.events ?? payload?.data?.events;
  if (Array.isArray(events) && events.length) return events;
  return getOpenClawTimelineEventsFromLedgerPayload(payload);
}

function isOpenClawTimelineReplaceEvent(event: any, payload?: Record<string, unknown>): boolean {
  return (
    event?.replace === true ||
    event?.mode === "replace" ||
    payload?.replace === true ||
    payload?.mode === "replace"
  );
}

function readOpenClawProcessRecord(event: any): any {
  const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
  return (payload as any).process_step || (payload as any).data?.process_step || {};
}

/**
 * 从 OpenClaw payload 中提取 timeline events 并获取最大 seq 值
 * @param payload - OpenClaw payload 对象
 * @returns timeline events 中的最大 seq 值，如果没有则返回 0
 */
export function getOpenClawPayloadTimelineMaxSeq(payload: any): number {
  return getOpenClawTimelineEvents(payload).reduce((maxSeq, event) => {
    const seq = typeof event?.seq === "number" ? event.seq : Number(event?.seq);
    return Number.isFinite(seq) ? Math.max(maxSeq, seq) : maxSeq;
  }, 0);
}

export function getOpenClawMessageListMaxActivitySeq(
  messages: Message[] = [],
  conversationId?: string | number
): number {
  const targetConversationId = conversationId ? String(conversationId) : "";
  return messages.reduce((maxSeq, message) => {
    if (targetConversationId && String(message.conversation_id || "") !== targetConversationId) {
      return maxSeq;
    }
    const messageMax = (message.openclawActivities || []).reduce((innerMax, item) => {
      const seq = typeof item.seq === "number" ? item.seq : Number(item.seq);
      return Number.isFinite(seq) ? Math.max(innerMax, seq) : innerMax;
    }, 0);
    return Math.max(maxSeq, messageMax, getOpenClawTimelineMax(message.openclawTimelineItems || []));
  }, 0);
}

function getOpenClawTimelineMax(items: Message["openclawTimelineItems"] = []) {
  return getOpenClawTimelineItemMaxSeq(items || []);
}

function readOpenClawMessageMaxSeq(message?: Message | null): number {
  if (!message) return 0;
  const activityMax = (message.openclawActivities || []).reduce((maxSeq, item) => {
    const seq = typeof item.seq === "number" ? item.seq : Number(item.seq);
    return Number.isFinite(seq) ? Math.max(maxSeq, seq) : maxSeq;
  }, 0);
  const timelineMax = getOpenClawTimelineMax(message.openclawTimelineItems || []);
  const turnMax = Number(message.openclawTurn?.maxSeq || 0);
  return Math.max(activityMax, timelineMax, Number.isFinite(turnMax) ? turnMax : 0);
}

function hasDifferentOpenClawClientMessageId(existing: Message, activeMessage: Message): boolean {
  const existingClientId = String(existing._openclawClientMessageId || "");
  const activeClientId = String(activeMessage._openclawClientMessageId || "");
  return Boolean(existingClientId && activeClientId && existingClientId !== activeClientId);
}

function isSameOpenClawActiveTurnCandidate(existing: Message, activeMessage: Message): boolean {
  if (hasDifferentOpenClawClientMessageId(existing, activeMessage)) return false;

  const activeConversationId = String(activeMessage.conversation_id || "");
  const existingConversationId = String(existing.conversation_id || "");
  if (activeConversationId && existingConversationId && activeConversationId !== existingConversationId) {
    return false;
  }

  const activeQuestion = getOpenClawMessageQuestion(activeMessage);
  if (!activeQuestion || getOpenClawMessageQuestion(existing) !== activeQuestion) return false;

  const activeTurnStartSeq = Number(activeMessage._openclawTurnStartSeq || 0);
  if (!Number.isFinite(activeTurnStartSeq) || activeTurnStartSeq <= 0) {
    return false;
  }

  return readOpenClawMessageMaxSeq(existing) > activeTurnStartSeq;
}

function hasOpenClawRenderableAnswer(message?: Message | null): boolean {
  return Boolean(
    message?.answer?.trim() ||
      message?.openclawProjection?.visibleAnswer?.trim() ||
      message?.openclawTimelineItems?.some((item) => item.type === "answer" && item.content?.trim())
  );
}

function hasOpenClawVisibleProgress(message?: Message | null): boolean {
  return Boolean(
    message?.loading ||
      message?.reasoning_content?.trim() ||
      message?.openclawActivities?.length ||
      message?.openclawTimelineItems?.length ||
      message?.outputFiles?.length
  );
}

function isOpenClawUnhydratedSameQuestionCandidate(existing: Message, activeMessage: Message): boolean {
  if (hasDifferentOpenClawClientMessageId(existing, activeMessage)) return false;

  const activeConversationId = String(activeMessage.conversation_id || "");
  const existingConversationId = String(existing.conversation_id || "");
  if (activeConversationId && existingConversationId && activeConversationId !== existingConversationId) {
    return false;
  }

  const activeQuestion = getOpenClawMessageQuestion(activeMessage);
  if (!activeQuestion || getOpenClawMessageQuestion(existing) !== activeQuestion) return false;
  if (hasOpenClawRenderableAnswer(existing)) return false;

  const existingStatus = String(existing.openclawTurn?.status || "");
  if (existingStatus && existingStatus !== "streaming" && readOpenClawMessageMaxSeq(existing) > 0) {
    return false;
  }

  const activeHasTurnIdentity = Boolean(
    activeMessage._openclawClientMessageId ||
      activeMessage._openclawActiveRequestId ||
      activeMessage.openclawTurn?.turnKey
  );
  if (!activeHasTurnIdentity) return false;

  return Boolean(activeMessage.loading || hasOpenClawVisibleProgress(activeMessage));
}

function findOpenClawActiveMessageIndex(messages: Message[], activeMessage: Message): number {
  const activeClientId = String(activeMessage._openclawClientMessageId || "");
  if (activeClientId) {
    const clientIdIndex = messages.findIndex(
      (message) => String(message._openclawClientMessageId || message.id || "") === activeClientId
    );
    if (clientIdIndex >= 0) return clientIdIndex;

    const activeId = String(activeMessage.id || "");
    if (activeId) {
      const idIndex = messages.findIndex((message) => String(message.id || "") === activeId);
      if (idIndex >= 0) return idIndex;
    }

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (isSameOpenClawActiveTurnCandidate(messages[index], activeMessage)) return index;
    }

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (isOpenClawUnhydratedSameQuestionCandidate(messages[index], activeMessage)) {
        traceOpenClawStream("active-message.merge-unhydrated-user", {
          existingId: String(messages[index].id || ""),
          activeId: String(activeMessage.id || ""),
          conversationId: String(activeMessage.conversation_id || messages[index].conversation_id || ""),
          activeClientId,
          questionHash: hashOpenClawStreamText(getOpenClawMessageQuestion(activeMessage)),
          existingStatus: String(messages[index].openclawTurn?.status || ""),
          existingMaxSeq: readOpenClawMessageMaxSeq(messages[index]),
        });
        return index;
      }
    }

    return -1;
  }

  const activeId = String(activeMessage.id || "");
  if (activeId) {
    const idIndex = messages.findIndex((message) => String(message.id || "") === activeId);
    if (idIndex >= 0) return idIndex;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isSameOpenClawActiveTurnCandidate(messages[index], activeMessage)) return index;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isOpenClawUnhydratedSameQuestionCandidate(messages[index], activeMessage)) {
      traceOpenClawStream("active-message.merge-unhydrated-user", {
        existingId: String(messages[index].id || ""),
        activeId: String(activeMessage.id || ""),
        conversationId: String(activeMessage.conversation_id || messages[index].conversation_id || ""),
        activeClientId,
        questionHash: hashOpenClawStreamText(getOpenClawMessageQuestion(activeMessage)),
        existingStatus: String(messages[index].openclawTurn?.status || ""),
        existingMaxSeq: readOpenClawMessageMaxSeq(messages[index]),
      });
      return index;
    }
  }

  return -1;
}

function getOpenClawMessageQuestion(message?: Message | null): string {
  if (!message) return "";
  const direct = String(message.question || "").trim();
  if (direct) return direct;

  const rawUserMessage = (message as any).raw_user_message;
  const rawContent = typeof rawUserMessage?.content === "string" ? rawUserMessage.content.trim() : "";
  if (rawContent) return rawContent;

  const encodedMessage = (message as any).message;
  if (typeof encodedMessage !== "string" || !encodedMessage.trim()) return "";
  try {
    const records = JSON.parse(encodedMessage);
    if (!Array.isArray(records)) return "";
    const user = records.find((item) => item?.role === "user" && typeof item?.content === "string" && item.content.trim());
    return typeof user?.content === "string" ? user.content.trim() : "";
  } catch {
    return "";
  }
}

function hasOpenClawAnswerTimeline(message?: Message | null): boolean {
  return Boolean(
    message?.answer?.trim() ||
      message?.openclawProjection?.timelineItems?.some((item) => item.type === "answer" && item.content?.trim()) ||
      message?.openclawTimelineItems?.some((item) => item.type === "answer" && item.content?.trim())
  );
}

function hasHydratedOpenClawEvents(message?: Message | null): boolean {
  return Boolean(
    message?.openclawTurn?.events?.some((event) => event.source === "events" || event.source === "history")
  );
}

function hasTerminalOpenClawTurn(message?: Message | null): boolean {
  const status = message?.openclawTurn?.status;
  return Boolean(
    message?.interrupted ||
      message?.error ||
      status === "completed" ||
      status === "failed" ||
      status === "interrupted"
  );
}

function getOpenClawComparableAnswer(message?: Message | null): string {
  if (!message) return "";
  const projectedAnswer = message.openclawProjection?.visibleAnswer;
  if (typeof projectedAnswer === "string" && projectedAnswer.trim()) {
    return projectedAnswer.replace(/\s+/g, " ").trim();
  }

  const timelineAnswer = (message.openclawTimelineItems || [])
    .filter((item) => item.type === "answer")
    .map((item) => item.content || "")
    .filter(Boolean)
    .join("");
  if (timelineAnswer.trim()) return timelineAnswer.replace(/\s+/g, " ").trim();

  return String(message.answer || "").replace(/\s+/g, " ").trim();
}

function hasDuplicateOpenClawAnswerBlocks(message?: Message | null): boolean {
  const answerItems = (message?.openclawTimelineItems || []).filter(
    (item) => item.type === "answer" && item.content?.trim()
  );
  if (answerItems.length <= 1) return false;

  const normalized = answerItems.map((item) => String(item.content || "").replace(/\s+/g, " ").trim());
  const seen = new Set<string>();
  for (const content of normalized) {
    if (!content) continue;
    if (seen.has(content)) return true;
    if ([...seen].some((previous) => content.includes(previous) || previous.includes(content))) return true;
    seen.add(content);
  }
  return false;
}

function shouldPreferHydratedOpenClawMessage(existing: Message, activeMessage: Message): boolean {
  if (existing.loading) return false;
  if (activeMessage.loading && hasOpenClawAnswerTimeline(existing)) {
    if (!hasTerminalOpenClawTurn(existing)) return false;
    const existingAnswer = getOpenClawComparableAnswer(existing);
    const activeAnswer = getOpenClawComparableAnswer(activeMessage);
    if (!activeAnswer || existingAnswer.length >= activeAnswer.length) {
      return true;
    }
  }
  if (activeMessage.loading) return false;
  if (!hasOpenClawAnswerTimeline(existing) || !hasOpenClawAnswerTimeline(activeMessage)) return false;
  if (!hasHydratedOpenClawEvents(existing)) return false;

  if (hasDuplicateOpenClawAnswerBlocks(activeMessage) && !hasDuplicateOpenClawAnswerBlocks(existing)) {
    return true;
  }

  const existingAnswer = getOpenClawComparableAnswer(existing);
  const activeAnswer = getOpenClawComparableAnswer(activeMessage);
  if (activeAnswer && existingAnswer && activeAnswer.length > existingAnswer.length) {
    const activeLooksMoreComplete = activeAnswer.includes(existingAnswer) || activeAnswer.length - existingAnswer.length >= 12;
    if (activeLooksMoreComplete) return false;
  }

  return true;
}

function mergeOpenClawActiveMessage(existing: Message, activeMessage: Message): Message {
  if (shouldPreferHydratedOpenClawMessage(existing, activeMessage)) {
    return {
      ...existing,
      outputFiles: mergeOutputFiles(existing.outputFiles || [], activeMessage.outputFiles || [], { logicalIdentity: true }),
    };
  }

  const merged = {
    ...existing,
    ...activeMessage,
    id: existing.id || activeMessage.id,
    _openclawClientMessageId: existing._openclawClientMessageId || activeMessage._openclawClientMessageId,
    question: existing.question || activeMessage.question,
    conversation_id: existing.conversation_id || activeMessage.conversation_id,
    created_at: existing.created_at || activeMessage.created_at,
    updated_at: activeMessage.updated_at || existing.updated_at,
    created_time: existing.created_time || activeMessage.created_time,
    updated_time: activeMessage.updated_time || existing.updated_time,
    // The in-flight active message is the authoritative snapshot for realtime OpenClaw state.
    // Merging stale list snapshots back into it can duplicate answer blocks when seq changes
    // between throttled publishes.
    openclawActivities:
      activeMessage.openclawActivities != null
        ? [...activeMessage.openclawActivities]
        : existing.openclawActivities,
    openclawTurn: activeMessage.openclawTurn || existing.openclawTurn,
    openclawProjection: activeMessage.openclawProjection || existing.openclawProjection,
    openclawTimelineItems:
      activeMessage.openclawTimelineItems != null
        ? [...activeMessage.openclawTimelineItems]
        : existing.openclawTimelineItems,
    outputFiles:
      activeMessage.outputFiles != null
        ? [...activeMessage.outputFiles]
        : existing.outputFiles,
  };
  if (merged.openclawTurn) {
    syncProjectedOpenClawMessage(merged as MessageWithStreamState);
  } else {
    syncOpenClawMessageDerivedState(merged);
  }
  return merged;
}

export function mergeOpenClawActiveMessageIntoList(
  messages: Message[] = [],
  activeMessage?: Message | null,
  conversationId?: string | number
): Message[] {
  if (!activeMessage) return messages;

  const targetConversationId = conversationId ? String(conversationId) : "";
  const activeConversationId = String(activeMessage.conversation_id || "");
  if (targetConversationId && activeConversationId && activeConversationId !== targetConversationId) {
    return messages;
  }
  if (!activeConversationId && targetConversationId) {
    activeMessage = { ...activeMessage, conversation_id: targetConversationId };
  }

  const hasVisibleProgress =
    Boolean(activeMessage.loading) ||
    Boolean(activeMessage.answer?.trim()) ||
    Boolean(activeMessage.reasoning_content?.trim()) ||
    Boolean(activeMessage.openclawActivities?.length) ||
    Boolean(activeMessage.outputFiles?.length);
  if (!hasVisibleProgress) return messages;

  const index = findOpenClawActiveMessageIndex(messages, activeMessage);
  if (index < 0) {
    return [...messages, activeMessage];
  }

  const next = [...messages];
  next[index] = mergeOpenClawActiveMessage(next[index], activeMessage);
  return next;
}

export function mergeOpenClawTimelineEventsIntoMessage(
  message: Message,
  payload: any,
  options?: { canonicalOnly?: boolean }
): boolean {
  return mergeOpenClawTimelineEventsIntoMessageWithOptions(message, payload, options);
}

export function replaceOpenClawTurnWithTimelineEvents(
  message: Message,
  payload: any,
  options?: { canonicalOnly?: boolean }
): boolean {
  return mergeOpenClawTimelineEventsIntoMessageWithOptions(message, payload, {
    mode: "replace-turn",
    isStreaming: false,
    canonicalOnly: options?.canonicalOnly,
  });
}

function mergeOpenClawTimelineEventsIntoMessageWithOptions(
  message: Message,
  payload: any,
  options?: {
    mode?: "append" | "replace-turn";
    isStreaming?: boolean;
    canonicalOnly?: boolean;
  }
): boolean {
  (message as MessageWithStreamState)._openclawCanonicalOnly = Boolean(options?.canonicalOnly);
  const targetConversationId = String(message.conversation_id || "");
  const turnStartSeq = Number.isFinite(Number(message._openclawTurnStartSeq))
    ? Number(message._openclawTurnStartSeq)
    : 0;
  const messageLedgerTurnIds = getMessageOpenClawLedgerTurnIds(message);
  const messageLedgerRunIds = getMessageOpenClawLedgerRunIds(message);
  const canBindFirstLedgerTurn = isOpenClawActiveLedgerBindCandidate(message);
  const canBindAnonymousLedgerTurn = isOpenClawAnonymousLedgerBindCandidate(message);
  const events = getOpenClawTimelineEvents(payload).filter((event) => {
    const eventSessionId = event?.sessionId ? String(event.sessionId) : "";
    if (targetConversationId ? eventSessionId !== targetConversationId : Boolean(eventSessionId)) {
      return false;
    }
    const payload = event?.payload as Record<string, unknown> | undefined;
    const hasLedgerProtocol = payload ? hasOpenClawLedgerProtocolPayload(payload) : false;
    if (options?.canonicalOnly && !hasLedgerProtocol) {
      return false;
    }
    const ledgerTurnId = readOpenClawLedgerTurnId(payload);
    const ledgerRunId = readOpenClawLedgerRunId(payload);
    if (ledgerTurnId && messageLedgerTurnIds.size > 0) {
      if (messageLedgerTurnIds.has(ledgerTurnId)) return true;
      return Boolean(ledgerRunId && messageLedgerRunIds.has(ledgerRunId));
    }
    if (options?.canonicalOnly && ledgerTurnId) {
      if (doesOpenClawLedgerEventBelongToMessage(message, payload)) return true;
      if (!canBindAnonymousLedgerTurn) return false;
      const seq = typeof event?.seq === "number" ? event.seq : Number(event?.seq);
      return !turnStartSeq || (Number.isFinite(seq) && seq > turnStartSeq);
    }
    const seq = typeof event?.seq === "number" ? event.seq : Number(event?.seq);
    if (ledgerTurnId && !canBindFirstLedgerTurn) {
      return false;
    }
    if (ledgerTurnId && canBindFirstLedgerTurn) {
      return !turnStartSeq || (Number.isFinite(seq) && seq > turnStartSeq);
    }
    if (!turnStartSeq) {
      return true;
    }
    return Number.isFinite(seq) && seq > turnStartSeq;
  });
  if (!events.length) return false;

  const firstLedgerPayload = events.find((event) =>
    readOpenClawLedgerTurnId(event?.payload as Record<string, unknown> | undefined)
  )?.payload as Record<string, unknown> | undefined;
  const activeRequestId = readOpenClawLedgerActiveRequestId(firstLedgerPayload);
  if (activeRequestId) {
    message._openclawActiveRequestId = activeRequestId;
    message._openclawClientMessageId = message._openclawClientMessageId || activeRequestId;
  }
  const firstLedgerTurnId = readOpenClawLedgerTurnId(firstLedgerPayload);
  if (canBindAnonymousLedgerTurn && firstLedgerTurnId) {
    const hasTerminalEvent = events.some(
      (event) => event?.kind === "run.completed" || event?.kind === "run.failed" || event?.kind === "run.interrupted"
    );
    message.openclawTurn = createOpenClawTurnState({
      sessionId: targetConversationId,
      turnKey: firstLedgerTurnId,
      status: hasTerminalEvent ? "completed" : "streaming",
    });
    message.loading = !hasTerminalEvent;
    traceOpenClawStream("ledger.bind-unhydrated-user", {
      messageId: String(message.id || ""),
      conversationId: targetConversationId,
      turnId: firstLedgerTurnId,
      activeRequestId: activeRequestId || "",
      eventCount: events.length,
      hasTerminalEvent,
      questionHash: hashOpenClawStreamText(getOpenClawMessageQuestion(message)),
    });
  }

  const previousAnswer = message.answer || "";
  const previousTimelineSignature = JSON.stringify(
    (message.openclawTimelineItems || []).map((item) => [item.type, item.key, item.seq, item.sessionId, item.content])
  );
  const previousKeys = (message.openclawActivities || []).map((item) => item.key).join("|");
  const normalizedEvents = events.flatMap((event) => {
    const kind = String(event?.kind || "");
    const seq = typeof event?.seq === "number" ? event.seq : Number(event?.seq);
    const createdAt = event?.createdAt;
    const sessionId = String(event?.sessionId || targetConversationId || "");
    const eventId = String(event?.id || `${sessionId}:${kind}:${seq || ""}:${createdAt || ""}`);
    if (kind === "assistant.message" || kind === "assistant.message.delta" || kind === "assistant.delta") {
      const content = getOpenClawAssistantEventContent(event);
      if (!content) return [];
      const eventPayload =
        event?.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
      return [
        createOpenClawTurnEvent({
          eventId,
          sessionId,
          seq: Number.isFinite(seq) ? seq : undefined,
          kind,
          createdAt,
          payload: { ...eventPayload, content },
          source: "events",
          replace: isOpenClawTimelineReplaceEvent(event, eventPayload),
          messageSeq: Number.isFinite(seq) ? seq : undefined,
        }),
      ];
    }
    if (kind === "process.step") {
      const eventPayload =
        event?.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
      const step = readOpenClawProcessRecord(event);
      if (step?.step_code !== "output_files" || step?.status !== "completed") return [];
      const files = [
        ...normalizeOutputFiles(step?.data?.files),
        ...normalizeOutputFiles(step?.data?.media_attachments),
      ];
      if (!files.length) return [];
      const ledgerRecord = readOpenClawLedgerRecord(eventPayload);
      const hasLedgerRecord = Object.keys(ledgerRecord).length > 0;
      return [
        createOpenClawTurnEvent({
          eventId,
          sessionId,
          seq: Number.isFinite(seq) ? seq : undefined,
          kind,
          createdAt,
          payload: {
            ...(eventPayload.process_step ? { process_step: eventPayload.process_step } : {}),
            files,
            ...(step?.data?.openclaw_timeline ? { openclaw_timeline: step.data.openclaw_timeline } : {}),
            ...(hasLedgerRecord ? { openclaw_ledger: ledgerRecord } : {}),
          },
          source: "events",
        }),
      ];
    }
    if (!kind) return [];
    return [
      createOpenClawTurnEvent({
        eventId,
        sessionId,
        seq: Number.isFinite(seq) ? seq : undefined,
        kind,
        createdAt,
        payload: event?.payload && typeof event.payload === "object" ? event.payload : {},
        source: "events",
        messageSeq: Number.isFinite(seq) ? seq : undefined,
      }),
    ];
  });

  if (options?.mode === "replace-turn") {
    const replacementEvents = preserveStreamingSupportEventsForFinalReplace(message, normalizedEvents);
    const terminalStatus = normalizedEvents.some((event) => event.kind === "run.failed")
      ? "failed"
      : normalizedEvents.some((event) => event.kind === "run.interrupted")
        ? "interrupted"
        : normalizedEvents.some((event) => event.kind === "run.completed")
          ? "completed"
          : message.loading
            ? "streaming"
            : "completed";
    const turnKey =
      message.openclawTurn?.turnKey ||
      buildOpenClawTurnKey({
        sessionId: targetConversationId,
        clientMessageId: message._openclawClientMessageId,
        messageId: message.id,
        turnStartSeq,
      });
    const turn = appendOpenClawEvents(
      createOpenClawTurnState({
        sessionId: targetConversationId,
        turnKey,
        status: terminalStatus,
        resolvedMessageId: message.openclawTurn?.resolvedMessageId,
      }),
      replacementEvents
    );
    message.openclawTurn = turn;
    const projection = projectOpenClawTurn(turn, {
      isStreaming: options.isStreaming ?? false,
      canonicalOnly: Boolean(options?.canonicalOnly),
    });
    syncOpenClawProjectionToMessage(message, projection);
  } else {
    appendOpenClawTurnEventsToMessage(message as MessageWithStreamState, normalizedEvents);
  }

  if (events.some((event) => event?.kind === "run.interrupted")) {
    markOpenClawInterrupted(message);
  }
  const failedEvent = events.find((event) => event?.kind === "run.failed");
  if (failedEvent) {
    const payloadRecord = failedEvent.payload && typeof failedEvent.payload === "object" ? failedEvent.payload as Record<string, unknown> : {};
    const errorText = readOpenClawFailureText(payloadRecord);
    message.error = true;
    message.loading = false;
    if (!message.answer?.trim()) {
      message.answer = errorText;
    }
  }
  syncProjectedOpenClawMessage(message as MessageWithStreamState);
  const nextTimelineSignature = JSON.stringify(
    (message.openclawTimelineItems || []).map((item) => [item.type, item.key, item.seq, item.sessionId, item.content])
  );
  const nextKeys = (message.openclawActivities || []).map((item) => item.key).join("|");

  return (
    previousKeys !== nextKeys ||
    previousAnswer !== (message.answer || "") ||
    previousTimelineSignature !== nextTimelineSignature
  );
}

function preserveStreamingOutputFileEventsForFinalReplace(
  message: Message,
  normalizedEvents: ReturnType<typeof createOpenClawTurnEvent>[]
) {
  const protocolTurnIds = getProtocolTurnIds(normalizedEvents);
  const previousOutputEvents = getPreviousEventsForFinalReplace(message, normalizedEvents).filter((event) => {
    if (event.kind !== "process.step" && event.segmentType !== "output_files") return false;
    return normalizeOutputFilesFromOpenClawPayload(event.payload || {}).length > 0;
  });
  if (!previousOutputEvents.length) return normalizedEvents;

  const incomingFileKeys = new Set<string>();
  for (const event of normalizedEvents) {
    if (event.kind !== "process.step" && event.segmentType !== "output_files") continue;
    for (const file of normalizeOutputFilesFromOpenClawPayload(event.payload || {})) {
      incomingFileKeys.add(getOutputFileKey(file));
    }
  }

  const preserved = previousOutputEvents.filter((event) => {
    if (!isSameFinalReplaceTurn(event, message, protocolTurnIds)) return false;
    return normalizeOutputFilesFromOpenClawPayload(event.payload || {}).some((file) => !incomingFileKeys.has(getOutputFileKey(file)));
  });
  return preserved.length ? [...normalizedEvents, ...preserved] : normalizedEvents;
}

function getProtocolTurnIds(events: ReturnType<typeof createOpenClawTurnEvent>[]): Set<string> {
  return new Set(
    events
      .map((event) => String(event.turnId || ""))
      .filter(Boolean)
  );
}

function isSameProtocolTurnForFinalReplace(
  event: ReturnType<typeof createOpenClawTurnEvent>,
  protocolTurnIds: Set<string>
): boolean {
  if (!protocolTurnIds.size) return true;
  return Boolean(event.turnId && protocolTurnIds.has(event.turnId));
}

function isSameFinalReplaceTurn(
  event: ReturnType<typeof createOpenClawTurnEvent>,
  message: Message,
  protocolTurnIds: Set<string>
): boolean {
  if (isSameProtocolTurnForFinalReplace(event, protocolTurnIds)) return true;
  if (!protocolTurnIds.size || event.turnId || event.source !== "stream") return false;

  const eventSeq = typeof event.seq === "number" ? event.seq : Number(event.seq);
  if (!Number.isFinite(eventSeq)) return false;

  const turnStartSeq = Number((message as MessageWithStreamState)._openclawTurnStartSeq || 0);
  return Number.isFinite(turnStartSeq) && turnStartSeq > 0 && eventSeq > turnStartSeq;
}

function inferFinalReplaceTurnId(protocolTurnIds: Set<string>): string {
  return protocolTurnIds.size === 1 ? [...protocolTurnIds][0] || "" : "";
}

function normalizePreviousEventForFinalReplace(
  event: ReturnType<typeof createOpenClawTurnEvent>,
  message: Message,
  protocolTurnIds: Set<string>
): ReturnType<typeof createOpenClawTurnEvent> | null {
  if (isSameProtocolTurnForFinalReplace(event, protocolTurnIds)) return event;
  if (!isSameFinalReplaceTurn(event, message, protocolTurnIds)) return null;

  const inferredTurnId = inferFinalReplaceTurnId(protocolTurnIds);
  if (!inferredTurnId) return null;
  return {
    ...event,
    turnId: inferredTurnId,
  };
}

function getPreviousEventsForFinalReplace(
  message: Message,
  normalizedEvents: ReturnType<typeof createOpenClawTurnEvent>[]
) {
  const protocolTurnIds = getProtocolTurnIds(normalizedEvents);
  const previousEvents = message.openclawTurn?.events || [];
  if (!protocolTurnIds.size) return previousEvents;
  return previousEvents
    .map((event) => normalizePreviousEventForFinalReplace(event, message, protocolTurnIds))
    .filter((event): event is ReturnType<typeof createOpenClawTurnEvent> => Boolean(event));
}

function normalizeOpenClawComparableText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function getPreservedStreamingToolEventKey(event: ReturnType<typeof createOpenClawTurnEvent>) {
  if (event.kind !== "tool.call" && event.kind !== "tool.result") return "";
  const activity = buildOpenClawActivity({
    id: event.eventId,
    sessionId: event.sessionId,
    seq: event.seq,
    kind: event.kind,
    payload: event.payload,
    createdAt: event.createdAt,
  });
  if (!activity) return "";

  const toolCallId = normalizeOpenClawComparableText(activity.tool?.toolCallId || "");
  if (toolCallId) return `${activity.kind}:call:${toolCallId}`;
  const toolName = normalizeOpenClawComparableText(activity.tool?.name || activity.tool?.displayName || "");
  const toolInput = normalizeOpenClawComparableText(activity.tool?.input || "");
  const toolOutput = normalizeOpenClawComparableText(
    activity.tool?.output || activity.summary || activity.detail || ""
  );
  if (!toolName && !toolInput && !toolOutput) return String(event.eventId || "");
  if (!toolInput && !toolOutput) return `${event.kind}:${String(event.eventId || "")}`;
  return `${activity.kind}:${toolName}:${toolInput}:${toolOutput}`;
}

function hasPreservableStreamingToolContent(event: ReturnType<typeof createOpenClawTurnEvent>) {
  if (event.kind !== "tool.call" && event.kind !== "tool.result") return false;
  const activity = buildOpenClawActivity({
    id: event.eventId,
    sessionId: event.sessionId,
    seq: event.seq,
    kind: event.kind,
    payload: event.payload,
    createdAt: event.createdAt,
  });
  if (!activity) return false;
  return Boolean(
    normalizeOpenClawComparableText(activity.tool?.input || "") ||
      normalizeOpenClawComparableText(activity.tool?.output || "")
  );
}

function getPreservedStreamingThinkingEventKey(event: ReturnType<typeof createOpenClawTurnEvent>) {
  if (event.kind !== "assistant.thinking") return "";
  const activity = buildOpenClawActivity({
    id: event.eventId,
    sessionId: event.sessionId,
    seq: event.seq,
    kind: event.kind,
    payload: event.payload,
    createdAt: event.createdAt,
  });
  const summary = normalizeOpenClawComparableText(activity?.summary || activity?.detail || "");
  if (!summary || isOpenClawToolPlaceholderThinkingText(summary)) return "";
  return `assistant.thinking:${summary}`;
}

function preserveStreamingSupportEventsForFinalReplace(
  message: Message,
  normalizedEvents: ReturnType<typeof createOpenClawTurnEvent>[]
) {
  const withOutputFiles = preserveStreamingOutputFileEventsForFinalReplace(message, normalizedEvents);
  const previousEvents = getPreviousEventsForFinalReplace(message, normalizedEvents);
  const previousToolEvents = previousEvents.filter((event) =>
    event.kind === "tool.call" || event.kind === "tool.result"
  );
  const incomingToolKeys = new Set(
    withOutputFiles
      .map((event) => getPreservedStreamingToolEventKey(event))
      .filter(Boolean)
  );
  const preservedToolEvents = previousToolEvents.filter((event) => {
    if (!hasPreservableStreamingToolContent(event)) return false;
    const key = getPreservedStreamingToolEventKey(event);
    return key && !incomingToolKeys.has(key);
  });

  const withTools = preservedToolEvents.length ? [...withOutputFiles, ...preservedToolEvents] : withOutputFiles;
  const previousThinkingEvents = previousEvents.filter((event) => event.kind === "assistant.thinking");
  if (!previousThinkingEvents.length) return withTools;

  const incomingThinkingKeys = new Set(
    withTools
      .map((event) => getPreservedStreamingThinkingEventKey(event))
      .filter(Boolean)
  );
  const preservedThinkingEvents = previousThinkingEvents.filter((event) => {
    const key = getPreservedStreamingThinkingEventKey(event);
    return key && !incomingThinkingKeys.has(key);
  });
  return preservedThinkingEvents.length ? [...withTools, ...preservedThinkingEvents] : withTools;
}

function normalizeOutputFilesFromOpenClawPayload(payload: Record<string, any>): OutputFile[] {
  const step = payload?.process_step && typeof payload.process_step === "object" ? payload.process_step : undefined;
  return [
    ...normalizeOutputFiles(payload?.files),
    ...normalizeOutputFiles(payload?.media_attachments),
    ...normalizeOutputFiles(step?.data?.files),
    ...normalizeOutputFiles(step?.data?.media_attachments),
  ];
}

function mergeOpenClawReasoningText(
  current: string,
  next: string,
  replace: boolean,
  separateBlock: boolean
): string {
  if (!next) return current;
  if (replace) return next;
  if (!current) return next;
  if (current === next || current.trim() === next.trim()) return current;
  if (!separateBlock) return current + next;

  const left = current.trimEnd();
  const right = next.trimStart();
  if (!left) return right;
  if (!right) return left;
  return `${left}\n\n${right}`;
}

function readOpenClawTimelineSeq(data: any, delta: any): number | undefined {
  const candidates = [
    data?.seq,
    data?.data?.seq,
    data?.payload?.seq,
    data?.data?.payload?.seq,
    data?.payload?.message_seq,
    data?.data?.payload?.message_seq,
    data?.payload?.openclaw_timeline?.segment_index,
    data?.data?.payload?.openclaw_timeline?.segment_index,
    delta?.seq,
    delta?.message_seq,
  ];
  for (const candidate of candidates) {
    const seq = typeof candidate === "number" ? candidate : Number(candidate);
    if (Number.isFinite(seq)) return seq;
  }
  return undefined;
}

export function processStreamDataItem(
  data: any,
  message: Message,
  formatRagStats: (ragStats: any, processRecords: any[]) => any,
  options?: StreamProcessOptions
): void {
  if (options?.openclaw) {
    (message as MessageWithStreamState)._openclawCanonicalOnly = Boolean(options.canonicalOnly);
  }
  const { message_id } = data;
  const streamPayload = getStreamPayload(data);
  const openClawTraceEnabled = Boolean(options?.openclaw && isOpenClawStreamDebugEnabled());
  const openClawTraceBefore = openClawTraceEnabled
    ? summarizeOpenClawMessageProjectionTrace(message)
    : undefined;
  const traceOpenClawProjection = (outcome: string) => {
    if (!openClawTraceEnabled) return;
    traceOpenClawStream("stream.chunk.projected", {
      outcome,
      chunk: summarizeOpenClawStreamChunk(data, streamPayload),
      before: openClawTraceBefore,
      after: summarizeOpenClawMessageProjectionTrace(message),
      options: {
        canonicalOnly: Boolean(options?.canonicalOnly),
      },
    });
  };

  if (openClawTraceEnabled) {
    traceOpenClawStream("stream.chunk.in", {
      chunk: summarizeOpenClawStreamChunk(data, streamPayload),
      before: openClawTraceBefore,
      options: {
        canonicalOnly: Boolean(options?.canonicalOnly),
      },
    });
  }

  if (options?.openclaw) {
    const resolvedConversationId = readOpenClawResolvedConversationId(data, streamPayload);
    if (resolvedConversationId && !isOpenClawPendingConversationId(resolvedConversationId)) {
      const previousConversationId = String(message.conversation_id || "");
      if (previousConversationId !== resolvedConversationId) {
        Object.assign(
          message,
          rebaseOpenClawMessageConversation(
            message as MessageWithStreamState,
            resolvedConversationId,
            previousConversationId
          )
        );
        if (message.openclawTurn) {
          message.openclawTurn = rebaseOpenClawTurnStateConversation(
            message.openclawTurn,
            resolvedConversationId,
            previousConversationId
          );
          syncProjectedOpenClawMessage(message as MessageWithStreamState);
        }
      } else {
        message.conversation_id = resolvedConversationId;
      }
    }
  }

  if (options?.openclaw && applyOpenClawStructuredStreamEvent(message as MessageWithStreamState, data, streamPayload, {
    canonicalOnly: options?.canonicalOnly,
  })) {
    if (message_id) {
      message.id = message_id;
    }
    traceOpenClawProjection("structured-event");
    return;
  }

  if (data?.error) {
    const payload = getOpenClawEventPayload(data);
    message.error = true;
    message.answer = options?.openclaw
      ? readOpenClawFailureText(payload, data.error_message || data.error?.message || "请求失败")
      : data.error_message || "请求失败";
    message.loading = false;
    if (options?.openclaw) {
      syncProjectedOpenClawMessage(message as MessageWithStreamState);
    }
    traceOpenClawProjection("error");
    return;
  }

  if (options?.openclaw) {
    const eventKind = getOpenClawEventKind(data);
    if (options.canonicalOnly && eventKind && !isOpenClawRealtimeSupportEventKind(eventKind)) {
      traceOpenClawProjection("canonical-skip-unsupported-event");
      return;
    }
    if (eventKind === "run.interrupted") {
      appendOpenClawActivity(message, eventKind, "本次运行已中断", data);
      markOpenClawInterrupted(message);
      syncProjectedOpenClawMessage(message as MessageWithStreamState);
      traceOpenClawProjection("run-interrupted");
      return;
    }
    if (eventKind === "run.failed") {
      const payload = getOpenClawEventPayload(data);
      const failureText = readOpenClawFailureText(payload);
      appendOpenClawActivity(message, eventKind, failureText, data);
      message.error = true;
      message.loading = false;
      message.answer = failureText;
      syncProjectedOpenClawMessage(message as MessageWithStreamState);
      traceOpenClawProjection("run-failed");
      return;
    }
    if (isOpenClawToolEventKind(eventKind)) {
      const delta = streamPayload?.choices?.[0]?.delta;
      const deltaText = cleanStreamText(delta?.reasoning_content) || cleanStreamText(delta?.content);
      if (!deltaText || isOpenClawToolPlaceholderThinkingText(deltaText)) {
        const payload = getOpenClawEventPayload(data);
        appendOpenClawActivity(message, eventKind, String(payload.summary || payload.content || ""), data);
        traceOpenClawProjection("tool-placeholder");
        return;
      }
    }
  }

  appendOutputFilesToMessage(message, extractStreamOutputFiles(data, streamPayload), Boolean(options?.openclaw));

  const processStepPayload =
    data.object === "process.step"
      ? data
      : data?.data?.object === "process.step"
        ? data.data
        : undefined;

  if (processStepPayload) {
    const ps = processStepPayload.process_step || {};
    const process_data = ps.data || {};

    if (!message.rag_temp) message.rag_temp = {};

    if (process_data.sources) {
      message.rag_temp.document_search = { chunks: process_data.sources };
    }

    if (!Array.isArray(message.process_records)) {
      message.process_records = [];
    }
    message.process_records = [
      ...message.process_records,
      { ...ps, data: JSON.stringify(process_data) },
    ];

    if (process_data.document_search) {
      message.rag_temp.document_search = process_data.document_search;
    }
    if (process_data.document_quotations) {
      message.rag_temp.document_quotations = process_data.document_quotations;
    }
    if (process_data.file_quotations) {
      message.rag_temp.file_quotations = process_data.file_quotations;
    }
    if (message.rag_temp.document_search) {
      message.rag_stats = formatRagStats(message.rag_temp, message.process_records || []);
    }
    message.rag_search_text = ps.message;

    if (ps.step_code === "output_files" && ps.status === "completed" && ps.data) {
      const files = [
        ...normalizeOutputFiles(ps.data?.files),
        ...normalizeOutputFiles(ps.data?.media_attachments),
      ];
      appendOutputFilesToMessage(message, files, Boolean(options?.openclaw));
      if (options?.openclaw && files.length) {
        const stepTimeline =
          ps.data?.openclaw_timeline && typeof ps.data.openclaw_timeline === "object"
            ? ps.data.openclaw_timeline
            : undefined;
        appendOpenClawTurnEventsToMessage(message as MessageWithStreamState, [
          createOpenClawTurnEvent({
            eventId: `${String(message.conversation_id || "openclaw")}:process.step:output_files:${ps.timestamp || processStepPayload.timestamp || Date.now()}`,
            sessionId: String(message.conversation_id || ""),
            seq: readOpenClawTimelineSeq(processStepPayload, streamPayload?.choices?.[0]?.delta),
            kind: "process.step",
            payload: { files, ...(stepTimeline ? { openclaw_timeline: stepTimeline } : {}) },
            createdAt: new Date().toISOString(),
            source: "stream",
          }),
        ]);
      }
    }

    if (!Array.isArray(message.skillRunItems)) message.skillRunItems = [];

    const step: ProcessRecord = {
      step_code: String(ps.step_code ?? ""),
      status: ps.status as any,
      message: String(ps.message ?? ""),
      data: ps.data,
    };

    const { items: newItems } = applyProcessStep(step, message.skillRunItems);
    message.skillRunItems = newItems;
  } else if (streamPayload.choices?.[0]?.delta) {
    const delta = streamPayload.choices[0].delta;
    const rawContent = cleanStreamText(delta.content);
    const finishReason = streamPayload.choices[0].finish_reason;
    const streamError = streamPayload.error;

    if (
      options?.openclaw &&
      finishReason === "error" &&
      (isOpenClawInterruptedText(rawContent) ||
        isOpenClawInterruptedText(streamError?.message) ||
        isOpenClawInterruptedText(streamError?.code))
    ) {
      markOpenClawInterrupted(message);
      syncProjectedOpenClawMessage(message as MessageWithStreamState);
      traceOpenClawProjection("finish-interrupted");
      return;
    }
    if (options?.openclaw && (finishReason === "error" || streamError)) {
      message.error = true;
      message.loading = false;
      message.answer = String(streamError?.message || rawContent || "OpenClaw 运行失败");
      syncProjectedOpenClawMessage(message as MessageWithStreamState);
      traceOpenClawProjection("finish-error");
      return;
    }

    const streamState = message as MessageWithStreamState;
    const openClawThinkingChunk = isOpenClawThinkingChunk(data, options);
    const openClawReplaceChunk = isOpenClawReplaceChunk(data, delta, options);
    let content = rawContent;
    let inlineReasoning = "";

    if (options?.openclaw && rawContent) {
      const split = splitThinkTagContent(rawContent, streamState._openclawThinkTagOpen);
      if (split.sawThinkTag) {
        content = split.content;
        inlineReasoning = split.reasoning;
        streamState._openclawThinkTagOpen = split.thinkOpen;
      }
    }

    const reasoning_content =
      cleanStreamText(delta.reasoning_content) ||
      (openClawThinkingChunk ? rawContent : inlineReasoning);
    const rawOpenClawEventKind = getOpenClawEventKind(data);
    const effectiveEventKind = rawOpenClawEventKind || "assistant.thinking";
    if (options?.openclaw && reasoning_content && (openClawThinkingChunk || inlineReasoning)) {
      appendOpenClawActivity(message, effectiveEventKind, reasoning_content, data);
    }
    const nextReasoningContent =
      options?.openclaw && reasoning_content
        ? mergeOpenClawReasoningText(
            message.reasoning_content || "",
            reasoning_content,
            openClawReplaceChunk,
            openClawThinkingChunk
          )
        : `${message.reasoning_content || ""}${reasoning_content || ""}`;
    const accumulatedReasoning = options?.openclaw
      ? [nextReasoningContent || message.reasoning_content || "", getOpenClawActivityReasoning(message)]
          .filter(Boolean)
          .join("\n\n")
      : nextReasoningContent || message.reasoning_content || "";

    if (options?.openclaw) {
      message.reasoning_content = nextReasoningContent || message.reasoning_content || "";
      if (openClawThinkingChunk && message.answer) {
        message.answer = sanitizeOpenClawAnswer(message.answer, message.reasoning_content || "");
      }
    }

    if (options?.openclaw && content && accumulatedReasoning) {
      content = sanitizeOpenClawAnswer(content, accumulatedReasoning);
    }

    if (options?.openclaw) {
      if (content && !openClawThinkingChunk) {
        const eventPayload = getOpenClawEventPayload(data);
        const answerSeq = readOpenClawTimelineSeq(data, delta) ?? (Number(message.openclawTurn?.maxSeq || 0) + 1);
        const streamAnswerKind =
          rawOpenClawEventKind === "assistant.message"
            ? "assistant.message"
            : "assistant.message.delta";
        if (
          !shouldExposeOpenClawStreamAnswer(
            eventPayload,
            streamAnswerKind,
            Boolean(rawOpenClawEventKind),
            openClawReplaceChunk
          )
        ) {
          syncProjectedOpenClawMessage(message as MessageWithStreamState);
          traceOpenClawProjection("answer-hidden-by-visibility");
          return;
        }
        appendOpenClawTurnEventsToMessage(message as MessageWithStreamState, [
          createOpenClawTurnEvent({
            eventId: `${String(message.conversation_id || "openclaw")}:stream:answer:${answerSeq}:${content.length}`,
            sessionId: readOpenClawResolvedConversationId(data, getStreamPayload(data)) || String(message.conversation_id || ""),
            seq: answerSeq,
            kind: streamAnswerKind,
            payload: { ...eventPayload, content },
            createdAt: new Date().toISOString(),
            source: "stream",
            provisional: streamAnswerKind !== "assistant.message",
            replace: openClawReplaceChunk,
            messageId: message.id,
            messageSeq: answerSeq,
          }),
        ]);
      }
    } else {
      if (content && !openClawThinkingChunk) {
        const failedTip = "请求失败";
        if (content.startsWith("Upstream Error") || content.startsWith("Error: 当前应用模型余额不足")) {
          message.answer = failedTip;
        } else if (message.answer === failedTip) {
          message.answer = content;
        } else {
          message.answer = message.answer + content;
        }
      }
      if (reasoning_content) {
        message.reasoning_content = (message.reasoning_content || "") + reasoning_content;
      }
    }

    if (message.answer?.trim() && message.reasoning_content?.trim() && message.reasoning_expanded) {
      message.reasoning_expanded = false;
    }
    if (options?.openclaw) {
      syncProjectedOpenClawMessage(message as MessageWithStreamState);
    }
  }

  if (message_id) {
    message.id = message_id;
  }
  traceOpenClawProjection("completed");
}

// ============ 文件下载 ============

/**
 * 下载沙箱文件
 * 需要通过 ChatConfigProvider 注入 fileDownload 适配器
 */
export async function downloadSandboxFile(
  id: string | number,
  filename?: string,
  downloadApi?: { downloadFile(id: string | number): Promise<Blob> }
): Promise<void> {
  if (!downloadApi) {
    console.error("下载文件失败: 缺少 fileDownload 适配器");
    return;
  }
  try {
    const blob = await downloadApi.downloadFile(id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || `sandbox-file-${id}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("下载文件失败:", err);
  }
}

// ============ 主 Hook ============

export function useChatStream() {
  const jsonBufferRef = useRef("");
  const adapters = useChatAdapters();

  const processStreamData = useCallback(
    (
      e: any,
      processedLength: number,
      message: Message,
      networkSearch: boolean,
      formatRagStats: (ragStats: any, processRecords: any[]) => any,
      options?: StreamProcessOptions
    ): number => {
      if (!e.event?.target || !message) return processedLength;

      if (networkSearch && message.rag_temp) {
        message.rag_temp.type = "web_search";
      }

      const fullResponse = e.event.target.response || "";
      const newChunk = fullResponse.substring(processedLength);
      const newProcessedLength = fullResponse.length;

      try {
        const lines = newChunk
          .split("\n")
          .filter((line: string) => line.trim() !== "" && line.trim() !== "data: [DONE]");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            if (jsonBufferRef.current) {
              jsonBufferRef.current = "";
            }

            const jsonStr = line.slice(6);
            const data = parseJson<any>(jsonStr);

            if (data) {
              if (data?.error) {
                const payload = options?.openclaw ? getOpenClawEventPayload(data) : {};
                message.error = true;
                message.answer = options?.openclaw
                  ? readOpenClawFailureText(payload, data.error_message || data.error?.message || "请求失败")
                  : (data.error?.message || "请求失败");
                if (options?.openclaw) {
                  message.loading = false;
                  syncProjectedOpenClawMessage(message as MessageWithStreamState);
                }
                return newProcessedLength;
              }
              processStreamDataItem(data, message, formatRagStats, options);
              jsonBufferRef.current = "";
            } else {
              jsonBufferRef.current = jsonStr;
            }
          } else {
            if (jsonBufferRef.current) {
              const combinedJson = jsonBufferRef.current + line;
              const data = parseJson(combinedJson);

              if (data) {
                processStreamDataItem(data, message, formatRagStats, options);
                jsonBufferRef.current = "";
              } else {
                jsonBufferRef.current = combinedJson;
              }
            } else {
              message.error = true;
              message.answer = line;
            }
          }
        }
      } catch (err: unknown) {
        jsonBufferRef.current = "";
        message.error = true;
        message.answer = err instanceof Error ? err.message : String(err);
      }

      return newProcessedLength;
    },
    []
  );

  const clearBuffer = useCallback(() => {
    jsonBufferRef.current = "";
  }, []);

  // 下载沙箱文件（绑定适配器）
  const handleDownloadSandboxFile = useCallback(
    async (id: string | number, filename?: string) => {
      await downloadSandboxFile(id, filename, adapters?.fileDownload);
    },
    [adapters?.fileDownload]
  );

  return {
    applyProcessStep,
    processStreamData,
    clearBuffer,
    parseJson,
    processStreamDataItem,
    convertReplayEventToSSE,
    downloadSandboxFile: handleDownloadSandboxFile,
  };
}

export default useChatStream;
