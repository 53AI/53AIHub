/**
 * Agent 数据 Tab
 *
 * 根据 agent_type 动态渲染不同的统计组件：
 * - knowledge (AI搜问): Record
 * - 其他类型: WorkAIStatistic
 */

import WorkAIStatistic from '@/views/work-ai/Statistic'
import { Record } from '@/views/search/record/Record'

interface AgentDataTabProps {
  agentId?: string | number
  agentType?: string
}

export function AgentDataTab({ agentId, agentType }: AgentDataTabProps) {
  if (agentType === 'knowledge') {
    return (
      <div className="h-full p-6 bg-white overflow-hidden">
        <Record agentId={agentId} agentType={agentType} />
      </div>
    )
  }

  return (
    <div className="h-full p-6 bg-white overflow-hidden">
      <WorkAIStatistic agentId={agentId} showSourceFilter showStatusFilter={false} />
    </div>
  )
}

export default AgentDataTab
