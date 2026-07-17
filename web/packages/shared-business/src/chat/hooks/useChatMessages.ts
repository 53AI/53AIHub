import { useState, useCallback, useRef, useEffect } from "react";
import type { Message, Skill, MessageFile, SpecifiedFile, OutputFile, ProcessRecord } from "../types";
import { AGENT_RUN_TERMINAL_EVENTS } from "../adapters/types";
import { parseJson } from "./useChatStream";
import { parseQuestionWithSkill } from "../utils/parseQuestionWithSkill";
import { parseRegenerateParams } from "./parseRegenerateParams";
import type { RegenerateParams, UseChatMessagesRegenerateOptions } from "../types/regenerate";
import { useRagStats } from "./useRagStats";
import { useChatAdapters } from "../i18n";
import { useAgentRun, type RecoverCallbacks } from "./useAgentRun";
import { applyAgentRunEvents } from "../utils/agentrun-events";
import { collapseDuplicateOpenClawIntermediateRows } from "../utils/openclaw-adapter";
import { readPaginationHasMore, readPaginationNextOffset } from "../utils/pagination";
import { formatFileInfo, JSONParse } from "@km/shared-utils";

function processRecordsToOutputFiles(records: ProcessRecord[]): OutputFile[] {
  const outputFiles: OutputFile[] = [];
  const indexByKey = new Map<string, number>();

  const appendFiles = (files: any[]) => {
    files.forEach((file: any) => {
      if (!file || typeof file !== "object") return;
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
      if (id == null && !url && !fileName) return;
      const key = id != null ? String(id) : `${url || ""}|${fileName || ""}`;
      const incoming = {
        id: String(id ?? key),
        file_name: fileName != null ? String(fileName) : "",
        url: url != null ? String(url) : "",
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
      if (key && indexByKey.has(key)) {
        const index = indexByKey.get(key)!;
        const existing = outputFiles[index];
        outputFiles[index] = {
          ...incoming,
          ...existing,
          mime_type: existing.mime_type ?? incoming.mime_type,
          size: existing.size ?? incoming.size,
          kind: existing.kind ?? incoming.kind,
          message_id: existing.message_id ?? incoming.message_id,
          preview_key: existing.preview_key ?? incoming.preview_key,
          preview_url: existing.preview_url ?? incoming.preview_url,
          download_url: existing.download_url ?? incoming.download_url,
          signed_download_url: existing.signed_download_url ?? incoming.signed_download_url,
          artifact_id: existing.artifact_id ?? incoming.artifact_id,
          upload_file_id: existing.upload_file_id ?? incoming.upload_file_id,
          source_kind: existing.source_kind ?? incoming.source_kind,
          base64: incoming.base64 ?? existing.base64,
          content: incoming.content ?? existing.content,
          file_path: existing.file_path ?? incoming.file_path,
        };
        return;
      }
      if (key) indexByKey.set(key, outputFiles.length);
      outputFiles.push({
        ...incoming,
      });
    });
  };

  for (const record of records) {
    if (record.step_code === "output_files" && record.status === "completed" && record.data) {
      const data = (typeof record.data === "string" ? parseJson<{ files?: OutputFile[]; media_attachments?: OutputFile[] }>(record.data as string) : record.data) as { files?: OutputFile[]; media_attachments?: OutputFile[] } | null;
      const files = data?.files;
      const mediaAttachments = data?.media_attachments;
      if (Array.isArray(files)) appendFiles(files);
      if (Array.isArray(mediaAttachments)) appendFiles(mediaAttachments);
    }
  }

  return outputFiles;
}

interface UseChatMessagesOptions {
  limit?: number;
  supportSpecifiedContent?: boolean;
  skillList?: any[];
  mySkillList?: any[];
  /** 是否加载消息的反馈状态，默认 false */
  loadFeedback?: boolean;
  /** 重新生成回答参数配置（控制 skill 前缀解析行为） */
  regenerate?: UseChatMessagesRegenerateOptions;
}

interface MessageState {
  messageList: Message[];
  isLoadingMessages: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  offset: number;
}

function readOpenClawHistoryMeta(response: any) {
  const payload = response?.data ?? response ?? {};
  const source = typeof payload.source === "string" ? payload.source : "";
  const stale = typeof payload.stale === "boolean" ? payload.stale : undefined;
  const lastSeq = typeof payload.last_seq === "number" ? payload.last_seq : Number(payload.last_seq);
  const messagesLastSeq =
    typeof payload.messages_last_seq === "number" ? payload.messages_last_seq : Number(payload.messages_last_seq);
  const mirrorLastSeq =
    typeof payload.mirror_last_seq === "number" ? payload.mirror_last_seq : Number(payload.mirror_last_seq);
  return {
    ...(source ? { source } : {}),
    ...(typeof stale === "boolean" ? { stale } : {}),
    ...(Number.isFinite(lastSeq) && lastSeq > 0 ? { last_seq: lastSeq } : {}),
    ...(Number.isFinite(messagesLastSeq) && messagesLastSeq > 0 ? { messages_last_seq: messagesLastSeq } : {}),
    ...(Number.isFinite(mirrorLastSeq) && mirrorLastSeq > 0 ? { mirror_last_seq: mirrorLastSeq } : {}),
    ...(typeof payload.refresh_recommended === "boolean" ? { refresh_recommended: payload.refresh_recommended } : {}),
  };
}

function attachOpenClawHistoryMeta<T extends Message[]>(messages: T, response: any): T {
  const meta = readOpenClawHistoryMeta(response);
  if (Object.keys(meta).length > 0) {
    Object.assign(messages, { openclawHistoryMeta: meta });
  }
  return messages;
}

function messageIdentity(message: Message): string {
  return String(message.id ?? "");
}

// Exported for unit testing dedup logic.
export function messageStableMergeKey(message: Message): string {
  const record = message as Message & Record<string, any>;
  return String(
    message.id ||
      record.openclawTurn?.turnKey ||
      record._openclawTurnStartSeq ||
      record._openclawClientMessageId ||
      `${message.conversation_id || ""}:${message.question || ""}:${message.created_time || ""}`
  );
}

function normalizeOpenClawMergeText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

// Exported for unit testing dedup logic.
export function isOpenClawMessage(message: Message): boolean {
  const record = message as Message & Record<string, any>;
  return Boolean(
    record.openclawTurn ||
      record.openclawProjection ||
      record.openclawTimelineItems ||
      record._openclawClientMessageId ||
      record._openclawActiveRequestId
  );
}

function getOpenClawMessageConversationId(message: Message): string {
  const record = message as Message & Record<string, any>;
  return String(record.conversation_id || record.openclawTurn?.sessionId || "").trim();
}

function getOpenClawMessageTimestamp(message: Message): number {
  const record = message as Message & Record<string, any>;
  const raw =
    record.updated_time ??
    record.created_time ??
    (record.updated_at ? Number(record.updated_at) * 1000 : undefined) ??
    (record.created_at ? Number(record.created_at) * 1000 : undefined);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function hasOpenClawOptimisticOrRuntimeIdentity(message: Message): boolean {
  const record = message as Message & Record<string, any>;
  return Boolean(
    record._openclawActiveRequestId ||
      record._openclawClientMessageId ||
      record.loading ||
      record.openclawTurn?.status === "streaming"
  );
}

// Exported for unit testing dedup logic.
export function getOpenClawLogicalMergeKey(message: Message): string {
  if (!isOpenClawMessage(message)) return "";
  const conversationId = getOpenClawMessageConversationId(message);
  const question = normalizeOpenClawMergeText(message.question);
  if (!conversationId || !question) return "";
  return `${conversationId}::${question}`;
}

// Exported for unit testing dedup logic.
export function canMergeOpenClawLogicalTurn(existing: Message, incoming: Message): boolean {
  if (!isOpenClawMessage(existing) || !isOpenClawMessage(incoming)) return false;
  if (getOpenClawLogicalMergeKey(existing) !== getOpenClawLogicalMergeKey(incoming)) return false;
  if (!hasOpenClawOptimisticOrRuntimeIdentity(existing) && !hasOpenClawOptimisticOrRuntimeIdentity(incoming)) return false;

  const existingTime = getOpenClawMessageTimestamp(existing);
  const incomingTime = getOpenClawMessageTimestamp(incoming);
  if (existingTime > 0 && incomingTime > 0 && Math.abs(existingTime - incomingTime) > 10 * 60 * 1000) {
    return false;
  }

  return true;
}

function areMessagesEquivalent(left: Message, right: Message): boolean {
  if (left === right) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function preserveLongerArray(target: Record<string, any>, existing: Message, incoming: Message, key: string) {
  const existingValue = (existing as any)[key];
  const incomingValue = (incoming as any)[key];
  if (
    Array.isArray(existingValue) &&
    existingValue.length > 0 &&
    (!Array.isArray(incomingValue) || incomingValue.length < existingValue.length)
  ) {
    target[key] = existingValue;
  }
}

function isWeakOpenClawAnswer(value: unknown): boolean {
  const normalized = String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  return !normalized || normalized === "heartbeat_ok" || normalized === "no_reply" || normalized === "no reply" || normalized === "no";
}

function hasOpenClawRenderableAnswer(message: Message): boolean {
  return Boolean(
    String((message as any).answer || "").trim() ||
      String((message as any).openclawProjection?.visibleAnswer || "").trim() ||
      (message as any).openclawTimelineItems?.some((item: any) => item?.type === "answer" && String(item?.content || "").trim())
  );
}

function hasOpenClawTerminalTurnSignal(message: Message): boolean {
  const turn = (message as any).openclawTurn;
  const status = String(turn?.status || "");
  if (status === "completed" || status === "interrupted" || status === "failed") return true;
  if ((message as any).openclawProjection?.isStreaming === false) return true;
  return Boolean(
    turn?.events?.some((event: any) =>
      event?.kind === "run.completed" ||
        event?.kind === "run.interrupted" ||
        event?.kind === "run.failed" ||
        event?.payload?.openclaw_ledger?.event_type === "turn.completed" ||
        event?.payload?.openclaw_ledger?.event_type === "turn.interrupted" ||
        event?.payload?.openclaw_ledger?.event_type === "turn.failed"
    )
  );
}

function shouldCloseOpenClawLoadingFromIncoming(incoming: Message, merged: Message): boolean {
  if ((incoming as any).loading === true) return false;
  if (hasOpenClawTerminalTurnSignal(incoming)) return true;
  if (hasOpenClawTerminalTurnSignal(merged) && hasOpenClawRenderableAnswer(merged)) return true;
  return false;
}

function preserveStrongerOpenClawAnswer(target: Record<string, any>, existing: Message, incoming: Message, preferExistingAnswer = false) {
  const existingAnswer = (existing as any).answer;
  const incomingAnswer = (incoming as any).answer;
  if (isWeakOpenClawAnswer(existingAnswer)) return;
  if (isWeakOpenClawAnswer(incomingAnswer) || preferExistingAnswer) {
    target.answer = existingAnswer;
  }
}

function scoreOpenClawProjection(projection: any): number {
  if (!projection || typeof projection !== "object") return 0;
  const answer = String(projection.visibleAnswer || "").trim();
  const timelineCount = Array.isArray(projection.timelineItems) ? projection.timelineItems.length : 0;
  const outputFileCount = Array.isArray(projection.outputFiles) ? projection.outputFiles.length : 0;
  const activityCount = Array.isArray(projection.activities) ? projection.activities.length : 0;
  return (
    (isWeakOpenClawAnswer(answer) ? 0 : 1_000 + Math.min(answer.length, 1_000)) +
    timelineCount * 100 +
    outputFileCount * 300 +
    activityCount * 100
  );
}

function preserveStrongerOpenClawProjection(target: Record<string, any>, existing: Message, incoming: Message) {
  const existingProjection = (existing as any).openclawProjection;
  const incomingProjection = (incoming as any).openclawProjection;
  if (scoreOpenClawProjection(existingProjection) <= scoreOpenClawProjection(incomingProjection)) return;

  target.openclawProjection = existingProjection;
  if (!isWeakOpenClawAnswer(existingProjection?.visibleAnswer)) {
    target.answer = existingProjection.visibleAnswer;
  }
  for (const key of ["openclawTimelineItems", "openclawActivities", "outputFiles"]) {
    const existingValue = (existing as any)[key];
    if (Array.isArray(existingValue) && existingValue.length > 0) {
      target[key] = existingValue;
    }
  }
}

function mergeOpenClawSupportFields(existing: Message, incoming: Message, options?: { preferExistingAnswer?: boolean }): Message {
  const merged: Message & Record<string, any> = {
    ...existing,
    ...incoming,
  };
  preserveStrongerOpenClawAnswer(merged, existing, incoming, Boolean(options?.preferExistingAnswer));
  preserveStrongerOpenClawProjection(merged, existing, incoming);
  for (const key of [
    "outputFiles",
    "process_records",
    "processRecords",
    "skillRunItems",
    "openclawTimelineItems",
    "openclawActivities",
  ]) {
    preserveLongerArray(merged, existing, incoming, key);
  }

  const existingTurn = (existing as any).openclawTurn;
  const incomingTurn = (incoming as any).openclawTurn;
  if (existingTurn && (!incomingTurn || !Array.isArray(incomingTurn.events) || incomingTurn.events.length === 0)) {
    merged.openclawTurn = existingTurn;
  } else if (existingTurn && incomingTurn) {
    merged.openclawTurn = {
      ...existingTurn,
      ...incomingTurn,
      events:
        Array.isArray(incomingTurn.events) &&
        incomingTurn.events.length >= (Array.isArray(existingTurn.events) ? existingTurn.events.length : 0)
          ? incomingTurn.events
          : existingTurn.events,
    };
  }
  if (shouldCloseOpenClawLoadingFromIncoming(incoming, merged)) {
    merged.loading = false;
  }
  return merged;
}

function messageBelongsToConversation(message: Message, conversationId: string): boolean {
  const record = message as Message & Record<string, any>;
  return (
    String(record.conversation_id || "") === conversationId ||
    String(record.openclawTurn?.sessionId || "") === conversationId ||
    String(record.openclawTurn?.turnKey || "").startsWith(`${conversationId}:`) ||
    String(record.id || "").startsWith(`${conversationId}:`)
  );
}

function shouldMergeOpenClawHistoryLoad(conversationId: string, currentMessages: Message[], incomingMessages: Message[]): boolean {
  if (!conversationId || !conversationId.startsWith("agent:")) return false;
  if (!currentMessages.length || !incomingMessages.length) return false;
  return currentMessages.some((message) => messageBelongsToConversation(message, conversationId));
}

function shouldPreferExistingOpenClawAnswer(incomingMessages: Message[]): boolean {
  const meta = (incomingMessages as any).openclawHistoryMeta;
  return meta?.source === "mirror" && meta?.stale === true;
}

// Exported for unit testing dedup logic.
export function mergeOpenClawMessages(
  currentMessages: Message[],
  incomingMessages: Message[],
  options?: { preferExistingAnswer?: boolean }
): Message[] {
  if (!incomingMessages.length) return currentMessages;

  const currentByKey = new Map<string, Message>();
  const currentByLogicalKey = new Map<string, Message[]>();
  // 同 _openclawTurnStartSeq 兜底：mirror 源和 openclaw 源对同一条逻辑消息的 id 格式不同
  // （例如 `turn:...legacy:1:assistant` vs `agent:main:main:assistant:2`），stableKey 匹配不到，
  // logicalKey 也匹配不到（question 为空或不一致）时，按 seq 匹配能让 incoming 替换 stale 的 existing。
  const currentBySeq = new Map<number, Message[]>();
  for (const message of currentMessages) {
    const key = messageStableMergeKey(message);
    if (key) currentByKey.set(key, message);
    const logicalKey = getOpenClawLogicalMergeKey(message);
    if (logicalKey) {
      const bucket = currentByLogicalKey.get(logicalKey) || [];
      bucket.push(message);
      currentByLogicalKey.set(logicalKey, bucket);
    }
    const seq = (message as any)._openclawTurnStartSeq;
    if (typeof seq === "number" && seq > 0) {
      const seqBucket = currentBySeq.get(seq) || [];
      seqBucket.push(message);
      currentBySeq.set(seq, seqBucket);
    }
  }

  const incomingKeys = new Set(incomingMessages.map(messageStableMergeKey).filter(Boolean));
  const consumedCurrentMessages = new Set<Message>();
  const consumedLogicalCandidates = new Set<Message>();

  const mergedIncoming = incomingMessages.map((incoming) => {
    const key = messageStableMergeKey(incoming);
    const incomingSeq = (incoming as any)._openclawTurnStartSeq;
    let existing = key ? currentByKey.get(key) : undefined;
    if (!existing) {
      // seq 兜底：stableKey 和 logicalKey 都匹配不到时（同 seq 不同 id 的跨源场景），
      // 让 incoming 替换 existing（openclaw 源更新更权威）。
      // 跳过 optimistic / streaming 消息，避免覆盖正在流式渲染的内容。
      if (typeof incomingSeq === "number" && incomingSeq > 0) {
        const seqCandidates = currentBySeq.get(incomingSeq) || [];
        const seqMatch = seqCandidates.find(
          (candidate) =>
            !consumedCurrentMessages.has(candidate) &&
            !consumedLogicalCandidates.has(candidate) &&
            String(candidate.id) !== String(incoming.id) &&
            isOpenClawMessage(candidate) &&
            !hasOpenClawOptimisticOrRuntimeIdentity(candidate),
        );
        if (seqMatch) {
          existing = seqMatch;
          consumedCurrentMessages.add(seqMatch);
        }
      }
    }
    if (!existing) {
      const logicalKey = getOpenClawLogicalMergeKey(incoming);
      const candidates = logicalKey ? currentByLogicalKey.get(logicalKey) || [] : [];
      existing = candidates.find((candidate) =>
        !consumedLogicalCandidates.has(candidate) &&
        canMergeOpenClawLogicalTurn(candidate, incoming)
      );
      if (existing) {
        consumedLogicalCandidates.add(existing);
      }
    }
    if (!existing) return incoming;
    consumedCurrentMessages.add(existing);
    const merged = mergeOpenClawSupportFields(existing, incoming, options);
    return areMessagesEquivalent(existing, merged) ? existing : merged;
  });

  const preservedMessages = currentMessages.filter((message) => {
    const key = messageStableMergeKey(message);
    return key && !incomingKeys.has(key) && !consumedCurrentMessages.has(message);
  });

  const nextMessages = collapseDuplicateOpenClawIntermediateRows([...preservedMessages, ...mergedIncoming]);

  if (
    nextMessages.length === currentMessages.length &&
    nextMessages.every((message, index) => message === currentMessages[index])
  ) {
    return currentMessages;
  }
  return nextMessages;
}

function normalizeMessageFile(file: any, index: number): MessageFile | null {
  if (!file || typeof file !== "object") return null;
  const contentId =
    typeof file.content === "string" && file.content.startsWith("file_id:")
      ? file.content.replace("file_id:", "")
      : undefined;
  const id =
    file.id ??
    file.file_id ??
    file.fileId ??
    file.upload_file_id ??
    file.uploadFileId ??
    file.artifact_id ??
    file.artifactId ??
    contentId ??
    file.preview_url ??
    file.previewUrl ??
    file.url ??
    file.file_path ??
    file.name ??
    file.file_name ??
    file.filename ??
    `file_${index}`;
  const name = file.name ?? file.file_name ?? file.filename ?? (id != null ? String(id) : undefined);
  if (id == null && !name) return null;

  return {
    ...file,
    id,
    name,
    file_name: file.file_name ?? file.name ?? file.filename ?? name,
    file_path: file.file_path ?? file.path,
    file_mime: file.file_mime ?? file.mime_type ?? file.mimeType ?? file.mime,
    file_size:
      typeof file.file_size === "number"
        ? file.file_size
        : typeof file.size === "number"
          ? file.size
          : Number.isFinite(Number(file.size))
            ? Number(file.size)
            : undefined,
    file_url: file.preview_url ?? file.previewUrl ?? file.file_url ?? file.url ?? file.download_url,
    url: file.preview_url ?? file.previewUrl ?? file.url ?? file.download_url ?? file.signed_download_url,
    preview_key: file.preview_key,
    preview_url: file.preview_url ?? file.previewUrl,
    download_url: file.download_url ?? file.downloadUrl,
    signed_download_url: file.signed_download_url ?? file.signedDownloadUrl,
    upload_file_id: file.upload_file_id ?? file.uploadFileId,
    artifact_id: file.artifact_id ?? file.artifactId,
  };
}

function normalizeMessageFiles(files: any): MessageFile[] {
  if (!Array.isArray(files)) return [];
  return files.map(normalizeMessageFile).filter((file): file is MessageFile => Boolean(file));
}

function normalizeMessageSkill(skill: any): Skill | null {
  if (!skill || typeof skill !== "object") return null;
  const skillName = typeof skill.skill_name === "string" ? skill.skill_name.trim() : "";
  const displayName = typeof skill.display_name === "string" ? skill.display_name.trim() : "";
  const skillId = skill.skill_id ?? skill.id;
  if (!skillName && !displayName && skillId == null) return null;
  return {
    ...skill,
    skill_name: skillName,
    display_name: displayName,
  };
}

function prependUniqueMessages(incomingMessages: Message[], currentMessages: Message[]) {
  const seen = new Set(currentMessages.map(messageIdentity).filter(Boolean));
  const uniqueIncomingMessages: Message[] = [];
  const dropped: string[] = [];

  for (const message of incomingMessages) {
    const key = messageIdentity(message);
    if (key && seen.has(key)) {
      dropped.push(key);
      continue;
    }
    if (key) seen.add(key);
    uniqueIncomingMessages.push(message);
  }

  const messages = collapseDuplicateOpenClawIntermediateRows([...uniqueIncomingMessages, ...currentMessages]);

  return {
    addedCount: uniqueIncomingMessages.length,
    messages,
  };
}

function finishPullUpAfterRender(done: () => void) {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    done();
    return;
  }
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(done);
  });
}

// Feedback updater helper
function createFeedbackUpdater(feedback: any) {
  return (msg: Message): Message => ({
    ...msg,
    ...feedback,
    feedbackVisible: msg.feedbackVisible ?? feedback.feedbackVisible,
    feedbackTypeOptions: msg.feedbackTypeOptions ?? feedback.feedbackTypeOptions,
    feedbackLoading: false,
  });
}

function isOpenClawUiDebugEnabled(): boolean {
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

function hashOpenClawText(value?: string | null): string {
  const text = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function traceOpenClawMessages(label: string, messages: Message[]) {
  if (!isOpenClawUiDebugEnabled()) return;
  const openclawMessages = messages.filter((message: any) => message.openclawTurn || message.openclawProjection || message.openclawTimelineItems);
  if (!openclawMessages.length) return;
  console.info(`[openclaw-ui:${label}] ${JSON.stringify({
    count: messages.length,
    openclawCount: openclawMessages.length,
    messages: openclawMessages.map((message: any) => ({
      id: message.id,
      conversationId: message.conversation_id,
      questionLen: String(message.question || "").length,
      questionHash: hashOpenClawText(message.question),
      answerLen: String(message.answer || "").length,
      answerHash: hashOpenClawText(message.answer),
      timelineCount: message.openclawTimelineItems?.length || 0,
      eventCount: message.openclawTurn?.events?.length || 0,
      status: message.openclawTurn?.status,
      loading: Boolean(message.loading),
    })),
  })}`);
}

type LoadMessagesApi = (
  conversationId: string,
  params: { offset: number; limit: number; fresh?: boolean }
) => Promise<any>;

interface LoadMessageListOptions {
  skillList?: any[];
  mySkillList?: any[];
  isRunning?: boolean;
  runningMessageId?: string | number;
  silent?: boolean;
}

function splitLoadMessagesArgs<TOptions extends Record<string, any>>(
  apiOrOptions?: LoadMessagesApi | TOptions,
  maybeOptions?: TOptions
): { loadMessagesApi?: LoadMessagesApi; options?: TOptions } {
  if (typeof apiOrOptions === "function") {
    return { loadMessagesApi: apiOrOptions, options: maybeOptions };
  }
  return { options: apiOrOptions };
}

function requireLoadMessagesApi(loadMessagesApi?: LoadMessagesApi): LoadMessagesApi {
  if (loadMessagesApi) return loadMessagesApi;
  throw new Error(
    'useChatMessages requires messages adapter. ' +
      'Please provide it in ChatConfigProvider: adapters={{ messages: { api: { loadMessages } } }}'
  );
}

export function useChatMessages(options?: UseChatMessagesOptions) {
  const { formatRagStats } = useRagStats();
  const adapters = useChatAdapters();
  const agentRun = useAgentRun();
  const skillList = options?.skillList || [];
  const mySkillList = options?.mySkillList || [];

  const limit = options?.limit || 10;
  const supportSpecifiedContent = options?.supportSpecifiedContent || false;
  const providerLoadMessagesApi = adapters?.messages?.api?.loadMessages;

  const [state, setState] = useState<MessageState>({
    messageList: [],
    isLoadingMessages: false,
    isLoadingMore: false,
    hasMore: true,
    offset: 0,
  });

  // 恢复运行中消息后,useChatSend 的 isStreaming 不会被自动设为 true。
  // 这里独立跟踪"通过 recover 找到的 running message"状态,供 ChatView 合入
  // visibleIsStreaming / sendBlockedRef,让 stop 按钮、input 禁用等父层守卫生效。
  const [isRecoveredRunning, setIsRecoveredRunning] = useState(false);

  const stateRef = useRef(state);
  stateRef.current = state;
  const loadMoreRequestSeqRef = useRef(0);
  const loadMessageListRequestSeqRef = useRef(0);
  const loadMoreInFlightKeyRef = useRef<string | null>(null);
  const pendingLoadMoreDoneRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (state.isLoadingMore || !pendingLoadMoreDoneRef.current) return;
    const done = pendingLoadMoreDoneRef.current;
    pendingLoadMoreDoneRef.current = null;
    finishPullUpAfterRender(done);
  }, [state.isLoadingMore, state.messageList.length, state.offset, state.hasMore]);

  // 是否加载反馈（需要 loadFeedback 选项且 feedback adapter 存在）
  const shouldLoadFeedback = options?.loadFeedback && Boolean(adapters?.feedback);

  const loadMessages = useCallback(
    async (
      messages: any[],
      limit: number,
      skipFeedback: boolean = true,
      options?: { skillList?: any[]; mySkillList?: any[] }
    ): Promise<{ messages: Message[]; hasMore: boolean }> => {
      const validSkillList = options?.skillList || skillList;
      const validMySkillList = options?.mySkillList || mySkillList;

      try {
        const list: Message[] = [];

        for (const item of messages) {
          const message = JSONParse(
            item.message,
            typeof item.message === "string" ? [{ role: "user", content: item.message }] : []
          );
          const userMessage = message.find((item: any) => item.role === "user") || { content: "" };
          const userInfoList = supportSpecifiedContent
            ? message.filter((item: any) => item.role === "info")
            : [message.find((item: any) => item.role === "info")].filter(Boolean);

          let specified_files: SpecifiedFile[] = [];
          let specified_content = "";
          let uploaded_files: MessageFile[] = normalizeMessageFiles((item as any).uploaded_files);
          let questionText = "";

          const userContent: any = JSONParse(userMessage.content, null);

          if (Array.isArray(userContent)) {
            const textItem = userContent.find((item: any) => item?.type === "text");
            questionText = textItem?.content || "";

            // uploaded_files: 没有 library_id 的文件
            uploaded_files = userContent
              .filter((item: any) => item != null && item.type === "file" && !item.library_id)
              .map((fileItem: any) => {
                const fileId = fileItem.content?.replace("file_id:", "") || "";
                return {
                  id: fileId,
                  name: fileItem.filename || `文件 ${fileId}`,
                  filename: fileItem.filename || `文件 ${fileId}`,
                  size: fileItem.size,
                  mime_type: fileItem.mime_type,
                  preview_key: fileItem.preview_key,
                };
              });

            // specified_files: 有 library_id 的文件（从 userContent 解析）
            const userContentSpecifiedFiles = userContent
              .filter((item: any) => item != null && item.type === "file" && item.library_id)
              .map((fileItem: any) => {
                const fileId = fileItem.content?.replace("file_id:", "") || "";
                const file = formatFileInfo(fileItem.filename || "", fileItem.isfolder || fileItem.mime_type === 'folder');
                return {
                  icon: file.icon,
                  id: fileItem.file_id,
                  upload_file_id: fileId,
                  name: fileItem.filename,
                  file_name: fileItem.filename,
                  file_id: fileItem.file_id,
                  library_id: fileItem.library_id,
                  mime_type: fileItem.mime_type,
                  isfolder: fileItem.isfolder,
                  islibrary: fileItem.islibrary,
                };
              });
            specified_files = [...specified_files, ...userContentSpecifiedFiles];
          } else {
            const content = userMessage.content;
            questionText = typeof content === "string" ? content : (content?.text || content?.content || "");
          }

          const projectedSkill = normalizeMessageSkill((item as any).skill);
          let skill: Skill = projectedSkill || { skill_name: "", display_name: "" };
          if (!projectedSkill) {
            const { question: parsedQuestion, skill: parsedSkill } = parseQuestionWithSkill(
              questionText,
              { skillList: validSkillList, mySkillList: validMySkillList },
            );
            questionText = parsedQuestion;
            skill = parsedSkill;
          }

          let answer = "";
          let processedOutputFiles: any[] = [];
          if (item.process_records?.length > 0) {
            processedOutputFiles = processRecordsToOutputFiles(item.process_records);
          }
          answer = item.answer || "";

          // 从 info role 解析的 specified_files（追加到列表）
          userInfoList.forEach((userInfo: any) => {
            if (!userInfo) return;
            userInfo.content = JSONParse(userInfo.content, {});
            const infoType = userInfo.content?.type;

            if (infoType === "specified_files") {
              specified_files = [...specified_files, ...userInfo.content.list.map((fileItem: any) => {
                const file = formatFileInfo(fileItem.name, fileItem.isfolder)
                return {
                  icon: file.icon,
                  ...fileItem
                }
              })]
            } else if (infoType === "specified_content" && supportSpecifiedContent) {
              specified_content = userInfo.content.content || "";
            }
          });

          const initialFeedbackParams = {
            feedbackId: null,
            feedbackVisible: false,
            feedbackTypeOptions: null,
            submitBtnDisabled: true,
            feedbackSuccessful: false,
            feedback_type: "",
            feedbackLoading: !skipFeedback,
          };


          list.push({
            ...item,
            id: item.id,
            question: questionText,
            role: "assistant",
            skill,
            answer: answer?.split("<decision>DONE</decision>").join(""),
            rag_stats: formatRagStats(item.rag_stats, item.process_records),
            specified_files,
            uploaded_files,
            specified_content: supportSpecifiedContent ? specified_content : undefined,
            outputFiles: processedOutputFiles,
            ...initialFeedbackParams,
            error: answer?.includes("Access denied") || answer?.includes("InvalidApiKey") || false,
            // 历史数据显示时间
            showTime: true,
            created_time: item.created_time,
          });
        }

        return {
          messages: list,
          hasMore: list.length === limit,
        };
      } catch (err) {
        console.error("Failed to load messages:", err);
        return { messages: [], hasMore: false };
      }
    },
    [formatRagStats, supportSpecifiedContent, skillList, mySkillList]
  );

  // Batch load feedbacks in background
  const loadFeedbackBatch = useCallback(
    async (
      messageIds: (string | number)[],
      onUpdate: (id: string | number, feedback: any) => void
    ) => {
      if (!adapters?.feedback) return;

      const { api } = adapters.feedback;
      const results = await Promise.all(
        messageIds.map(id =>
          api.getFeedback({ message_id: id }).catch(() => {
            return null;
          })
        )
      );
      results.forEach((feedback, index) => {
        if (feedback) {
          onUpdate(messageIds[index], feedback);
        }
      });
    },
    [adapters]
  );

  // Regenerate answer
  // 异常向上传播到调用方页面级 handleRegenerate 包装与 React Error Boundary(finding #7)
  const handleRegenerate = useCallback(
    (message: Message, onSend: (params: RegenerateParams) => void) => {
      const params = parseRegenerateParams(message, options?.regenerate);
      onSend(params);
    },
    [options?.regenerate]
  );

  // Render source label
  const renderSource = useCallback((type: string, number: number, message: any) => {
    if (message.rag_stats?.type === "web_search") {
      return number;
    }
    return type + "-" + number;
  }, []);

  // Handle source reference hover
  const handleSourceReferenceHover = useCallback(
    (
      data: any,
      message: any,
      chunkRef: any,
      chunkSourceRef: any,
      graphRef?: any,
      graphSourceRef?: any
    ) => {
      const chunks = message.rag_stats?.chunks || [];
      const key = `[Source:${data.sourceType}-${data.sourceNumber}]`;
      const chunk = chunks.find((item: any) => item.source_key === key || item.source === key);
      if (chunk) {
        if (chunk.chunk_type === "graph_result") {
          if (graphSourceRef) {
            graphSourceRef.current = data.element;
          }
          graphRef?.current?.setLibraryInfo(chunk, message.rag_stats.type);
        } else {
          chunkSourceRef.current = data.element;
          chunkRef.current?.setLibraryInfo(chunk, message.rag_stats.type);
        }
      } else {
        chunkSourceRef.current = null;
        chunkRef.current?.setLibraryInfo(null, "");
      }
    },
    []
  );

  // Open knowledge base
  const handleOpenKnow = useCallback(
    (
      message: any,
      thinkknowledgeRef: any,
      setShowThinkKnowledge: (value: boolean) => void
    ) => {
      setShowThinkKnowledge(true);
      setTimeout(() => {
        thinkknowledgeRef.current?.updateResults(
          message.rag_stats?.files_search,
          message.rag_stats?.type
        );
      }, 0);
    },
    []
  );

  const handleLoadListMore = useCallback(
    async (
      done: () => void,
      conversationId: string,
      apiOrOptions?: LoadMessagesApi | { skillList?: any[]; mySkillList?: any[] },
      maybeOptions?: { skillList?: any[]; mySkillList?: any[] }
    ): Promise<void> => {
      const { loadMessagesApi: overrideLoadMessagesApi, options } =
        splitLoadMessagesArgs(apiOrOptions, maybeOptions);
      const loadMessagesApi = requireLoadMessagesApi(overrideLoadMessagesApi || providerLoadMessagesApi);
      const currentState = stateRef.current;
      if (currentState.isLoadingMore || !currentState.hasMore) return finishPullUpAfterRender(done);

      if (!conversationId) return finishPullUpAfterRender(done);

      const newOffset = currentState.offset + limit;
      const inFlightKey = `${conversationId}:${newOffset}:${limit}`;
      if (loadMoreInFlightKeyRef.current === inFlightKey) {
        return finishPullUpAfterRender(done);
      }
      loadMoreInFlightKeyRef.current = inFlightKey;

      const requestSeq = loadMoreRequestSeqRef.current + 1;
      loadMoreRequestSeqRef.current = requestSeq;
      const messageListRequestSeq = loadMessageListRequestSeqRef.current;
      setState((prev) => ({ ...prev, isLoadingMore: true }));

      let loadingSettled = false;

      try {
        const res = await loadMessagesApi(conversationId, { offset: newOffset, limit });
        const { messages, hasMore } = await loadMessages(res.data?.messages || res.messages || [], limit, true, options);
        const responseHasMore = readPaginationHasMore(res);
        const responseNextOffset = readPaginationNextOffset(res);
        traceOpenClawMessages("load-more", messages);

        if (
          requestSeq !== loadMoreRequestSeqRef.current ||
          messageListRequestSeq !== loadMessageListRequestSeqRef.current
        ) {
          return finishPullUpAfterRender(done);
        }
        pendingLoadMoreDoneRef.current = done;
        loadingSettled = true;
        setState((prev) => {
          const merged = prependUniqueMessages(messages, prev.messageList);
          return {
            ...prev,
            isLoadingMore: false,
            hasMore: merged.addedCount > 0 ? responseHasMore ?? hasMore : false,
            offset: Math.max(prev.offset, responseNextOffset ?? newOffset),
            messageList: merged.messages,
          };
        });

        // Background load feedbacks
        if (shouldLoadFeedback) {
          const ids = messages.map((m: any) => m.id);
          loadFeedbackBatch(ids, (id, feedback) => {
            setState((prev) => ({
              ...prev,
              messageList: prev.messageList.map(msg =>
                msg.id === id ? createFeedbackUpdater(feedback)(msg as Message) as Message : msg
              ),
            }));
          });
        }
      } catch (err) {
        if (
          requestSeq !== loadMoreRequestSeqRef.current ||
          messageListRequestSeq !== loadMessageListRequestSeqRef.current
        ) {
          return finishPullUpAfterRender(done);
        }
        pendingLoadMoreDoneRef.current = done;
        loadingSettled = true;
        setState((prev) => ({
          ...prev,
          isLoadingMore: false,
          offset: Math.max(0, prev.offset - limit),
        }));
      } finally {
        if (loadMoreInFlightKeyRef.current === inFlightKey) {
          loadMoreInFlightKeyRef.current = null;
        }
        if (
          !loadingSettled &&
          requestSeq === loadMoreRequestSeqRef.current &&
          messageListRequestSeq === loadMessageListRequestSeqRef.current
        ) {
          setState((prev) => ({ ...prev, isLoadingMore: false }));
        }
      }
    },
    [limit, loadMessages, providerLoadMessagesApi, shouldLoadFeedback, loadFeedbackBatch]
  );

  const loadMessageList = useCallback(
    async (
      conversationId: string,
      apiOrOptions?: LoadMessagesApi | LoadMessageListOptions,
      maybeOptions?: LoadMessageListOptions
    ) => {
      const { loadMessagesApi: overrideLoadMessagesApi, options } =
        splitLoadMessagesArgs(apiOrOptions, maybeOptions);
      const loadMessagesApi = requireLoadMessagesApi(overrideLoadMessagesApi || providerLoadMessagesApi);
      const silent = Boolean(options?.silent);
      const requestSeq = loadMessageListRequestSeqRef.current + 1;
      loadMessageListRequestSeqRef.current = requestSeq;
      loadMoreRequestSeqRef.current += 1;
      loadMoreInFlightKeyRef.current = null;
      setState((prev) => ({
        ...prev,
        isLoadingMessages: silent ? prev.isLoadingMessages : true,
        isLoadingMore: false,
        offset: silent ? prev.offset : 0,
        hasMore: silent ? prev.hasMore : true,
      }));

      try {
        const res = await loadMessagesApi(conversationId, { offset: 0, limit });

        const rawInput = res.data?.messages || res.messages || [];
        const { messages, hasMore } = await loadMessages(rawInput, limit, true, options);
        const responseHasMore = readPaginationHasMore(res);
        traceOpenClawMessages("load-list", messages);

        if (requestSeq !== loadMessageListRequestSeqRef.current) {
          return [];
        }

        const isActiveRun = options?.isRunning;
        const runningMessageId = options?.runningMessageId;
        if (isActiveRun && runningMessageId && messages.length > 0) {
          const targetIndex = messages.findIndex((m: any) => m.id === runningMessageId);
          if (targetIndex !== -1) {
            messages[targetIndex] = {
              ...messages[targetIndex],
              reasoning_content: "",
              answer: "",
              process_records: [],
              skillRunItems: [],
              outputFiles: [],
              rag_temp: {},
              rag_stats: undefined,
              rag_search_text: "",
              loading: true,
            };
          }
        }

        const messagesWithMeta = attachOpenClawHistoryMeta(messages, res);

        setState((prev) => {
          const shouldMerge =
            silent ||
            shouldMergeOpenClawHistoryLoad(conversationId, prev.messageList, messagesWithMeta);
          return {
            ...prev,
            hasMore: silent ? prev.hasMore : responseHasMore ?? hasMore,
            messageList: shouldMerge
              ? mergeOpenClawMessages(prev.messageList, messagesWithMeta, {
                  preferExistingAnswer: shouldPreferExistingOpenClawAnswer(messagesWithMeta),
                })
              : messagesWithMeta,
          };
        });

        // Background load feedbacks
        if (shouldLoadFeedback) {
          const ids = messagesWithMeta.map((m: any) => m.id);
          loadFeedbackBatch(ids, (id, feedback) => {
            setState((prev) => ({
              ...prev,
              messageList: prev.messageList.map(msg =>
                msg.id === id ? createFeedbackUpdater(feedback)(msg as Message) as Message : msg
              ),
            }));
          });
        }

        return messagesWithMeta;
      } finally {
        if (!silent && requestSeq === loadMessageListRequestSeqRef.current) {
          setState((prev) => ({ ...prev, isLoadingMessages: false }));
        }
      }
    },
    [limit, loadMessages, providerLoadMessagesApi, shouldLoadFeedback, loadFeedbackBatch]
  );

  const clearMessageList = useCallback(() => {
    loadMessageListRequestSeqRef.current += 1;
    loadMoreRequestSeqRef.current += 1;
    loadMoreInFlightKeyRef.current = null;
    setState((prev) => ({
      ...prev,
      messageList: [],
      isLoadingMessages: false,
      offset: 0,
      hasMore: true,
    }));
  }, []);

  const updateMessageList = useCallback((updater: (list: Message[]) => Message[]) => {
    setState((prev) => {
      const newList = updater(prev.messageList);
      const deduped = [...new Map(newList.map((m) => [m.id, m])).values()];
      return {
        ...prev,
        messageList: deduped,
      };
    });
  }, []);

  const addMessage = useCallback((message: Message) => {
    setState((prev) => ({
      ...prev,
      messageList: [...prev.messageList, message],
    }));
  }, []);

  const updateMessage = useCallback((id: string | number, updater: (msg: Message) => Message) => {
    setState((prev) => ({
      ...prev,
      messageList: prev.messageList.map((msg) => (msg.id === id ? updater(msg) : msg)),
    }));
  }, []);

  /**
   * 恢复运行中的消息（页面刷新后）
   *
   * 行为由 options.skipReload 决定：
   * - true（调用方已预加载消息列表）：只通过 setState 标记目标 message 为 loading
   * - false（默认）：调用 loadMessageList 加载最新消息（包括 SSE 历史事件），
   *   并通过 isRunning/runningMessageId 把目标消息标 loading
   */
  const recoverRunningMessage = useCallback(
    async (
      conversationId: string,
      callbacks?: RecoverCallbacks,
      options?: { skipReload?: boolean; onMessageLoaded?: (list: Message[]) => void },
    ): Promise<boolean> => {
      if (!agentRun.enabled) {
        return false;
      }

      // 重置上一次会话可能残留的 recovered running 状态,避免跨会话脏标记
      setIsRecoveredRunning(false);

      const result = await agentRun.recover(conversationId, {
        onStart: callbacks?.onStart,
        onMessage: async (isRunning, messageId) => {
          callbacks?.onMessage?.(isRunning, messageId);

          // 同步 recovered running 状态:useChatSend 不会被外部触发,这里独立驱动
          // ChatView 的 visibleIsStreaming / sendBlockedRef
          if (isRunning && messageId) {
            setIsRecoveredRunning(true);
          } else if (isRunning === false) {
            setIsRecoveredRunning(false);
          }

          if (options?.skipReload) {
            // 已在外部预加载消息列表，仅标记目标 message 为 loading
            if (isRunning && messageId) {
              setState((prev) => ({
                ...prev,
                messageList: prev.messageList.map((msg) =>
                  msg.id === messageId
                    ? { ...msg, loading: true, answer: '', reasoning_content: '', process_records: [] }
                    : msg
                ),
              }));
            }
            return;
          }

          // 加载最新消息:必须 await——useAgentRun.recover 在 onMessage 完成后才会
          // setEvents(historyEvents),如果 messageList 还没就绪就 setEvents,
          // 下面监听 events 的 useEffect 会因 targetIndex === -1 提前返回,
          // 把整批 replay 事件丢掉(silently dropped)。
          if (isRunning && messageId) {
            const list = await loadMessageList(conversationId, {
              isRunning: true,
              runningMessageId: messageId,
            });
            options?.onMessageLoaded?.(list);
          } else if (isRunning === false) {
            const list = await loadMessageList(conversationId);
            options?.onMessageLoaded?.(list);
          }
        },
      });

      return result.isrunning;
    },
    [agentRun, loadMessageList],
  );

  // 监听 agentRun events 增量更新消息
  // - lastAppliedSeqRef 记录上次应用的最后一个 event.seq，
  //   避免每次 SSE tick 都对完整 event 数组重新 apply（O(n²) → O(delta)）。
  // - messageId 变化（重连/换 run）时重置 ref。
  // - applyAgentRunEvents 是纯函数，返回新 Message，不修改入参。
  const lastAppliedSeqRef = useRef(0);
  const lastAppliedMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!agentRun.enabled || !agentRun.events.length) return;

    // 终态事件到达时,清掉 recovered running 标记,让 UI 恢复 idle
    const lastEvent = agentRun.events[agentRun.events.length - 1];
    if (lastEvent && AGENT_RUN_TERMINAL_EVENTS.includes(lastEvent.type)) {
      setIsRecoveredRunning(false);
    }

    const messageId = agentRun.currentRun?.message_id;
    if (!messageId) return;

    // 重连/换 run：重置 seq 游标
    if (lastAppliedMessageIdRef.current !== messageId) {
      lastAppliedSeqRef.current = 0;
      lastAppliedMessageIdRef.current = messageId;
    }

    // 只取尚未应用的 events
    const newEvents = agentRun.events.filter(
      (e) => e.seq > lastAppliedSeqRef.current,
    );
    if (newEvents.length === 0) return;

    setState((prev) => {
      const targetIndex = prev.messageList.findIndex((m) => m.id === messageId);
      if (targetIndex === -1) return prev;

      const newMessage = applyAgentRunEvents(
        prev.messageList[targetIndex],
        newEvents,
      );

      const newList = [...prev.messageList];
      newList[targetIndex] = newMessage;
      // 仅在 applyAgentRunEvents 真正执行后才推进 seq,
      // 避免 messageList 还没就绪时把整批事件提前丢掉。
      lastAppliedSeqRef.current = newEvents[newEvents.length - 1].seq;
      return { ...prev, messageList: newList };
    });
  }, [agentRun.events, agentRun.currentRun, agentRun.enabled]);

  /**
   * 重置 recovered running 标记,用于"新建会话"路径:用户在"recover 找到的
   * 运行中消息"状态下点新建,应立即清掉这个状态让 Sender 退出 loading。
   * 不影响 agent run 的远端 cancel(那是 agentRun.cancel 的职责)。
   */
  const clearRecoveredRunning = useCallback(() => {
    setIsRecoveredRunning(false);
  }, []);

  return {
    state,
    loadMessages,
    handleLoadListMore,
    loadMessageList,
    handleRegenerate,
    renderSource,
    handleSourceReferenceHover,
    handleOpenKnow,
    clearMessageList,
    updateMessageList,
    addMessage,
    updateMessage,
    recoverRunningMessage,
    /**
     * recover 找到运行中消息时为 true,直到 SSE 终态事件到达自动 reset。
     * 用于驱动 ChatView 的 visibleIsStreaming / sendBlockedRef,使刷新页面后
     * 仍能继续看到流式光标、停止按钮、输入禁用等 UI 反馈。
     */
    isRecoveredRunning,
    clearRecoveredRunning,
  };
}

export default useChatMessages;
