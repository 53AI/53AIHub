// packages/shared-business/src/chat/components/message/MessageItem.tsx

import { memo } from "react";
import UserMessage from "./UserMessage";
import AssistantMessage from "./AssistantMessage";
import type { Message, ChatMessagesFeatures } from "../../types/message";
import type { IAgentInfo } from "../../adapters/types";
import type {
  MessageActionFeature,
  FileActionFeature,
  SourceActionFeature,
  OpenClawFeature,
  ChatMessagesSlots,
} from "../ChatMessages/types";
import type { TranslateFn } from "../process-flow";

function readOpenClawVisibleAssistantContent(message: Message): string {
  return String(message.openclawProjection?.visibleAnswer || "").trim();
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

function traceOpenClawMessageRender(label: string, payload: Record<string, unknown>) {
  if (!isOpenClawUiDebugEnabled()) return;
  console.info(`[openclaw-ui:${label}] ${JSON.stringify(payload)}`);
}

// === Main Props ===

export interface MessageItemProps {
  // === 核心 ===
  /** 消息数据 */
  message: Message;
  /** 消息索引 */
  index: number;
  /** 消息总数 */
  total: number;
  /** Agent 信息 */
  agentInfo?: IAgentInfo;
  /** 用户头像 URL（用于 UserMessage） */
  userAvatar?: string;
  /** 功能开关 */
  features?: ChatMessagesFeatures;
  /** 外部传入的翻译函数 */
  t?: TranslateFn;

  // === 功能分组 ===
  /** 流式状态 */
  isStreaming?: boolean;
  /** OpenClaw 模式 */
  openclaw?: OpenClawFeature;
  /** 分享模式 */
  isShareMode?: boolean;
  /** 选中的消息 ID 列表 */
  selectedMessageIds?: (string | number)[];
  /** 是否被选中（分享模式） */
  isSelected?: boolean;

  // === 回调分组 ===
  /** 消息操作回调 */
  messageAction?: MessageActionFeature;
  /** 文件操作回调 */
  fileAction?: FileActionFeature;
  /** 源引用操作回调 */
  sourceAction?: SourceActionFeature;

  // === UI 插槽 ===
  slots?: ChatMessagesSlots;

  // === 其他 ===
  /** 折叠/展开 OpenClaw 时间线时保持外层滚动位置 */
  preserveScrollDuringToggle?: (callback: () => void) => void;
}

function MessageItemInner({
  message,
  index,
  total,
  agentInfo,
  userAvatar,
  features,
  isStreaming = false,
  openclaw,
  isShareMode = false,
  isSelected = false,
  messageAction,
  fileAction,
  sourceAction,
  slots,
  preserveScrollDuringToggle,
  t,
}: MessageItemProps) {
  const openclawEnabled = openclaw?.enabled ?? false;
  const isLastMessage = index === total - 1;
  const visibleAssistantContent = openclawEnabled
    ? readOpenClawVisibleAssistantContent(message)
    : String(message.answer || message.content || "").trim();
  const hasAssistantSurface = openclawEnabled
    ? message.loading ||
      Boolean(visibleAssistantContent) ||
      Boolean(message.openclawProjection?.timelineItems?.length) ||
      Boolean(message.openclawProjection?.outputFiles?.length)
    : Boolean(
        message.loading ||
          visibleAssistantContent ||
          message.outputFiles?.length ||
          message.process_records?.length
      );
  const shouldRenderAssistant = !openclawEnabled || hasAssistantSurface;

  if (openclawEnabled) {
    traceOpenClawMessageRender("message-item.render", {
      id: message.id,
      questionLen: String(message.question || "").length,
      questionHash: hashOpenClawText(message.question),
      answerLen: String(message.answer || "").length,
      answerHash: hashOpenClawText(message.answer),
      visibleAssistantLen: visibleAssistantContent.length,
      timelineCount: message.openclawTimelineItems?.length || 0,
      projectionTimelineCount: message.openclawProjection?.timelineItems?.length || 0,
      projectionAnswerLen: String(message.openclawProjection?.visibleAnswer || "").length,
      status: message.openclawTurn?.status,
      loading: Boolean(message.loading),
      shouldRenderAssistant,
    });
  }

  return (
    <div key={message.id}>
      {/* User Message */}
      <UserMessage
        message={message}
        userAvatar={userAvatar}
        features={features}
        isShareMode={isShareMode}
        isSelected={isSelected}
        fileAction={fileAction}
        slots={slots}
      />

      {/* Assistant Message */}
      {shouldRenderAssistant && (
        <AssistantMessage
          message={message}
          agentInfo={agentInfo}
          features={features}
          isStreaming={isStreaming}
          isLastMessage={isLastMessage}
          isShareMode={isShareMode}
          isSelected={isSelected}
          openclaw={openclaw}
          messageAction={messageAction}
          fileAction={fileAction}
          sourceAction={sourceAction}
          slots={slots}
          preserveScrollDuringToggle={preserveScrollDuringToggle}
          t={t}
        />
      )}
    </div>
  );
}

const MessageItem = memo(MessageItemInner);
MessageItem.displayName = "MessageItem";

export default MessageItem;
