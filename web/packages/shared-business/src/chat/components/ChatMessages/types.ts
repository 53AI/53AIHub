import type { ReactNode } from "react";
import type {
  Message,
  FileItem,
  ChunkItem,
  OutputFile,
  SourceReferenceData,
  OpenClawActivityItem,
  OpenClawInteractionOption,
  ChatMessagesFeatures,
} from "../../types/message";
import type { IAgentInfo } from "../../adapters/types";
import type { TranslateFn } from "../process-flow";
import type { AgentRecommendFeature, AuthTagsSlotProps } from "../../types/features";

// === Slot Props ===

export interface MessageMenuSlotProps {
  type: "user" | "assistant";
  message: Message;
}

export interface SourceSlotProps {
  type: string;
  number: number;
  message: Message;
}

export interface FileLinkSlotProps {
  file: FileItem;
  children: ReactNode;
}

// === Feature Groups ===

export interface MessageSelectionFeature {
  /** 选中的消息 ID 列表 */
  selectedMessageIds?: (string | number)[];
  /** 全选状态 */
  selectAll?: boolean;
  /** 消息选择回调 */
  onSelect?: (msg: Message) => void;
  /** 全选回调 */
  onSelectAll?: () => void;
}

export interface WelcomeFeature {
  /** 是否显示欢迎页 */
  show?: boolean;
}

export interface OpenClawConversationResolvedInfo {
  conversation_id?: string | number;
  title?: string;
  question?: string;
  created_time?: number;
  updated_time?: number;
}

export interface OpenClawFeature {
  /** 是否启用 OpenClaw 模式 */
  enabled?: boolean;
  /** OpenClaw 交互选项提交回调 */
  onInteractionSubmit?: (
    activity: OpenClawActivityItem,
    option: OpenClawInteractionOption,
    msg: Message
  ) => Promise<void> | void;
  /** 是否禁用输入 */
  inputDisabled?: boolean;
  /** 输入禁用原因 */
  inputDisabledReason?: string;
  /** 初始会话解析中 */
  initialConversationResolving?: boolean;
  /** 跳过初始加载 */
  skipInitialLoad?: boolean;
  /**
   * OpenClaw 首次会话解析完成回调。
   * 替代顶层 `ChatViewProps.onOpenClawConversationResolved`。
   */
  onConversationResolved?: (info: OpenClawConversationResolvedInfo) => void;
}

export interface LoadMoreFeature {
  /** 是否还有更早消息 */
  hasMore?: boolean;
  /** 是否正在加载更早消息 */
  isLoadingMore?: boolean;
  /** 是否正在加载当前会话消息 */
  isConversationLoading?: boolean;
  /** 上拉加载更早消息 */
  onLoadMore?: (done: () => void) => void;
}

export interface MessageActionFeature {
  /** 分享模式下选择消息 */
  onSelect?: (msg: Message) => void;
  /** 建议问题点击回调 */
  onSuggestionClick?: (content: string) => void;
  /** 重新生成回调 */
  onRegenerate?: (msg: Message) => void;
  /** 分享回调 */
  onShare?: () => void;
  /** 添加为文件回调 */
  onAddAsMd?: (msg: Message) => void;
  /** 反馈回调 - 点击点赞/点错按钮 */
  onFeedback?: (msg: Message, type: "satisfied" | "unsatisfied") => void;
  /** 反馈面板关闭回调 */
  onFeedbackClose?: (msg: Message) => void;
  /** 反馈选项切换回调 */
  onFeedbackToggle?: (msg: Message, key: string) => void;
  /** 反馈描述变化回调 */
  onFeedbackDescriptionChange?: (msg: Message, value: string) => void;
  /** 反馈提交回调 */
  onFeedbackSubmit?: (msg: Message) => void;
  /** 显示错误详情回调 */
  onShowErrorDetails?: (msg: Message) => void;
}

export interface FileActionFeature {
  /** 文件点击回调 */
  onClick?: (file: FileItem) => void;
  /** 输出文件收藏回调 */
  onFavorite?: (file: OutputFile, msg: Message) => void;
  /** 输出文件预览回调 */
  onPreview?: (file: OutputFile, msg: Message) => void;
  /** 输出文件收藏状态检查回调 */
  onCheckFavorite?: (fileIds: string[], msg?: Message) => void;
}

export interface SourceActionFeature {
  /** 源文件点击回调 */
  onClick?: (source: ChunkItem, msg: Message) => void;
  /** 打开知识库侧边栏回调 */
  onOpenKnow?: (msg: Message) => void;
  /** Source 引用点击回调 */
  onReferenceClick?: (data: SourceReferenceData, msg: Message) => void;
}

// === UI Slots ===

export interface ChatMessagesSlots {
  /** 消息菜单渲染函数 */
  messageMenu?: (props: MessageMenuSlotProps) => ReactNode;
  /** 欢迎页 AuthTags 渲染函数 */
  authTags?: (props: AuthTagsSlotProps) => ReactNode;
  /** 自定义 Source 渲染函数 */
  source?: (props: SourceSlotProps) => string;
  /** 自定义文件链接渲染 */
  fileLink?: (props: FileLinkSlotProps) => ReactNode;
}

// === Main Props ===

export interface ChatMessagesProps {
  // === 核心 ===
  /** 消息列表 */
  messageList: Message[];
  /** Agent 信息 */
  agentInfo: IAgentInfo;
  /** 用户头像 URL（用于用户消息气泡） */
  userAvatar?: string;
  /** 是否正在流式输出 */
  isStreaming: boolean;
  /** 功能配置 */
  features?: ChatMessagesFeatures;
  /** OpenClaw 模式；兼容旧布尔值写法 */
  openclaw?: boolean | OpenClawFeature;

  // === UI 插槽 ===
  slots?: ChatMessagesSlots;

  // === 功能分组 ===
  /** 消息选择 */
  selection?: MessageSelectionFeature;
  /** 智能体推荐 */
  agentRecommend?: AgentRecommendFeature;
  /** 欢迎页 */
  welcome?: WelcomeFeature;
  /** 加载更多 */
  loadMore?: LoadMoreFeature;
  /** 消息操作 */
  messageAction?: MessageActionFeature;
  /** 文件操作 */
  fileAction?: FileActionFeature;
  /** 源文件操作 */
  sourceAction?: SourceActionFeature;

  // === 其他 ===
  /** 分享模式 */
  isShareMode?: boolean;
  /** 外部传入的翻译函数 */
  t?: TranslateFn;
  /** 自定义内容区域容器类名 */
  boxClassName?: string;
}
