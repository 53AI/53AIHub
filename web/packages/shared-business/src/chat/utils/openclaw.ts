import { hasConversationId } from "./openclaw-chatview-helpers";

type OpenClawAgentLike = {
  agent_id?: string | number | null;
  agent_type?: string | number | null;
  channel_type?: string | number | null;
  custom_config_obj?: {
    agent_type?: unknown;
  } | null;
} | null | undefined;

export function isOpenClawConversationId(conversationId?: string | number | null): boolean {
  if (typeof conversationId !== "string") return false;
  return (
    conversationId.startsWith("agent:") ||
    conversationId.startsWith("agenthub_") ||
    conversationId.startsWith("agenthub-") ||
    isOpenClawPendingConversationId(conversationId)
  );
}

export function isOpenClawPendingConversationId(conversationId?: string | number | null): boolean {
  return typeof conversationId === "string" && conversationId.startsWith("hub53ai:new:");
}

export function createOpenClawPendingConversationId(): string {
  const randomId =
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `hub53ai:new:${randomId}`;
}

export function shouldStartOpenClawBlankConversation(input: {
  openclaw?: boolean;
  initialConversationId?: string | number | null;
}): boolean {
  return Boolean(input.openclaw) && !hasConversationId(input.initialConversationId);
}

export function isOpenClawAgentForRoute(input: {
  currentAgent: OpenClawAgentLike;
  agentId?: string | number | null;
  openClawChannelType: string | number;
}): boolean {
  const { currentAgent, agentId, openClawChannelType } = input;
  const currentAgentId = currentAgent?.agent_id;
  const currentAgentChannelType = currentAgent?.channel_type;

  if (currentAgentId == null || agentId == null || currentAgentChannelType == null) {
    return false;
  }

  return String(currentAgentId) === String(agentId) && Number(currentAgentChannelType) === Number(openClawChannelType);
}

export function shouldUseOpenClawChatAdapter(input: {
  currentAgent: OpenClawAgentLike;
  agentId?: string | number | null;
  openClawChannelType: string | number;
  routeType?: string | null;
  conversationId?: string | number | null;
}): boolean {
  if (isOpenClawAgentForRoute({
    currentAgent: input.currentAgent,
    agentId: input.agentId,
    openClawChannelType: input.openClawChannelType,
  })) {
    return true;
  }

  const routeRequestsOpenClaw =
    input.routeType === "openclaw" ||
    isOpenClawConversationId(input.conversationId);
  if (!routeRequestsOpenClaw) return false;

  const currentAgentId = input.currentAgent?.agent_id;
  if (currentAgentId == null || input.agentId == null) return true;
  if (String(currentAgentId) !== String(input.agentId)) return true;

  return input.currentAgent?.channel_type == null;
}

export function shouldUseOpenClawRouteType(
  isOpenClawMode?: boolean,
  conversationId?: string | number | null
): boolean {
  return Boolean(isOpenClawMode) || isOpenClawConversationId(conversationId);
}

export function isOpenClawStatusAssistantContent(content?: string | null): boolean {
  const normalized = String(content || "").trim().replace(/\s+/g, " ").toLowerCase();
  return normalized === "⚙️ reasoning visibility enabled." ||
    normalized === "reasoning visibility enabled.";
}

export function isOpenClawDiscardableAssistantContent(content?: string | null): boolean {
  const normalized = String(content || "").trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) return true;
  if (isOpenClawStatusAssistantContent(content)) return true;
  return normalized === "no_reply" ||
    normalized === "no reply" ||
    normalized === "no" ||
    normalized === "heartbeat_ok";
}

function normalizeWithSourceMap(value: string): { text: string; sourceIndexes: number[] } {
  const chars: string[] = [];
  const sourceIndexes: number[] = [];
  let lastWasSpace = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (/\s/.test(char)) {
      if (!lastWasSpace && chars.length > 0) {
        chars.push(" ");
        sourceIndexes.push(index);
        lastWasSpace = true;
      }
      continue;
    }

    chars.push(char.toLowerCase());
    sourceIndexes.push(index);
    lastWasSpace = false;
  }

  if (chars.at(-1) === " ") {
    chars.pop();
    sourceIndexes.pop();
  }

  return { text: chars.join(""), sourceIndexes };
}

function getReasoningOverlapMinLength(value: string): number {
  return /[\u3400-\u9fff]/.test(value) ? 6 : 12;
}

function stripReasoningPrefix(content: string, reasoning: string): string {
  const answer = content.trimStart();
  const thought = reasoning.trim();
  const minOverlapLength = getReasoningOverlapMinLength(`${answer}${thought}`);

  if (!answer || !thought) return content;
  if (answer.length >= minOverlapLength && thought.includes(answer)) return "";
  if (answer.startsWith(thought)) return answer.slice(thought.length).trimStart();

  const maxOverlapLength = Math.min(answer.length, thought.length);
  for (let length = maxOverlapLength; length >= minOverlapLength; length -= 1) {
    if (thought.endsWith(answer.slice(0, length))) {
      return answer.slice(length).trimStart();
    }
  }

  const normalizedAnswer = normalizeWithSourceMap(answer);
  const normalizedThought = normalizeWithSourceMap(thought);
  if (normalizedAnswer.text.length >= minOverlapLength && normalizedThought.text.includes(normalizedAnswer.text)) {
    return "";
  }

  const maxNormalizedOverlap = Math.min(normalizedAnswer.text.length, normalizedThought.text.length);
  for (let length = maxNormalizedOverlap; length >= minOverlapLength; length -= 1) {
    if (normalizedThought.text.endsWith(normalizedAnswer.text.slice(0, length))) {
      const rawEndIndex = normalizedAnswer.sourceIndexes[length - 1];
      return answer.slice(rawEndIndex + 1).trimStart();
    }
  }

  return content;
}

export function stripOpenClawReasoningPrefixOnly(content: string, reasoning: string): string {
  return stripReasoningPrefix(content, reasoning);
}

function splitReasoningCandidates(reasoning: string): string[] {
  const cleaned = reasoning.trim();
  if (!cleaned) return [];

  const withoutDefaultPrefix = cleaned.replace(/^正在处理您的请求[.…...]*\s*/u, "").trim();
  const sentenceParts = cleaned
    .split(/(?<=[.!?。！？])\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);

  const candidates = [cleaned, withoutDefaultPrefix, ...sentenceParts];
  return [...new Set(candidates)]
    .filter((part) => part.length >= getReasoningOverlapMinLength(part))
    .sort((left, right) => right.length - left.length);
}

function removeReasoningCandidate(content: string, candidate: string): string {
  if (!content || !candidate) return content;
  if (content.includes(candidate)) {
    return content.split(candidate).join("");
  }

  const normalizedContent = normalizeWithSourceMap(content);
  const normalizedCandidate = normalizeWithSourceMap(candidate).text;
  if (normalizedCandidate.length < getReasoningOverlapMinLength(candidate)) {
    return content;
  }

  const matchIndex = normalizedContent.text.indexOf(normalizedCandidate);
  if (matchIndex === -1) {
    return content;
  }

  const start = normalizedContent.sourceIndexes[matchIndex] ?? 0;
  const end = normalizedContent.sourceIndexes[matchIndex + normalizedCandidate.length - 1] ?? start;
  return `${content.slice(0, start)}${content.slice(end + 1)}`;
}

function cleanupReasoningRemovalBoundaries(content: string): string {
  return content
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+([，。！？、,.!?;；:：])/g, "$1")
    .replace(/([，。！？、；：])\s+([\u3400-\u9fff])/g, "$1$2")
    .trimStart();
}

export function sanitizeOpenClawAnswer(content: string, reasoning: string): string {
  let answer = stripReasoningPrefix(content, reasoning);
  const candidates = splitReasoningCandidates(reasoning);

  for (const candidate of candidates) {
    const next = removeReasoningCandidate(answer, candidate);
    if (next !== answer) {
      answer = cleanupReasoningRemovalBoundaries(next);
    }
  }

  return answer;
}
