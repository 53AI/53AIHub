import { forwardRef, useImperativeHandle, useState, useEffect } from 'react'
import { Form, Input, Select } from 'antd'
import { t } from '@/locales'
import { useAgentFormStore } from '../store'
import { useAgentForm } from '../hooks'
import { AgentInfo, BaseConfig, ExpandConfig, UseScope, RelateAgents, FieldInput, AgentType } from '../components'
import { AGENT_TYPES, AGENT_MODES, PROVIDER_VALUES, getAgentByAgentType } from '@/constants/platform/config'
import { channelApi } from '@/api/modules/channel'
import providersApi from '@/api/modules/providers/index'
import { transformProviderList } from '@/api/modules/providers/transform'
import { ProviderItem } from '@/api/modules/providers/types'
import { useChannelConfig } from '../context/ChannelConfigContext'
import { generateInputRules } from '@/utils/form-rule'

interface CozeOSVProps {
  showChannelConfig?: boolean
  className?: string
}

export interface CozeOSVRef {
  validateForm: () => Promise<boolean>
  onChannelSave: () => Promise<void>
}

const agentTypeOptions = [
  {
    icon: 'agent',
    label: t('agent.coze.agent_type_chat'),
    description: t('agent.coze.agent_type_chat_desc'),
    value: AGENT_TYPES.COZE_AGENT_OSV,
  },
  {
    icon: 'app-one',
    label: t('agent.coze.agent_type_workflow'),
    description: t('agent.coze.agent_type_workflow_desc'),
    value: AGENT_TYPES.COZE_WORKFLOW_OSV,
  },
]

export const CozeOSV = forwardRef<CozeOSVRef, CozeOSVProps>(
  ({ showChannelConfig, className }, ref) => {
    const channelInfo = useChannelConfig() as any
    const [channelFormRef] = Form.useForm()
    const [agentFormRef] = Form.useForm()
    const [channelEditable, setChannelEditable] = useState(false)
    const [providers, setProviders] = useState<ProviderItem[]>([])
    const [channelForm, setChannelForm] = useState({
      key: '',
      base_url: '',
      models: [] as string[],
      model: '',
      config: {
        agent_type: AGENT_MODES.COMPLETION,
      },
    })

    // 使用 hook 获取状态和方法
    const {
      agentType,
      agentId,
      agentData,
      formData,
      updateCustomConfig,
      updateInputFields,
      updateOutputFields,
      setAgentType,
    } = useAgentForm()
    const customConfig = formData.custom_config
    const inputFields = formData.settings.input_fields
    const outputFields = formData.settings.output_fields
    // 获取需要同步到 Form 的字段
    const { logo, name, group_id, sort } = formData

    const loadProviders = async () => {
      const list = await providersApi.list({
        providerType: PROVIDER_VALUES.COZE_OSV,
      })
      const transformedList = transformProviderList(list)
      setProviders(transformedList)

      const store = useAgentFormStore.getState()
      if (transformedList.length && !store.form_data.custom_config.provider_id) {
        updateCustomConfig({ provider_id: transformedList[0].provider_id })
      }
    }

    useEffect(() => {
      if (showChannelConfig) {
        loadProviders()
      }
    }, [showChannelConfig])

    useEffect(() => {
      const { channel_config = {} } = agentData || {}
      setChannelEditable(!!+channel_config.channel_id)
      channelInfo.channel_id = +channel_config.channel_id || 0
      channelInfo.key = channel_config.key || ''
      const newChannelForm = {
        key: channel_config.key || '',
        base_url: channel_config.base_url || '',
        models: channel_config.models || [],
        model: (channel_config.models || [])[0] || '',
        config: {
          ...(channel_config.config || {}),
          agent_type: channel_config.config?.agent_type || 'chat',
        },
      }
      setChannelForm(newChannelForm)
      channelInfo.models = channel_config.models || []
      channelInfo.model = (channel_config.models || [])[0] || ''
      channelInfo.config = newChannelForm.config
      channelFormRef.setFieldsValue({
        base_url: channel_config.base_url || '',
      })
    }, [agentData])

    const onChannelSave = async () => {
      const currentState = useAgentFormStore.getState()
      const agent = getAgentByAgentType(currentState.agent_type)

      if (agent.mode === 'completion') {
        try {
          const url = new URL(channelForm.base_url)
          const params = new URLSearchParams(url.search)
          channelForm.model = `workflow-${params.get('workflow_id')}` || ''
        } catch (error) {
          console.warn('Invalid URL format:', channelForm.base_url)
          channelForm.model = ''
        }
      } else {
        const model = channelForm.base_url.split('/').pop()
        channelForm.model = `bot-${model}`
      }

      const models = [channelForm.model]
      const name = 'coze_osv'
      const saveData = {
        channel_id: channelInfo.channel_id,
        key: channelForm.key,
        base_url: channelForm.base_url,
        config: channelForm.config,
        models,
        name,
      }
      const resultData = await channelApi.save({
        data: saveData,
      })
      Object.assign(channelInfo, resultData)
      if (!saveData.channel_id) saveData.channel_id = resultData.channel_id
      useAgentFormStore.setState({
        form_data: {
          ...currentState.form_data,
          channel_type: agent?.channelType || currentState.form_data.channel_type,
          model: models[0],
          custom_config: {
            ...currentState.form_data.custom_config,
            channel_config: saveData,
          },
        },
      })
      setChannelEditable(true)
    }

    const validateForm = async () => {
      try {
        if (showChannelConfig) {
          await channelFormRef.validateFields();
        }
        await agentFormRef.validateFields();
        return true;
      } catch {
        return false;
      }
    }

    useImperativeHandle(ref, () => ({
      validateForm,
      onChannelSave,
    }))

    return (
      <div className={`${showChannelConfig ? '' : 'pb-7'} ${className || ''}`}>
        {showChannelConfig && (
          <>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1">
                <h3 className="text-base text-primary">
                  {t('agent_app.coze_agent_cn')}
                </h3>
              </div>
            </div>
            <Form form={channelFormRef} layout="vertical" className="mt-3">
              <Form.Item label={t('module.website_info_name')}>
                <Select
                  value={customConfig.provider_id}
                  onChange={(value) => updateCustomConfig({ provider_id: value })}
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
                    updateCustomConfig({ agent_type: value })
                  }}
                />
              </Form.Item>
              <Form.Item
                className="mb-9"
                label={t('agent.coze.agent_link')}
                name="base_url"
                rules={generateInputRules({ message: 'form_link_validator', validator: ['link'] })}
                getValueProps={() => ({ value: channelForm.base_url })}
                getValueFromEvent={(e) => {
                  const val = e?.target?.value ?? e
                  setChannelForm({ ...channelForm, base_url: val })
                  return val
                }}
              >
                <Input placeholder={t('form_input_placeholder')} />
              </Form.Item>
            </Form>
          </>
        )}

        <Form
          form={agentFormRef}
          layout="vertical"
          labelCol={{ style: { width: '104px' } }}
          className={showChannelConfig ? 'mt-6' : ''}
          initialValues={{ logo, name, group_id, sort }}
        >
          {showChannelConfig ? (
            <AgentInfo form={agentFormRef} />
          ) : (
            <>
              <UseScope />
              {agentType === AGENT_TYPES.COZE_WORKFLOW_OSV ? (
                <>
                  <FieldInput
                    list={inputFields}
                    onChange={updateInputFields}
                    title={t('agent.input_variable')}
                    allowAdd
                    type="input"
                    agentType={agentType}
                  />
                  <FieldInput
                    list={outputFields}
                    onChange={updateOutputFields}
                    title={t('agent.output_variable')}
                    allowAdd
                    type="output"
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

CozeOSV.displayName = 'CozeOSV'

export default CozeOSV
