import { get, post } from '../../config'
import type { AgentRun } from './types'

export const agentRunApi = {
  /**
   * 获取会话最近一次 Run
   * GET /api/conversations/{conversation_id}/latest-run
   */
  latest: (conversationId: string) =>
    get<AgentRun.Info>(`/api/conversations/${conversationId}/latest-run`),

  /**
   * 获取会话 Run 历史列表
   * GET /api/conversations/{conversation_id}/agent-runs
   */
  list: (conversationId: string, offset = 0, limit = 20) =>
    get<AgentRun.ListResponse>(`/api/conversations/${conversationId}/agent-runs`, {
      params: { offset, limit },
    }),

  /**
   * 获取单个 Run 详情
   * GET /api/agent-runs/{run_id}
   */
  get: (runId: string) =>
    get<AgentRun.Info>(`/api/agent-runs/${runId}`),

  /**
   * 获取 Run 事件补发
   * GET /api/agent-runs/{run_id}/events
   */
  events: (runId: string, afterSeq = 0, limit = 200) =>
    get<{ events: AgentRun.EventRaw[] }>(`/api/agent-runs/${runId}/events`, {
      params: { after_seq: afterSeq, limit },
    }),

  /**
   * 获取 Run 回放数据
   * GET /api/agent-runs/{run_id}/replay
   */
  replay: (runId: string, afterSeq = 0, limit = 200) =>
    get<AgentRun.ReplayResponse>(`/api/agent-runs/${runId}/replay`, {
      params: { after_seq: afterSeq, limit },
    }),

  /**
   * 取消 Run
   * POST /api/agent-runs/{run_id}/cancel
   */
  cancel: (runId: string) =>
    post<void>(`/api/agent-runs/${runId}/cancel`, undefined)
}

export default agentRunApi
