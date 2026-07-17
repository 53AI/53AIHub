import type { SkillInfo } from "../types/message";

/**
 * API Adapter Interfaces
 * Plugins implement these interfaces to provide data access
 */

export interface ChatCompletionParams {
  conversation_id?: string | number;
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream: boolean;
  enable_process_steps?: boolean;
  frequency_penalty?: number;
  presence_penalty?: number;
  temperature?: number;
  top_p?: number;
  knowledge_base_ids?: Array<string | number>;
  file_ids?: Array<string | number>;
  space_ids?: Array<string | number>;
  message_file_id?: string;
  solo_file_mode?: boolean;
  search_config?: any;
  web_search_config?: any;
  enable_graph_search?: boolean;
  completion_params?: any;
  metadata?: Record<string, any>;
}

export interface ConversationControlParams {
  action: "stop" | "respond_interruption" | "submit_answer" | "resolve_interruption";
  [key: string]: any;
}

export interface IConversationApi {
  create(agentId: string, question: string, title?: string, type?: string): Promise<any>;
  list(agentId: string, params?: { conversation_type?: string; offset?: number; limit?: number }): Promise<any>;
  messages(conversationId: string, params?: { offset?: number; limit?: number; fresh?: boolean }): Promise<any>;
  events?(conversationId: string, params?: { offset?: number; limit?: number; after_seq?: number; fresh?: boolean }): Promise<any>;
  snapshot?(conversationId: string, params?: { after_seq?: number; fresh?: boolean }): Promise<any>;
  control?(conversationId: string, data: ConversationControlParams): Promise<any>;
  ensureSkill?(skill: { id?: string | number; skill_id?: string | number; skill_name?: string; display_name?: string }): Promise<any>;
  edit(conversationId: string | number, data: { title: string }): Promise<any>;
  del(conversationId: string | number): Promise<any>;
  completions(
    params: ChatCompletionParams,
    options: {
      responseType: "stream";
      onDownloadProgress: (e: any) => void;
      signal?: AbortSignal;
    }
  ): Promise<any>;
}

export interface IAgentApi {
  detail(agentId: string | number): Promise<any>;
  list(): Promise<any>;
  myDetail(agentId: string | number): Promise<any>;
  myList(): Promise<any>;
}

export interface IUploadApi {
  upload(file: File, type?: string): Promise<any>;
}

export interface IWorkflowApi {
  run(
    data: {
      conversation_id: string | number;
      model: string;
      parameters: Record<string, any>;
      stream: boolean;
    },
    options?: { onDownloadProgress?: (e: any) => void; responseType?: string; signal?: AbortSignal }
  ): Promise<any>;
}

export interface ISkillApi {
  listMySkills(): Promise<SkillInfo[]>;
  openSkillLibrary?(): void;
}

/**
 * Agent 设置对象类型
 */
export interface IAgentSettings {
  opening_statement?: string;
  suggested_questions?: Array<{ id: string; content: string }>;
  input_fields?: Array<{
    id: string;
    variable: string;
    label: string;
    type: string;
    required?: boolean;
    options?: Array<{ label: string; value: string }>;
    multiple?: boolean;
    max_length?: number;
    show_word_limit?: boolean;
    desc?: string;
    file_limit?: number;
    file_size?: number;
    file_accept?: string[];
  }>;
  output_fields?: Array<{
    id: string;
    variable: string;
    label?: string;
    type: string;
  }>;
  relate_agents?: any[];
  file_parse?: { enable: boolean };
  image_parse?: { vision: boolean; enable: boolean };
}

/**
 * Agent 自定义配置类型
 */
export interface IAgentCustomConfig {
  agent_mode?: 'chat' | 'completion';
  agent_type?: string;
  openclaw_app_secret?: string;
}

/**
 * Agent 信息类型
 * 被 ChatView 和 CompletionView 共用
 */
export interface IAgentInfo {
  agent_id: string | number;
  name: string;
  logo?: string;
  description?: string;
  configs?: string | Record<string, any>;
  settings?: IAgentSettings;
  settings_obj?: IAgentSettings;
  custom_config_obj?: IAgentCustomConfig;
  use_cases?: any[];
  /** 用户组 IDs - 用于 AuthTagGroup 显示使用范围 */
  user_group_ids?: number[];
  // 内部用户
  scopes?: { scoped_type: string; target_id: number }[]
  /** 智能体用途类型 - 用于判断是否支持反馈功能 */
  agent_usage?: number;
  /**
   * backend_agent_type 数值(0=对话, 1=工作流/补全, 2=助理)。
   * 由 ChatContainer 从 currentAgent.backend_agent_type 注入。
   * 与 custom_config_obj.agent_mode(仅 'chat'/'completion')语义对齐但更全(包含 assistant=2)。
   */
  agent_type?: number;
}

// ===== Recent Used API =====

/** 资源类型：0=空间, 1=知识库, 2=文件 */
export type RecentUsedResourceType = 0 | 1 | 2;

/** 保存最近使用记录请求项 */
export interface RecentUsedSaveItem {
  resource_type: RecentUsedResourceType;
  resource_id: string | number;
}

/** 最近使用记录 */
export interface IRecentUsedApi {
  /** 保存最近使用记录（单条/批量） */
  save(data: RecentUsedSaveItem | RecentUsedSaveItem[]): Promise<unknown>;
}

// ===== Agent Run API =====

/** Agent Run 状态 */
export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'requires_action'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Agent Run 事件类型 */
export type AgentRunEventType =
  | 'run.created'
  | 'run.status_changed'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'
  | 'message.delta'
  | 'message.completed'
  | 'step.created'
  | 'process.step'
  | 'heartbeat';

/** 终端事件：到达这些事件时自动断开 SSE 连接 */
export const AGENT_RUN_TERMINAL_EVENTS: AgentRunEventType[] = [
  'run.completed',
  'run.failed',
  'run.cancelled',
];

/** 运行中状态：这些状态表示 run 仍在执行 */
export const AGENT_RUN_RUNNING_STATUSES: AgentRunStatus[] = [
  'queued',
  'running',
  'requires_action',
];

/** Agent Run 信息 */
export interface AgentRunInfo {
  id: string;
  run_id: string;
  conversation_id: string;
  message_id?: string;
  status: AgentRunStatus;
  created_at: string;
  updated_at: string;
}

/** Agent Run 事件 */
export interface AgentRunEvent {
  seq: number;
  type: AgentRunEventType;
  payload: Record<string, unknown>;
  created_at?: string;
  message_id?: string;
  run_id?: string;
}

/** SSE 连接控制 */
export interface AgentRunConnection {
  disconnect(): void;
}

/** Agent Run SSE 回调 */
export interface AgentRunCallbacks {
  onEvent: (event: AgentRunEvent) => void;
  onError: (error: Error) => void;
  onReconnect: () => void;
  onTerminal: () => void;
}

/** Agent Run API 适配器 */
export interface IAgentRunApi {
  /** 获取会话的最新 run */
  latest(conversationId: string): Promise<{ run: AgentRunInfo | null; isrunning: boolean }>;
  /** 获取 run 的历史事件 */
  events(runId: string, params?: { after_seq?: number; limit?: number }): Promise<AgentRunEvent[]>;
  /** 获取 run 详情 + 事件（用于恢复） */
  replay(runId: string, params?: { after_seq?: number }): Promise<{ run: AgentRunInfo; events: AgentRunEvent[] }>;
  /** 取消 run */
  cancel(runId: string): Promise<void>;
  /** 建立 SSE 连接 */
  subscribe(runId: string, callbacks: AgentRunCallbacks, params?: { after_seq?: number }): AgentRunConnection;
}
