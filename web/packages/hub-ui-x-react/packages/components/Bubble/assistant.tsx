import React, { useState, useCallback, useEffect, useMemo, memo } from "react";
import { t } from "../../locale";
import Icon from "../Icon/index";
import MdRenderer from "../Markdown/renderer";
import "./assistant.css";

/**
 * 从内容中提取 <think> 标签包裹的思考内容
 * 支持格式: <think>思考内容</think>
 * @param content 原始内容
 * @returns { reasoning: string, content: string } 提取后的思考内容和清理后的内容
 */
function extractThinkTag(content: string): {
  reasoning: string;
  content: string;
} {
  let remaining = content;
  let inThink = false;
  let sawThinkTag = false;
  const contentParts: string[] = [];
  const reasoningParts: string[] = [];

  while (remaining) {
    if (inThink) {
      const closeMatch = remaining.match(/<\/think>/i);
      if (!closeMatch || closeMatch.index === undefined) {
        reasoningParts.push(remaining);
        remaining = "";
        break;
      }

      reasoningParts.push(remaining.slice(0, closeMatch.index));
      remaining = remaining.slice(closeMatch.index + closeMatch[0].length);
      inThink = false;
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
    inThink = true;
  }

  if (!sawThinkTag) {
    return { reasoning: "", content };
  }

  return {
    reasoning: reasoningParts
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n\n"),
    content: contentParts.join("").trim(),
  };
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
  // CJK thinking text is often concise, so shorter repeated prefixes should still be treated as leakage.
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

  return removeReasoningLeakage(content, reasoning);
}

function splitReasoningCandidates(reasoning: string): string[] {
  const cleaned = reasoning.trim();
  if (!cleaned) return [];

  const withoutDefaultPrefix = cleaned.replace(/^正在处理您的请求[.…...]*\s*/u, "").trim();
  const sentenceParts = cleaned
    .split(/(?<=[.!?。！？])\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);

  return [...new Set([cleaned, withoutDefaultPrefix, ...sentenceParts])]
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
  if (normalizedCandidate.length < getReasoningOverlapMinLength(candidate)) return content;

  const matchIndex = normalizedContent.text.indexOf(normalizedCandidate);
  if (matchIndex === -1) return content;

  const start = normalizedContent.sourceIndexes[matchIndex] ?? 0;
  const end = normalizedContent.sourceIndexes[matchIndex + normalizedCandidate.length - 1] ?? start;
  return `${content.slice(0, start)}${content.slice(end + 1)}`;
}

function removeReasoningLeakage(content: string, reasoning: string): string {
  let answer = content;
  for (const candidate of splitReasoningCandidates(reasoning)) {
    const next = removeReasoningCandidate(answer, candidate);
    if (next !== answer) {
      answer = next
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/\s+([，。！？、,.!?;；:：])/g, "$1")
        .replace(/([，。！？、；：])\s+([\u3400-\u9fff])/g, "$1$2")
        .trimStart();
    }
  }
  return answer;
}

interface Suggestion {
  id: string | number;
  content: string;
}

export interface BubbleAssistantProps {
  type?: "welcome" | "assistant";
  showError?: boolean;
  content?: string;
  suggestions?: Suggestion[];
  avatar?: string;
  showAvatar?: boolean;
  markdownOptions?: any;
  reasoning?: string;
  reasoningExpanded?: boolean;
  /** 是否渲染独立的深度思考区块；Agent 执行过程可将推理统一放入 header。 */
  showReasoning?: boolean;
  alwaysShowMenu?: boolean;
  streaming?: boolean;
  messageStyle?: React.CSSProperties;
  messageClass?: string;
  renderSource?: Function;
  sourceRegex?: RegExp | string;
  sourceEnabled?: boolean;
  mermaidClickable?: boolean;
  viewerClass?: string;
  viewerStyle?: React.CSSProperties;
  onSuggestion?: (content: string) => void;
  onSourceReferenceClick?: (data: any) => void;
  onMermaidClick?: (data: any) => void;
  header?: React.ReactNode;
  error?: React.ReactNode;
  footer?: React.ReactNode;
  menu?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const BubbleAssistant: React.FC<BubbleAssistantProps> = ({
  type = "assistant",
  showError = false,
  content = "",
  suggestions = [],
  avatar = "",
  showAvatar = false,
  markdownOptions = {},
  reasoning = "",
  reasoningExpanded: reasoningExpandedProp = false,
  showReasoning = true,
  alwaysShowMenu = false,
  streaming = false,
  messageStyle = {},
  messageClass = "",
  renderSource,
  sourceRegex,
  sourceEnabled = false,
  mermaidClickable = false,
  viewerClass = "",
  viewerStyle = {},
  onSuggestion,
  onSourceReferenceClick,
  onMermaidClick,
  header,
  error,
  footer,
  menu,
  className,
  style,
}) => {
  const [isReasoningExpanded, setIsReasoningExpanded] = useState(
    reasoningExpandedProp,
  );

  // reasoningExpanded 既会随流式阶段自动收起，也允许用户在组件内手动展开。
  // 仅在父级值实际变化时同步，避免普通重渲染覆盖用户的手动操作。
  useEffect(() => {
    setIsReasoningExpanded(reasoningExpandedProp);
  }, [reasoningExpandedProp]);

  // 提取 <think> 标签内容
  const { extractedReasoning, displayContent } = useMemo(() => {
    const { reasoning: thinkReasoning, content: cleanContent } =
      extractThinkTag(content);
    // 合并传入的 reasoning 和从 think 标签提取的内容（两者都存在时合并）
    const mergedReasoning = [reasoning, thinkReasoning]
      .filter(Boolean)
      .join("\n\n");
    // 如果提取到了 think 标签内容，使用清理后的内容；否则使用原始内容
    const finalContent = thinkReasoning ? cleanContent : content;
    return {
      extractedReasoning: mergedReasoning,
      displayContent: stripReasoningPrefix(finalContent, mergedReasoning),
    };
  }, [content, reasoning]);

  const handleReasoningToggle = useCallback(() => {
    setIsReasoningExpanded((prev) => !prev);
  }, []);

  const handleSuggestionClick = useCallback(
    (suggestion: Suggestion) => {
      onSuggestion?.(suggestion.content);
    },
    [onSuggestion],
  );

  return (
    <div className={`x-assistant-bubble ${className || ""}`} style={style}>
      {avatar && (
        <div className="x-assistant-bubble__avatar">
          <img src={avatar} alt="Assistant" />
        </div>
      )}
      <div className="x-assistant-bubble__content">
        {header}
        <div
          className={`x-assistant-bubble__message ${type === "welcome" ? "x-assistant-bubble__message--welcome" : "x-assistant-bubble__message--assistant"} ${messageClass}`}
          style={messageStyle}
        >
          {showReasoning && extractedReasoning && (
            <div className="x-assistant-bubble__reasoning">
              <div
                className="x-assistant-bubble__reasoning-header"
                onClick={handleReasoningToggle}
              >
                <Icon name="think" />
                <div className="x-assistant-bubble__reasoning-title">
                  {displayContent
                    ? t("hubx.bubble.completion_completed")
                    : t("hubx.bubble.completion_thinking")}
                </div>
                <span
                  className={`x-assistant-bubble__reasoning-arrow ${isReasoningExpanded ? "x-assistant-bubble__reasoning-arrow--expanded" : ""}`}
                >
                  <Icon name="down" />
                </span>
              </div>
              {isReasoningExpanded && (
                <div className="x-assistant-bubble__reasoning-content-wrapper">
                  <MdRenderer
                    className="x-assistant-bubble__reasoning-content"
                    content={extractedReasoning}
                    streaming={streaming}
                    sourceEnabled={sourceEnabled}
                    renderSource={renderSource}
                    sourceRegex={sourceRegex}
                    viewerClass={viewerClass}
                    viewerStyle={viewerStyle}
                    onSourceReferenceClick={onSourceReferenceClick}
                  />
                </div>
              )}
            </div>
          )}

          {showError ? (
            error
          ) : (
            <MdRenderer
              className="x-assistant-bubble__markdown"
              content={displayContent}
              streaming={streaming}
              sourceEnabled={sourceEnabled}
              renderSource={renderSource}
              sourceRegex={sourceRegex}
              mermaidClickable={mermaidClickable}
              viewerClass={viewerClass}
              viewerStyle={viewerStyle}
              onSourceReferenceClick={onSourceReferenceClick}
              onMermaidClick={onMermaidClick}
            />
          )}

          {streaming && (
            <div className="x-assistant-bubble__loading">
              <div className="x-assistant-bubble__loading-dot x-assistant-bubble__loading-dot--1"></div>
              <div className="x-assistant-bubble__loading-dot x-assistant-bubble__loading-dot--2"></div>
              <div className="x-assistant-bubble__loading-dot x-assistant-bubble__loading-dot--3"></div>
            </div>
          )}
        </div>

        {suggestions.length > 0 && (
          <div className="x-assistant-bubble__suggestions">
            <div className="x-assistant-bubble__suggestions-title">
              我可以帮您：
            </div>
            {suggestions.map(
              (suggestion) =>
                suggestion.content.trim() && (
                  <div
                    key={suggestion.id}
                    className="x-assistant-bubble__suggestion"
                    onClick={() => handleSuggestionClick(suggestion)}
                  >
                    {suggestion.content}
                  </div>
                ),
            )}
          </div>
        )}

        {footer}

        <div
          className={`x-assistant-bubble__menu ${!alwaysShowMenu ? "x-assistant-bubble__menu--hidden" : ""}`}
        >
          {menu}
        </div>
      </div>
    </div>
  );
};

// 自定义比较函数：只比较动态变化的 props
// 详见 ./assistant-memo.ts：父组件每次渲染都会创建新的 React 元素
// (menu / header / footer / error)，引用永远不等会让 memo 完全失效。
// 这里只比较标量 + suggestions，避免 React 元素引用变化导致整棵子树重渲染。
import { shouldBubbleAssistantSkipRender } from "./assistant-memo";
const arePropsEqual = shouldBubbleAssistantSkipRender;

const BubbleAssistantMemo = memo(BubbleAssistant, arePropsEqual);

BubbleAssistantMemo.displayName = "xBubbleAssistant";

export default BubbleAssistantMemo;
