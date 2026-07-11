import type {
  Message,
  OpenClawActivityItem,
  OpenClawTimelineItem,
  OpenClawTurnProjection,
  OutputFile,
} from "../types/message";
import { mergeOpenClawActivities } from "./openclaw-activities";

type OpenClawMutableMessage = Message & {
  openclawProjection?: OpenClawTurnProjection;
  openclawActivities?: OpenClawActivityItem[];
  openclawTimelineItems?: OpenClawTimelineItem[];
  answer?: string;
  outputFiles?: OutputFile[];
  reasoning_content?: string;
  _openclawLastAnswerItemKey?: string;
};

const TIMELINE_TYPE_PRIORITY: Record<OpenClawTimelineItem["type"], number> = {
  thinking: 1,
  tool_call: 2,
  tool_result: 3,
  answer: 4,
  output_files: 5,
  run_terminal: 6,
};

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeOutputFileId(file: OutputFile) {
  return file.id != null ? String(file.id) : "";
}

function normalizeOutputFileName(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOutputFileUrl(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getUrlBasename(value: string) {
  const withoutQuery = value.split(/[?#]/)[0] || "";
  const normalized = withoutQuery.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() || "";
}

export function getOutputFileKey(file: OutputFile): string {
  const id =
    normalizeOutputFileId(file) ||
    (file.artifact_id != null ? String(file.artifact_id) : "") ||
    (file.upload_file_id != null ? String(file.upload_file_id) : "");
  const url = file.preview_url || file.signed_download_url || file.download_url || file.url || "";
  const fileName = file.file_name || "";
  return id || `${url}|${fileName}`;
}

export function getOutputFileKeys(
  file: OutputFile,
  options: { logicalIdentity?: boolean } = {}
): string[] {
  const keys = new Set<string>();
  const primaryKey = getOutputFileKey(file);
  if (primaryKey) keys.add(primaryKey);

  if (!options.logicalIdentity) {
    return [...keys];
  }

  const fileName = normalizeOutputFileName(file.file_name);
  const messageId = file.message_id != null ? String(file.message_id) : "";
  const sourceKind = normalizeOutputFileName(file.source_kind);
  const urls = [
    normalizeOutputFileUrl(file.preview_url),
    normalizeOutputFileUrl(file.signed_download_url),
    normalizeOutputFileUrl(file.download_url),
    normalizeOutputFileUrl(file.url),
    normalizeOutputFileUrl((file as any).file_path),
  ].filter(Boolean);

  if (messageId && fileName) keys.add(`message:${messageId}:${fileName}`);
  if (file.artifact_id != null && fileName) keys.add(`artifact:${String(file.artifact_id)}:${fileName}`);
  if (file.upload_file_id != null && fileName) keys.add(`upload:${String(file.upload_file_id)}:${fileName}`);
  if (sourceKind && fileName) keys.add(`source:${sourceKind}:${fileName}`);
  for (const url of urls) {
    const basename = getUrlBasename(url);
    if (basename && fileName) keys.add(`basename:${basename}:${fileName}`);
    if (basename) keys.add(`basename:${basename}`);
  }
  if (fileName) keys.add(`filename:${fileName}`);

  return [...keys];
}

function mergeOutputFile(existing: OutputFile, incoming: OutputFile): OutputFile {
  const merged = {
    ...existing,
    ...incoming,
    url: incoming.preview_url || existing.preview_url || incoming.url || existing.url,
    preview_key: incoming.preview_key || existing.preview_key,
    preview_url: incoming.preview_url || existing.preview_url,
    download_url: incoming.download_url || existing.download_url,
    signed_download_url: incoming.signed_download_url || existing.signed_download_url,
    artifact_id: incoming.artifact_id || existing.artifact_id,
    upload_file_id: incoming.upload_file_id || existing.upload_file_id,
    mime_type: incoming.mime_type || existing.mime_type,
    size: incoming.size ?? existing.size,
    kind: incoming.kind || existing.kind,
    message_id: incoming.message_id || existing.message_id,
    source_kind: incoming.source_kind || existing.source_kind,
    base64: incoming.base64 ?? existing.base64,
    content: incoming.content ?? existing.content,
    file_path: incoming.file_path || existing.file_path,
  };
  for (const key of ["artifact_id", "upload_file_id", "source_kind", "base64", "content", "file_path"] as const) {
    if (merged[key] === undefined) {
      delete merged[key];
    }
  }
  return merged;
}

export function mergeOutputFiles(
  current: OutputFile[] = [],
  incoming: OutputFile[] = [],
  options: { logicalIdentity?: boolean } = {}
): OutputFile[] {
  if (!incoming.length) return current;

  const merged = [...current];
  const indexByKey = new Map<string, number>();
  merged.forEach((file, index) => {
    for (const key of getOutputFileKeys(file, options)) {
      indexByKey.set(key, index);
    }
  });

  for (const file of incoming) {
    const keys = getOutputFileKeys(file, options);
    const matchedKey = keys.find((key) => indexByKey.has(key));
    if (matchedKey) {
      const index = indexByKey.get(matchedKey)!;
      merged[index] = mergeOutputFile(merged[index], file);
      for (const key of getOutputFileKeys(merged[index], options)) {
        indexByKey.set(key, index);
      }
      continue;
    }
    for (const key of keys) {
      indexByKey.set(key, merged.length);
    }
    merged.push(file);
  }

  return merged;
}

export function buildOpenClawTimelineItemFromActivity(activity: OpenClawActivityItem): OpenClawTimelineItem {
  const type =
    activity.kind === "assistant.thinking"
      ? "thinking"
      : activity.kind === "tool.call"
        ? "tool_call"
        : activity.kind === "tool.result"
          ? "tool_result"
          : "run_terminal";

  const summary = activity.summary || activity.detail || "";
  const toolName = normalizeText(activity.tool?.name || activity.tool?.displayName || "");
  const toolCallId = normalizeText(activity.tool?.toolCallId || "");
  const mergeKey =
    type === "thinking"
      ? `${type}:${normalizeText(summary)}`
      : type === "tool_call" || type === "tool_result"
        ? toolCallId
          ? `${type}:call:${toolCallId}`
          : normalizeText(activity.tool?.input || "") || normalizeText(activity.tool?.output || "")
            ? `${type}:${toolName}:${normalizeText(activity.tool?.input || "")}:${normalizeText(activity.tool?.output || "")}`
            : `${type}:${normalizeText(activity.key)}`
        : `${type}:${activity.seq || 0}`;

  return {
    key: activity.key,
    mergeKey,
    sessionId: activity.sessionId,
    seq: activity.seq,
    createdAt: activity.createdAt,
    type,
    title: activity.title,
    content: type === "thinking" ? summary : undefined,
    detail: activity.detail || summary,
    tone: activity.tone,
    kind: activity.kind,
    tool: activity.tool,
    requiresUserInput: activity.requiresUserInput,
    interaction: activity.interaction,
    questions: activity.questions,
    resolved: activity.resolved,
    activity,
  };
}

export function buildOpenClawAnswerTimelineItem(input: {
  key: string;
  sessionId?: string;
  seq?: number;
  createdAt?: string;
  content: string;
  replace?: boolean;
  identityKey?: string;
}): OpenClawTimelineItem {
  return {
    key: input.key,
    mergeKey: `answer:${input.identityKey || input.seq || input.key}`,
    sessionId: input.sessionId,
    seq: input.seq,
    createdAt: input.createdAt,
    type: "answer",
    content: input.content,
    replace: input.replace,
    tone: "neutral",
  };
}

export function buildOpenClawOutputFilesTimelineItem(input: {
  key: string;
  sessionId?: string;
  seq?: number;
  createdAt?: string;
  files: OutputFile[];
}): OpenClawTimelineItem | null {
  if (!input.files.length) return null;
  const fileKey = input.files.map((file) => getOutputFileKey(file)).sort().join(",");
  return {
    key: input.key,
    mergeKey: `output_files:${input.seq || 0}:${fileKey}`,
    sessionId: input.sessionId,
    seq: input.seq,
    createdAt: input.createdAt,
    type: "output_files",
    title: `生成了 ${input.files.length} 个文件`,
    files: input.files,
    tone: "success",
  };
}

function getAnswerMergeIdentity(item: OpenClawTimelineItem) {
  return item.seq || item.key;
}

function getTimelineMergeKey(item: OpenClawTimelineItem) {
  if (item.mergeKey) {
    return item.mergeKey;
  }
  if (item.type === "thinking") {
    return `thinking:${normalizeText(item.content || item.detail || item.title || "")}`;
  }
  if (item.type === "tool_call" || item.type === "tool_result") {
    const toolName = normalizeText(item.tool?.name || item.tool?.displayName || "");
    const toolInput = normalizeText(item.tool?.input || "");
    const toolOutput = normalizeText(item.tool?.output || item.detail || item.title || "");
    return `${item.type}:${toolName}:${toolInput}:${toolOutput}`;
  }
  if (item.type === "answer") {
    return `answer:${getAnswerMergeIdentity(item)}`;
  }
  if (item.type === "output_files") {
    const fileKey = (item.files || []).map((file) => getOutputFileKey(file)).sort().join(",");
    return `output_files:${item.seq || 0}:${fileKey}`;
  }
  return `${item.type}:${item.seq || 0}:${item.kind || item.key}`;
}

function mergeAnswerContent(previous = "", incoming = "", replace = false) {
  if (!incoming) return previous;
  if (replace || !previous) return incoming;
  if (previous === incoming || previous.trim() === incoming.trim()) return previous;
  if (incoming.startsWith(previous)) return incoming;
  if (previous.startsWith(incoming)) return previous;
  return previous + incoming;
}

export function mergeOpenClawTimelineItems(
  current: OpenClawTimelineItem[] = [],
  incoming: OpenClawTimelineItem[] = []
): OpenClawTimelineItem[] {
  const byKey = new Map<string, OpenClawTimelineItem>();

  for (const item of [...current, ...incoming]) {
    const key = getTimelineMergeKey(item);
    const previous = byKey.get(key);
    if (!previous) {
      byKey.set(key, item);
      continue;
    }

    if (item.type === "answer") {
      byKey.set(key, {
        ...previous,
        ...item,
        content: mergeAnswerContent(previous.content, item.content, item.replace),
      });
      continue;
    }

    if (item.type === "output_files") {
      byKey.set(key, {
        ...previous,
        ...item,
        files: mergeOutputFiles(previous.files || [], item.files || [], { logicalIdentity: true }),
      });
      continue;
    }

    const prevSeq = typeof previous.seq === "number" ? previous.seq : Number.NEGATIVE_INFINITY;
    const nextSeq = typeof item.seq === "number" ? item.seq : Number.NEGATIVE_INFINITY;
    if (prevSeq > nextSeq) continue;
    byKey.set(key, { ...previous, ...item });
  }

  return [...byKey.values()].sort((left, right) => {
    const leftSeq = typeof left.seq === "number" ? left.seq : Number.MAX_SAFE_INTEGER;
    const rightSeq = typeof right.seq === "number" ? right.seq : Number.MAX_SAFE_INTEGER;
    if (leftSeq !== rightSeq) return leftSeq - rightSeq;
    const leftPriority = TIMELINE_TYPE_PRIORITY[left.type] || 99;
    const rightPriority = TIMELINE_TYPE_PRIORITY[right.type] || 99;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return left.key.localeCompare(right.key);
  });
}

function replaceConversationPrefix(value: string, previousConversationId: string, nextConversationId: string) {
  if (!value || !previousConversationId || previousConversationId === nextConversationId) return value;
  if (value === previousConversationId) return nextConversationId;
  if (value.startsWith(`${previousConversationId}:`)) {
    return `${nextConversationId}${value.slice(previousConversationId.length)}`;
  }
  return value;
}

function rebaseTimelineItemConversation(
  item: OpenClawTimelineItem,
  previousConversationId: string,
  nextConversationId: string
): OpenClawTimelineItem {
  const nextSessionId = !item.sessionId || item.sessionId === previousConversationId
    ? nextConversationId
    : item.sessionId;
  const nextKey =
    item.type === "answer" || item.type === "output_files"
      ? replaceConversationPrefix(item.key, previousConversationId, nextConversationId)
      : item.key;
  const identityKey = item.type === "answer" ? String(item.seq || nextKey) : undefined;
  return {
    ...item,
    key: nextKey,
    sessionId: nextSessionId,
    activity: item.activity
      ? {
          ...item.activity,
          sessionId: !item.activity.sessionId || item.activity.sessionId === previousConversationId
            ? nextConversationId
            : item.activity.sessionId,
        }
      : item.activity,
    mergeKey:
      item.type === "answer"
        ? `answer:${identityKey}`
        : item.type === "output_files"
          ? `output_files:${item.seq || 0}:${(item.files || []).map((file) => getOutputFileKey(file)).sort().join(",")}`
          : undefined,
  };
}

export function rebaseOpenClawMessageConversation<
  TMessage extends OpenClawMutableMessage
>(
  message: TMessage,
  nextConversationId: string,
  previousConversationId?: string
): TMessage {
  const resolvedConversationId = String(nextConversationId || "");
  if (!resolvedConversationId) return message;

  const currentConversationId = String(previousConversationId ?? message.conversation_id ?? "");
  if (currentConversationId === resolvedConversationId && message.conversation_id === resolvedConversationId) {
    return message;
  }

  const nextMessage = {
    ...message,
    conversation_id: resolvedConversationId,
  } as TMessage;

  if (Array.isArray(message.openclawActivities)) {
    nextMessage.openclawActivities = mergeOpenClawActivities(
      [],
      message.openclawActivities.map((item) => ({
        ...item,
        sessionId: !item.sessionId || item.sessionId === currentConversationId
          ? resolvedConversationId
          : item.sessionId,
      }))
    );
  }

  if (Array.isArray(message.openclawTimelineItems)) {
    nextMessage.openclawTimelineItems = mergeOpenClawTimelineItems(
      [],
      message.openclawTimelineItems.map((item) =>
        rebaseTimelineItemConversation(item, currentConversationId, resolvedConversationId)
      )
    );
  }

  if (message._openclawLastAnswerItemKey) {
    nextMessage._openclawLastAnswerItemKey = replaceConversationPrefix(
      message._openclawLastAnswerItemKey,
      currentConversationId,
      resolvedConversationId
    );
  }

  syncOpenClawMessageDerivedState(nextMessage);
  return nextMessage;
}

function canReconcileAnswerContent(existing = "", incoming = "") {
  const left = existing.replace(/\s+/g, " ").trim();
  const right = incoming.replace(/\s+/g, " ").trim();
  if (!left || !right) return false;
  if (left === right || left.startsWith(right) || right.startsWith(left)) {
    return true;
  }

  const shorterLength = Math.min(left.length, right.length);
  if (shorterLength >= 16 && (left.includes(right) || right.includes(left))) {
    return true;
  }

  return false;
}

function findAnswerTimelineItemIndex(
  items: OpenClawTimelineItem[],
  input: {
    key: string;
    seq?: number;
    content: string;
  },
  lastAnswerItemKey?: string
) {
  const answerIndexes = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.type === "answer");
  if (!answerIndexes.length) return -1;

  const exactKey = answerIndexes.find(({ item }) => item.key === input.key);
  if (exactKey) return exactKey.index;

  if (Number.isFinite(input.seq)) {
    const seqMatch = [...answerIndexes].reverse().find(({ item }) => Number(item.seq) === Number(input.seq));
    if (seqMatch) return seqMatch.index;
    const lastAnswerMatch = [...answerIndexes].reverse().find(({ item }) => item.key === lastAnswerItemKey);
    if (
      lastAnswerMatch &&
      canReconcileAnswerContent(lastAnswerMatch.item.content || "", input.content)
    ) {
      return lastAnswerMatch.index;
    }
  }

  if (!Number.isFinite(input.seq) && lastAnswerItemKey) {
    const lastKeyMatch = answerIndexes.find(({ item }) => item.key === lastAnswerItemKey);
    if (lastKeyMatch) return lastKeyMatch.index;
  }

  const contentMatch = [...answerIndexes].reverse().find(({ item }) =>
    canReconcileAnswerContent(item.content || "", input.content)
  );
  return contentMatch ? contentMatch.index : -1;
}

export function upsertOpenClawAnswerTimelineItemInMessage<
  TMessage extends OpenClawMutableMessage
>(
  message: TMessage,
  input: {
    key: string;
    sessionId?: string;
    seq?: number;
    createdAt?: string;
    content: string;
    replace?: boolean;
    identityKey?: string;
  }
) {
  const items = [...(message.openclawTimelineItems || [])];
  const candidateIndex = findAnswerTimelineItemIndex(items, input, message._openclawLastAnswerItemKey);
  const nextItem = buildOpenClawAnswerTimelineItem(input);

  if (candidateIndex >= 0) {
    const previous = items[candidateIndex];
    items[candidateIndex] = {
      ...previous,
      ...nextItem,
      content: mergeAnswerContent(previous.content, input.content, input.replace),
    };
    message.openclawTimelineItems = mergeOpenClawTimelineItems([], items);
  } else {
    message.openclawTimelineItems = mergeOpenClawTimelineItems(items, [nextItem]);
  }

  message._openclawLastAnswerItemKey = input.key;
  syncOpenClawMessageDerivedState(message);
}

export function getOpenClawTimelineMaxSeq(items: OpenClawTimelineItem[] = []) {
  return items.reduce((maxSeq, item) => {
    const seq = typeof item.seq === "number" ? item.seq : Number(item.seq);
    return Number.isFinite(seq) ? Math.max(maxSeq, seq) : maxSeq;
  }, 0);
}

export function syncOpenClawMessageDerivedState(message: OpenClawMutableMessage) {
  if (message.openclawProjection) {
    message.openclawActivities = message.openclawProjection.activities;
    message.answer = message.openclawProjection.visibleAnswer;
    message.outputFiles = message.openclawProjection.outputFiles;
    message.openclawTimelineItems = message.openclawProjection.timelineItems;
    if (message.openclawProjection.activities.length > 0) {
      message.reasoning_content = "";
    }
    return;
  }

  const timeline = message.openclawTimelineItems || [];
  if (!timeline.length) return;

  const activities = timeline
    .map((item) => item.activity)
    .filter((item): item is OpenClawActivityItem => Boolean(item));
  if (activities.length) {
    message.openclawActivities = mergeOpenClawActivities([], activities);
  }

  const answerContent = timeline
    .filter((item) => item.type === "answer")
    .map((item) => item.content || "")
    .filter(Boolean);
  if (answerContent.length) {
    message.answer = answerContent.join("");
  }

  const outputFiles = timeline
    .filter((item) => item.type === "output_files")
    .reduce<OutputFile[]>((allFiles, item) => mergeOutputFiles(allFiles, item.files || [], { logicalIdentity: true }), []);
  if (outputFiles.length) {
    message.outputFiles = outputFiles;
  }
}
