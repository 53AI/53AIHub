import { memo } from 'react'
import { ExclamationCircleOutlined } from '@ant-design/icons'

interface AgentNotFoundProps {
  message?: string
  onRetry?: () => void
}

function AgentNotFoundInner({ message = '智能体不存在', onRetry }: AgentNotFoundProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-[#eaf3ff] to-white">
      <div className="flex flex-col items-center gap-4 text-center p-8">
        <ExclamationCircleOutlined className="text-5xl text-gray-400" />
        <div className="text-xl text-gray-600">{message}</div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-6 py-2 bg-[#2563EB] text-white rounded-lg hover:bg-[#1d4ed8] transition-colors text-sm"
          >
            重试
          </button>
        )}
      </div>
    </div>
  )
}

export const AgentNotFound = memo(AgentNotFoundInner)
AgentNotFound.displayName = 'AgentNotFound'