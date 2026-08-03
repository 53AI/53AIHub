import type {
  OpenClawActivityItem,
  OpenClawTurnEvent,
  OpenClawTurnProjection,
  OpenClawTurnState,
  OutputFile,
} from "../types/message";
import { buildOpenClawActivity, mergeOpenClawActivities } from "./openclaw-activities";
import { decodeOutputFile } from "./openclaw-transport";
import {
  buildOpenClawAnswerTimelineItem,
  buildOpenClawOutputFilesTimelineItem,
  buildOpenClawTimelineItemFromActivity,
  mergeOpenClawTimelineItems,
  mergeOutputFiles,
} from "./openclaw-timeline";

export type OpenClawLedgerPartType = "answer" | "thinking" | "tool" | "output_file" | "status";
export type OpenClawLedgerEventType =
  | "turn.started"
  | "part.delta"
  | "part.replace"
  | "part.done"
  | "turn.completed"
  | "turn.interrupted"
  | "turn.failed";
export type OpenClawLedgerOperation = "append" | "replace" | "close" | "noop";
export type OpenClawLedgerVisibility = "stream" | "final" | "hidden";
export type OpenClawLedgerTerminalStatus = "running" | "completed" | "interrupted" | "failed" | "cancelled";

export interface OpenClawLedgerEvent {
  protocol_version: "openclaw.ledger.v1";
  seq: number;
  session_id: string;
  conversation_id: string;
  turn_id: string;
  run_id?: string;
  active_request_id: string;
  part_id: string;
  part_type: OpenClawLedgerPartType;
  event_type: OpenClawLedgerEventType;
  operation: OpenClawLedgerOperation;
  visibility: OpenClawLedgerVisibility;
  text?: string;
  payload?: Record<string, unknown>;
  terminal_status?: OpenClawLedgerTerminalStatus;
  created_at: string;
  raw_event_ref?: string;
}

interface LedgerPartState {
  partId: string;
  semanticPartId: string;
  partType: OpenClawLedgerPartType;
  turnId?: string;
  runId?: string;
  activeRequestId?: string;
  content: string;
  visible: boolean;
  final: boolean;
  seq: number;
  orderSeq?: number;
  createdAt?: string;
  payload?: Record<string, unknown>;
  sourceKind?: string;
}

export interface OpenClawLedgerReducerState {
  turnId?: string;
  runId?: string;
  activeRequestId?: string;
  status: OpenClawLedgerTerminalStatus;
  terminalSeq?: number;
  lastSeq: number;
  parts: LedgerPartState[];
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readLedgerFromPayload(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  const direct = readRecord(payload?.openclaw_ledger);
  if (Object.keys(direct).length > 0) return direct;
  const processStep = readRecord(payload?.process_step);
  const processData = readRecord(processStep.data);
  return readRecord(processData.openclaw_ledger);
}

function isPartType(value: string): value is OpenClawLedgerPartType {
  return value === "answer" || value === "thinking" || value === "tool" || value === "output_file" || value === "status";
}

function isEventType(value: string): value is OpenClawLedgerEventType {
  return (
    value === "turn.started" ||
    value === "part.delta" ||
    value === "part.replace" ||
    value === "part.done" ||
    value === "turn.completed" ||
    value === "turn.interrupted" ||
    value === "turn.failed"
  );
}

function isOperation(value: string): value is OpenClawLedgerOperation {
  return value === "append" || value === "replace" || value === "close" || value === "noop";
}

function isVisibility(value: string): value is OpenClawLedgerVisibility {
  return value === "stream" || value === "final" || value === "hidden";
}

function isTerminalStatus(value: string): value is OpenClawLedgerTerminalStatus {
  return value === "running" || value === "completed" || value === "interrupted" || value === "failed" || value === "cancelled";
}

export function normalizeOpenClawLedgerEvent(value: unknown): OpenClawLedgerEvent | null {
  const record = readRecord(value);
  if (record.protocol_version !== "openclaw.ledger.v1") return null;

  const seq = readNumber(record.seq);
  const sessionId = readString(record.session_id);
  const conversationId = readString(record.conversation_id) || sessionId;
  const turnId = readString(record.turn_id);
  const activeRequestId = readString(record.active_request_id);
  const partId = readString(record.part_id);
  const partType = readString(record.part_type);
  const eventType = readString(record.event_type);
  const operation = readString(record.operation);
  const visibility = readString(record.visibility);
  const createdAt = readString(record.created_at);
  if (
    seq == null ||
    !sessionId ||
    !conversationId ||
    !turnId ||
    !activeRequestId ||
    !partId ||
    !partType ||
    !isPartType(partType) ||
    !eventType ||
    !isEventType(eventType) ||
    !operation ||
    !isOperation(operation) ||
    !visibility ||
    !isVisibility(visibility) ||
    !createdAt
  ) {
    return null;
  }

  const terminalStatus = readString(record.terminal_status);
  return {
    protocol_version: "openclaw.ledger.v1",
    seq,
    session_id: sessionId,
    conversation_id: conversationId,
    turn_id: turnId,
    ...(readString(record.run_id) ? { run_id: readString(record.run_id) } : {}),
    active_request_id: activeRequestId,
    part_id: partId,
    part_type: partType,
    event_type: eventType,
    operation,
    visibility,
    ...(typeof record.text === "string" ? { text: record.text } : {}),
    payload: readRecord(record.payload),
    ...(terminalStatus && isTerminalStatus(terminalStatus) ? { terminal_status: terminalStatus } : {}),
    created_at: createdAt,
    ...(readString(record.raw_event_ref) ? { raw_event_ref: readString(record.raw_event_ref) } : {}),
  };
}

export function getOpenClawLedgerEventFromTurnEvent(event: OpenClawTurnEvent): OpenClawLedgerEvent | null {
  return normalizeOpenClawLedgerEvent(readLedgerFromPayload(event.payload));
}

export function hasOpenClawLedgerProtocol(event: OpenClawTurnEvent): boolean {
  return Boolean(getOpenClawLedgerEventFromTurnEvent(event));
}

export function getOpenClawLedgerEventsFromPayload(payload: any): OpenClawLedgerEvent[] {
  const candidateGroups = [
    payload?.ledger_events,
    payload?.ledgerEvents,
    payload?.recent_events,
    payload?.recentEvents,
    payload?.data?.ledger_events,
    payload?.data?.ledgerEvents,
    payload?.data?.recent_events,
    payload?.data?.recentEvents,
  ].filter(Array.isArray) as unknown[][];
  if (!candidateGroups.length) return [];

  const byKey = new Map<string, OpenClawLedgerEvent>();
  for (const candidate of candidateGroups.flat()) {
    const event = normalizeOpenClawLedgerEvent(candidate);
    if (!event) continue;
    byKey.set(
      event.raw_event_ref || `${event.session_id}:${event.seq}:${event.turn_id}:${event.part_id}:${event.event_type}`,
      event
    );
  }
  return [...byKey.values()].sort((left, right) => {
    if (left.seq !== right.seq) return left.seq - right.seq;
    return left.part_id.localeCompare(right.part_id);
  });
}

function getTimelineKindFromLedgerEvent(event: OpenClawLedgerEvent): string {
  const payloadKind = readString(event.payload?.source_kind);
  if (payloadKind) return payloadKind;
  if (event.event_type === "turn.started") return "run.started";
  if (event.event_type === "turn.completed") return "run.completed";
  if (event.event_type === "turn.interrupted") return "run.interrupted";
  if (event.event_type === "turn.failed") return "run.failed";
  if (event.part_type === "answer") return event.visibility === "stream" ? "assistant.delta" : "assistant.message";
  if (event.part_type === "thinking") return "assistant.thinking";
  if (event.part_type === "tool") return "tool.result";
  return "process.step";
}

export function getOpenClawTimelineEventsFromLedgerPayload(payload: any): any[] {
  return getOpenClawLedgerEventsFromPayload(payload).map((event) => ({
    id: event.raw_event_ref || `${event.session_id}:${event.seq}:${event.part_id}`,
    sessionId: event.session_id,
    seq: event.seq,
    kind: getTimelineKindFromLedgerEvent(event),
    createdAt: event.created_at,
    payload: {
      ...(event.payload || {}),
      ...(event.text != null ? { content: event.text } : {}),
      openclaw_ledger: event,
    },
  }));
}

function sortLedgerEvents(events: OpenClawLedgerEvent[]) {
  return [...events].sort((left, right) => {
    if (left.seq !== right.seq) return left.seq - right.seq;
    return left.part_id.localeCompare(right.part_id);
  });
}

function getEventText(event: OpenClawLedgerEvent) {
  if (typeof event.text === "string") return event.text;
  const payloadContent = event.payload?.content;
  return typeof payloadContent === "string" ? payloadContent : "";
}

function getLedgerEventOrderSeq(event: OpenClawLedgerEvent) {
  return (
    readNumber(event.payload?.rawSeq) ??
    readNumber(event.payload?.raw_seq) ??
    readNumber(event.payload?.messageSeq) ??
    readNumber(event.payload?.message_seq) ??
    event.seq
  );
}

function extractHistoryIdentity(value?: string) {
  if (!value) return "";
  const match = value.match(/(?:^|:)history:([^:]+)/);
  return match?.[1] || "";
}

function getLedgerEventRunIdentity(event: OpenClawLedgerEvent) {
  return event.run_id || extractHistoryIdentity(event.turn_id) || extractHistoryIdentity(event.part_id);
}

function getLedgerStateRunIdentity(state: OpenClawLedgerReducerState) {
  if (state.runId) return state.runId;
  const turnIdentity = extractHistoryIdentity(state.turnId);
  if (turnIdentity) return turnIdentity;
  for (const part of state.parts) {
    const partIdentity = part.runId || extractHistoryIdentity(part.turnId) || extractHistoryIdentity(part.partId);
    if (partIdentity) return partIdentity;
  }
  return "";
}

function isSameLedgerTurnScope(state: OpenClawLedgerReducerState, event: OpenClawLedgerEvent) {
  return Boolean(
    (state.turnId && event.turn_id && state.turnId === event.turn_id) ||
      (state.activeRequestId && event.active_request_id && state.activeRequestId === event.active_request_id)
  );
}

function isSameLedgerRun(state: OpenClawLedgerReducerState, event: OpenClawLedgerEvent) {
  if (isSameLedgerTurnScope(state, event)) return true;
  const stateRunIdentity = getLedgerStateRunIdentity(state);
  const eventRunIdentity = getLedgerEventRunIdentity(event);
  return Boolean(stateRunIdentity && eventRunIdentity && stateRunIdentity === eventRunIdentity);
}

function canApplyPostTerminalLedgerEvent(state: OpenClawLedgerReducerState, event: OpenClawLedgerEvent) {
  if (state.terminalSeq == null || event.seq <= state.terminalSeq) return true;
  if (!isSameLedgerRun(state, event)) return false;
  if (event.event_type.startsWith("turn.")) return false;
  if (event.visibility !== "final" && event.operation !== "replace") return false;
  return (
    event.part_type === "answer" ||
    event.part_type === "thinking" ||
    event.part_type === "tool" ||
    event.part_type === "output_file"
  );
}

function getLedgerPartSemanticIndex(partId: string, partType: OpenClawLedgerPartType) {
  const marker = `:${partType}:`;
  const markerIndex = partId.lastIndexOf(marker);
  if (markerIndex < 0) return "0";
  const suffix = partId.slice(markerIndex + marker.length);
  const index = suffix.split(":")[0]?.trim();
  return index || "0";
}

function getLedgerEventPartIdentity(event: OpenClawLedgerEvent) {
  if (event.part_type === "answer") {
    const runIdentity = getLedgerEventRunIdentity(event);
    if (runIdentity) {
      return `run:${runIdentity}:answer:${getLedgerPartSemanticIndex(event.part_id, event.part_type)}`;
    }
  }
  return event.part_id;
}

function toTurnStatus(status: OpenClawLedgerTerminalStatus): OpenClawTurnState["status"] {
  if (status === "failed") return "failed";
  if (status === "interrupted" || status === "cancelled") return "interrupted";
  if (status === "completed") return "completed";
  return "streaming";
}

function upsertPart(parts: LedgerPartState[], event: OpenClawLedgerEvent): LedgerPartState[] {
  if (event.event_type.startsWith("turn.")) return parts;
  const semanticPartId = getLedgerEventPartIdentity(event);
  const index = parts.findIndex((part) => part.semanticPartId === semanticPartId || part.partId === event.part_id);
  const existing = index >= 0 ? parts[index]! : {
    partId: event.part_id,
    semanticPartId,
    partType: event.part_type,
    turnId: event.turn_id,
    runId: event.run_id,
    activeRequestId: event.active_request_id,
    content: "",
    visible: false,
    final: false,
    seq: event.seq,
    orderSeq: getLedgerEventOrderSeq(event),
  };
  const text = getEventText(event);
  const nextContent =
    existing.final && event.operation === "append" && event.visibility === "stream"
      ? existing.content
      :
    event.operation === "append"
      ? `${existing.content}${text}`
      : event.operation === "replace"
        ? text
        : existing.content || text;
  const next: LedgerPartState = {
    ...existing,
    partId: event.part_id,
    semanticPartId,
    partType: event.part_type,
    turnId: event.turn_id || existing.turnId,
    runId: event.run_id || existing.runId,
    activeRequestId: event.active_request_id || existing.activeRequestId,
    content: nextContent,
    visible: existing.visible || event.visibility === "stream" || event.visibility === "final",
    final: existing.final || event.visibility === "final" || event.event_type === "part.done",
    seq: event.seq,
    orderSeq: existing.orderSeq ?? getLedgerEventOrderSeq(event),
    createdAt: event.created_at || existing.createdAt,
    payload: event.payload || existing.payload,
    sourceKind: readString(event.payload?.source_kind) || existing.sourceKind,
  };
  if (index < 0) return [...parts, next];
  const copy = [...parts];
  copy[index] = next;
  return copy;
}

export function openclawLedgerReducer(
  state: OpenClawLedgerReducerState,
  event: OpenClawLedgerEvent
): OpenClawLedgerReducerState {
  if (!canApplyPostTerminalLedgerEvent(state, event)) {
    return state;
  }

  const status = event.terminal_status || state.status;
  return {
    turnId: event.turn_id || state.turnId,
    runId: event.run_id || state.runId,
    activeRequestId: event.active_request_id || state.activeRequestId,
    status,
    terminalSeq: event.terminal_status && event.terminal_status !== "running" ? event.seq : state.terminalSeq,
    lastSeq: Math.max(state.lastSeq, event.seq),
    parts: upsertPart(state.parts, event),
  };
}

export function reduceOpenClawLedgerEvents(events: OpenClawLedgerEvent[]): OpenClawLedgerReducerState {
  return sortLedgerEvents(events).reduce<OpenClawLedgerReducerState>(
    (state, event) => openclawLedgerReducer(state, event),
    {
      status: "running",
      lastSeq: 0,
      parts: [],
    }
  );
}

function extractOutputFiles(payload: Record<string, unknown> | undefined): OutputFile[] {
  const record = readRecord(payload);
  const nestedPayload = readRecord(record.payload);
  const processStep = readRecord(record.process_step);
  const nestedProcessStep = readRecord(nestedPayload.process_step);
  const processData = readRecord(processStep.data);
  const nestedProcessData = readRecord(nestedProcessStep.data);
  const directFiles = Array.isArray(record.files) ? record.files : [];
  const nestedDirectFiles = Array.isArray(nestedPayload.files) ? nestedPayload.files : [];
  const processFiles = Array.isArray(processData.files) ? processData.files : [];
  const nestedProcessFiles = Array.isArray(nestedProcessData.files) ? nestedProcessData.files : [];
  const mediaAttachments = Array.isArray(processData.media_attachments) ? processData.media_attachments : [];
  const nestedMediaAttachments = Array.isArray(nestedProcessData.media_attachments) ? nestedProcessData.media_attachments : [];
  return [...directFiles, ...processFiles, ...mediaAttachments]
    .concat(nestedDirectFiles, nestedProcessFiles, nestedMediaAttachments)
    .map(normalizeLedgerOutputFile)
    .filter((file): file is OutputFile => Boolean(file));
}

function normalizeLedgerOutputFile(value: unknown): OutputFile | null {
  const file = readRecord(value);
  if (!Object.keys(file).length) return null;

  const fileName = readString(file.file_name) || readString(file.fileName) || readString(file.filename) || readString(file.name) || "";
  const mimeType = readString(file.mime_type) || readString(file.mimeType) || readString(file.mime);
  const base64 = readString(file.base64);
  const content = typeof file.content === "string" ? file.content : undefined;
  const filePath = readString(file.file_path) || readString(file.path);
  const previewKey = readString(file.preview_key) || readString(file.previewKey);
  const previewUrl = readString(file.preview_url) || readString(file.previewUrl);
  const downloadUrl = readString(file.download_url) || readString(file.downloadUrl);
  const signedDownloadUrl = readString(file.signed_download_url) || readString(file.signedDownloadUrl);
  const rawUrl = readString(file.url) || readString(file.href);
  const url = previewUrl || rawUrl || (base64 ? `data:${mimeType || "application/octet-stream"};base64,${base64}` : "") || signedDownloadUrl || downloadUrl;
  const decoded = decodeOutputFile(value);
  const id = decoded?.id ?? url ?? fileName;
  if (id == null && !url && !fileName) return null;

  return {
    id: String(id ?? `${url}|${fileName}`),
    file_name: fileName,
    url,
    preview_key: previewKey,
    preview_url: previewUrl,
    download_url: downloadUrl,
    signed_download_url: signedDownloadUrl,
    artifact_id: (file.artifact_id ?? file.artifactId) as string | number | undefined,
    upload_file_id: (file.upload_file_id ?? file.uploadFileId) as string | number | undefined,
    mime_type: mimeType,
    size: readNumber(file.size),
    kind: readString(file.kind),
    message_id: (file.message_id ?? file.messageId) as string | number | undefined,
    source_kind: readString(file.source_kind) || readString(file.sourceKind),
    base64,
    content,
    file_path: filePath,
  };
}

function buildActivityFromLedgerPart(part: LedgerPartState): OpenClawActivityItem | null {
  const kind =
    part.sourceKind ||
    (part.partType === "thinking"
      ? "assistant.thinking"
      : part.partType === "tool"
        ? "tool.result"
        : part.partType === "status"
          ? "run.started"
          : "");
  if (!kind) return null;
  return buildOpenClawActivity({
    id: part.partId,
    sessionId: undefined,
    seq: part.orderSeq ?? part.seq,
    kind,
    payload: {
      ...(part.payload || {}),
      content: part.content || part.payload?.content,
    },
    createdAt: part.createdAt,
  });
}

function isLedgerSupportTurnEvent(event: OpenClawTurnEvent): boolean {
  return event.kind === "assistant.thinking" || event.kind === "tool.call" || event.kind === "tool.result";
}

function buildActivityFromSupportTurnEvent(event: OpenClawTurnEvent): OpenClawActivityItem | null {
  if (!isLedgerSupportTurnEvent(event)) return null;
  if (getOpenClawLedgerEventFromTurnEvent(event)) return null;
  return buildOpenClawActivity({
    id: event.eventId,
    sessionId: event.sessionId,
    seq: event.seq,
    kind: event.kind,
    payload: event.payload,
    createdAt: event.createdAt,
  });
}

export function projectOpenClawLedgerTurn(
  turn: OpenClawTurnState,
  options?: {
    isStreaming?: boolean;
  }
): OpenClawTurnProjection {
  const ledgerEvents = turn.events
    .map(getOpenClawLedgerEventFromTurnEvent)
    .filter((event): event is OpenClawLedgerEvent => Boolean(event));
  const state = reduceOpenClawLedgerEvents(ledgerEvents);

  const answerItems = state.parts
    .filter((part) => part.partType === "answer" && part.visible && part.content.trim())
    .map((part) =>
      buildOpenClawAnswerTimelineItem({
        key: `${state.turnId || turn.turnKey}:answer:${part.partId}`,
        sessionId: turn.sessionId,
        seq: part.orderSeq ?? part.seq,
        createdAt: part.createdAt,
        content: part.content.trim(),
        replace: true,
        identityKey: part.partId,
      })
    );

  const outputFiles = state.parts
    .filter((part) => part.partType === "output_file")
    .reduce<OutputFile[]>((files, part) => mergeOutputFiles(files, extractOutputFiles(part.payload), { logicalIdentity: true }), []);
  const outputFilesItem = buildOpenClawOutputFilesTimelineItem({
    key: `${state.turnId || turn.turnKey}:output_files`,
    sessionId: turn.sessionId,
    seq: state.lastSeq,
    files: outputFiles,
  });

  const ledgerActivities = state.parts
      .filter((part) => part.partType === "thinking" || part.partType === "tool" || part.partType === "status")
      .map(buildActivityFromLedgerPart)
      .filter((activity): activity is OpenClawActivityItem => Boolean(activity));
  const supportActivities = turn.events
    .map(buildActivityFromSupportTurnEvent)
    .filter((activity): activity is OpenClawActivityItem => Boolean(activity));
  const activities = mergeOpenClawActivities(
    [],
    [...supportActivities, ...ledgerActivities]
  );
  const activityItems = activities
    .map((activity) => buildOpenClawTimelineItemFromActivity(activity))
    .filter((item) => item.kind !== "run.completed");
  const timelineItems = mergeOpenClawTimelineItems(
    outputFilesItem ? [...activityItems, outputFilesItem] : activityItems,
    answerItems
  );
  const visibleAnswer = answerItems.map((item) => item.content || "").join("");

  return {
    timelineItems,
    visibleAnswer,
    outputFiles,
    activities,
    interrupted: state.status === "interrupted" || state.status === "cancelled",
    failed: state.status === "failed",
    isStreaming: options?.isStreaming ?? toTurnStatus(state.status) === "streaming",
  };
}

// ============================================================================
// Session Snapshot 类型（上移自 apps/front-react/src/api/modules/openclaw）
// ============================================================================

/** Snapshot 中单个 active turn 的形态（兼容 snake/camel 命名） */
export interface OpenClawSnapshotActiveTurn {
  turn_id?: string;
  turnId?: string;
  run_id?: string;
  runId?: string;
  active_request_id?: string;
  activeRequestId?: string;
  status?: OpenClawLedgerTerminalStatus | string;
  terminal_status?: OpenClawLedgerTerminalStatus;
  terminalStatus?: string;
  last_seq?: number;
  lastSeq?: number;
  part_ids?: string[];
  partIds?: string[];
}

/** 会话 snapshot 载荷（兼容 snake/camel 命名 + 顶层/data 双层嵌套） */
export interface OpenClawSessionSnapshot {
  session_id?: string;
  sessionId?: string;
  conversation_id?: string;
  conversationId?: string;
  last_seq?: number;
  lastSeq?: number;
  active_turns?: OpenClawSnapshotActiveTurn[];
  activeTurns?: OpenClawSnapshotActiveTurn[];
  recent_events?: OpenClawLedgerEvent[];
  recentEvents?: OpenClawLedgerEvent[];
  ledger_events?: OpenClawLedgerEvent[];
  ledgerEvents?: OpenClawLedgerEvent[];
  /** 部分 API 会把 snapshot 整体包在 data 字段里 */
  data?: OpenClawSessionSnapshot;
}
