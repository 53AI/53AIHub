import { useState } from 'react'
import { Switch, InputNumber, Input } from 'antd'
import { useAgentCreateAdapter } from '../../adapters'
import { CollapsibleSection } from '../shared/CollapsibleSection'

interface RequestLimit {
  frequency: {
    enable: boolean
    interval: number
    number: number
    over_message: string
  }
  total: {
    enable: boolean
    limit: number
    over_message: string
  }
}

interface LimitConfigProps {
  value?: RequestLimit
  onChange?: (value: RequestLimit) => void
}

const defaultLimit: RequestLimit = {
  frequency: {
    enable: false,
    interval: 1,
    number: 1,
    over_message: '',
  },
  total: {
    enable: false,
    limit: 1,
    over_message: '',
  },
}

export function LimitConfig({ value, onChange }: LimitConfigProps) {
  const [requestLimit, setRequestLimit] = useState<RequestLimit>(value || defaultLimit)
  const adapter = useAgentCreateAdapter()
  const t = adapter.t || ((key: string) => key)

  const updateLimit = (path: string[], newValue: any) => {
    const newLimit = { ...requestLimit }
    let current: any = newLimit
    for (let i = 0; i < path.length - 1; i++) {
      current[path[i]] = { ...current[path[i]] }
      current = current[path[i]]
    }
    current[path[path.length - 1]] = newValue
    setRequestLimit(newLimit)
    onChange?.(newLimit)
  }

  return (
    <>
      <CollapsibleSection
        title={t('limit.dialogue_frequency')}
        actions={
          <Switch
            checked={requestLimit.frequency.enable}
            onChange={(checked) => updateLimit(['frequency', 'enable'], checked)}
          />
        }
      >
        {requestLimit.frequency.enable && (
          <div>
            <div className="flex items-center whitespace-nowrap text-[#182B50] mt-4">
              {t('common.limit')}
              <InputNumber
                value={requestLimit.frequency.interval}
                min={1}
                controls={false}
                className="mx-2 w-7"
                onChange={(v) => updateLimit(['frequency', 'interval'], v || 1)}
              />
              {t('common.second')}, {t('common.send')}
              <InputNumber
                value={requestLimit.frequency.number}
                min={1}
                controls={false}
                className="mx-2 w-7"
                onChange={(v) => updateLimit(['frequency', 'number'], v || 1)}
              />
              {t('unit.messages')}
            </div>
            <div className="flex items-center whitespace-nowrap text-[#182B50] mt-4">
              {t('limit.over_message')}
              <Input.TextArea
                value={requestLimit.frequency.over_message}
                rows={3}
                style={{ resize: 'none' }}
                className="mx-2"
                onChange={(e) => updateLimit(['frequency', 'over_message'], e.target.value)}
              />
            </div>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title={t('limit.dialogue_total')}
        actions={
          <Switch
            checked={requestLimit.total.enable}
            onChange={(checked) => updateLimit(['total', 'enable'], checked)}
          />
        }
      >
        {requestLimit.total.enable && (
          <>
            {/* 为了让对话频率跟对话总量宽度一样，复制上面一份 */}
            <div className="h-[1px] flex overflow-hidden items-center whitespace-nowrap text-[#182B50] invisible">
              {t('common.limit')}
              <InputNumber min={1} controls={false} className="mx-2 w-7" />
              {t('common.second')}, {t('common.send')}
              <InputNumber min={1} controls={false} className="mx-2 w-7" />
              {t('unit.messages')}
            </div>
            <div className="flex items-center whitespace-nowrap text-[#182B50] mt-4">
              {t('limit.every_dialogue')}
              <InputNumber
                value={requestLimit.total.limit}
                min={1}
                controls={false}
                className="mx-2 w-7"
                onChange={(v) => updateLimit(['total', 'limit'], v || 1)}
              />
              {t('unit.messages_v2')}
            </div>
            <div className="flex items-center whitespace-nowrap text-[#182B50] mt-4">
              {t('limit.over_message')}
              <Input.TextArea
                value={requestLimit.total.over_message}
                rows={3}
                style={{ resize: 'none' }}
                className="mx-2"
                onChange={(e) => updateLimit(['total', 'over_message'], e.target.value)}
              />
            </div>
          </>
        )}
      </CollapsibleSection>
    </>
  )
}

export default LimitConfig