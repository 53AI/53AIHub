import type { AgentRunReplayEvent, Message } from "../types";
import { convertReplayEventToSSE, processStreamDataItem } from "../hooks/useChatStream";
import { reconcileAgentRunCompletedAnswer } from "./agentrun-events";

export interface AgentRunMessageProjection {
  messageId: string;
  scopeId: string;
  lastSeq: number;
  message: Message;
}

type FormatRagStats = (ragStats: any, processRecords: any[]) => any;

const TERMINAL_EVENT_TYPES = new Set(["run.completed", "run.failed", "run.cancelled"]);

function mergeProjectedText(
  current: unknown,
  projected: unknown,
  canUseProjectionText: boolean,
): string | undefined {
  const currentText = typeof current === "string" ? current : "";
  const projectedText = typeof projected === "string" ? projected : "";
  if (!canUseProjectionText) return currentText || undefined;
  if (!currentText) return projectedText || undefined;
  if (!projectedText) return currentText;
  if (projectedText.startsWith(currentText)) return projectedText;

  // While running, direct SSE is the only answer writer. At terminal state the
  // projection may fill a missing suffix, but never replace a different text.
  return currentText;
}

function cloneProjectionMessage(message: Message): Message {
  return {
    ...message,
    process_records: message.process_records ? [...message.process_records] : [],
    skillRunItems: message.skillRunItems ? [...message.skillRunItems] : [],
    outputFiles: message.outputFiles ? [...message.outputFiles] : [],
    rag_temp: message.rag_temp ? { ...message.rag_temp } : {},
  } as Message;
}

function createProjectionMessage(messageId: string): Message {
  return {
    id: messageId,
    role: "assistant",
    answer: "",
    reasoning_content: "",
    process_records: [],
    skillRunItems: [],
    outputFiles: [],
    rag_temp: {},
    loading: true,
  } as Message;
}

export function applyAgentRunProjectionEvents(
  current: AgentRunMessageProjection | null,
  events: AgentRunReplayEvent[],
  messageId: string | number,
  formatRagStats: FormatRagStats,
  scopeId = String(messageId),
): AgentRunMessageProjection {
  const normalizedMessageId = String(messageId);
  const sameMessage = current?.scopeId === scopeId;
  const lastSeq = sameMessage ? current.lastSeq : 0;
  const newEvents = events.filter((event) => {
    const seq = Number(event.seq);
    return Number.isFinite(seq) && seq > lastSeq;
  }).sort((left, right) => Number(left.seq) - Number(right.seq));

  if (sameMessage && newEvents.length === 0) return current;

  const message = sameMessage
    ? cloneProjectionMessage(current.message)
    : createProjectionMessage(normalizedMessageId);
  let nextSeq = lastSeq;

  for (const event of newEvents) {
    const eventType = String(event.event_type || event.type || "");
    const sseData = convertReplayEventToSSE(event, messageId);
    if (sseData) {
      processStreamDataItem(sseData, message, formatRagStats);
    } else if (eventType === "message.completed") {
      message.answer = reconcileAgentRunCompletedAnswer(message.answer, event.payload?.answer);
      message.loading = false;
    }

    if (TERMINAL_EVENT_TYPES.has(eventType)) {
      message.loading = false;
    }
    nextSeq = Math.max(nextSeq, Number(event.seq));
  }

  return {
    messageId: normalizedMessageId,
    scopeId,
    lastSeq: nextSeq,
    message,
  };
}

function mergeProjectedArray<T>(current: T[] | undefined, projected: T[] | undefined): T[] | undefined {
  if (!projected?.length) return current;
  if (!current?.length) return projected;
  if (projected.length < current.length) return current;
  if (projected.length === current.length) {
    // Projection cloning keeps unchanged item identities. Comparing the last
    // item avoids serializing the complete process history on every token.
    return projected[projected.length - 1] === current[current.length - 1]
      ? current
      : projected;
  }
  return projected;
}

function mergeProjectedLiveArray<T>(
  current: T[] | undefined,
  projected: T[] | undefined,
  projectionOwnsLiveState: boolean,
): T[] | undefined {
  // A direct completions SSE connection and the AgentRun subscription carry
  // the same timeline with different batching. Array length therefore cannot
  // establish which copy is newer: AgentRun may contain more tool records but
  // still be missing an earlier llm_delta. While direct SSE owns the live turn,
  // its non-empty process state is monotonic and must not be replaced at the
  // terminal event. AgentRun takes ownership only for recovery, or as an empty
  // direct-state fallback.
  if (!projectionOwnsLiveState && current?.length) return current;
  return mergeProjectedArray(current, projected);
}

export function mergeAgentRunProjectionIntoMessage(
  current: Message,
  projected: Message,
  options: { projectionOwnsLiveState?: boolean } = {},
): Message {
  const projectionTerminal = projected.loading === false;
  const projectionOwnsLiveState = options.projectionOwnsLiveState === true;
  const canUseProjectionText = projectionTerminal || projectionOwnsLiveState;
  const answer = mergeProjectedText(current.answer, projected.answer, canUseProjectionText);
  const reasoningContent = mergeProjectedText(
    current.reasoning_content,
    projected.reasoning_content,
    canUseProjectionText,
  );
  const processRecords = mergeProjectedLiveArray(
    current.process_records,
    projected.process_records,
    projectionOwnsLiveState,
  );
  const skillRunItems = mergeProjectedLiveArray(
    current.skillRunItems,
    projected.skillRunItems,
    projectionOwnsLiveState,
  );
  const outputFiles = mergeProjectedArray(current.outputFiles, projected.outputFiles);
  const projectedRagTemp = projected.rag_temp && Object.keys(projected.rag_temp).length > 0
    ? projected.rag_temp
    : current.rag_temp;

  return {
    ...current,
    answer,
    content: mergeProjectedText(
      current.content,
      projected.content ?? projected.answer,
      canUseProjectionText,
    ),
    reasoning_content: reasoningContent,
    process_records: processRecords,
    skillRunItems,
    outputFiles,
    rag_temp: projectedRagTemp,
    rag_stats: projected.rag_stats ?? current.rag_stats,
    rag_search_text: projected.rag_search_text ?? current.rag_search_text,
    loading: projected.loading,
    error: projected.error ?? current.error,
    interrupted: projected.interrupted ?? current.interrupted,
  } as Message;
}
