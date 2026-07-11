import { forwardRef, useImperativeHandle, useState, useEffect } from 'react'
import { Form, Select } from 'antd'
import { t } from '@/locales'
import { useAgentFormStore } from '../store'
import { useAgentForm, createValidateForm } from '../hooks'
import { AgentInfo, BaseConfig, ExpandConfig, UseScope, RelateAgents } from '../components'
import { SelectPlus } from '@/components/SelectPlus'
import providersApi from '@/api/modules/providers/index'
import { transformProviderList } from '@/api/modules/providers/transform'
import { ProviderItem } from '@/api/modules/providers/types'
import agentApi, { TencentAppItem, transformTencentAppItem } from '@/api/modules/agent'
import { PROVIDER_VALUES } from '@/constants/platform/config'

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
    const [providers, setProviders] = useState<ProviderItem[]>([])
    const [bots, setBots] = useState<TencentAppItem[]>([])

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
      agentApi.tencent.detail(value as string)
    }

    const loadBots = async () => {
      const store = useAgentFormStore.getState()
      const list = await agentApi.tencent.bots_list({
        provider_id: store.form_data.custom_config.provider_id,
      })
      setBots(list.map(transformTencentAppItem))
    }

    const loadProviders = async () => {
      const list = await providersApi.list({
        providerType: PROVIDER_VALUES.TENCENT,
      })
      const transformedList = transformProviderList(list)
      setProviders(transformedList)

      const store = useAgentFormStore.getState()
      if (transformedList.length && !store.form_data.custom_config.provider_id) {
        updateCustomConfig({ provider_id: transformedList[0].provider_id })
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

    useImperativeHandle(ref, () => ({
      validateForm: createValidateForm(form),
    }))

    // 获取需要同步到 Form 的字段
    const { logo, name, group_id, sort } = formData

    return (
      <div className={`${showChannelConfig ? '' : 'pb-7'} ${className || ''}`}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ logo, name, group_id, sort }}
        >
          {showChannelConfig ? (
            <>
              <div className="text-base text-primary font-medium mb-3">
                {t('agent_app.tencent')}
              </div>
              <Form.Item label={t('module.website_info_name')}>
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
                  className="flex-1"
                  label={t('agent.name')}
                  name="tencent_bot_id"
                  rules={[{ required: true, message: t('form_select_placeholder') }]}
                  getValueProps={() => ({ value: customConfig.tencent_bot_id })}
                  getValueFromEvent={(value) => {
                    onBotChange(value, bots.find(b => b.value === value))
                    return value
                  }}
                >
                  <SelectPlus
                    useI18n={false}
                    options={bots}
                  />
                </Form.Item>
              </div>
              <AgentInfo form={form} />
            </>
          ) : (
            <>
              <UseScope />
              <BaseConfig />
              <RelateAgents />
              <ExpandConfig />
            </>
          )}
        </Form>
      </div>
    )
  }
)

Tencent.displayName = 'Tencent'

export default Tencent