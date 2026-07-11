import { forwardRef, useImperativeHandle, useState, useEffect } from 'react'
import { Form, Select } from 'antd'
import { useAgentCreateAdapter } from '../adapters'
import { useAgentFormStore } from '../store'
import { useAgentForm, createValidateForm } from '../hooks'
import { BaseConfig, ExpandConfig, RelateAgents, FieldInput } from '../components'
import { SelectPlus } from '@km/shared-components-react'
import { AGENT_TYPES } from '../constants'

interface Agent53AIProps {
  showChannelConfig?: boolean
  className?: string
}

export interface Agent53AIRef {
  validateForm: () => Promise<boolean>
}

export const Agent53AI = forwardRef<Agent53AIRef, Agent53AIProps>(
  ({ showChannelConfig, className }, ref) => {
    const [form] = Form.useForm()
    const [providers, setProviders] = useState<any[]>([])
    const [bots, setBots] = useState<any[]>([])
    const adapter = useAgentCreateAdapter()
    const t = adapter.t || ((key: string) => key)

    // 使用 hook 获取状态和方法
    const {
      agentType,
      agentId,
      formData,
      updateCustomConfig,
      updateInputFields,
      updateOutputFields,
      updateFields,
    } = useAgentForm()
    const customConfig = formData.custom_config
    const inputFields = formData.settings.input_fields
    const outputFields = formData.settings.output_fields


    const load53aiBots = async () => {
      const store = useAgentFormStore.getState()
      const result = await adapter.getPlatformConfig?.({
        platform: AGENT_TYPES['53AI_AGENT'],
        provider_id: store.form_data.custom_config.provider_id,
      })
      const list = result?.bots || []
      setBots(list)
    }

    const load53aiWorkflows = async () => {
      const store = useAgentFormStore.getState()
      const result = await adapter.getPlatformConfig?.({
        platform: AGENT_TYPES['53AI_WORKFLOW'],
        provider_id: store.form_data.custom_config.provider_id,
      })
      const list = result?.workflows || []
      setBots(list)
    }

    const loadApp = async () => {
      const store = useAgentFormStore.getState()
      if (store.agent_type === AGENT_TYPES['53AI_AGENT']) {
        load53aiBots()
      } else {
        load53aiWorkflows()
      }
    }

    const loadProviders = async () => {
      const result = await adapter.getPlatformConfig?.({
        platform: AGENT_TYPES['53AI_AGENT'],
        type: 'providers',
      })
      const list = result?.providers || []
      setProviders(list)

      const store = useAgentFormStore.getState()
      if (list.length && !store.form_data.custom_config.provider_id) {
        updateCustomConfig({ provider_id: list[0].provider_id })
      }
      loadApp()
    }

    const onProviderChange = () => {
      updateCustomConfig({ chat53ai_agent_id: '' })
      loadApp()
    }

    const inputUpdateRequest = async () => {
      const store = useAgentFormStore.getState()
      const result = await adapter.getPlatformConfig?.({
        platform: AGENT_TYPES['53AI_WORKFLOW'],
        type: 'input_fields',
        agent_id: store.form_data.custom_config.chat53ai_agent_id,
      })
      const fields = result?.input_fields || []
      return fields.map((item: any) => {
        return {
          id: item.id,
          variable: item.variable,
          type: item.type_53ai,
          label: item.label,
          desc: item.desc,
          required: item.required,
          multiple: item.multiple,
          options: item.options_53ai,
          max_length: item.max_length,
          show_word_limit: item.showWordLimit,
          date_format: item.mode || '',
          file_type: item.docType,
          file_accept: item.accept,
          file_size: item.size,
          file_limit: item.limit,
          is_system: true,
        }
      })
    }

    // 53ai 的 agent 选择后，需要设置 那边的开场白和建议问题
    const onBotChange = (data: { value: string; option: any }) => {
      updateCustomConfig({ chat53ai_agent_id: data.value })
      const updates: any = {
        opening_statement: data.option.opening_statement,
        suggested_questions: data.option.suggested_questions?.map((item: string) => ({
          id: Math.random().toString(36).substring(2, 15),
          content: item,
        })) || [],
      }
      if (!agentId) {
        updates.logo = data.option.logo
        updates.name = data.option.name
        updates.description = data.option.description || ''
      }
      updateFields(updates)
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

    // 同步 customConfig 中的 chat53ai_agent_id 到 Form
    useEffect(() => {
      if (customConfig.chat53ai_agent_id) {
        form.setFieldValue('chat53ai_agent_id', customConfig.chat53ai_agent_id)
      }
    }, [customConfig.chat53ai_agent_id, form])

    return (
      <div className={`${className || ''}`}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ logo, name, group_id, sort }}
        >
          {showChannelConfig ? (
            <>
              <div className="text-sm font-medium text-primary mb-3">{t("provider_platform.platform_auth")}</div>
              <div className="p-4 border rounded-xl bg-white flex gap-4">
                <Form.Item label={t('platform.53ai')} className="flex-1 mb-0">
                  <Select
                    value={customConfig.provider_id}
                    className="w-full"
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
                <Form.Item
                  label={t('term.select_agent')}
                  name="chat53ai_agent_id"
                  rules={[{ required: true, message: t('form.select_placeholder') }]}
                  getValueProps={() => ({ value: customConfig.chat53ai_agent_id })}
                  getValueFromEvent={(value) => {
                    onBotChange({ value, option: bots.find(b => b.value === value) })
                    return value
                  }}
                   className="flex-1 mb-0"
                >
                  <SelectPlus
                    t={t}
                    className="w-full"
                    useI18n={false}
                    options={bots.map((item) => ({
                      value: item.value,
                      label: item.label,
                      logo: item.logo,
                      name: item.name,
                      description: item.description,
                      opening_statement: item.opening_statement,
                      suggested_questions: item.suggested_questions,
                    }))}
                  />
                </Form.Item>
              </div>
              { agentType === AGENT_TYPES['53AI_WORKFLOW'] && (
                <>
                  <FieldInput
                    list={inputFields}
                    onChange={updateInputFields}
                    title={t('agent.input_variable')}
                    allowUpdate
                    updateRequest={inputUpdateRequest}
                    type="input"
                    agentType={agentType}
                    className="mt-2"
                  />
                  <FieldInput
                    list={outputFields}
                    onChange={updateOutputFields}
                    title={t('agent.output_variable')}
                    type="output"
                    allowAdd
                    agentType={agentType}
                    className="mt-2"
                  />
                </>
              ) }
            </>
          ) : (
            <>
              {agentType === AGENT_TYPES['53AI_WORKFLOW'] ? (
                <>
                  <div className="text-sm font-medium text-[#9CA3AF] py-1.5">{t('agent.chat_enhance')}</div>
                  <RelateAgents />
                  <div className="h-3"></div>
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
            </>
          )}
        </Form>
      </div>
    )
  }
)

Agent53AI.displayName = 'Agent53AI'

export default Agent53AI