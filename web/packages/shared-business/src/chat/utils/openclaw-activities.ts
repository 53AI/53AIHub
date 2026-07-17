import type { OpenClawActivityItem, OpenClawActivityTone } from "../types";

/** OpenClaw 时间线事件（强类型，id/kind 必填） */
export interface OpenClawTimelineEvent {
  id: string;
  sessionId?: string;
  seq?: number;
  kind: string;
  payload?: Record<string, unknown>;
  createdAt?: string;
}

/** 弱类型别名（id/kind 全部 optional），用于 partial 形态的事件入参 */
export type OpenClawTimelineEventLike = OpenClawTimelineEvent;

const ACTIVITY_EVENT_KINDS = new Set([
  "assistant.thinking",
  "tool.call",
  "tool.result",
  "run.completed",
  "run.failed",
  "run.interrupted",
]);

const HUB_THINKING_PLACEHOLDERS = new Set([
  "used a tool",
  "tool returned a result",
  "正在处理您的请求...",
  "正在处理您的请求…",
]);

const HUB_NAMED_TOOL_PLACEHOLDER_PATTERNS = [
  /^used tool\b/i,
  /^tool .+ returned a result$/i,
];

export function isOpenClawActivityEvent(event?: OpenClawTimelineEventLike | null): boolean {
  return ACTIVITY_EVENT_KINDS.has(String(event?.kind || ""));
}

export function isOpenClawToolPlaceholderThinkingText(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  if (HUB_THINKING_PLACEHOLDERS.has(normalized.toLowerCase())) {
    return true;
  }
  return HUB_NAMED_TOOL_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readStringValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (!Array.isArray(value)) continue;

    const text = value
      .flatMap((entry) => {
        const record = toRecord(entry);
        return [record.text, record.content, record.thinking, record.reasoning].filter(
          (item): item is string => typeof item === "string"
        );
      })
      .map((item) => item.trim())
      .filter(Boolean)
      .join("\n\n");
    if (text) return text;
  }

  return "";
}

function formatDetail(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") return value.trim();

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function titleCaseToolName(value: string): string {
  const normalized = value.replace(/[_-]+/g, " ").trim();
  if (!normalized) return "Tool";
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatToolTitle(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.replace(/^([a-z])/, (char) => char.toUpperCase());
}

function readNested(payload: Record<string, unknown>, ...paths: string[][]): unknown {
  for (const path of paths) {
    let current: unknown = payload;
    for (const key of path) {
      current = toRecord(current)[key];
    }
    if (current !== undefined && current !== null && current !== "") {
      return current;
    }
  }
  return undefined;
}

function readToolInputValue(payload: Record<string, unknown>): unknown {
  return readNested(payload, ["data", "args"], ["data", "arguments"], ["data", "input"], ["args"], ["arguments"], ["input"]);
}

function readToolOutputValue(payload: Record<string, unknown>): unknown {
  return readNested(
    payload,
    ["data", "result", "details"],
    ["data", "result", "output"],
    ["data", "result", "content"],
    ["data", "result", "result"],
    ["data", "result", "aggregated"],
    ["data", "result"],
    ["data", "details", "aggregated"],
    ["data", "details", "output"],
    ["data", "details", "content"],
    ["data", "output"],
    ["data", "content"],
    ["result", "details"],
    ["result", "output"],
    ["result", "content"],
    ["result", "result"],
    ["result", "aggregated"],
    ["result"],
    ["details", "aggregated"],
    ["details", "output"],
    ["details", "content"],
    ["output"],
    ["content"]
  );
}

function readToolArgs(inputValue: unknown): Record<string, unknown> {
  return toRecord(parseMaybeJson(inputValue));
}

function readRecordString(record: Record<string, unknown>, ...keys: string[]): string {
  return readStringValue(...keys.map((key) => record[key]));
}

function readRecordNumber(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function normalizeToolKind(rawName: string, displayName: string): string {
  const source = (rawName || displayName).replace(/\s+/g, "_").trim().toLowerCase();
  const parts = source.split("__").filter(Boolean);
  return (parts[parts.length - 1] || source).replace(/[^a-z0-9_.-]+/g, "_");
}

function isExecToolKind(kind: string): boolean {
  return kind === "exec" || kind === "bash" || kind === "shell" || kind === "run_command";
}

function countTextCharacters(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  return Array.from(value).length;
}

function summarizeWriteTool(args: Record<string, unknown>): string {
  const path = readRecordString(args, "path", "filePath", "file_path", "target", "targetPath", "target_path");
  if (!path) return "";
  const explicitCount = readRecordNumber(args, "chars", "charCount", "char_count", "characterCount", "character_count");
  const contentCount = countTextCharacters(args.content ?? args.text ?? args.body);
  const count = explicitCount ?? contentCount;
  return count === undefined ? `to ${path}` : `to ${path} (${count} chars)`;
}

function summarizeReadTool(args: Record<string, unknown>): string {
  const path = readRecordString(args, "path", "filePath", "file_path", "source", "sourcePath", "source_path");
  return path ? `from ${path}` : "";
}

function summarizeSearchTool(args: Record<string, unknown>): string {
  const query = readRecordString(args, "query", "q", "search", "keywords", "term");
  if (!query) return "";
  const count = readRecordNumber(args, "count", "limit", "topK", "top_k", "numResults", "num_results");
  return count === undefined ? `for "${query}"` : `for "${query}" (top ${count})`;
}

function summarizeFetchTool(args: Record<string, unknown>): string {
  const url = readRecordString(args, "url", "targetUrl", "target_url", "href", "uri");
  return url ? `from ${url}` : "fetch url";
}

function firstCommandName(command: string): string {
  const match = command.match(/^\s*(?:env\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(?:sudo\s+)?([^\s"'|&;]+)/);
  const token = match?.[1]?.trim() || "";
  if (!token) return "";
  return token.split("/").filter(Boolean).pop() || token;
}

function summarizeCommand(command: string): string {
  const normalized = command.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const lower = normalized.toLowerCase();

  if (/\b(curl|wget)\b/.test(lower) && /(https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,})/i.test(normalized)) {
    return "fetch url";
  }
  if (/^\s*(echo|printf)\b/i.test(normalized) && /\|\s*wc\b/i.test(normalized)) {
    return "print text -> run wc";
  }

  const inlinePython = normalized.match(/\b(python(?:\d+(?:\.\d+)?)?)\s+-c\b/i);
  if (inlinePython?.[1]) {
    return `run ${inlinePython[1]} inline script`;
  }

  const commandName = firstCommandName(normalized);
  return commandName ? `run ${commandName}` : "run command";
}

const EXEC_COMMAND_KEYS = [
  "command",
  "cmd",
  "script",
  "shell",
  "commandLine",
  "command_line",
  "code",
];

function normalizeCommandText(value: string): string {
  const trimmed = value.replace(/\r\n/g, "\n").trim();
  const withoutPrompt = trimmed.replace(/^\$\s+/, "").trim();
  const normalized = withoutPrompt.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized || normalized === "exec" || normalized === "used exec" || normalized === "used tool" || normalized === "tool output") {
    return "";
  }
  return withoutPrompt;
}

function readCommandFromRecord(record: Record<string, unknown>): string {
  return normalizeCommandText(readRecordString(record, ...EXEC_COMMAND_KEYS));
}

function toParsedRecord(value: unknown): Record<string, unknown> {
  return toRecord(parseMaybeJson(value));
}

function commandFromUnknown(value: unknown): string {
  if (typeof value === "string") {
    const parsed = parseMaybeJson(value);
    if (parsed !== value) {
      const nestedCommand = commandFromUnknown(parsed);
      if (nestedCommand) return nestedCommand;
    }
    return normalizeCommandText(value);
  }
  const record = toRecord(value);
  if (!Object.keys(record).length) return "";
  return (
    readCommandFromRecord(record) ||
    commandFromUnknown(record.input) ||
    commandFromUnknown(record.args) ||
    commandFromUnknown(record.arguments) ||
    commandFromUnknown(record.parameters) ||
    commandFromUnknown(record.options)
  );
}

function extractBacktickCommand(value: unknown): string {
  if (typeof value !== "string") return "";
  const matches = [...value.matchAll(/`([^`]+)`/g)];
  for (const match of matches) {
    const command = normalizeCommandText(match[1] || "");
    if (command) return command;
  }
  return "";
}

function readExecCommand({
  payload,
  data,
  args,
  inputValue,
}: {
  payload: Record<string, unknown>;
  data: Record<string, unknown>;
  args: Record<string, unknown>;
  inputValue: unknown;
}): string {
  const direct =
    readCommandFromRecord(args) ||
    readCommandFromRecord(data) ||
    readCommandFromRecord(payload) ||
    commandFromUnknown(inputValue);
  if (direct) return direct;

  const nestedValues = [
    data.input,
    data.args,
    data.arguments,
    data.parameters,
    data.toolInput,
    data.tool_input,
    payload.input,
    payload.args,
    payload.arguments,
    payload.parameters,
    payload.toolInput,
    payload.tool_input,
    toParsedRecord(data.function).arguments,
    toParsedRecord(payload.function).arguments,
  ];
  for (const value of nestedValues) {
    const command = commandFromUnknown(value);
    if (command) return command;
  }

  return (
    extractBacktickCommand(data.meta) ||
    extractBacktickCommand(payload.meta) ||
    extractBacktickCommand(data.summary) ||
    extractBacktickCommand(payload.summary) ||
    extractBacktickCommand(data.detail) ||
    extractBacktickCommand(payload.detail)
  );
}

function summarizeExecTool(args: Record<string, unknown>, inputValue: unknown, command?: string): string {
  const resolvedCommand = command || readRecordString(args, ...EXEC_COMMAND_KEYS) || readStringValue(inputValue);
  if (!resolvedCommand) return "";
  const normalizedCommand = normalizeCommandText(resolvedCommand);
  if (!normalizedCommand) return "";
  return summarizeCommand(normalizedCommand);
}

function normalizeToolTitleForComparison(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function isGenericToolDisplayTitle(title: string, rawName: string, displayName: string): boolean {
  const normalized = normalizeToolTitleForComparison(title);
  if (!normalized) return true;

  const raw = normalizeToolTitleForComparison(titleCaseToolName(rawName));
  const display = normalizeToolTitleForComparison(displayName);
  return [
    "tool",
    "tool call",
    "used tool",
    raw,
    display,
    raw ? `used ${raw}` : "",
    display ? `used ${display}` : "",
  ].filter(Boolean).includes(normalized);
}

function buildToolDisplayTitle({
  payload,
  data,
  rawName,
  displayName,
  args,
  inputValue,
  execCommand,
}: {
  payload: Record<string, unknown>;
  data: Record<string, unknown>;
  rawName: string;
  displayName: string;
  args: Record<string, unknown>;
  inputValue: unknown;
  execCommand?: string;
}): string {
  const explicitTitle = readStringValue(
    data.toolDisplayTitle,
    data.tool_display_title,
    data.displayTitle,
    data.display_title,
    payload.toolDisplayTitle,
    payload.tool_display_title,
    payload.displayTitle,
    payload.display_title,
    data.title,
    payload.title
  );

  const kind = normalizeToolKind(rawName, displayName);
  let derivedTitle = "";
  if (kind === "write" || kind === "write_file" || kind === "create_file") {
    derivedTitle = summarizeWriteTool(args);
  }
  if (kind === "read" || kind === "read_file") {
    derivedTitle = derivedTitle || summarizeReadTool(args);
  }
  if (kind === "web_search" || kind === "search" || kind === "online_search") {
    derivedTitle = derivedTitle || summarizeSearchTool(args);
  }
  if (kind === "web_fetch" || kind === "fetch" || kind === "fetch_url") {
    derivedTitle = derivedTitle || summarizeFetchTool(args);
  }
  if (isExecToolKind(kind)) {
    derivedTitle = derivedTitle || summarizeExecTool(args, inputValue, execCommand);
  }

  const explicitTitleIsGeneric = explicitTitle ? isGenericToolDisplayTitle(explicitTitle, rawName, displayName) : false;
  if (explicitTitle && !explicitTitleIsGeneric) {
    return formatToolTitle(explicitTitle);
  }
  if (derivedTitle) {
    return formatToolTitle(derivedTitle);
  }
  if (explicitTitle && !isExecToolKind(kind)) {
    return formatToolTitle(explicitTitle);
  }

  return "";
}

export function getOpenClawEventReasoningText(event: OpenClawTimelineEventLike): string {
  if (event.kind !== "assistant.thinking") return "";
  const payload = toRecord(event.payload);
  const text = readStringValue(
    payload.content,
    payload.reasoning,
    payload.reasoningText,
    payload.reasoning_content,
    payload.thinking,
    payload.thinkingText
  );
  if (isOpenClawToolPlaceholderThinkingText(text)) {
    return "";
  }
  return text;
}

function buildToolActivity(event: OpenClawTimelineEventLike): OpenClawActivityItem {
  const payload = toRecord(event.payload);
  const data = toRecord(payload.data);
  const result = toRecord(data.result || payload.result);
  const toolCallId = readStringValue(
    data.toolCallId,
    data.tool_call_id,
    data.callId,
    data.id,
    payload.toolCallId,
    payload.tool_call_id,
    payload.callId
  );
  const rawName = readStringValue(
    data.name,
    data.toolName,
    data.tool_name,
    data.tool,
    result.tool,
    payload.tool,
    payload.toolName,
    payload.tool_name,
    payload.name
  );
  const displayName = readStringValue(data.displayName, data.display_name, data.display, result.displayName, result.display_name) ||
    titleCaseToolName(rawName);
  const inputValue = readToolInputValue(payload);
  const args = readToolArgs(inputValue);
  const kind = normalizeToolKind(rawName, displayName);
  const execCommand = isExecToolKind(kind) ? readExecCommand({ payload, data, args, inputValue }) : "";
  const isToolResult = event.kind === "tool.result";
  const displayTitle = isToolResult
    ? ""
    : buildToolDisplayTitle({
        payload,
        data,
        rawName,
        displayName,
        args,
        inputValue,
        execCommand,
      });
  const input = isToolResult ? "" : formatDetail(isExecToolKind(kind) ? execCommand || inputValue : inputValue);
  const output = formatDetail(readToolOutputValue(payload));
  const isError = Boolean(data.isError || data.is_error || result.isError || result.is_error || payload.isError || payload.is_error);
  const tone: OpenClawActivityTone = isError ? "error" : event.kind === "tool.result" ? "success" : "neutral";
  const fallbackTitle = isExecToolKind(kind) ? displayName : `Used ${displayName}`;
  const title = isToolResult ? "Tool output" : formatToolTitle(displayTitle || fallbackTitle);
  const fallbackSummary = isToolResult ? `Tool output: ${displayName}` : title;
  const summary = readStringValue(payload.summary, data.summary, output) || fallbackSummary;
  const meta = isToolResult && output ? "" : formatDetail(data.meta || payload.meta);

  return {
    key: event.id || `${event.kind}:${event.seq || ""}:${event.createdAt || ""}`,
    sessionId: event.sessionId,
    seq: event.seq,
    kind: String(event.kind || ""),
    title,
    summary,
    createdAt: event.createdAt,
    tone,
    tool: {
      toolCallId,
      name: rawName,
      displayName,
      meta,
      input,
      output,
      isError,
    },
  };
}

function normalizeActivityText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function getActivityMergeKey(item: OpenClawActivityItem): string {
  if (item.kind === "run.completed" || item.kind === "run.failed" || item.kind === "run.interrupted") {
    return "run.terminal";
  }

  const summary = normalizeActivityText(item.summary || item.detail || "");
  if (item.kind === "assistant.thinking" && summary) {
    return `assistant.thinking:${summary}`;
  }

  const toolName = normalizeActivityText(item.tool?.name || item.tool?.displayName || "");
  const toolInput = normalizeActivityText(item.tool?.input || "");
  const toolOutput = normalizeActivityText(item.tool?.output || "");
  const toolCallId = normalizeActivityText(item.tool?.toolCallId || "");
  if (item.kind.startsWith("tool.") && toolCallId) {
    return `${item.kind}:call:${toolCallId}`;
  }
  if (item.kind.startsWith("tool.") && toolName && (toolInput || toolOutput)) {
    return `${item.kind}:${toolName}:${toolInput}:${toolOutput}`;
  }

  return `${item.kind}:${item.key}`;
}

function buildRunActivity(event: OpenClawTimelineEventLike): OpenClawActivityItem {
  const payload = toRecord(event.payload);
  const kind = String(event.kind || "");
  const failed = kind === "run.failed";
  const interrupted = kind === "run.interrupted";
  const interaction = toRecord(payload.interaction);
  const firstQuestion = Array.isArray(payload.questions) ? toRecord(payload.questions[0]) : {};
  const question = readStringValue(interaction.question, payload.message, payload.content);
  const optionSummary = formatInteractionOptions(interaction.options || firstQuestion.options);
  const title = failed ? "运行失败" : interrupted && question ? "等待用户选择" : interrupted ? "本次运行已中断" : "运行已完成";
  const summary = readStringValue(
    question && optionSummary ? `${question}\n${optionSummary}` : question,
    payload.error,
    payload.reason,
    title
  );

  return {
    key: event.id || `${kind}:${event.seq || ""}:${event.createdAt || ""}`,
    sessionId: event.sessionId,
    seq: event.seq,
    kind,
    title,
    summary,
    detail: summary,
    createdAt: event.createdAt,
    tone: failed || interrupted ? "warning" : "success",
    requiresUserInput: interrupted && Boolean(payload.requiresUserInput ?? true),
    interaction: interrupted && Object.keys(interaction).length > 0 ? interaction : undefined,
    questions: interrupted && Array.isArray(payload.questions)
      ? payload.questions.map((item) => toRecord(item)).filter((item) => Object.keys(item).length > 0)
      : undefined,
    resolved: interrupted ? Boolean(payload.resolved) : undefined,
  };
}

function formatInteractionOptions(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "";
  const labels = value
    .map((item, index) => {
      if (typeof item === "string" && item.trim()) {
        return `${index + 1}. ${item.trim()}`;
      }
      const record = toRecord(item);
      const label = readStringValue(record.label, record.title, record.name, record.value, record.id);
      const description = readStringValue(record.description);
      if (!label) return "";
      return description ? `${index + 1}. ${label} - ${description}` : `${index + 1}. ${label}`;
    })
    .filter(Boolean);
  return labels.length ? `选项：\n${labels.join("\n")}` : "";
}

export function buildOpenClawActivity(event: OpenClawTimelineEventLike): OpenClawActivityItem | null {
  const kind = String(event.kind || "");
  if (kind === "assistant.thinking") {
    const summary = getOpenClawEventReasoningText(event);
    if (!summary) return null;
    return {
      key: event.id || `${kind}:${event.seq || ""}:${event.createdAt || ""}:${summary}`,
      sessionId: event.sessionId,
      seq: event.seq,
      kind,
      title: "已完成深度思考",
      summary,
      detail: summary,
      createdAt: event.createdAt,
      tone: "neutral",
    };
  }

  if (kind === "tool.call" || kind === "tool.result") {
    return buildToolActivity(event);
  }

  if (kind === "run.completed" || kind === "run.failed" || kind === "run.interrupted") {
    return buildRunActivity(event);
  }

  return null;
}

export function buildOpenClawActivities(events: OpenClawTimelineEventLike[]): OpenClawActivityItem[] {
  const items: OpenClawActivityItem[] = [];
  for (const event of events) {
    const item = buildOpenClawActivity(event);
    if (!item) continue;
    items.push(item);
  }
  return mergeOpenClawActivities([], items);
}

export function mergeOpenClawActivities(
  current: OpenClawActivityItem[] = [],
  incoming: OpenClawActivityItem[] = []
): OpenClawActivityItem[] {
  const byKey = new Map<string, OpenClawActivityItem>();
  for (const item of [...current, ...incoming]) {
    const key = getActivityMergeKey(item);
    const previous = byKey.get(key);
    if (previous && typeof previous.seq === "number" && typeof item.seq === "number" && previous.seq > item.seq) {
      continue;
    }
    byKey.set(key, { ...(previous || {}), ...item });
  }
  return [...byKey.values()].sort((left, right) => (left.seq || 0) - (right.seq || 0));
}
