import { useState } from 'react'
import { Form, Switch, InputNumber, Input } from 'antd'
import { t } from '@/locales'

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
  const [form] = Form.useForm()
  const [requestLimit, setRequestLimit] = useState<RequestLimit>(value || defaultLimit)

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
      <Form.Item label={t('dialogue_frequency')}>
        <div className="w-full">
          <div className="text-dark text-opacity-60">
            <Switch
              checked={requestLimit.frequency.enable}
              onChange={(checked) => updateLimit(['frequency', 'enable'], checked)}
              className="mr-2"
            />
            {requestLimit.frequency.enable ? t('action_open') : t('action_close')}
          </div>
          {requestLimit.frequency.enable && (
            <div>
              <div className="flex items-center whitespace-nowrap text-dark mt-4">
                {t('limit')}
                <InputNumber
                  value={requestLimit.frequency.interval}
                  min={1}
                  controls={false}
                  className="mx-2 w-7"
                  onChange={(v) => updateLimit(['frequency', 'interval'], v || 1)}
                />
                {t('second')}, {t('send')}
                <InputNumber
                  value={requestLimit.frequency.number}
                  min={1}
                  controls={false}
                  className="mx-2 w-7"
                  onChange={(v) => updateLimit(['frequency', 'number'], v || 1)}
                />
                {t('unit_messages')}
              </div>
              <div className="flex items-center whitespace-nowrap text-dark mt-4">
                {t('over_message')}
                <Input.TextArea
                  value={requestLimit.frequency.over_message}
                  rows={3}
                  resize="none"
                  className="mx-2"
                  onChange={(e) => updateLimit(['frequency', 'over_message'], e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      </Form.Item>

      <Form.Item label={t('dialogue_total')}>
        <div className="w-full">
          <div className="text-dark text-opacity-60">
            <Switch
              checked={requestLimit.total.enable}
              onChange={(checked) => updateLimit(['total', 'enable'], checked)}
              className="mr-2"
            />
            {requestLimit.total.enable ? t('action_open') : t('action_close')}
          </div>
          {requestLimit.total.enable && (
            <>
              {/* 为了让对话频率跟对话总量宽度一样，复制上面一份 */}
              <div className="h-[1px] flex overflow-hidden items-center whitespace-nowrap text-dark invisible">
                {t('limit')}
                <InputNumber min={1} controls={false} className="mx-2 w-7" />
                {t('second')}, {t('send')}
                <InputNumber min={1} controls={false} className="mx-2 w-7" />
                {t('unit_messages')}
              </div>
              <div className="flex items-center whitespace-nowrap text-dark mt-4">
                {t('limit_every_dialogue')}
                <InputNumber
                  value={requestLimit.total.limit}
                  min={1}
                  controls={false}
                  className="mx-2 w-7"
                  onChange={(v) => updateLimit(['total', 'limit'], v || 1)}
                />
                {t('unit_messages_v2')}
              </div>
              <div className="flex items-center whitespace-nowrap text-dark mt-4">
                {t('over_message')}
                <Input.TextArea
                  value={requestLimit.total.over_message}
                  rows={3}
                  resize="none"
                  className="mx-2"
                  onChange={(e) => updateLimit(['total', 'over_message'], e.target.value)}
                />
              </div>
            </>
          )}
        </div>
      </Form.Item>
    </>
  )
}

export default LimitConfig
