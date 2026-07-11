import { forwardRef, useImperativeHandle, useState, useEffect } from 'react'
import { Form, Select } from 'antd'
import { t } from '@/locales'
import { useAgentFormStore } from '../store'
import { useAgentForm, createValidateForm } from '../hooks'
import { AgentInfo, BaseConfig, ExpandConfig, UseScope, RelateAgents, FieldInput, AgentType } from '../components'
import { SelectPlus } from '@/components/SelectPlus'
import providersApi from '@/api/modules/providers/index'
import { transformProviderList } from '@/api/modules/providers/transform'
import { ProviderItem } from '@/api/modules/providers/types'
import agentApi, { BotItem53aiItem, transform53aiBotItem } from '@/api/modules/agent'
import { AGENT_TYPES, PROVIDER_VALUES } from '@/constants/platform/config'

interface Agent53AIProps {
  showChannelConfig?: boolean
  className?: string
}

export interface Agent53AIRef {
  validateForm: () => Promise<boolean>
}

const agentTypeOptions = [
  {
    icon: 'agent',
    label: t('agent.53ai.agent_type_chat'),
    description: t('agent.53ai.agent_type_chat_desc'),
    value: AGENT_TYPES['53AI_AGENT'],
  },
  {
    icon: 'app-one',
    label: t('agent.53ai.agent_type_workflow'),
    description: t('agent.53ai.agent_type_workflow_desc'),
    value: AGENT_TYPES['53AI_WORKFLOW'],
  },
]

export const Agent53AI = forwardRef<Agent53AIRef, Agent53AIProps>(
  ({ showChannelConfig, className }, ref) => {
    const [form] = Form.useForm()
    const [providers, setProviders] = useState<ProviderItem[]>([])
    const [bots, setBots] = useState<BotItem53aiItem[]>([])

    // 使用 hook 获取状态和方法
    const {
      agentType,
      agentId,
      formData,
      updateCustomConfig,
      updateInputFields,
      updateOutputFields,
      updateFields,
      setAgentType,
    } = useAgentForm()
    const customConfig = formData.custom_config
    const inputFields = formData.settings.input_fields
    const outputFields = formData.settings.output_fields

    const load53aiBots = async () => {
      const store = useAgentFormStore.getState()
      const list = await agentApi.chat53ai.bots_list({
        provider_id: store.form_data.custom_config.provider_id,
      })
      setBots(list.map(transform53aiBotItem))
    }

    const load53aiWorkflows = async () => {
      const store = useAgentFormStore.getState()
      const list = await agentApi.chat53ai.workflow_list({
        provider_id: store.form_data.custom_config.provider_id,
      })
      setBots(list.map(transform53aiBotItem))
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
      const list = await providersApi.list({
        providerType: PROVIDER_VALUES['53AI'],
      })
      const transformedList = transformProviderList(list)
      setProviders(transformedList)

      const store = useAgentFormStore.getState()
      if (transformedList.length && !store.form_data.custom_config.provider_id) {
        updateCustomConfig({ provider_id: transformedList[0].provider_id })
      }
      loadApp()
    }

    const onProviderChange = () => {
      updateCustomConfig({ chat53ai_agent_id: '' })
      loadApp()
    }

    const onAgentTypeChange = () => {
      updateCustomConfig({ chat53ai_agent_id: '' })
      loadApp()
    }

    const inputUpdateRequest = async () => {
      const store = useAgentFormStore.getState()
      const res = await agentApi.chat53ai.workflow_field_list(
        store.form_data.custom_config.chat53ai_agent_id
      )
      return res.user_input_form.map((item: any) => {
        const value: any = Object.values(item)[0]
        return {
          id: value.id,
          variable: value.variable,
          type: value.type_53ai,
          label: value.label,
          desc: value.desc,
          required: value.required,
          multiple: value.multiple,
          options: value.options_53ai,
          max_length: value.max_length,
          show_word_limit: value.showWordLimit,
          date_format: value.mode || '',
          file_type: value.docType,
          file_accept: value.accept,
          file_size: value.size,
          file_limit: value.limit,
          is_system: true,
        }
      })
    }

    // 53ai 的 agent 选择后，需要设置 那边的开场白和建议问题
    const onBotChange = (data: { value: string; option: any }) => {
      updateCustomConfig({ chat53ai_agent_id: data.value })
      const updates: any = {
        opening_statement: data.option.opening_statement,
        suggested_questions: data.option.suggested_questions.map((item: string) => ({
          id: Math.random().toString(36).substring(2, 15),
          content: item,
        })),
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
      <div className={`${showChannelConfig ? '' : 'pb-7'} ${className || ''}`}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ logo, name, group_id, sort }}
        >
          {showChannelConfig ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1">
                  <h3 className="text-base text-primary">{t('53ai')}</h3>
                </div>
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
              <Form.Item label={t('type')}>
                <AgentType
                  value={agentType}
                  options={agentTypeOptions}
                  disabled={!!agentId}
                  onChange={(value) => {
                    setAgentType(value)
                    onAgentTypeChange()
                  }}
                />
              </Form.Item>
              <Form.Item
                label={t('select_agent')}
                name="chat53ai_agent_id"
                rules={[{ required: true, message: t('form_select_placeholder') }]}
                getValueProps={() => ({ value: customConfig.chat53ai_agent_id })}
                getValueFromEvent={(value) => {
                  onBotChange({ value, option: bots.find(b => b.value === value) })
                  return value
                }}
              >
                <SelectPlus
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
              <AgentInfo form={form} />
            </>
          ) : (
            <>
              <UseScope />
              {agentType === AGENT_TYPES['53AI_WORKFLOW'] ? (
                <>
                  <FieldInput
                    list={inputFields}
                    onChange={updateInputFields}
                    title={t('agent.input_variable')}
                    allowUpdate
                    updateRequest={inputUpdateRequest}
                    type="input"
                    agentType={agentType}
                  />
                  <FieldInput
                    list={outputFields}
                    onChange={updateOutputFields}
                    title={t('agent.output_variable')}
                    type="output"
                    allowAdd
                    agentType={agentType}
                  />
                  <RelateAgents />
                </>
              ) : (
                <>
                  <BaseConfig />
                  <RelateAgents />
                  <ExpandConfig />
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
