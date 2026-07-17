/**
 * Agent 反馈 Tab
 *
 * 根据 backendAgentType 动态渲染不同的反馈组件，并传递对应的 config 接口 type：
 * - knowledge (AI搜问): SearchFeedback
 * - workbench (小助理):  WorkAIFeedback, type='work_ai'
 * - chat (对话型):         WorkAIFeedback, type='chat'
 * - workflow (工作流):     WorkAIFeedback, type='workflow'
 */

import WorkAIFeedback from '@/views/work-ai/Feedback'
import { Feedback as SearchFeedback } from '@/views/search/feedback/Feedback'

interface AgentFeedbackTabProps {
  agentId?: string | number
  agentType?: string
  backendAgentType?: number
}

export function AgentFeedbackTab({ agentId, agentType, backendAgentType }: AgentFeedbackTabProps) {
  if (agentType === 'knowledge') {
    return (
      <div className="h-full p-6 bg-white overflow-hidden">
        <SearchFeedback agentId={agentId} />
      </div>
    )
  }

  // backendAgentType: 0=对话, 1=工作流/补全, 2=助理（默认 work_ai）
  const feedbackType =
    backendAgentType === 0 ? 'chat' : backendAgentType === 1 ? 'workflow' : 'work_ai'

  return (
    <div className="h-full p-6 bg-white overflow-hidden">
      <WorkAIFeedback agentId={agentId} type={feedbackType} />
    </div>
  )
}

export default AgentFeedbackTab
