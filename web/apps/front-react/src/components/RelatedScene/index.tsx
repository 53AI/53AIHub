import { useMemo } from 'react'
import { Divider } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import { useConversationStore } from '@/stores/modules/conversation'
import { useCurrentAgent } from '@/stores/modules/agent'
import './related-scene.css'

interface OutputField {
  id: string
  label: string
  value: string
  variable: string
}

interface RelatedSceneItem {
  scene: string
  agent_id: string
  name: string
  description: string
  logo: string
  execution_rule?: string
  is_workflow?: boolean
  field_mapping: Record<string, string>
}

interface RelatedSceneProps {
  isWorkflow?: boolean
  output: OutputField[] | string
  onInitAgent?: () => void
}

export function RelatedScene({ isWorkflow = false, output, onInitAgent }: RelatedSceneProps) {
  const currentAgentId = useConversationStore((state) => state.current_agentid)
  const setNextAgentPrepare = useConversationStore((state) => state.setNextAgentPrepare)
  const setCurrentState = useConversationStore((state) => state.setCurrentState)

  const currentAgent = useCurrentAgent()

  const relateAgents = useMemo(() => {
    return currentAgent?.settings_obj?.relate_agents || []
  }, [currentAgent])

  const getParameter = (): OutputField[] => {
    if (isWorkflow) return output as OutputField[]
    return [
      {
        id: 'output',
        label: '',
        value: output as string,
        variable: 'text',
      },
    ]
  }

  const handleNextAgent = (item: RelatedSceneItem) => {
    const parameters = getParameter()
    setNextAgentPrepare({
      agent_id: item.agent_id,
      execution_rule: item.execution_rule,
      is_workflow: typeof item.is_workflow === 'boolean' ? item.is_workflow : true,
      parameters: Object.keys(item.field_mapping).reduce((acc, key) => {
        acc[key] = item.field_mapping[key].replace(/\{\#(.*?)\#\}/g, (match, p1) => {
          return parameters.find((item) => item.variable === p1)?.value || ''
        })
        return acc
      }, {} as Record<string, string>),
    })
    setCurrentState(item.agent_id, 0)
    if (item.agent_id === currentAgentId) {
      setTimeout(() => {
        onInitAgent?.()
      }, 0)
    }
  }

  if (!relateAgents.length) return null

  return (
    <div className="related-scene">
      {isWorkflow ? (
        <Divider className="related-scene-divider">
          <span className="related-scene-divider-text">下一步操作</span>
        </Divider>
      ) : (
        <div className="flex items-center">
          <SvgIcon name="related" stroke className="text-secondary" />
          <p className="pl-2 text-sm text-secondary">相关场景</p>
        </div>
      )}
      <div className={`related-scene-grid ${isWorkflow ? 'p-4' : ''}`}>
        {relateAgents.map((item: RelatedSceneItem) => (
          <div
            key={item.agent_id}
            className="related-scene-card"
            onClick={() => handleNextAgent(item)}
          >
            <img className="related-scene-logo" src={item.logo} alt={item.name} />
            <div className="related-scene-info">
              <h6 className="related-scene-name">{item.name}</h6>
              <p className="related-scene-desc">{item.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default RelatedScene
