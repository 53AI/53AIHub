import { memo, useState } from "react";
import { DownOutlined } from "@ant-design/icons";
import type { OpenClawActivityItem, OpenClawInteractionOption } from "../../types";

export interface OpenClawActivityListProps {
  items?: OpenClawActivityItem[];
  onInteractionSubmit?: (item: OpenClawActivityItem, option: OpenClawInteractionOption) => Promise<void> | void;
}

const toneClassMap: Record<string, string> = {
  neutral: "border-[#DFE3EA] bg-white text-[#1F2A44]",
  success: "border-[#D7F4E6] bg-[#FBFFFD] text-[#1F2A44]",
  warning: "border-[#FFE6B8] bg-[#FFFCF5] text-[#1F2A44]",
  error: "border-[#FFD8D8] bg-[#FFF7F7] text-[#1F2A44]",
};

function iconForKind(kind: string) {
  if (kind.startsWith("tool.")) return "⌘";
  if (kind === "run.completed") return "✓";
  if (kind === "run.failed" || kind === "run.interrupted") return "!";
  return "✣";
}

function normalizeInteractionOptions(item: OpenClawActivityItem): OpenClawInteractionOption[] {
  const options = item.interaction?.options || item.questions?.find((question) => question.options?.length)?.options;
  return Array.isArray(options) ? options : [];
}

function getOptionLabel(option: OpenClawInteractionOption, index: number) {
  return String(option.label ?? option.title ?? option.name ?? option.value ?? option.id ?? `选项 ${index + 1}`);
}

function OpenClawActivityCard({
  item,
  onInteractionSubmit,
  submittingOptionKey,
}: {
  item: OpenClawActivityItem;
  onInteractionSubmit?: OpenClawActivityListProps["onInteractionSubmit"];
  submittingOptionKey?: string;
}) {
  const toneClass = toneClassMap[item.tone || "neutral"] || toneClassMap.neutral;
  const hasToolDetail = Boolean(item.tool?.input || item.tool?.output || item.tool?.meta);
  const isToolCard = item.kind.startsWith("tool.");
  const hasStructuredToolBlocks = Boolean(item.tool?.input || item.tool?.output);
  const shouldRenderPrimaryText = Boolean(item.detail) && !(isToolCard && hasStructuredToolBlocks);
  const interactionOptions = normalizeInteractionOptions(item);
  const canSubmitInteraction = Boolean(
    item.kind === "run.interrupted" &&
      !item.resolved &&
      item.requiresUserInput !== false &&
      interactionOptions.length > 0 &&
      onInteractionSubmit
  );
  const hasDetail = Boolean(shouldRenderPrimaryText || hasToolDetail || canSubmitInteraction);
  const defaultOpen = item.kind === "assistant.thinking";
  const toolDisplayName = item.kind.startsWith("tool.") ? item.tool?.displayName || item.tool?.name : "";

  return (
    <details
      className={`group w-full min-w-0 max-w-full overflow-hidden rounded-lg border px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${toneClass}`}
      open={defaultOpen}
    >
      <summary className="flex min-w-0 cursor-pointer list-none items-start gap-3 text-sm font-medium marker:hidden">
        <span className="flex size-6 flex-none items-center justify-center rounded-full border border-current/10 bg-white text-xs text-[#111827]">
          {iconForKind(item.kind)}
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
          {shouldRenderPrimaryText && <div className="whitespace-pre-wrap break-words">{item.detail}</div>}

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

          {canSubmitInteraction && (
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
                    onClick={() => onInteractionSubmit?.(item, option)}
                  >
                    <span className="block truncate">{submitting ? "提交中..." : getOptionLabel(option, index)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!hasDetail && item.summary && !(isToolCard && hasStructuredToolBlocks) && (
        <div className="mt-3 whitespace-pre-wrap break-words pl-9 text-sm leading-6 text-[#6B7280]">
          {item.summary}
        </div>
      )}
    </details>
  );
}

export const OpenClawActivityList = memo(function OpenClawActivityList({
  items = [],
  onInteractionSubmit,
}: OpenClawActivityListProps) {
  const [submittingOptionKey, setSubmittingOptionKey] = useState("");
  if (!items.length) return null;

  const handleInteractionSubmit = onInteractionSubmit
    ? async (item: OpenClawActivityItem, option: OpenClawInteractionOption) => {
        const optionKey = String(option.id ?? option.value ?? "0");
        setSubmittingOptionKey(`${item.key}:${optionKey}`);
        try {
          await onInteractionSubmit(item, option);
        } finally {
          setSubmittingOptionKey("");
        }
      }
    : undefined;

  return (
    <div className="mb-4 min-w-0 max-w-full space-y-3 overflow-hidden">
      {items.map((item) => (
        <OpenClawActivityCard
          key={item.key}
          item={item}
          onInteractionSubmit={handleInteractionSubmit}
          submittingOptionKey={submittingOptionKey}
        />
      ))}
    </div>
  );
});

export default OpenClawActivityList;
