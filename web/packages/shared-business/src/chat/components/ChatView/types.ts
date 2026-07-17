import type { ReactNode } from "react";
import type { IAgentInfo } from "../../adapters/types";
import type { Message, OutputFile, FileItem, ChunkItem, Skill } from "../../types";
import type { Lang } from "../../i18n";
import type { AgentRecommendFeature, AuthTagsSlotProps } from "../../types/features";
import type {
  MentionFeature,
  SkillFeature,
  SenderSlots,
} from "@km/hub-ui-x-react";

// === Slot Props ===

export interface HeaderSlotProps {
  agentInfo: IAgentInfo;
  lang: Lang;
  setLang: (lang: Lang) => void;
  showGuide?: boolean;
  onGuideChange?: (show: boolean) => void;
}

export interface AgentSelectorSlotProps {
  agentInfo: IAgentInfo;
  onSelect: (agent: IAgentInfo) => void;
}

// === Feature Groups ===

export interface HistoryFeature {
  /** 是否启用历史侧边栏，默认 true */
  enabled?: boolean;
}

export interface NewConversationFeature {
  /** 是否启用新会话按钮，默认 true */
  enabled?: boolean;
}

export interface LanguageSwitcherFeature {
  /** 是否启用语言切换，默认 true */
  enabled?: boolean;
}

export interface GuideFeature {
  /** 是否启用使用指引，默认 true */
  enabled?: boolean;
}

export interface WelcomeFeature {
  /** 是否显示欢迎页，默认 true */
  show?: boolean;
  /** 工作台入口欢迎布局 - 居中显示标题描述和 suggestions */
  indexLayout?: boolean;
}

export interface FileUploadFeature {
  /** 是否启用文件上传 */
  enabled?: boolean;
  /** 自定义上传函数 */
  request?: (file: File) => Promise<any>;
  /** 接受的文件类型 */
  acceptTypes?: string;
  /** 最大文件大小（字节） */
  maxFileSize?: number;
  /** 是否启用拖拽上传 */
  enableDrag?: boolean;
  /** 是否启用粘贴上传 */
  enablePaste?: boolean;
  /** 是否允许多文件选择 */
  allowMultiple?: boolean;
  /** 是否允许仅文件发送（无文本） */
  allowSendWithFiles?: boolean;
}

export interface MessageFeature {
  /** 是否显示消息操作菜单，默认 true */
  showMenu?: boolean;
  /** 消息发送完成回调 */
  onSent?: () => void;
  /** 输出文件预览回调 */
  onPreviewOutputFile?: (file: OutputFile, message: Message) => void;
  /** 输出文件收藏/取消收藏回调 */
  onOutputFileFavorite?: (file: OutputFile, message: Message) => void;
  /** 输出文件收藏状态检查回调（进入视野时触发） */
  onOutputFileCheckFavorite?: (fileIds: string[], message: Message) => void;
  /** 添加回答到知识库回调 */
  onSaveToKnowledge?: (message: Message) => void;
  /** 用户文件点击回调（指定文件、上传文件等） */
  onFileClick?: (file: FileItem) => void;
  /** 源文件点击回调（知识库引用片段） */
  onSourceClick?: (source: ChunkItem, message: Message) => void;
  /** 打开知识库侧边栏回调 */
  onOpenKnowledgePanel?: (message: Message) => void;
}

export interface ShareFeature {
  /** 是否启用分享功能 */
  enabled?: boolean;
  /** 创建分享链接回调 */
  onCreate?: (messageIds: (string | number)[], conversationId: string | number, selectAll: boolean) => Promise<string>;
}

export interface PermissionFeature {
  /** 权限检查回调 */
  checkAccess?: (resourceId?: string | number) => boolean | Promise<boolean>;
}

export interface CompletionFeature {
  /** 完成回调 */
  onComplete?: () => void;
}

export interface OpenClawFeature {
  /** 是否启用 OpenClaw 模式 */
  enabled?: boolean;
  /** 是否禁用输入 */
  inputDisabled?: boolean;
  /** 输入禁用原因 */
  inputDisabledReason?: string;
  /** 初始会话解析中 */
  initialConversationResolving?: boolean;
  /** 跳过初始加载 */
  skipInitialLoad?: boolean;
}

// === Send Context (透传给 useChatSend.sendMessage) ===

/**
 * ChatContainer 按 agent_usage 注入的发送上下文。
 *
 * 用于让 ChatView 的 handleSend 在调用 useChatSend.sendMessage 时携带与
 * 原 knowledge/chat.tsx (agent_usage=1) / IndexChat.tsx (agent_usage=4)
 * 一致的业务参数(type / networkSearch / knowledgeGraph / library /
 * modelId / agentInfo / minimalParams)。
 */
export interface SendContext {
  /** 业务类型标识,如 "work-ai" / "km-ai-search" / "agent" */
  type?: string;
  /** 是否启用联网搜索(影响 completions.search_config / web_search_config) */
  networkSearch?: boolean;
  /** 是否启用知识图谱(影响 completions.enable_graph_search) */
  knowledgeGraph?: boolean;
  /** 当前生效的 library(决定 knowledge_base_ids) */
  library?: { name: string; value: string[]; isSpace: boolean };
  /**
   * 是否选中"全部知识"(km-ai-search KnowledgeSourceSelector 默认状态)。
   * 为 true 时 useChatSend.sendMessage 会显式发送 `knowledge_base_ids: ["all"]`,
   * 避免在没有 fallback 的情况下被识别成"无知识库"。
   * 联网搜索与具体 library 选择优先级高于此字段。
   */
  allKnowledge?: boolean;
  /** 当前选中的模型 id(用于 modelId 拼接 model 字段) */
  modelId?: number | string;
  /** 完整 agentInfo(用于 search_config / web_search_config / rerank_config) */
  agentInfo?: IAgentInfo;
  /**
   * 是否走精简模式(useChatSend.minimalParams)。
   * - knowledge / work-ai 场景应设为 false(走完整模式,启用知识库/联网/文件参数)
   * - openclaw / 普通 agent 场景可保持 true(走精简模式)
   */
  minimalParams?: boolean;
  /**
   * @ 提及链接列表(由 ChatContainer 注入,与 Sender 的 atList 合并后传给 useChatSend)。
   * - 包含用户选中的 file / library / space
   * - 用于构建 messages 中的 specified_files(对齐原版 IndexChat.tsx sendMessage 调用)
   * - 如果未传,ChatView 会优先使用 Sender 透传的 atList
   */
  links?: any[];
  /**
   * 消息增强选项(注入 messages 数组)
   * - prompt: 插入为 system message
   * - text: 插入为 specified_content(对齐原版 useChatSend 的 sendOptions 字段)
   */
  options?: {
    prompt?: string;
    text?: string;
  };
}

// === UI Slots ===

export interface ChatViewSlots {
  /** 自定义 Header */
  header?: (props: HeaderSlotProps) => ReactNode;
  /** 输入框前的智能体选择器 */
  agentSelector?: (props: AgentSelectorSlotProps) => ReactNode;
  /** 欢迎页 AuthTags 渲染 */
  authTags?: (props: AuthTagsSlotProps) => ReactNode;
  /** 版权信息 */
  copyright?: () => ReactNode;
  /**
   * @deprecated 推荐使用 senderBelowExtras。
   * 输入框下方扩展区域 - 通过 Sender 内部 extrasLeft slot 实现。
   * 注意:此 slot 会覆盖 Sender 内部 toolbar(@ / 技能 / 附件 三个 icon)。
   */
  senderLeftExtras?: ReactNode;
  /**
   * Sender 下方独立扩展区域 - 渲染在 ChatInput 之外,与 Sender 内部 toolbar 解耦。
   * 用于在工作台入口(work-ai 模式)显示技能 chips / 我的技能弹窗 等与 Sender 内部 toolbar 平级的内容。
   * 仅在 welcomeIndexLayout 且 messageList 为空时渲染(对齐原版 IndexChat.tsx line 1828 的空态条件)。
   */
  senderBelowExtras?: ReactNode;
  // === Sender 透传（与 agent_usage 分支配合使用） ===
  /** @ 提及 feature,透传给底层 Sender */
  senderMention?: MentionFeature;
  /** / 技能 feature,透传给底层 Sender(目前仅 work-ai 使用) */
  senderSkill?: SkillFeature;
  /** Sender 内部 slot(mentionDropdown / skillDropdown / linkList / actionBar 等) */
  senderSlots?: SenderSlots;
  /** 覆盖 Sender 占位符 */
  senderPlaceholder?: string;
  /** 操作按钮位置(actions | extras) */
  senderActionPosition?: "actions" | "extras";
}

// === ChatInput SendData (扩展以透传 @ / 技能) ===

/**
 * Sender.onSend 透传数据。
 * 与 @km/hub-ui-x-react SenderSendData 对齐(只保留 ChatView 关心的字段)。
 */
export interface SendData {
  textContent?: string;
  pureTextContent?: string;
  files?: any[];
  /** @ 提及列表(由 Sender 内部 mention.list 在发送时 snapshot) */
  atList?: any[];
  /** / 技能列表(由 Sender 内部 skill.list 在发送时 snapshot — 仅 display_name) */
  skillList?: string[];
  /**
   * / 技能完整信息(由 Sender 内部 skill.list 在发送时 snapshot)。
   * 优先使用此项区分 skill_name(后端路由)与 display_name(展示)。
   */
  selectedSkills?: Array<{ display_name: string; skill_name?: string }>;
}

// === ChatInput 内部类型(供 ChatInput.tsx 内部使用) ===

export interface ChatInputSlots {
  /** 左侧按钮区域 - 用于 AgentTooltip 等组件 */
  leftButtons?: () => React.ReactNode;
  /** 输入框下方扩展区域 - 用于模型选择器、知识源选择器等 */
  renderLeftExtras?: React.ReactNode;
  /** 透传给 Sender 的 slots(linkList / mentionDropdown / skillDropdown / actionBar 等) */
  senderSlots?: SenderSlots;
  /** 覆盖 Sender 占位符 */
  senderPlaceholder?: string;
}

export interface ChatInputProps {
  // === 核心 ===
  /** 输入框值 */
  inputValue: string;
  /** 值变化回调 */
  onChange: (value: string) => void;
  /** 发送回调 */
  onSend: (data: SendData | string, files?: any[]) => void;
  /** 停止回调 */
  onStop: () => void;
  /** 是否正在流式输出 */
  isStreaming: boolean;

  // === UI 插槽 ===
  slots?: ChatInputSlots;

  // === 功能分组 ===
  /** 历史侧边栏 */
  history?: HistoryFeature & {
    /** 打开历史回调 */
    onOpen?: () => void;
  };
  /** 新会话按钮 */
  newConversation?: NewConversationFeature & {
    /** 创建新会话回调 */
    onCreate?: () => void;
  };
  /** 文件上传 */
  fileUpload?: FileUploadFeature;
  /** 输入状态 */
  inputState?: InputStateFeature;
  /** @deprecated 请使用 inputState.disabled */
  disabled?: boolean;
  /** @deprecated 请使用 inputState.stopDisabled */
  stopDisabled?: boolean;
  /** @deprecated 请使用 inputState.disabledReason */
  disabledReason?: string;
  /** @ 提及 feature(透传到 Sender) */
  mention?: MentionFeature;
  /** / 技能 feature(透传到 Sender) */
  skill?: SkillFeature;
  /** @deprecated 兼容旧 ChatInput OpenClaw 技能 props */
  showSkill?: boolean;
  /** @deprecated 兼容旧 ChatInput OpenClaw 技能 props */
  skillOptions?: Skill[];
  /** @deprecated 兼容旧 ChatInput OpenClaw 技能 props */
  selectedSkill?: Skill | null;
  /** @deprecated 兼容旧 ChatInput OpenClaw 技能 props */
  onSelectSkill?: (skill: Skill) => void;
  /** @deprecated 兼容旧 ChatInput OpenClaw 技能 props */
  onRemoveSkill?: () => void;
  /** @deprecated 兼容旧 ChatInput OpenClaw 技能 props */
  onOpenSkillLibrary?: () => void;
  /** 操作按钮位置(actions | extras) */
  actionPosition?: "actions" | "extras";

  // === 其他 ===
  /** 占位符文本 */
  placeholder?: string;
  /** 调用方覆盖的 Sender 占位符(优先级高于 placeholder) */
  senderPlaceholder?: string;
  /** 容器类名 */
  boxClassName?: string;
}

export interface InputStateFeature {
  /** 是否禁用输入 */
  disabled?: boolean;
  /** 是否禁用停止按钮 */
  stopDisabled?: boolean;
  /** 禁用原因 */
  disabledReason?: string;
}

// === Main Props ===

export interface ChatViewProps {
  // === 核心 ===
  /** 智能体 ID（必填） */
  agentId: string | number;
  /** 初始会话 ID */
  initialConversationId?: string | number;
  /** 直接传入智能体信息，跳过 API 加载 */
  agentInfo?: IAgentInfo;
  /** 用户头像 URL（用于用户消息气泡；与 agent 头像分离） */
  userAvatar?: string;
  /** 是否同步 agent_id/conversation_id 到 URL，默认 true */
  syncToUrl?: boolean;

  // === UI 插槽 ===
  slots?: ChatViewSlots;
  /** 自定义头部渲染 */
  renderHeader?: (props: {
    agentInfo: IAgentInfo;
    lang: Lang;
    setLang: (lang: Lang) => void;
    showGuide?: boolean;
    onGuideChange?: (show: boolean) => void;
  }) => ReactNode;

  // === 功能分组 ===
  /** @deprecated 请使用 history/newConversation/fileUpload/openclaw 等分组 prop */
  features?: {
    history?: boolean;
    newConversation?: boolean;
    languageSwitcher?: boolean;
    guide?: boolean;
    welcome?: boolean;
    fileUpload?: boolean;
    share?: boolean;
    openclaw?: boolean;
    messageMenu?: boolean;
    showWelcome?: boolean;
    indexWelcomeLayout?: boolean;
    showRelatedScene?: boolean;
    enableDragUpload?: boolean;
    allowMultiple?: boolean;
    allowSendWithFiles?: boolean;
    enablePasteUpload?: boolean;
    openclawInputDisabled?: boolean;
    openclawInputDisabledReason?: string;
    initialConversationResolving?: boolean;
    skipInitialLoad?: boolean;
    timeout?: number;
  };
  /** 历史侧边栏 */
  history?: HistoryFeature;
  /** 新会话按钮 */
  newConversation?: NewConversationFeature;
  /** 语言切换 */
  languageSwitcher?: LanguageSwitcherFeature;
  /** 使用指引 */
  guide?: GuideFeature;
  /** 欢迎页 */
  welcome?: WelcomeFeature;
  /** 文件上传 */
  fileUpload?: FileUploadFeature;
  /** 智能体推荐与跳转 */
  agentRecommend?: AgentRecommendFeature;
  /** 消息操作 */
  message?: MessageFeature;
  /** @deprecated 请使用 message.onSent */
  onMessageSent?: () => void;
  /** @deprecated 请使用 message.onPreviewOutputFile */
  onOutputFilePreview?: (file: OutputFile, message: Message) => void;
  /** @deprecated 请使用 message.onOutputFileFavorite */
  onOutputFileFavorite?: (file: OutputFile, message: Message) => void;
  /** @deprecated 请使用 message.onOutputFileCheckFavorite */
  onOutputFileCheckFavorite?: (fileIds: string[], message: Message) => void;
  /** @deprecated 请使用 message.onSaveToKnowledge */
  onAddAsMd?: (message: Message) => void;
  /** @deprecated 请使用 message.onFileClick */
  onFileClick?: (file: FileItem) => void;
  /** @deprecated 请使用 message.onSourceClick */
  onSourceClick?: (source: ChunkItem, message: Message) => void;
  /** @deprecated 请使用 message.onOpenKnowledgePanel */
  onOpenKnowledgePanel?: (message: Message) => void;
  /** @deprecated OpenClaw 首次会话解析完成回调 */
  onOpenClawConversationResolved?: (conversation: {
    conversation_id: string;
    agent_id?: string | number;
    title?: string;
    question?: string;
    created_time?: number;
    updated_time?: number;
  }) => void;
  /** 分享功能 */
  share?: ShareFeature;
  /** 权限检查 */
  permission?: PermissionFeature;
  /** OpenClaw 模式 */
  openclaw?: OpenClawFeature;

  /**
   * 发送上下文(由 ChatContainer 按 agent_usage 注入)
   *
   * - knowledge (agent_usage=1): 透传 type/networkSearch/knowledgeGraph/library/modelId
   * - work-ai (agent_usage=4):   透传 type/library/networkSearch/modelId
   * - 其他:                       不传(ChatView 维持默认精简模式)
   *
   * ChatView 的 handleSend 会原样把这些字段转发给 useChatSend().sendMessage(),
   * 确保共享组件对业务参数的处理与原 knowledge/chat.tsx / IndexChat.tsx 一致。
   */
  sendContext?: SendContext;

  // === 其他 ===
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 容器类名 */
  boxClassName?: string;
}

export interface ChatViewRef {
  reload: () => void;
  newConversation: () => void;
  openHistory: () => void;
  showShare: () => void;
  sendMessage: (content: string) => void;
  setPrompt: (content: string) => void;
  /**
   * 用 updater 局部更新消息列表。
   * 典型用例：在外部更新单条消息的 `outputFiles[*].is_favorite` 状态。
   */
  updateMessage: (updater: (message: Message) => Message) => void;
}
