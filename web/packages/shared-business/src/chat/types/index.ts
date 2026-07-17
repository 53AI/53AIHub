export * from './message';
export * from './features';
export * from './regenerate';
import type { AgentRunInfo } from '../adapters/types';

/** 会话信息 */
export interface ConversationInfo {
  conversation_id: string | number;
  title?: string;
  created_time?: number | string;
  updated_time?: number | string;
  created_at?: string;
  updated_at?: string;
  agent_id?: string | number;
  virtual_id?: string;
  top?: number;
  is_valid?: number;
  /**
   * 该会话最新的 run（用于页面刷新后恢复运行状态）
   *
   * 为 null 时表示该会话没有运行中的 run；
   * status 属于 running 类时表示正在运行。
   */
  latest_run?: AgentRunInfo | null;
}
