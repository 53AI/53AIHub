import type {
  Message,
  OpenClawActivityItem,
  OpenClawTimelineItem,
  OpenClawTurnEvent,
  OpenClawTurnProjection,
  OpenClawTurnState,
  OutputFile,
} from "../types/message";
import {
  buildOpenClawActivity,
  isOpenClawToolPlaceholderThinkingText,
  mergeOpenClawActivities,
} from "./openclaw-activities";
import { sanitizeOpenClawAnswer } from "./openclaw";
import {
  buildOpenClawAnswerTimelineItem,
  buildOpenClawOutputFilesTimelineItem,
  buildOpenClawTimelineItemFromActivity,
  getOutputFileKey,
  mergeOpenClawTimelineItems,
  mergeOutputFiles,
} from "./openclaw-timeline";
import { hasOpenClawLedgerProtocol, projectOpenClawLedgerTurn } from "./openclaw-ledger";

type OpenClawMutableMessage = Message & {
  openclawTurn?: OpenClawTurnState;
  openclawProjection?: OpenClawTurnProjection;
  openclawActivities?: OpenClawActivityItem[];
  openclawTimelineItems?: OpenClawTimelineItem[];
  outputFiles?: OutputFile[];
  answer?: string;
  reasoning_content?: string;
  interrupted?: boolean;
  loading?: boolean;
  error?: boolean;
  _openclawClientMessageId?: string | number;
  _openclawTurnStartSeq?: number;
};

type PendingOpenClawAnswer = {
  content: string;
  seq?: number;
  createdAt?: string;
  authoritative: boolean;
};

const OPENCLAW_ANSWER_EVENT_KINDS = new Set(["assistant.message", "assistant.message.delta", "assistant.delta"]);
const OPENCLAW_ACTIVITY_EVENT_KINDS = new Set([
  "assistant.thinking",
  "tool.call",
  "tool.result",
  "run.started",
  "run.completed",
  "run.failed",
  "run.interrupted",
]);

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stringifyStable(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
  } catch {
    return String(value);
  }
}

function readNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getEventContent(event: OpenClawTurnEvent): string {
  const payload = event.payload || {};
  const content = payload.content;
  return typeof content === "string" ? content : "";
}

function getEventFiles(event: OpenClawTurnEvent): OutputFile[] {
  const payload = event.payload || {};
  const files = payload.files;
  return Array.isArray(files) ? (files as OutputFile[]) : [];
}

function readTimelineProtocol(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  const nested = payload?.openclaw_timeline;
  return nested && typeof nested === "object" ? (nested as Record<string, unknown>) : {};
}

function readLedgerProtocol(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  const nested = payload?.openclaw_ledger;
  return nested && typeof nested === "object" ? (nested as Record<string, unknown>) : {};
}

function readStringFromRecords(key: string, ...records: Array<Record<string, unknown> | undefined>): string | undefined {
  for (const record of records) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function readBooleanFromRecords(key: string, ...records: Array<Record<string, unknown> | undefined>): boolean | undefined {
  for (const record of records) {
    const value = record?.[key];
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function readNumberFromRecords(key: string, ...records: Array<Record<string, unknown> | undefined>): number | undefined {
  for (const record of records) {
    const value = record?.[key];
    const parsed = readNumber(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeSegmentType(value?: string): OpenClawTurnEvent["segmentType"] | undefined {
  if (
    value === "answer" ||
    value === "thinking" ||
    value === "tool_call" ||
    value === "tool_result" ||
    value === "run" ||
    value === "output_files"
  ) {
    return value;
  }
  return undefined;
}

function normalizeLedgerSegmentType(value?: string): OpenClawTurnEvent["segmentType"] | undefined {
  if (value === "answer") return "answer";
  if (value === "thinking") return "thinking";
  if (value === "tool") return "tool_result";
  if (value === "output_file") return "output_files";
  if (value === "status") return "run";
  return normalizeSegmentType(value);
}

function getExpectedSegmentTypeForKind(kind?: string): OpenClawTurnEvent["segmentType"] | undefined {
  if (!kind) return undefined;
  if (kind === "assistant.message" || kind === "assistant.message.delta" || kind === "assistant.delta") {
    return "answer";
  }
  if (kind === "assistant.thinking") return "thinking";
  if (kind === "tool.call") return "tool_call";
  if (kind === "tool.result") return "tool_result";
  if (kind === "run.started" || kind === "run.completed" || kind === "run.failed" || kind === "run.interrupted") return "run";
  return undefined;
}

function coerceSegmentTypeForKind(
  kind: string | undefined,
  segmentType: OpenClawTurnEvent["segmentType"] | undefined
): OpenClawTurnEvent["segmentType"] | undefined {
  const expected = getExpectedSegmentTypeForKind(kind);
  if (!expected) return segmentType;
  return segmentType && segmentType !== expected ? expected : segmentType || expected;
}

function normalizeOperation(value?: string): OpenClawTurnEvent["operation"] | undefined {
  if (value === "append" || value === "replace" || value === "close") return value;
  return undefined;
}

function normalizeVisibility(value?: string): OpenClawTurnEvent["visibility"] | undefined {
  if (value === "hidden" || value === "stream" || value === "final") return value;
  return undefined;
}

function getDefaultVisibilityForKind(kind?: string): OpenClawTurnEvent["visibility"] | undefined {
  if (kind === "assistant.delta" || kind === "assistant.message.delta") return "stream";
  if (
    kind === "assistant.message" ||
    kind === "run.started" ||
    kind === "run.completed" ||
    kind === "run.failed" ||
    kind === "run.interrupted"
  ) {
    return "final";
  }
  return undefined;
}

function getDefaultFinalForKind(kind?: string): boolean | undefined {
  if (kind === "assistant.message" || kind === "run.completed" || kind === "run.failed" || kind === "run.interrupted") {
    return true;
  }
  if (kind === "assistant.delta" || kind === "assistant.message.delta") return false;
  return undefined;
}

function readProtocolFields(input: Partial<OpenClawTurnEvent>) {
  const payload = input.payload || {};
  const protocol = readTimelineProtocol(payload);
  const ledger = readLedgerProtocol(payload);
  const explicitTurnId = readStringFromRecords("turn_id", protocol, payload, ledger);
  const hasExplicitProtocol = Boolean(
    input.turnId ||
      explicitTurnId ||
      protocol.protocol_version === "openclaw.timeline.v2" ||
      ledger.protocol_version === "openclaw.ledger.v1"
  );
  const runIdentity = readStringFromRecords("runId", payload) ||
    readStringFromRecords("run_id", payload) ||
    readStringFromRecords("responseId", payload) ||
    readStringFromRecords("response_id", payload);
  const inferredTurnId = runIdentity
    ? `${input.sessionId || "openclaw"}:turn:${runIdentity}`
    : undefined;
  const operation = input.operation || normalizeOperation(readStringFromRecords("operation", protocol, payload));
  const visibility = input.visibility || normalizeVisibility(readStringFromRecords("visibility", protocol, payload, ledger));
  const final = input.final ?? readBooleanFromRecords("final", protocol, payload);
  return {
    turnId: input.turnId || explicitTurnId || inferredTurnId,
    segmentId: input.segmentId || readStringFromRecords("segment_id", protocol, payload) || readStringFromRecords("part_id", ledger),
    segmentType: coerceSegmentTypeForKind(
      input.kind,
      input.segmentType ||
        normalizeSegmentType(readStringFromRecords("segment_type", protocol, payload)) ||
        normalizeLedgerSegmentType(readStringFromRecords("part_type", ledger))
    ),
    segmentIndex: input.segmentIndex ?? readNumberFromRecords("segment_index", protocol, payload),
    deltaIndex: input.deltaIndex ?? readNumberFromRecords("delta_index", protocol, payload),
    operation: operation || normalizeOperation(readStringFromRecords("operation", ledger)) || (input.replace ? "replace" : undefined),
    visibility: visibility || (!hasExplicitProtocol && inferredTurnId ? getDefaultVisibilityForKind(input.kind) : undefined),
    final: final ?? (!hasExplicitProtocol && inferredTurnId ? getDefaultFinalForKind(input.kind) : undefined),
  };
}

function hasTimelineProtocol(event: OpenClawTurnEvent) {
  return Boolean(event.turnId || event.segmentId || readTimelineProtocol(event.payload).protocol_version === "openclaw.timeline.v2");
}

function isAnswerEventKind(kind: string) {
  return OPENCLAW_ANSWER_EVENT_KINDS.has(kind);
}

function isActivityEventKind(kind: string) {
  return OPENCLAW_ACTIVITY_EVENT_KINDS.has(kind);
}

function getEventIdentity(event: OpenClawTurnEvent): string {
  if (event.turnId && event.segmentId) {
    return [
      "v2",
      event.turnId,
      event.segmentId,
      event.segmentType || event.kind,
      event.operation || "",
      event.visibility || "",
      event.deltaIndex ?? event.seq ?? "",
    ].join("|");
  }
  if (event.eventId) return event.eventId;
  const payload = event.payload || {};
  const content = normalizeWhitespace(getEventContent(event));
  const files = getEventFiles(event).map((file) => getOutputFileKey(file)).sort().join(",");
  return [
    event.sessionId || "",
    event.seq ?? "",
    event.kind,
    content || stringifyStable(payload.args || payload.input || payload.result || payload.data || payload),
    files,
  ].join("|");
}

function readEventPayloadRecord(event: OpenClawTurnEvent, key: string): Record<string, unknown> | undefined {
  const value = event.payload?.[key];
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function getToolEventIdentity(event: OpenClawTurnEvent): string {
  if (event.kind !== "tool.call" && event.kind !== "tool.result") return "";
  const payload = event.payload || {};
  const data = readEventPayloadRecord(event, "data");
  const result = data?.result && typeof data.result === "object" ? data.result as Record<string, unknown> : undefined;
  const toolCallId = readStringFromRecords(
    "toolCallId",
    data,
    payload
  ) || readStringFromRecords(
    "tool_call_id",
    data,
    payload
  ) || readStringFromRecords(
    "callId",
    data,
    payload
  ) || readStringFromRecords(
    "call_id",
    data,
    payload
  ) || readStringFromRecords(
    "id",
    data,
    payload
  );
  if (toolCallId) return `id:${normalizeWhitespace(toolCallId)}`;

  const name =
    readStringFromRecords("name", data, payload, result) ||
    readStringFromRecords("toolName", data, payload, result) ||
    readStringFromRecords("tool_name", data, payload, result) ||
    readStringFromRecords("tool", data, payload, result) ||
    "";
  const detail = stringifyStable(
    data?.args ??
      data?.arguments ??
      data?.input ??
      payload.args ??
      payload.arguments ??
      payload.input ??
      data?.result ??
      payload.result ??
      payload.output ??
      payload.content
  );
  return normalizeWhitespace([name, detail].filter(Boolean).join(":"));
}

export function createOpenClawTurnEvent(input: Partial<OpenClawTurnEvent> & {
  kind: string;
  payload?: Record<string, unknown>;
}): OpenClawTurnEvent {
  const protocol = readProtocolFields(input);
  const nextEvent: OpenClawTurnEvent = {
    eventId: input.eventId || "",
    sessionId: input.sessionId,
    seq: input.seq,
    kind: input.kind,
    createdAt: input.createdAt,
    payload: input.payload || {},
    source: input.source,
    provisional: input.provisional,
    replace: input.replace,
    messageId: input.messageId,
    messageSeq: input.messageSeq,
    segmentId: protocol.segmentId,
    turnId: protocol.turnId,
    segmentType: protocol.segmentType,
    segmentIndex: protocol.segmentIndex,
    deltaIndex: protocol.deltaIndex,
    operation: protocol.operation,
    visibility: protocol.visibility,
    final: protocol.final,
  };
  return {
    ...nextEvent,
    eventId: nextEvent.eventId || getEventIdentity(nextEvent),
  };
}

function getEventAuthority(event: OpenClawTurnEvent) {
  if (event.kind === "assistant.message") return 4;
  if (event.source === "events" || event.source === "history") return 3;
  if (event.kind === "assistant.message.delta" || event.kind === "assistant.delta") return 1;
  return 2;
}

function canReplaceSameSeqEvent(existing: OpenClawTurnEvent, incoming: OpenClawTurnEvent) {
  if (
    existing.turnId &&
    incoming.turnId &&
    existing.segmentId &&
    incoming.segmentId &&
    existing.turnId === incoming.turnId &&
    existing.segmentId === incoming.segmentId &&
    (existing.segmentType || existing.kind) === (incoming.segmentType || incoming.kind)
  ) {
    const segmentType = existing.segmentType || incoming.segmentType;
    if (segmentType === "answer") {
      if (incoming.operation === "replace" || incoming.visibility === "final" || incoming.final) {
        return true;
      }
      return readNumber(existing.deltaIndex) === readNumber(incoming.deltaIndex);
    }
    if (segmentType === "tool_call" || segmentType === "tool_result") {
      const existingToolIdentity = getToolEventIdentity(existing);
      const incomingToolIdentity = getToolEventIdentity(incoming);
      if (existingToolIdentity && incomingToolIdentity && existingToolIdentity !== incomingToolIdentity) {
        return false;
      }
    }
    return getEventAuthority(incoming) >= getEventAuthority(existing);
  }

  if ((existing.sessionId || "") !== (incoming.sessionId || "")) return false;
  if (existing.kind !== incoming.kind) return false;
  const existingSeq = readNumber(existing.seq);
  const incomingSeq = readNumber(incoming.seq);
  if (!Number.isFinite(existingSeq) || !Number.isFinite(incomingSeq)) return false;
  if (existingSeq !== incomingSeq) return false;
  if (!isActivityEventKind(existing.kind)) return false;

  const existingContent = normalizeWhitespace(getEventContent(existing));
  const incomingContent = normalizeWhitespace(getEventContent(incoming));
  if (!existingContent || !incomingContent) return getEventAuthority(incoming) >= getEventAuthority(existing);
  return (
    existingContent === incomingContent ||
    existingContent.includes(incomingContent) ||
    incomingContent.includes(existingContent)
  );
}

function compareEvents(left: OpenClawTurnEvent, right: OpenClawTurnEvent) {
  const leftSeq = readNumber(left.seq);
  const rightSeq = readNumber(right.seq);
  if (leftSeq !== undefined && rightSeq !== undefined && leftSeq !== rightSeq) {
    return leftSeq - rightSeq;
  }
  if ((leftSeq !== undefined) !== (rightSeq !== undefined)) {
    return leftSeq !== undefined ? -1 : 1;
  }

  const leftSegmentIndex = readNumber(left.segmentIndex);
  const rightSegmentIndex = readNumber(right.segmentIndex);
  if (leftSegmentIndex !== undefined && rightSegmentIndex !== undefined && leftSegmentIndex !== rightSegmentIndex) {
    return leftSegmentIndex - rightSegmentIndex;
  }
  if ((leftSegmentIndex !== undefined) !== (rightSegmentIndex !== undefined)) {
    return leftSegmentIndex !== undefined ? -1 : 1;
  }
  const leftCreated = Date.parse(String(left.createdAt || "")) || 0;
  const rightCreated = Date.parse(String(right.createdAt || "")) || 0;
  if (leftCreated !== rightCreated) return leftCreated - rightCreated;
  const leftDelta = readNumber(left.deltaIndex);
  const rightDelta = readNumber(right.deltaIndex);
  if (leftDelta !== undefined && rightDelta !== undefined && leftDelta !== rightDelta) {
    return leftDelta - rightDelta;
  }
  return getEventIdentity(left).localeCompare(getEventIdentity(right));
}

export function buildOpenClawTurnKey(input: {
  sessionId?: string;
  clientMessageId?: string | number;
  messageId?: string | number;
  turnStartSeq?: number;
}) {
  return [
    input.sessionId || "openclaw",
    input.clientMessageId || input.messageId || "turn",
    Number.isFinite(Number(input.turnStartSeq)) ? Number(input.turnStartSeq) : 0,
  ].join(":");
}

export function createOpenClawTurnState(input: {
  sessionId?: string;
  turnKey: string;
  status?: OpenClawTurnState["status"];
  events?: OpenClawTurnEvent[];
  resolvedMessageId?: string | number;
}): OpenClawTurnState {
  const events = [...(input.events || [])].sort(compareEvents);
  const maxSeq = events.reduce((maxSeq, event) => {
    const seq = readNumber(event.seq);
    return Number.isFinite(seq) ? Math.max(maxSeq, Number(seq)) : maxSeq;
  }, 0);
  return {
    turnKey: input.turnKey,
    sessionId: input.sessionId,
    status: input.status || "streaming",
    maxSeq,
    events,
    resolvedMessageId: input.resolvedMessageId,
  };
}

export function ensureOpenClawTurnState(
  message: OpenClawMutableMessage,
  options?: {
    sessionId?: string;
    turnKey?: string;
  }
) {
  if (message.openclawTurn) return message.openclawTurn;
  const sessionId = options?.sessionId || String(message.conversation_id || "");
  const turnKey =
    options?.turnKey ||
    buildOpenClawTurnKey({
      sessionId,
      clientMessageId: message._openclawClientMessageId,
      messageId: message.id,
      turnStartSeq: message._openclawTurnStartSeq,
    });
  const turn = createOpenClawTurnState({
    sessionId,
    turnKey,
    status: message.loading ? "streaming" : "completed",
  });
  message.openclawTurn = turn;
  return turn;
}

export function rebaseOpenClawTurnStateConversation(
  turn: OpenClawTurnState,
  nextSessionId: string,
  previousSessionId = ""
): OpenClawTurnState {
  if (!turn) return turn;
  const nextEvents = turn.events.map((event) => ({
    ...event,
    sessionId:
      !event.sessionId || event.sessionId === previousSessionId
        ? nextSessionId
        : event.sessionId,
  }));
  return createOpenClawTurnState({
    ...turn,
    turnKey: buildOpenClawTurnKey({
      sessionId: nextSessionId,
      clientMessageId: turn.turnKey,
    }),
    sessionId: nextSessionId,
    events: nextEvents,
    resolvedMessageId: turn.resolvedMessageId,
  });
}

export function appendOpenClawEvents(
  turn: OpenClawTurnState,
  incomingEvents: OpenClawTurnEvent[]
): OpenClawTurnState {
  if (!incomingEvents.length) return turn;

  const nextEvents = [...turn.events];
  for (const incoming of incomingEvents) {
    const normalizedIncoming = {
      ...incoming,
      eventId: incoming.eventId || getEventIdentity(incoming),
    };
    if (
      normalizedIncoming.turnId &&
      normalizedIncoming.segmentId &&
      normalizedIncoming.segmentType === "answer" &&
      (normalizedIncoming.operation === "replace" || normalizedIncoming.visibility === "final" || normalizedIncoming.final)
    ) {
      for (let index = nextEvents.length - 1; index >= 0; index -= 1) {
        const event = nextEvents[index]!;
        if (
          event.turnId === normalizedIncoming.turnId &&
          event.segmentId === normalizedIncoming.segmentId &&
          event.segmentType === "answer"
        ) {
          nextEvents.splice(index, 1);
        }
      }
    }
    const existingByIdentityIndex = nextEvents.findIndex(
      (event) => getEventIdentity(event) === getEventIdentity(normalizedIncoming)
    );
    if (existingByIdentityIndex >= 0) {
      if (getEventAuthority(normalizedIncoming) >= getEventAuthority(nextEvents[existingByIdentityIndex]!)) {
        nextEvents[existingByIdentityIndex] = { ...nextEvents[existingByIdentityIndex]!, ...normalizedIncoming };
      }
      continue;
    }

    const sameSeqIndex = nextEvents.findIndex((event) => canReplaceSameSeqEvent(event, normalizedIncoming));
    if (sameSeqIndex >= 0 && getEventAuthority(normalizedIncoming) >= getEventAuthority(nextEvents[sameSeqIndex]!)) {
      nextEvents[sameSeqIndex] = { ...nextEvents[sameSeqIndex]!, ...normalizedIncoming };
      continue;
    }

    nextEvents.push(normalizedIncoming);
  }

  const status = nextEvents.some((event) => event.kind === "run.failed")
    ? "failed"
    : nextEvents.some((event) => event.kind === "run.interrupted")
      ? "interrupted"
      : nextEvents.some((event) => event.kind === "run.completed")
        ? "completed"
        : turn.status || "streaming";

  return createOpenClawTurnState({
    ...turn,
    events: nextEvents,
    status,
  });
}

function isEphemeralSignal(content: string) {
  const signal = content
    .replace(/[*_`~#>\-\[\]\(\)]/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (!signal) return true;
  if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{P}\p{S}]+$/u.test(signal)) {
    return true;
  }
  const textSignal = signal.replace(/[^\p{L}\p{N}\u3400-\u9fff]+/gu, "");
  return textSignal.length === 0 ? signal.length <= 4 : textSignal.length <= 2;
}

function shouldShowStreamingPendingAnswer(content: string) {
  if (!content.trim()) return false;
  if (isEphemeralSignal(content)) return false;
  const normalized = content.replace(/[*_`~#>\-\[\]\(\)]/g, "").trim();
  if (/[。！？.!?]/.test(normalized)) return true;
  const textSignal = normalized.replace(/[^\p{L}\p{N}\u3400-\u9fff]+/gu, "");
  return textSignal.length >= 8;
}

function looksLikeStreamingTailFragment(content: string) {
  const trimmed = content.trimStart();
  if (!trimmed) return true;

  const withoutLeadingMarkdown = trimmed.replace(/^(?:[*_`~#>\s]+)+/u, "");
  if (!withoutLeadingMarkdown) return true;

  if (/^[°℃％%）】\]\),，。.!！?？:：;；、]/u.test(withoutLeadingMarkdown)) {
    return true;
  }

  if (/^[+\-]?\d+\s*(?:°|℃|°c|°f)/iu.test(withoutLeadingMarkdown) && /(?:\n|^)\s*[-*]\s/u.test(withoutLeadingMarkdown)) {
    return true;
  }

  return false;
}

function isTransientProgressAnswer(content: string) {
  const signal = content
    .replace(/[*_`~#>\-\[\]\(\)]/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
  if (!signal) return true;
  if (/^(?:✅)?收到[！!。.]?/.test(signal) && /系统运行正常|随时为您服务/.test(signal)) {
    return true;
  }
  return /^我来查询.{0,24}天气(?:情况)?[。.!！]?$/.test(signal);
}

function isBodyActivityEvent(event: OpenClawTurnEvent) {
  return (
    event.kind === "assistant.thinking" ||
    event.kind === "tool.call" ||
    event.kind === "tool.result" ||
    event.kind === "process.step"
  );
}

function hasLaterBodyActivity(events: OpenClawTurnEvent[], eventIndex: number) {
  return events.slice(eventIndex + 1).some(isBodyActivityEvent);
}

function normalizeOutputFilesFromPayload(payload: Record<string, unknown>): OutputFile[] {
  const normalizeFiles = (value: unknown): OutputFile[] => {
    if (!Array.isArray(value)) return [];
    return value
      .map((file) => {
        if (!file || typeof file !== "object") return null;
        const record = file as Record<string, unknown>;
        const fileName = record.file_name ?? record.fileName ?? record.filename ?? record.name;
        const mimeType = record.mime_type ?? record.mimeType ?? record.mime;
        const base64 = typeof record.base64 === "string" && record.base64.trim() ? record.base64.trim() : "";
        const content = typeof record.content === "string" ? record.content : undefined;
        const filePath =
          typeof record.file_path === "string"
            ? record.file_path
            : typeof record.path === "string"
              ? record.path
              : "";
        const previewUrl =
          typeof record.preview_url === "string"
            ? record.preview_url
            : typeof record.previewUrl === "string"
              ? record.previewUrl
              : "";
        const downloadUrl =
          typeof record.download_url === "string"
            ? record.download_url
            : typeof record.downloadUrl === "string"
              ? record.downloadUrl
              : "";
        const signedDownloadUrl =
          typeof record.signed_download_url === "string"
            ? record.signed_download_url
            : typeof record.signedDownloadUrl === "string"
              ? record.signedDownloadUrl
              : "";
        const url =
          previewUrl ||
          (typeof record.url === "string"
            ? record.url
            : typeof record.href === "string"
              ? record.href
              : "") ||
          (base64 ? `data:${mimeType || "application/octet-stream"};base64,${base64}` : signedDownloadUrl || downloadUrl || "");
        const id =
          record.id ??
          record.file_id ??
          record.fileId ??
          record.artifact_id ??
          record.artifactId ??
          record.upload_file_id ??
          record.uploadFileId ??
          url ??
          fileName;
        if (id == null && !url && !fileName) return null;
        return {
          ...record,
          id: String(id ?? `${url || ""}|${fileName || ""}`),
          file_name: fileName != null ? String(fileName) : "",
          url: url ? String(url) : "",
          preview_key:
            typeof record.preview_key === "string"
              ? record.preview_key
              : typeof record.previewKey === "string"
                ? record.previewKey
                : undefined,
          preview_url: previewUrl || undefined,
          download_url: downloadUrl || undefined,
          signed_download_url: signedDownloadUrl || undefined,
          artifact_id: record.artifact_id ?? record.artifactId,
          upload_file_id: record.upload_file_id ?? record.uploadFileId,
          mime_type: mimeType != null ? String(mimeType) : undefined,
          size:
            typeof record.size === "number"
              ? record.size
              : Number.isFinite(Number(record.size))
                ? Number(record.size)
                : undefined,
          message_id: record.message_id ?? record.messageId,
          source_kind: record.source_kind ?? record.sourceKind,
          base64: base64 || undefined,
          content,
          file_path: filePath || undefined,
        } as OutputFile;
      })
      .filter((file): file is OutputFile => Boolean(file));
  };

  const collectFilesFromRecord = (record: Record<string, unknown>): OutputFile[] => {
    const candidates: unknown[] = [];
    if (Array.isArray(record.files)) candidates.push(record.files);
    if (Array.isArray(record.media_attachments)) candidates.push(record.media_attachments);
    const processStep = record.process_step;
    if (processStep && typeof processStep === "object") {
      const stepData = (processStep as Record<string, unknown>).data;
      if (stepData && typeof stepData === "object") {
        const dataRecord = stepData as Record<string, unknown>;
        if (Array.isArray(dataRecord.files)) candidates.push(dataRecord.files);
        if (Array.isArray(dataRecord.media_attachments)) candidates.push(dataRecord.media_attachments);
      }
    }
    return candidates.flatMap(normalizeFiles);
  };

  const files = collectFilesFromRecord(payload);
  const nestedPayload = payload.payload;
  if (nestedPayload && typeof nestedPayload === "object" && !Array.isArray(nestedPayload)) {
    const nestedFiles = collectFilesFromRecord(nestedPayload as Record<string, unknown>);
    if (nestedFiles.length) {
      return mergeOutputFiles(files, nestedFiles, { logicalIdentity: true });
    }
  }
  return files;
}

function buildOutputFilesEventItem(
  event: OpenClawTurnEvent,
  files: OutputFile[],
  fallbackSeq: number
): OpenClawTimelineItem | null {
  return buildOpenClawOutputFilesTimelineItem({
    key: event.eventId || `${event.sessionId || "openclaw"}:output_files:${event.seq || fallbackSeq}`,
    sessionId: event.sessionId,
    seq: readNumber(event.seq) ?? fallbackSeq,
    createdAt: event.createdAt,
    files,
  });
}

function createAnswerItem(
  turn: OpenClawTurnState,
  segmentIndex: number,
  content: string,
  seq: number | undefined,
  createdAt?: string,
  authoritative = false
) {
  const hasConcreteSeq = Number.isFinite(readNumber(seq));
  const key = authoritative && hasConcreteSeq
    ? `${turn.sessionId || "openclaw"}:answer:${Number(seq)}`
    : `openclaw:answer:live:${segmentIndex}`;
  return buildOpenClawAnswerTimelineItem({
    key,
    sessionId: turn.sessionId,
    seq,
    createdAt,
    content,
    identityKey: authoritative && hasConcreteSeq ? String(Number(seq)) : key,
  });
}

function resolveActiveProtocolTurnId(events: OpenClawTurnEvent[]): string {
  let fallbackTurnId = "";
  let bodyTurnId = "";

  for (const event of events) {
    if (!event.turnId) continue;
    fallbackTurnId = event.turnId;
    if (
      event.segmentType === "answer" ||
      isAnswerEventKind(event.kind) ||
      event.segmentType === "run" ||
      event.kind === "run.completed" ||
      event.kind === "run.failed" ||
      event.kind === "run.interrupted"
    ) {
      bodyTurnId = event.turnId;
    }
  }

  return bodyTurnId || fallbackTurnId;
}

function getTurnStartSeq(turn: OpenClawTurnState): number {
  const parts = String(turn.turnKey || "").split(":");
  const last = Number(parts[parts.length - 1]);
  return Number.isFinite(last) ? last : 0;
}

function isSameTurnProtocolFallbackStreamSupportEvent(
  event: OpenClawTurnEvent,
  turnStartSeq: number
): boolean {
  if (event.source !== "stream") return false;
  if (isAnswerEventKind(event.kind) || event.segmentType === "answer") return false;
  if (
    !isActivityEventKind(event.kind) &&
    event.segmentType !== "output_files" &&
    event.kind !== "process.step"
  ) {
    return false;
  }
  const seq = readNumber(event.seq);
  return Number.isFinite(seq) && Number.isFinite(turnStartSeq) && turnStartSeq > 0 && Number(seq) > turnStartSeq;
}

type OpenClawTurnProjectionOptions = {
  isStreaming?: boolean;
  allowLegacyProtocol?: boolean;
  canonicalOnly?: boolean;
};

function createEmptyOpenClawProjection(
  turn: OpenClawTurnState,
  options?: OpenClawTurnProjectionOptions
): OpenClawTurnProjection {
  return {
    timelineItems: [],
    visibleAnswer: "",
    outputFiles: [],
    activities: [],
    interrupted: turn.status === "interrupted",
    failed: turn.status === "failed",
    isStreaming: options?.isStreaming ?? turn.status === "streaming",
  };
}

function projectProtocolOpenClawTurn(
  turn: OpenClawTurnState,
  options?: OpenClawTurnProjectionOptions
): OpenClawTurnProjection {
  const answerSegments = new Map<
    string,
    {
      content: string;
      visible: boolean;
      seq?: number;
      createdAt?: string;
      segmentIndex: number;
      key: string;
    }
  >();
  const rawActivities: OpenClawActivityItem[] = [];
  let outputFiles: OutputFile[] = [];
  let reasoningSoFar = "";
  let interrupted = false;
  let failed = false;

  const allSortedEvents = [...turn.events].sort(compareEvents);
  const activeTurnId = resolveActiveProtocolTurnId(allSortedEvents);
  const protocolTurnIds = new Set(allSortedEvents.map((event) => event.turnId).filter(Boolean));
  const hasMultipleProtocolTurnIds = protocolTurnIds.size > 1;
  const turnStartSeq = getTurnStartSeq(turn);
  const sortedEvents = activeTurnId
    ? allSortedEvents.filter((event) => {
        if (event.turnId) return event.turnId === activeTurnId;
        return (
          !hasMultipleProtocolTurnIds &&
          (event.source !== "stream" || isSameTurnProtocolFallbackStreamSupportEvent(event, turnStartSeq))
        );
      })
    : allSortedEvents;
  const primaryAnswerEvent = sortedEvents.find(
    (event) => (event.segmentType === "answer" || isAnswerEventKind(event.kind)) && Boolean(event.segmentId)
  );
  const primaryAnswerSegmentId = primaryAnswerEvent?.segmentId;
  const primaryAnswerTurnId = primaryAnswerEvent?.turnId;

  for (let eventIndex = 0; eventIndex < sortedEvents.length; eventIndex += 1) {
    const event = sortedEvents[eventIndex]!;
    const segmentType = event.segmentType;
    const timelineSeq = readNumber(event.seq) ?? readNumber(event.segmentIndex);

    if (segmentType === "output_files" || event.kind === "process.step") {
      const files = normalizeOutputFilesFromPayload(event.payload || {});
      if (files.length) {
        outputFiles = mergeOutputFiles(outputFiles, files, { logicalIdentity: true });
      }
      continue;
    }

    if (segmentType === "answer" || isAnswerEventKind(event.kind)) {
      const segmentId = event.segmentId || primaryAnswerSegmentId || `${event.turnId || primaryAnswerTurnId || turn.turnKey}:answer:0`;
      const answerTurnId = event.turnId || primaryAnswerTurnId || turn.turnKey;
      const current = answerSegments.get(segmentId) || {
        content: "",
        visible: false,
        seq: timelineSeq,
        createdAt: event.createdAt,
        segmentIndex: readNumber(event.segmentIndex) ?? answerSegments.size,
        key: `${answerTurnId}:answer:${segmentId}`,
      };
      const sanitized = sanitizeOpenClawAnswer(getEventContent(event), reasoningSoFar);
      if (isTransientProgressAnswer(sanitized) && hasLaterBodyActivity(sortedEvents, eventIndex)) {
        continue;
      }
      if (event.operation === "replace" || event.replace || event.kind === "assistant.message") {
        current.content = sanitized;
      } else if (event.operation === "append") {
        current.content = `${current.content}${sanitized}`;
      } else if (!current.content) {
        current.content = sanitized;
      }
      current.seq = timelineSeq ?? current.seq;
      current.createdAt = event.createdAt || current.createdAt;
      const eventHasProtocol = hasTimelineProtocol(event);
      current.visible =
        current.visible ||
        event.visibility === "stream" ||
        event.visibility === "final" ||
        event.final === true ||
        (!eventHasProtocol && event.kind === "assistant.message");
      answerSegments.set(segmentId, current);
      continue;
    }

    if (event.kind === "assistant.thinking") {
      const reasoning = normalizeWhitespace(getEventContent(event));
      if (reasoning && !isOpenClawToolPlaceholderThinkingText(reasoning)) {
        reasoningSoFar = [reasoningSoFar, reasoning].filter(Boolean).join("\n\n");
      }
    }

    if (event.kind === "run.interrupted") {
      interrupted = true;
    }
    if (event.kind === "run.failed") {
      failed = true;
    }
    if (event.kind === "run.completed") {
      continue;
    }

    const activity = buildOpenClawActivity({
      id: event.segmentId || event.eventId,
      sessionId: event.sessionId,
      seq: timelineSeq,
      kind: event.kind,
      payload: event.payload,
      createdAt: event.createdAt,
    });
    if (activity) rawActivities.push(activity);
  }

  const answerTimelineItems = [...answerSegments.values()]
    .filter((segment) => segment.visible && segment.content.trim())
    .map((segment) =>
      buildOpenClawAnswerTimelineItem({
        key: segment.key,
        sessionId: turn.sessionId,
        seq: segment.seq,
        createdAt: segment.createdAt,
        content: segment.content.trim(),
        replace: true,
        identityKey: segment.key,
      })
    );
  const activities = mergeOpenClawActivities([], rawActivities);
  const activityTimelineItems = activities
    .map((activity) => buildOpenClawTimelineItemFromActivity(activity))
    .filter((item) => item.kind !== "run.completed");
  const bodyTimeline = mergeOpenClawTimelineItems(activityTimelineItems, answerTimelineItems);
  const visibleAnswer = bodyTimeline
    .filter((item) => item.type === "answer")
    .map((item) => item.content || "")
    .join("");

  return {
    timelineItems: bodyTimeline,
    visibleAnswer,
    outputFiles,
    activities,
    interrupted,
    failed,
    isStreaming: options?.isStreaming ?? turn.status === "streaming",
  };
}

export function projectOpenClawTurn(
  turn: OpenClawTurnState,
  options?: OpenClawTurnProjectionOptions
): OpenClawTurnProjection {
  if (turn.events.some(hasOpenClawLedgerProtocol)) {
    return projectOpenClawLedgerTurn(turn, options);
  }

  const allowLegacyProtocol = options?.allowLegacyProtocol ?? !options?.canonicalOnly;
  if (!allowLegacyProtocol) {
    return createEmptyOpenClawProjection(turn, options);
  }

  if (turn.events.some(hasTimelineProtocol)) {
    return projectProtocolOpenClawTurn(turn, options);
  }

  const answerTimelineItems: OpenClawTimelineItem[] = [];
  const rawActivities: OpenClawActivityItem[] = [];
  let outputFiles: OutputFile[] = [];
  let reasoningSoFar = "";
  let interrupted = false;
  let failed = false;
  let answerSegmentIndex = 0;
  let pendingAnswer: PendingOpenClawAnswer | null = null;

  const pushRawActivity = (event: OpenClawTurnEvent) => {
    const activity = buildOpenClawActivity({
      id: event.eventId,
      sessionId: event.sessionId,
      seq: event.seq,
      kind: event.kind,
      payload: event.payload,
      createdAt: event.createdAt,
    });
    if (activity) rawActivities.push(activity);
  };

  const flushPendingAnswer = (mode: "boundary" | "end", boundarySeq?: number) => {
    if (!pendingAnswer) return;
    const normalizedContent = pendingAnswer.content.trim();
    if (!normalizedContent) {
      pendingAnswer = null;
      return;
    }

    const dropTransientAtBoundary = mode === "boundary" && isTransientProgressAnswer(normalizedContent);
    const shouldKeep = !dropTransientAtBoundary && (
      pendingAnswer.authoritative ||
      (
        mode === "boundary"
          ? shouldShowStreamingPendingAnswer(normalizedContent) &&
            !looksLikeStreamingTailFragment(normalizedContent)
          : !isEphemeralSignal(normalizedContent) && !looksLikeStreamingTailFragment(normalizedContent)
      )
    );
    if (!shouldKeep) {
      pendingAnswer = null;
      return;
    }
    const effectiveSeq = mode === "boundary" && Number.isFinite(readNumber(boundarySeq))
      ? Math.max(readNumber(pendingAnswer.seq) ?? 0, Number(boundarySeq) + 1)
      : pendingAnswer.seq;
    const nextAnswerItem = createAnswerItem(
      turn,
      answerSegmentIndex,
      normalizedContent,
      effectiveSeq,
      pendingAnswer.createdAt,
      pendingAnswer.authoritative
    );
    const previousAnswerItem = answerTimelineItems[answerTimelineItems.length - 1];
    if (
      pendingAnswer.authoritative &&
      previousAnswerItem?.type === "answer" &&
      typeof previousAnswerItem.content === "string" &&
      normalizedContent.startsWith(previousAnswerItem.content.trim()) &&
      normalizedContent.trim() !== previousAnswerItem.content.trim()
    ) {
      answerTimelineItems[answerTimelineItems.length - 1] = nextAnswerItem;
      pendingAnswer = null;
      return;
    }

    answerTimelineItems.push(nextAnswerItem);
    answerSegmentIndex += 1;
    pendingAnswer = null;
  };

  const sortedEvents = [...turn.events].sort(compareEvents);
  for (const event of sortedEvents) {
    if (event.kind === "assistant.thinking") {
      flushPendingAnswer("boundary", readNumber(event.seq));
      const reasoning = normalizeWhitespace(getEventContent(event));
      if (reasoning && !isOpenClawToolPlaceholderThinkingText(reasoning)) {
        reasoningSoFar = [reasoningSoFar, reasoning].filter(Boolean).join("\n\n");
      }
      pushRawActivity(event);
      continue;
    }

    if (event.kind === "tool.call" || event.kind === "tool.result") {
      flushPendingAnswer("boundary", readNumber(event.seq));
      pushRawActivity(event);
      continue;
    }

    if (event.kind === "run.interrupted") {
      flushPendingAnswer("boundary", readNumber(event.seq));
      interrupted = true;
      pushRawActivity(event);
      continue;
    }

    if (event.kind === "run.failed") {
      flushPendingAnswer("boundary", readNumber(event.seq));
      failed = true;
      pushRawActivity(event);
      continue;
    }

    if (event.kind === "run.completed") {
      flushPendingAnswer("end");
      pushRawActivity(event);
      continue;
    }

    if (event.kind === "process.step") {
      const files = normalizeOutputFilesFromPayload(event.payload || {});
      if (files.length) {
        outputFiles = mergeOutputFiles(outputFiles, files, { logicalIdentity: true });
      }
      continue;
    }

    if (isAnswerEventKind(event.kind)) {
      const sanitized = sanitizeOpenClawAnswer(getEventContent(event), reasoningSoFar);
      if (!sanitized.trim()) continue;

      const previousPendingAnswer = (pendingAnswer ?? null) as PendingOpenClawAnswer | null;
      const previousContent = previousPendingAnswer?.content || "";
      const previousSeq = previousPendingAnswer?.seq;
      const previousCreatedAt = previousPendingAnswer?.createdAt;
      const previousAuthoritative = previousPendingAnswer?.authoritative || false;
      const nextContent: string = event.kind === "assistant.message"
        ? sanitized
        : event.replace
          ? sanitized
          : previousContent
            ? `${previousContent}${sanitized}`
            : sanitized;

      pendingAnswer = {
        content: nextContent,
        seq:
          event.kind === "assistant.message"
            ? readNumber(event.seq) ?? previousSeq
            : readNumber(event.seq) ?? previousSeq,
        createdAt: event.createdAt || previousCreatedAt,
        authoritative: event.kind === "assistant.message" || event.replace || previousAuthoritative,
      };
      continue;
    }
  }

  flushPendingAnswer("end");

  const activities = mergeOpenClawActivities([], rawActivities);
  const activityTimelineItems = activities
    .map((activity) => buildOpenClawTimelineItemFromActivity(activity))
    .filter((item) => item.kind !== "run.completed");
  const bodyTimeline = mergeOpenClawTimelineItems(activityTimelineItems, answerTimelineItems);
  const visibleAnswer = bodyTimeline
    .filter((item) => item.type === "answer")
    .map((item) => item.content || "")
    .join("");

  return {
    timelineItems: bodyTimeline,
    visibleAnswer,
    outputFiles,
    activities,
    interrupted,
    failed,
    isStreaming: options?.isStreaming ?? turn.status === "streaming",
  };
}

export function syncOpenClawProjectionToMessage(
  message: OpenClawMutableMessage,
  projection: OpenClawTurnProjection
) {
  message.openclawProjection = projection;
  const hasAnswerEvents = Boolean(
    message.openclawTurn?.events?.some((event) => isAnswerEventKind(event.kind))
  );
  if (projection.visibleAnswer) {
    message.answer = projection.visibleAnswer;
  } else if (hasAnswerEvents) {
    message.answer = "";
  } else {
    message.answer = message.answer || "";
  }
  message.openclawActivities = projection.activities;
  message.outputFiles = projection.outputFiles;

  let compatTimelineItems = [...projection.timelineItems];
  if (projection.outputFiles.length) {
    const maxSeq = compatTimelineItems.reduce((currentMax, item) => {
      const seq = readNumber(item.seq);
      return Number.isFinite(seq) ? Math.max(currentMax, Number(seq)) : currentMax;
    }, 0);
    const outputSeq = message.openclawTurn?.events
      ?.filter((event) => event.kind === "process.step")
      .map((event) => readNumber(event.seq))
      .filter((seq): seq is number => Number.isFinite(seq))
      .reduce((currentMax, seq) => Math.max(currentMax, seq), 0);
    const outputItem = buildOutputFilesEventItem(
      {
        eventId: `${String(message.conversation_id || "openclaw")}:projection:output_files`,
        sessionId: String(message.conversation_id || ""),
        seq: outputSeq || maxSeq + 1,
        kind: "process.step",
        payload: { files: projection.outputFiles },
      },
      projection.outputFiles,
      outputSeq || maxSeq + 1
    );
    if (outputItem) {
      compatTimelineItems = mergeOpenClawTimelineItems(compatTimelineItems, [outputItem]);
    }
  }
  message.openclawTimelineItems = compatTimelineItems;
  const projectedReasoning = projection.activities
    .filter((activity) => activity.kind === "assistant.thinking")
    .map((activity) => activity.summary || activity.detail || "")
    .filter(Boolean)
    .join("\n\n");
  const usesProtocolProjection = Boolean(message.openclawTurn?.events?.some(hasTimelineProtocol));
  message.reasoning_content = usesProtocolProjection
    ? projectedReasoning || message.reasoning_content || ""
    : projectedReasoning || message.reasoning_content || "";
  if (projection.interrupted) {
    message.interrupted = true;
    message.loading = false;
    message.error = false;
  }
  if (projection.failed) {
    message.error = true;
    message.loading = false;
  }
  if (!projection.isStreaming && !projection.interrupted && !projection.failed) {
    message.loading = false;
    message.error = false;
  }
}
