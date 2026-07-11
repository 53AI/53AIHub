import { forwardRef, useImperativeHandle, useState, useEffect } from 'react'
import { Form, Select } from 'antd'
import { SelectPlus } from '@km/shared-components-react'
import { useAgentCreateAdapter } from '../adapters'
import { useAgentFormStore } from '../store'
import { useAgentForm, createValidateForm } from '../hooks'
import { BaseConfig, ExpandConfig, RelateAgents } from '../components'

interface TencentProps {
  showChannelConfig?: boolean
  className?: string
}

export interface TencentRef {
  validateForm: () => Promise<boolean>
}

export const Tencent = forwardRef<TencentRef, TencentProps>(
  ({ showChannelConfig, className }, ref) => {
    const [form] = Form.useForm()
    const [providers, setProviders] = useState<any[]>([])
    const [bots, setBots] = useState<any[]>([])
    const adapter = useAgentCreateAdapter()
    const t = adapter.t || ((key: string) => key)

    // 使用 hook 获取状态和方法
    const {
      agentId,
      formData,
      updateCustomConfig,
      updateFields,
    } = useAgentForm()
    const customConfig = formData.custom_config

    const onBotChange = (value: string | number, option: any) => {
      updateCustomConfig({ tencent_bot_id: value as string })
      if (!agentId) {
        updateFields({
          logo: option.icon,
          name: option.label,
          description: option.description || '',
        })
      }
      // 通过 adapter 获取详情
      adapter.getPlatformConfig?.({
        platform: 'tencent',
        type: 'detail',
        bot_id: value,
      })
    }

    const loadBots = async () => {
      const store = useAgentFormStore.getState()
      const result = await adapter.getPlatformConfig?.({
        platform: 'tencent',
        provider_id: store.form_data.custom_config.provider_id,
      })
      const list = result?.bots || []
      setBots(list)
    }

    const loadProviders = async () => {
      const result = await adapter.getPlatformConfig?.({
        platform: 'tencent',
        type: 'providers',
      })
      const list = result?.providers || []
      setProviders(list)

      const store = useAgentFormStore.getState()
      if (list.length && !store.form_data.custom_config.provider_id) {
        updateCustomConfig({ provider_id: list[0].provider_id })
      }
      loadBots()
    }

    const onProviderChange = () => {
      updateCustomConfig({ tencent_bot_id: '' })
    }

    useEffect(() => {
      if (showChannelConfig) {
        loadProviders()
      }
    }, [showChannelConfig])

    // 同步 customConfig.tencent_bot_id 到表单内部状态（确保验证时能读取到正确的值）
    useEffect(() => {
      if (customConfig.tencent_bot_id) {
        form.setFieldValue('tencent_bot_id', customConfig.tencent_bot_id)
      }
    }, [customConfig.tencent_bot_id, form])

    useImperativeHandle(ref, () => ({
      validateForm: createValidateForm(form),
    }))

    // 获取需要同步到 Form 的字段
    const { logo, name, group_id, sort } = formData

    return (
      <div className={`${className || ''}`}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ logo, name, group_id, sort }}
        >
          {showChannelConfig ? (
            <>
              <div className="text-sm font-medium text-primary">{t("provider_platform.platform_auth")}</div>
              <div className="p-4 border rounded-xl bg-white mt-3">
                <Form.Item label={t('agent_app.tencent')}>
                  <Select
                    value={customConfig.provider_id}
                    onChange={(value) => {
                      updateCustomConfig({ provider_id: value })
                      onProviderChange()
                    }}
                    options={providers.map((item) => ({
                      label: item.name,
                      value: item.provider_id,
                    }))}
                  />
                </Form.Item>
                <div className="flex items-center gap-4">
                  <Form.Item
                    className="flex-1 mb-0"
                    label={t('agent.name')}
                    name="tencent_bot_id"
                    rules={[{ required: true, message: t('form.select_placeholder') }]}
                    getValueProps={() => ({ value: customConfig.tencent_bot_id })}
                    getValueFromEvent={(value) => {
                      onBotChange(value, bots.find(b => b.value === value))
                      return value
                    }}
                  >
                    <SelectPlus
                      t={t}
                      useI18n={false}
                      options={bots.map((item) => ({
                        value: item.value,
                        label: item.label,
                        icon: item.logo,
                        description: item.description,
                      }))}
                    />
                  </Form.Item>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-medium text-[#9CA3AF] py-1.5">{t('agent.chat_enhance')}</div>
              <BaseConfig />
              <RelateAgents />
              <ExpandConfig />
              <div className="h-3"></div>
            </>
          )}
        </Form>
      </div>
    )
  }
)

Tencent.displayName = 'Tencent'

export default Tencent