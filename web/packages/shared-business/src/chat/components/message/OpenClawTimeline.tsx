import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { DownOutlined } from "@ant-design/icons";
import { BubbleAssistant } from "@km/hub-ui-x-react";
import { OutputFiles } from "../output";
import type {
    ChatMessagesFeatures,
    Message,
    OpenClawActivityItem,
    OpenClawInteractionOption,
    OpenClawTimelineItem,
    OutputFile,
} from "../../types/message";
import { mergeOutputFiles } from "../../utils/openclaw-timeline";

const toneClassMap: Record<string, string> = {
  neutral: "border-[#DFE3EA] bg-white text-[#1F2A44]",
  success: "border-[#D7F4E6] bg-[#FBFFFD] text-[#1F2A44]",
  warning: "border-[#FFE6B8] bg-[#FFFCF5] text-[#1F2A44]",
  error: "border-[#FFD8D8] bg-[#FFF7F7] text-[#1F2A44]",
};

const GRADUAL_TEXT_INITIAL_CHARS = 24;
const GRADUAL_TEXT_CHARS_PER_TICK = 10;
const GRADUAL_TEXT_INTERVAL_MS = 28;
const THINKING_PREVIEW_MAX_LINES = 5;
const THINKING_PREVIEW_MAX_CHARS = 320;

function isOpenClawTraceItem(item: OpenClawTimelineItem): boolean {
  return item.type === "thinking" || item.type === "tool_call" || item.type === "tool_result";
}

function getTraceGroupStateKey(message: Message, items: OpenClawTimelineItem[]) {
  const turnKey = String(
    message.openclawTurn?.turnKey ||
      message._openclawActiveRequestId ||
      message._openclawClientMessageId ||
      ""
  );
  const firstSeq = items.find((item) => item.seq != null)?.seq ?? "";
  return `${message.id || "message"}:${turnKey || firstSeq || "trace"}`;
}

function runWithScrollPreservation(
  preserveScrollDuringToggle: ((callback: () => void) => void) | undefined,
  callback: () => void
) {
  if (preserveScrollDuringToggle) {
    preserveScrollDuringToggle(callback);
    return;
  }
  callback();
}

function shouldCollapseThinkingPreview(content: string): boolean {
  const normalizedContent = content.trim();
  if (!normalizedContent) return false;
  const hardLineCount = normalizedContent.split(/\r\n|\r|\n/).length;
  return hardLineCount > THINKING_PREVIEW_MAX_LINES || normalizedContent.length > THINKING_PREVIEW_MAX_CHARS;
}

function commonPrefixLength(left: string, right: string) {
  const maxLength = Math.min(left.length, right.length);
  let index = 0;
  while (index < maxLength && left[index] === right[index]) index += 1;
  return index;
}

function createInitialGradualText(content: string) {
  return content.slice(0, Math.min(content.length, GRADUAL_TEXT_INITIAL_CHARS));
}

function useGradualText(content: string, active: boolean) {
  const [displayedContent, setDisplayedContent] = useState(() =>
    active ? createInitialGradualText(content) : content
  );
  const latestContentRef = useRef(content);

  useEffect(() => {
    latestContentRef.current = content;
  }, [content]);

  useEffect(() => {
    if (!active) {
      setDisplayedContent(content);
      return;
    }

    setDisplayedContent((current) => {
      if (!content) return "";
      if (!current) return createInitialGradualText(content);
      if (content.startsWith(current)) return current;

      const prefixLength = commonPrefixLength(current, content);
      return content.slice(0, Math.max(prefixLength, Math.min(content.length, GRADUAL_TEXT_INITIAL_CHARS)));
    });
  }, [active, content]);

  useEffect(() => {
    if (!active) return undefined;
    if (!content || (content.startsWith(displayedContent) && displayedContent.length >= content.length)) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setDisplayedContent((current) => {
        const target = latestContentRef.current || "";
        if (!target || current.length >= target.length) return target;

        if (!target.startsWith(current)) {
          const prefixLength = commonPrefixLength(current, target);
          return target.slice(0, Math.max(prefixLength, Math.min(target.length, GRADUAL_TEXT_INITIAL_CHARS)));
        }

        return target.slice(0, Math.min(target.length, current.length + GRADUAL_TEXT_CHARS_PER_TICK));
      });
    }, GRADUAL_TEXT_INTERVAL_MS);

    return () => window.clearTimeout(timer);
  }, [active, content, displayedContent]);

  return displayedContent;
}

function iconForType(type: OpenClawTimelineItem["type"]) {
  switch (type) {
    case "tool_call":
    case "tool_result":
      return "⌘";
    case "run_terminal":
      return "!";
    case "output_files":
      return "↧";
    default:
      return "✣";
  }
}

function TimelineAnswerBubble({
  content,
  active,
  avatar,
  message,
  onSourceReferenceClick,
  renderSource,
  menu,
}: {
  content: string;
  active: boolean;
  avatar?: string;
  message: Message;
  onSourceReferenceClick?: (data: any, message: Message) => void;
  renderSource?: (type: string, number: number, message: Message) => string;
  menu?: ReactNode;
}) {
  const displayedContent = useGradualText(content, active);

  return (
    <BubbleAssistant
      content={displayedContent}
      streaming={active}
      alwaysShowMenu={Boolean(menu)}
      avatar={avatar}
      sourceEnabled
      renderSource={(type: string, number: number) => renderSource?.(type, number, message) || `${type}-${number}`}
      onSourceReferenceClick={(data) => onSourceReferenceClick?.(data, message)}
      menu={menu}
    />
  );
}

function normalizeInteractionOptions(item: OpenClawTimelineItem): OpenClawInteractionOption[] {
  const options = item.interaction?.options || item.questions?.find((question) => question.options?.length)?.options;
  return Array.isArray(options) ? options : [];
}

function getOptionLabel(option: OpenClawInteractionOption, index: number) {
  return String(option.label ?? option.title ?? option.name ?? option.value ?? option.id ?? `选项 ${index + 1}`);
}

function buildActivityFromTimelineItem(item: OpenClawTimelineItem): OpenClawActivityItem {
  return item.activity || {
    key: item.key,
    sessionId: item.sessionId,
    seq: item.seq,
    kind: item.kind || "run.interrupted",
    title: item.title || "",
    summary: item.content || item.detail,
    detail: item.detail || item.content,
    createdAt: item.createdAt,
    tone: item.tone,
    tool: item.tool,
    requiresUserInput: item.requiresUserInput,
    interaction: item.interaction,
    questions: item.questions,
    resolved: item.resolved,
  };
}

function TimelineActivityCard({
  item,
  defaultOpen,
  expanded,
  onToggle,
  isStreaming,
  onInteractionSubmit,
  submittingOptionKey,
}: {
  item: OpenClawTimelineItem;
  defaultOpen?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  isStreaming?: boolean;
  onInteractionSubmit?: (activity: OpenClawActivityItem, option: OpenClawInteractionOption) => Promise<void> | void;
  submittingOptionKey?: string;
}) {
  const toneClass = toneClassMap[item.tone || "neutral"] || toneClassMap.neutral;
  const hasToolDetail = Boolean(item.tool?.input || item.tool?.output || item.tool?.meta);
  const isToolCard = item.type === "tool_call" || item.type === "tool_result";
  const hasStructuredToolBlocks = Boolean(item.tool?.input || item.tool?.output);
  const shouldRenderPrimaryText = Boolean(item.detail || item.content) && !(isToolCard && hasStructuredToolBlocks);
  const interactionOptions = normalizeInteractionOptions(item);
  const canSubmitInteraction = Boolean(
    item.kind === "run.interrupted" &&
      !item.resolved &&
      item.requiresUserInput !== false &&
      interactionOptions.length > 0 &&
      onInteractionSubmit
  );
  const hasDetail = Boolean(shouldRenderPrimaryText || hasToolDetail || canSubmitInteraction);
  const toolDisplayName = item.tool?.displayName || item.tool?.name || "";
  const activity = canSubmitInteraction ? buildActivityFromTimelineItem(item) : undefined;

  if (item.type === "thinking") {
    const content = item.detail || item.content || "";
    const canCollapseThinking = shouldCollapseThinkingPreview(content);
    const thinkingExpanded = !canCollapseThinking || (expanded ?? Boolean(isStreaming || defaultOpen));
    const handleThinkingKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (!canCollapseThinking) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onToggle?.();
    };

    return (
      <div
        role={canCollapseThinking ? "button" : undefined}
        tabIndex={canCollapseThinking ? 0 : undefined}
        data-testid="openclaw-thinking-card"
        aria-expanded={canCollapseThinking ? thinkingExpanded : undefined}
        className={`group w-full min-w-0 max-w-full overflow-hidden rounded-lg border px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${canCollapseThinking ? "cursor-pointer" : ""} ${toneClass}`}
        onClick={canCollapseThinking ? onToggle : undefined}
        onKeyDown={canCollapseThinking ? handleThinkingKeyDown : undefined}
      >
        <div className="flex min-w-0 items-start gap-3 text-sm font-medium">
          <span className="flex size-6 flex-none items-center justify-center rounded-full border border-current/10 bg-white text-xs text-[#1D1E1F]">
            {iconForType(item.type)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate">{item.title || "已完成深度思考"}</span>
          </span>
          {canCollapseThinking && (
            <DownOutlined className={`mt-1 text-xs text-[#0E2348] transition-transform ${thinkingExpanded ? "rotate-180" : ""}`} />
          )}
        </div>

        {content && (
          <div className="mt-3 min-w-0 max-w-full pl-9 text-sm leading-6 text-[#6B7280]">
            <div
              data-testid="openclaw-thinking-content"
              className={
                thinkingExpanded
                  ? "whitespace-pre-wrap break-words"
                  : "relative max-h-24 overflow-hidden whitespace-pre-wrap break-words pr-1"
              }
            >
              {content}
              {!thinkingExpanded && (
                <div
                  data-testid="openclaw-thinking-fade"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-white/0 to-white"
                />
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <details
      className={`group w-full min-w-0 max-w-full overflow-hidden rounded-lg border px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${toneClass}`}
      open={defaultOpen}
    >
      <summary className="flex min-w-0 cursor-pointer list-none items-start gap-3 text-sm font-medium marker:hidden">
        <span className="flex size-6 flex-none items-center justify-center rounded-full border border-current/10 bg-white text-xs text-[#1D1E1F]">
          {iconForType(item.type)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{item.title}</span>
          {toolDisplayName && (
            <span className="mt-1 inline-flex max-w-full items-center rounded-full bg-[#F1F5F9] px-2 py-0.5 text-xs font-normal text-[#8A94A6]">
              <span className="truncate">{toolDisplayName}</span>
            </span>
          )}
        </span>
        <DownOutlined className="mt-1 text-xs text-[#0E2348] transition-transform group-open:rotate-180" />
      </summary>

      {hasDetail && (
        <div className="mt-3 min-w-0 max-w-full space-y-3 overflow-hidden pl-9 text-sm leading-6 text-[#6B7280]">
          {shouldRenderPrimaryText && (
            <div className="whitespace-pre-wrap break-words">{item.detail || item.content}</div>
          )}

          {item.tool?.meta && (
            <div className="min-w-0 max-w-full overflow-hidden break-words rounded bg-[#F6F7F9] px-3 py-2 text-xs text-[#6B7280]">
              {item.tool.meta}
            </div>
          )}

          {item.tool?.input && (
            <div className="min-w-0 max-w-full overflow-hidden">
              <div className="mb-1 text-[11px] font-semibold tracking-wide text-[#9CA3AF]">TOOL INPUT</div>
              <pre className="max-h-56 max-w-full overflow-auto whitespace-pre-wrap break-words rounded bg-[#F6F7F9] px-3 py-2 text-xs leading-5 text-[#374151]">
                {item.tool.input}
              </pre>
            </div>
          )}

          {item.tool?.output && (
            <div className="min-w-0 max-w-full overflow-hidden">
              <div className="mb-1 text-[11px] font-semibold tracking-wide text-[#9CA3AF]">TOOL OUTPUT</div>
              <pre className="max-h-56 max-w-full overflow-auto whitespace-pre-wrap break-words rounded bg-[#F6F7F9] px-3 py-2 text-xs leading-5 text-[#374151]">
                {item.tool.output}
              </pre>
            </div>
          )}

          {canSubmitInteraction && activity && (
            <div className="flex min-w-0 max-w-full flex-wrap gap-2">
              {interactionOptions.map((option, index) => {
                const optionKey = String(option.id ?? option.value ?? index);
                const submitting = submittingOptionKey === `${item.key}:${optionKey}`;
                return (
                  <button
                    key={optionKey}
                    type="button"
                    disabled={Boolean(submittingOptionKey)}
                    className="max-w-full rounded border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#1F2A44] transition hover:border-[#4F80FF] hover:text-[#1C5DFF] disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => onInteractionSubmit?.(activity, option)}
                  >
                    <span className="block truncate">{submitting ? "提交中..." : getOptionLabel(option, index)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </details>
  );
}

export interface OpenClawTimelineProps {
  message: Message;
  items?: OpenClawTimelineItem[];
  agentInfo?: {
    name?: string;
    logo?: string;
  };
  isStreaming?: boolean;
  features?: ChatMessagesFeatures;
  onSourceReferenceClick?: (data: any, message: Message) => void;
  renderSource?: (type: string, number: number, message: Message) => string;
  onOutputFilePreview?: (file: OutputFile) => void;
  onOutputFileFavorite?: (file: OutputFile, message: Message) => void;
  onOutputFileCheckFavorite?: (fileIds: string[]) => void;
  onInteractionSubmit?: (activity: OpenClawActivityItem, option: OpenClawInteractionOption) => Promise<void> | void;
  answerMenu?: ReactNode;
  preserveScrollDuringToggle?: (callback: () => void) => void;
}

export const OpenClawTimeline = memo(function OpenClawTimeline({
  message,
  items = [],
  agentInfo,
  isStreaming = false,
  features: _features,
  onSourceReferenceClick,
  renderSource,
  onOutputFilePreview,
  onOutputFileFavorite,
  onOutputFileCheckFavorite,
  onInteractionSubmit,
  answerMenu,
  preserveScrollDuringToggle,
}: OpenClawTimelineProps) {
  const [submittingOptionKey, setSubmittingOptionKey] = useState("");
  const [traceGroupExpandedByKey, setTraceGroupExpandedByKey] = useState<Record<string, boolean>>({});
  const [thinkingExpandedByKey, setThinkingExpandedByKey] = useState<Record<string, boolean>>({});
  const hasProjection = Boolean(message.openclawProjection);
  const projectedItems = hasProjection ? message.openclawProjection!.timelineItems : items;
  const projectedTailFiles = hasProjection ? message.openclawProjection!.outputFiles : undefined;
  const visibleBodyItems = useMemo(
    () =>
      projectedItems.filter((item) => {
        if (item.type === "output_files") return false;
        if (item.type === "run_terminal" && item.kind === "run.completed") return false;
        return true;
      }),
    [projectedItems]
  );

  const tailFiles = useMemo(
    () => projectedTailFiles || (
      projectedItems
        .filter((item) => item.type === "output_files")
        .reduce<OutputFile[]>((allFiles, item) => mergeOutputFiles(allFiles, item.files || [], { logicalIdentity: true }), [])
    ),
    [projectedItems, projectedTailFiles]
  );

  const tailFilesLegacy = useMemo(
    () =>
      hasProjection
        ? []
        : items
        .filter((item) => item.type === "output_files")
        .reduce<OutputFile[]>((allFiles, item) => mergeOutputFiles(allFiles, item.files || [], { logicalIdentity: true }), []),
    [hasProjection, items]
  );
  const turnStartSeq = Number.isFinite(Number(message._openclawTurnStartSeq))
    ? Number(message._openclawTurnStartSeq)
    : 0;

  const maxNonAnswerSeq = useMemo(
    () =>
      visibleBodyItems.reduce((maxSeq, item) => {
        if (item.type === "answer") return maxSeq;
        const seq = typeof item.seq === "number" ? item.seq : Number(item.seq);
        return Number.isFinite(seq) ? Math.max(maxSeq, seq) : maxSeq;
      }, 0),
    [visibleBodyItems]
  );

  const turnNonAnswerCount = useMemo(
    () =>
      visibleBodyItems.filter((item) => {
        if (item.type === "answer") return false;
        const seq = typeof item.seq === "number" ? item.seq : Number(item.seq);
        return Number.isFinite(seq) && seq > turnStartSeq;
      }).length,
    [turnStartSeq, visibleBodyItems]
  );

  const visibleItems = useMemo(
    () =>
      visibleBodyItems.filter((item) => {
        if (item.type !== "answer") return true;
        const seq = typeof item.seq === "number" ? item.seq : Number(item.seq);
        if (!Number.isFinite(seq)) return true;
        if (!isStreaming) return true;
        if (seq <= turnStartSeq + 1) return true;
        if (turnNonAnswerCount === 0) return false;
        return maxNonAnswerSeq >= seq - 1;
      }),
    [isStreaming, maxNonAnswerSeq, turnNonAnswerCount, turnStartSeq, visibleBodyItems]
  );

  const lastVisibleAnswerKey = [...visibleItems]
    .reverse()
    .find((item) => item.type === "answer")?.key;

  const orderedVisibleItems = useMemo(() => {
    if (!lastVisibleAnswerKey) return visibleItems;
    const lastAnswer = visibleItems.find((item) => item.key === lastVisibleAnswerKey);
    if (!lastAnswer) return visibleItems;
    return [
      ...visibleItems.filter((item) => item.key !== lastVisibleAnswerKey),
      lastAnswer,
    ];
  }, [lastVisibleAnswerKey, visibleItems]);

  const effectiveTailFiles = tailFiles.length > 0 ? tailFiles : tailFilesLegacy;
  const hasVisibleAnswer = orderedVisibleItems.some((item) => item.type === "answer");
  const traceItems = useMemo(() => orderedVisibleItems.filter(isOpenClawTraceItem), [orderedVisibleItems]);
  const nonTraceItems = useMemo(() => orderedVisibleItems.filter((item) => !isOpenClawTraceItem(item)), [orderedVisibleItems]);
  const traceGroupCounts = useMemo(
    () => ({
      thinking: traceItems.filter((item) => item.type === "thinking").length,
      tool: traceItems.filter((item) => item.type === "tool_call" || item.type === "tool_result").length,
    }),
    [traceItems]
  );
  const traceGroupSubtitle = useMemo(
    () =>
      [
        traceGroupCounts.thinking > 0 ? `${traceGroupCounts.thinking} 个思考` : "",
        traceGroupCounts.tool > 0 ? `${traceGroupCounts.tool} 个工具步骤` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    [traceGroupCounts]
  );
  const traceGroupStateKey = useMemo(
    () => getTraceGroupStateKey(message, traceItems),
    [message, traceItems]
  );
  const traceGroupExpanded = traceGroupExpandedByKey[traceGroupStateKey] ?? Boolean(isStreaming);
  const toggleTraceGroup = useCallback(() => {
    runWithScrollPreservation(preserveScrollDuringToggle, () => {
      setTraceGroupExpandedByKey((previous) => ({
        ...previous,
        [traceGroupStateKey]: !(previous[traceGroupStateKey] ?? Boolean(isStreaming)),
      }));
    });
  }, [isStreaming, preserveScrollDuringToggle, traceGroupStateKey]);
  const getThinkingStateKey = useCallback(
    (item: OpenClawTimelineItem) => `${traceGroupStateKey}:${item.key}`,
    [traceGroupStateKey]
  );
  const toggleThinkingCard = useCallback(
    (item: OpenClawTimelineItem) => {
      const stateKey = getThinkingStateKey(item);
      runWithScrollPreservation(preserveScrollDuringToggle, () => {
        setThinkingExpandedByKey((previous) => ({
          ...previous,
          [stateKey]: !(previous[stateKey] ?? Boolean(isStreaming)),
        }));
      });
    },
    [getThinkingStateKey, isStreaming, preserveScrollDuringToggle]
  );
  const handleInteractionSubmit = onInteractionSubmit
    ? async (activity: OpenClawActivityItem, option: OpenClawInteractionOption) => {
        const optionKey = String(option.id ?? option.value ?? "0");
        setSubmittingOptionKey(`${activity.key}:${optionKey}`);
        try {
          await onInteractionSubmit(activity, option);
        } finally {
          setSubmittingOptionKey("");
        }
      }
    : undefined;

  if (!orderedVisibleItems.length && effectiveTailFiles.length === 0) return null;

  return (
    <div className="space-y-3">
      {traceItems.length > 0 && (
        <div
          data-testid="openclaw-trace-group"
          className="w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-[#DFE3EA] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
        >
          <button
            type="button"
            data-testid="openclaw-trace-group-toggle"
            aria-expanded={traceGroupExpanded}
            className="flex w-full min-w-0 cursor-pointer items-start gap-3 border-0 bg-transparent p-0 text-left text-sm font-medium text-[#1F2A44]"
            onClick={toggleTraceGroup}
          >
            <span className="flex size-6 flex-none items-center justify-center rounded-full border border-[#E5E7EB] bg-white text-xs text-[#1D1E1F]">
              ✣
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                {isStreaming ? "正在运行调用链" : "已完成调用链"} · {traceItems.length} 个步骤
              </span>
              {traceGroupSubtitle && (
                <span className="mt-1 block truncate text-xs font-normal text-[#8A94A6]">
                  {traceGroupSubtitle}
                </span>
              )}
            </span>
            <DownOutlined className={`mt-1 text-xs text-[#0E2348] transition-transform ${traceGroupExpanded ? "rotate-180" : ""}`} />
          </button>

          {traceGroupExpanded && (
            <div className="mt-3 space-y-3" data-testid="openclaw-trace-group-body">
              {traceItems.map((item) => (
                <TimelineActivityCard
                  key={item.key}
                  item={item}
                  expanded={item.type === "thinking" ? (thinkingExpandedByKey[getThinkingStateKey(item)] ?? Boolean(isStreaming)) : undefined}
                  onToggle={item.type === "thinking" ? () => toggleThinkingCard(item) : undefined}
                  isStreaming={isStreaming}
                  onInteractionSubmit={handleInteractionSubmit}
                  submittingOptionKey={submittingOptionKey}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {nonTraceItems.map((item) => {
        if (item.type === "answer") {
          return (
            <TimelineAnswerBubble
              key={item.key}
              content={item.content || ""}
              active={Boolean(isStreaming && item.key === lastVisibleAnswerKey)}
              avatar={agentInfo?.logo}
              message={message}
              renderSource={renderSource}
              onSourceReferenceClick={onSourceReferenceClick}
              menu={item.key === lastVisibleAnswerKey ? answerMenu : undefined}
            />
          );
        }

        return (
          <TimelineActivityCard
            key={item.key}
            item={item}
            defaultOpen={item.kind === "run.interrupted" && item.requiresUserInput !== false}
            isStreaming={isStreaming}
            onInteractionSubmit={handleInteractionSubmit}
            submittingOptionKey={submittingOptionKey}
          />
        );
      })}

      {isStreaming && !hasVisibleAnswer && (
        <BubbleAssistant
          content=""
          streaming
          avatar={agentInfo?.logo}
          sourceEnabled
          renderSource={(type: string, number: number) => renderSource?.(type, number, message) || `${type}-${number}`}
          onSourceReferenceClick={(data) => onSourceReferenceClick?.(data, message)}
        />
      )}

      {effectiveTailFiles.length > 0 && (
        <OutputFiles
          files={effectiveTailFiles}
          className="flex flex-wrap gap-3 mt-3 pb-6"
          onPreview={(file) => onOutputFilePreview?.(file)}
          onFavorite={onOutputFileFavorite ? (file) => onOutputFileFavorite(file, message) : undefined}
          onCheckFavorite={onOutputFileCheckFavorite}
        />
      )}
    </div>
  );
});

export default OpenClawTimeline;
