// packages/shared-business/src/chat/types/message.ts

// ============================================================================
// 基础类型（非消息相关）
// ============================================================================

/** 流程记录 */
export interface ProcessRecord {
  step_code: string;
  status: 'start' | 'completed' | 'success' | 'streaming';
  message: string;
  data?: string | object;
}

export interface IntentData {
  intent?: string;
  skill_name?: string;
  confidence?: number;
  reasoning?: string;
  keywords?: string[];
  answer?: string;
  expanded_queries?: unknown;
}

export interface AgentRunReplayEvent {
  event_type?: string;
  type?: string;
  payload?: any;
  message_id?: string | number;
  [key: string]: any;
}

/** 技能运行项状态 */
export type SkillRunItemStatus = 'pending' | 'running' | 'completed';

/** 技能运行项 - 脚本 */
export interface SkillRunScriptItem {
  type: 'script';
  title: string;
  bash: string;
  output: string;
  status: SkillRunItemStatus;
}

/** 技能运行项 - LLM */
export interface SkillRunLlmItem {
  type: 'llm';
  title: string;
  content: string;
  status: SkillRunItemStatus;
}

/** 技能运行项 - 搜索 */
export interface SkillRunSearchItem {
  type: 'search';
  title: string;
  icon?: string;
  sourceCount?: number;
  tags?: string[];
  sources?: Array<{ title: string; url?: string; icon?: string }>;
  status?: SkillRunItemStatus;
}

/** 技能运行项 - 技能 */
export interface SkillRunSkillItem {
  type: 'skill';
  title: string;
  status: SkillRunItemStatus;
  skillName?: string;
  intentData?: {
    intent?: string;
    skill_name?: string;
    confidence?: number;
    reasoning?: string;
    keywords?: string[];
    answer?: string;
  };
  _bash?: string;
  _toolCallId?: string;
}

/** 技能运行项联合类型 */
export type SkillRunItem =
  | SkillRunScriptItem
  | SkillRunSearchItem
  | SkillRunSkillItem
  | SkillRunLlmItem;

// ============================================================================
// OpenClaw 类型
// ============================================================================

/** Openclaw 活动 */
export interface OpenClawInteractionOption {
  id?: string | number;
  value?: string | number | boolean;
  label?: string;
  title?: string;
  name?: string;
  description?: string;
  [key: string]: unknown;
}

export interface OpenClawInteractionInfo {
  id?: string;
  type?: string;
  method?: string;
  question?: string;
  toolCallId?: string;
  requestId?: string;
  options?: OpenClawInteractionOption[];
  [key: string]: unknown;
}

/** OpenClaw 活动 tone 类型 */
export type OpenClawActivityTone = 'neutral' | 'success' | 'warning' | 'error';

export interface OpenClawActivityItem {
  key: string;
  sessionId?: string;
  seq?: number;
  kind: string;
  title: string;
  summary?: string;
  detail?: string;
  createdAt?: string;
  tone?: OpenClawActivityTone;
  tool?: {
    toolCallId?: string;
    name?: string;
    displayName?: string;
    meta?: string;
    input?: string;
    output?: string;
    isError?: boolean;
  };
  requiresUserInput?: boolean;
  interaction?: OpenClawInteractionInfo;
  questions?: OpenClawInteractionInfo[];
  resolved?: boolean;
}

export type OpenClawTimelineItemType =
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'answer'
  | 'run_terminal'
  | 'output_files';

/** OpenClaw 时间线项 */
export interface OpenClawTimelineItem {
  key: string;
  mergeKey?: string;
  sessionId?: string;
  seq?: number;
  createdAt?: string;
  type: OpenClawTimelineItemType;
  title?: string;
  content?: string;
  detail?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'error';
  kind?: string;
  replace?: boolean;
  tool?: OpenClawActivityItem['tool'];
  requiresUserInput?: boolean;
  interaction?: OpenClawInteractionInfo;
  questions?: OpenClawInteractionInfo[];
  resolved?: boolean;
  files?: OutputFile[];
  activity?: OpenClawActivityItem;
}

/** OpenClaw Turn 事件 */
export interface OpenClawTurnEvent {
  eventId: string;
  sessionId?: string;
  seq?: number;
  kind: string;
  createdAt?: string;
  payload?: Record<string, unknown>;
  source?: 'stream' | 'events' | 'history';
  provisional?: boolean;
  replace?: boolean;
  messageId?: string | number;
  messageSeq?: number;
  segmentId?: string;
  turnId?: string;
  segmentType?: 'answer' | 'thinking' | 'tool_call' | 'tool_result' | 'run' | 'output_files';
  segmentIndex?: number;
  deltaIndex?: number;
  operation?: 'append' | 'replace' | 'close';
  visibility?: 'hidden' | 'stream' | 'final';
  final?: boolean;
}

/** OpenClaw Turn 状态 */
export interface OpenClawTurnState {
  turnKey: string;
  sessionId?: string;
  status?: 'streaming' | 'completed' | 'failed' | 'interrupted';
  maxSeq: number;
  events: OpenClawTurnEvent[];
  resolvedMessageId?: string | number;
}

/** OpenClaw Turn 投影 */
export interface OpenClawTurnProjection {
  timelineItems: OpenClawTimelineItem[];
  visibleAnswer: string;
  outputFiles: OutputFile[];
  activities: OpenClawActivityItem[];
  interrupted?: boolean;
  failed?: boolean;
  isStreaming?: boolean;
}

/** RAG 来源的 chunk 类型（FileItem.chunk_type / ChunkItem.chunk_type 字段） */
export type ChunkType =
  | 'web_search'
  | 'web_page'
  | 'knowledge'
  | 'knowledge_search'
  | 'summary'
  | 'knowledge_map'
  | 'graph_result'
  | 'wiki';

// ============================================================================
// 文件类型
// ============================================================================

/** 文件项 */
export interface FileItem {
  id: string | number;
  name?: string;
  file_name?: string;
  filename?: string;
  file_id?: string | number;
  file_path?: string;
  file_ext?: string;
  file_mime?: string;
  file_size?: number;
  file_url?: string;
  icon?: string;
  file_icon?: string;
  url?: string;
  preview_key?: string;
  library_id?: string | number;
  upload_file_id?: string | number;
  isfolder?: boolean;
  isspace?: boolean;
  islibrary?: boolean;
  iswiki?: boolean;
  title?: string;
  slug?: string;
  is_favorite?: boolean;
  chunk_type?: ChunkType;
  source_key?: string;
  source?: string;
  type?: 'wiki' | null
}

/** 输出文件 */
export interface OutputFile {
  id: string | number;
  file_name?: string;
  url?: string;
  preview_key?: string;
  preview_url?: string;
  download_url?: string;
  signed_download_url?: string;
  artifact_id?: string | number;
  upload_file_id?: string | number;
  mime_type?: string;
  size?: number;
  kind?: string;
  message_id?: string | number;
  source_kind?: string;
  base64?: string;
  content?: string;
  file_path?: string;
  is_favorite?: boolean;
}

// ============================================================================
// RAG 类型
// ============================================================================

/** 知识图谱实体 */
export interface GraphEntity {
  id: string;
  name?: string;
  description?: string;
  type?: string;
  properties?: Record<string, any>;
  chunk_ids?: string[];
  created_time?: number;
}

/** 知识图谱关系 */
export interface GraphRelation {
  id?: string;
  source_entity_id: string;
  target_entity_id: string;
  predicate?: string;
  chunk_ids?: string[];
  created_time?: number;
}

/** 知识图谱数据 */
export interface GraphData {
  entities?: GraphEntity[];
  relations?: GraphRelation[];
}

/** 知识库引用片段 */
export interface ChunkItem {
  chunk_id?: string;
  chunk_type?: ChunkType;
  content?: string;
  file_id?: string | number;
  file_name?: string;
  file_path?: string;
  file_icon?: string;
  library_id?: string | number;
  library_name?: string;
  library_icon?: string;
  source_key?: string;
  source?: string;
  source_type?: string;
  space_id?: string;
  space_name?: string;
  score?: number;
  url?: string;
  wiki_page_id?: string;
  graph?: GraphData;
}

/** 知识库搜索结果 */
export interface RagStats {
  type?: string;
  chunks?: ChunkItem[];
  files_search?: ChunkItem[];
  library_search?: ChunkItem[];
  file_quotations?: ChunkItem[];
  document_quotations?: ChunkItem[];
  document_search?: { chunks?: ChunkItem[] };
}

// ============================================================================
// 技能类型
// ============================================================================

/** 技能信息 */
export interface SkillInfo {
  id?: string | number;
  skill_id?: string | number;
  display_name?: string;
  skill_name?: string;
  binding_status?: string;
}

export type Skill = SkillInfo;
export type MessageFile = FileItem;
export type SpecifiedFile = FileItem;

// ============================================================================
// 消息类型（拆分版）
// ============================================================================

/**
 * 基础消息类型
 * 所有消息共享的字段
 */
export interface BaseMessage {
  id: string | number;
  agent_id?: string | number;
  conversation_id?: string | number;
  time?: string;
  /** 是否显示时间（历史数据为 true，实时数据为 false） */
  showTime?: boolean;
  /** 创建时间戳（毫秒） */
  created_time?: number;
  updated_time?: number;
  created_at?: string | number;
  updated_at?: string | number;
  question?: string;
  original_question?: string;
  answer?: string;
  content?: string;
  specified_content?: string;
  specified_files?: FileItem[];
  uploaded_files?: FileItem[];
  skill?: SkillInfo;
  reasoning_content?: string;
  reasoning_expanded?: boolean;
  outputFiles?: OutputFile[];
  rag_temp?: any;
  rag_stats?: RagStats | null;
  rag_search_text?: string;
  knowledge_graph?: boolean;
  process_records?: ProcessRecord[];
  skillRunItems?: SkillRunItem[];
  openclawActivities?: OpenClawActivityItem[];
  openclawTimelineItems?: OpenClawTimelineItem[];
  openclawTurn?: OpenClawTurnState;
  openclawProjection?: OpenClawTurnProjection;
  interrupted?: boolean;
  loading?: boolean;
  error?: boolean;
  showErrorDetails?: boolean;
  feedbackVisible?: boolean;
  feedback_type?: 'satisfied' | 'unsatisfied' | '';
  feedbackTypeOptions?: Map<string, boolean> | null;
  feedbackLoading?: boolean;
  submitBtnDisabled?: boolean;
  feedbackSuccessful?: boolean;
  description?: string;
  feedbackId?: number | null;
  _openclawTurnStartSeq?: number;
  _openclawClientMessageId?: string | number;
  _openclawActiveRequestId?: string | number;
}

/**
 * 用户消息
 * 仅包含用户发送的消息字段
 */
export interface UserMessage extends BaseMessage {
  role: 'user';
  question?: string;
  original_question?: string;
  /** 用户上传的文件 */
  uploaded_files?: FileItem[];
  /** 用户指定的文件 */
  specified_files?: FileItem[];
  /** 用户选择的文件 */
  user_files?: FileItem[];
  /** 技能信息（如果有） */
  skill?: SkillInfo;
  /** 原始用户消息（API 返回） */
  raw_user_message?: any;
}

/**
 * 反馈状态
 * 可用于助手消息
 */
export interface FeedbackState {
  feedback_type?: 'satisfied' | 'unsatisfied' | '';
  feedbackVisible?: boolean;
  feedbackTypeOptions?: Map<string, boolean> | null;
  submitBtnDisabled?: boolean;
  feedbackSuccessful?: boolean;
  description?: string;
  feedbackId?: number | null;
}

/**
 * 消息 UI 状态
 * 用于控制消息渲染
 */
export interface MessageUIState {
  loading?: boolean;
  error?: boolean;
  showErrorDetails?: boolean;
  reasoning_expanded?: boolean;
}

/**
 * 助手消息 - 普通模式
 * 标准聊天场景
 */
export interface AssistantMessageNormal extends BaseMessage, FeedbackState, MessageUIState {
  role: 'assistant';
  /** 回答内容 */
  answer?: string;
  /** 内容（兼容字段） */
  content?: string;
  /** 推理内容 */
  reasoning_content?: string;
  /** 输出文件 */
  outputFiles?: OutputFile[];
  /** RAG 统计数据 */
  rag_stats?: RagStats | null;
  /** 流程记录 */
  process_records?: ProcessRecord[];
  /** 技能运行项 */
  skillRunItems?: SkillRunItem[];
  /** 原始助手消息（API 返回） */
  raw_assistant_message?: any;
}

/**
 * 助手消息 - OpenClaw 模式
 * WorkBuddy 运行时场景
 */
export interface AssistantMessageOpenClaw extends BaseMessage, FeedbackState, MessageUIState {
  role: 'assistant';
  /** OpenClaw 活动列表 */
  openclawActivities?: OpenClawActivityItem[];
  /** OpenClaw 时间线项 */
  openclawTimelineItems?: OpenClawTimelineItem[];
  /** OpenClaw Turn 状态 */
  openclawTurn?: OpenClawTurnState;
  /** OpenClaw 投影数据 */
  openclawProjection?: OpenClawTurnProjection;
  /** OpenClaw 内部字段 */
  _openclawTurnStartSeq?: number;
  _openclawClientMessageId?: string | number;
  _openclawActiveRequestId?: string | number;
}

/**
 * 消息联合类型
 * 根据 role 字段区分用户消息和助手消息
 */
export type Message = UserMessage | AssistantMessageNormal | AssistantMessageOpenClaw;

// ============================================================================
// 其他类型
// ============================================================================

/** 发送消息选项 */
export interface SendMessageOptions {
  question: string;
  agent_id: string | number;
  conversation_id: string | number;
  modelId?: string | number;
  completion_params?: Record<string, any>;
  messageList?: Message[];
  links?: SpecifiedFile[];
  /**
   * 选中的动态知识（空间和页面混合数组，与 links 同级，用于 UI 展示和 wiki_search_config 构建）
   */
  wikis?: Array<{
    id: string
    name: string
    wikiType?: 'space' | 'page'
    icon?: string
    title?: string
    slug?: string
    summary?: string
    space_id?: string
  }>;
  /**
   * 知识源配置（直通模式）
   * 与 agent-create/useAgentPreviewSender 的 KnowledgeSourceConfig 对齐
   * 包含 state + 三个启用标志
   */
  knowledgeSource?: {
    state: {
      allKnowledge: boolean
      networkSearch: boolean
      knowledgeGraph: boolean
      wiki: boolean
    }
    graphEnabled: boolean
    webSearchEnabled: boolean
    wikiEnabled: boolean
  }
  library?: { value?: Array<string | number> };
  agentInfo?: any;
  files?: any[];
  fileInfo?: any;
  options?: {
    prompt?: string;
    text?: string;
  };
  minimalParams?: boolean;
  openclaw?: boolean;
  openclawStartSeq?: number;
  openclawConversationTitle?: string;
  skill?: Skill;
  type?: string;
  onMessageListChange?: (updater: (list: Message[]) => Message[], newMessage?: Message) => void;
  onOpenClawConversationResolved?: (conversationId: string) => void;
  onOpenClawEventSeqChange?: (conversationId: string, seq: number) => void;
}

/**
 * ChatMessages 功能配置
 *
 * **数据驱动渲染**：除 `menu` 外的所有功能已改为数据驱动渲染。
 */
export interface ChatMessagesFeatures {
  /** 消息菜单配置（唯一需要配置的功能） */
  menu?: {
    copy?: boolean;
    regenerate?: boolean;
    share?: boolean;
    addAsMd?: boolean;
    feedback?: boolean;
  };
}

/** Source 引用数据 */
export interface SourceReferenceData {
  element?: HTMLDivElement;
  sourceType: string;
  sourceNumber: number;
}

// ============================================================================
// 类型守卫函数
// ============================================================================

/** 判断是否为用户消息 */
export function isUserMessage(message: Message): message is UserMessage {
  return message.role === 'user';
}

/** 判断是否为助手消息 */
export function isAssistantMessage(message: Message): message is AssistantMessageNormal | AssistantMessageOpenClaw {
  return message.role === 'assistant';
}

/** 判断是否为 OpenClaw 模式的助手消息 */
export function isOpenClawAssistantMessage(message: Message): message is AssistantMessageOpenClaw {
  return message.role === 'assistant' && Boolean(message.openclawTurn || message.openclawProjection);
}

/** 判断是否为普通模式的助手消息 */
export function isNormalAssistantMessage(message: Message): message is AssistantMessageNormal {
  return message.role === 'assistant' && !message.openclawTurn && !message.openclawProjection;
}
