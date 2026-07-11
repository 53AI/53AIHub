import { forwardRef, useImperativeHandle, useState, useEffect, useRef } from 'react'
import { Form, Input, Select } from 'antd'
import { t } from '@/locales'
import { useAgentFormStore } from '../store'
import { useAgentForm, createValidateForm } from '../hooks'
import { AgentInfo, BaseConfig, ExpandConfig, UseScope, RelateAgents, FieldInput, AgentType } from '../components'
import { SelectPlus } from '@/components/SelectPlus'
import providersApi from '@/api/modules/providers/index'
import { transformProviderList } from '@/api/modules/providers/transform'
import { ProviderItem } from '@/api/modules/providers/types'
import agentApi, {
    CozeBotItem,
    CozeWorkspaceItem,
    transformCozeWorkspaceItem,
    transformCozeBotItem,
} from '@/api/modules/agent'
import { AGENT_TYPES, PROVIDER_VALUES } from '@/constants/platform/config'
import { generateInputRules } from '@/utils/form-rule'

interface CozeCNProps {
  showChannelConfig?: boolean
  className?: string
}

export interface CozeCNRef {
  validateForm: () => Promise<boolean>
}

const agentTypeOptions = [
  {
    icon: 'agent',
    label: t('agent.coze.agent_type_chat'),
    description: t('agent.coze.agent_type_chat_desc'),
    value: AGENT_TYPES.COZE_AGENT_CN,
  },
  {
    icon: 'app-one',
    label: t('agent.coze.agent_type_workflow'),
    description: t('agent.coze.agent_type_workflow_desc'),
    value: AGENT_TYPES.COZE_WORKFLOW_CN,
  },
]

export const CozeCN = forwardRef<CozeCNRef, CozeCNProps>(
  ({ showChannelConfig, className }, ref) => {
    const [form] = Form.useForm()
    const [providers, setProviders] = useState<ProviderItem[]>([])
    const [workspaces, setWorkspaces] = useState<CozeWorkspaceItem[]>([])
    const [bots, setBots] = useState<CozeBotItem[]>([])
    const formRef = useRef<any>(null)

    // 使用 hook 获取状态和方法
    const {
      agentType,
      agentId,
      formData,
      updateCustomConfig,
      updateFields,
      updateInputFields,
      updateOutputFields,
      setAgentType,
    } = useAgentForm()
    const customConfig = formData.custom_config
    const inputFields = formData.settings.input_fields
    const outputFields = formData.settings.output_fields

    const loadBots = async () => {
      const store = useAgentFormStore.getState()
      const list = await agentApi.coze.bots_list(store.form_data.custom_config.coze_workspace_id, {
        provider_id: store.form_data.custom_config.provider_id,
      })
      setBots(list.map(transformCozeBotItem))
    }

    const loadCozeWorkspaces = async () => {
      const store = useAgentFormStore.getState()
      const list = await agentApi.coze.workspaces_list({
        provider_id: store.form_data.custom_config.provider_id,
      })
      const transformedList = list.map(transformCozeWorkspaceItem)
      setWorkspaces(transformedList)

      if (transformedList.length && !store.form_data.custom_config.coze_workspace_id) {
        updateCustomConfig({ coze_workspace_id: transformedList[0].value })
      }
      loadBots()
    }

    const loadProviders = async () => {
      const store = useAgentFormStore.getState()
      const list = await providersApi.list({
        providerType: PROVIDER_VALUES.COZE_CN,
      })
      const transformedList = transformProviderList(list)
      setProviders(transformedList)

      if (transformedList.length && !store.form_data.custom_config.provider_id) {
        updateCustomConfig({ provider_id: transformedList[0].provider_id })
      }
      loadCozeWorkspaces()
    }

    const onProviderChange = () => {
      updateCustomConfig({
        coze_workspace_id: '',
        coze_bot_id: '',
      })
      loadCozeWorkspaces()
    }

    const handleAgentTypeChange = (value: string) => {
      setAgentType(value)
      if (value === AGENT_TYPES.COZE_AGENT_CN) {
        updateCustomConfig({
          coze_workspace_id: workspaces[0]?.value || '',
          coze_bot_id: bots[0]?.value || '',
        })
      } else {
        updateCustomConfig({
          coze_workspace_id: '',
          coze_bot_id: '',
        })
      }
    }

    const onBotChange = (data: { value: string; option: any }) => {
      if (!agentId) {
        updateFields({
          logo: data.option.icon,
          name: data.option.label,
          description: data.option.description || '',
        })
      }
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

    // 同步 custom_config 字段到 Form（确保验证时能读取到正确的值）
    useEffect(() => {
      form.setFieldsValue({
        'custom_config.coze_workspace_id': customConfig.coze_workspace_id,
        'custom_config.coze_bot_id': customConfig.coze_bot_id,
        'custom_config.coze_bot_url': customConfig.coze_bot_url,
      })
    }, [form, customConfig.coze_workspace_id, customConfig.coze_bot_id, customConfig.coze_bot_url])

    return (
      <div className={`${showChannelConfig ? '' : 'pb-7'} ${className || ''}`}>
        <Form
          form={form}
          ref={formRef}
          layout="vertical"
          initialValues={{
            logo,
            name,
            group_id,
            sort,
            'custom_config.coze_workspace_id': customConfig.coze_workspace_id,
            'custom_config.coze_bot_id': customConfig.coze_bot_id,
            'custom_config.coze_bot_url': customConfig.coze_bot_url,
          }}
        >
          {showChannelConfig ? (
            <>
              <div className="text-base text-primary font-medium mb-3">
                {t('agent_app.coze_agent_cn')}
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
                  onChange={handleAgentTypeChange}
                />
              </Form.Item>
              {agentType === AGENT_TYPES.COZE_WORKFLOW_CN ? (
                <Form.Item
                  label={t('agent.coze.workflow_link')}
                  name="custom_config.coze_bot_url"
                  rules={generateInputRules({ message: 'form_link_validator', validator: ['link'] })}
                  getValueProps={() => ({ value: customConfig.coze_bot_url })}
                  getValueFromEvent={(e) => {
                    const val = e?.target?.value ?? e;
                    updateCustomConfig({ coze_bot_url: val });
                    return val;
                  }}
                >
                  <Input placeholder={t('form_input_placeholder')} />
                </Form.Item>
              ) : agentType === AGENT_TYPES.COZE_AGENT_CN ? (
                <div className="flex items-center gap-4">
                  <Form.Item
                    className="flex-1"
                    label={t('agent.coze.workspace')}
                    name="custom_config.coze_workspace_id"
                    rules={generateInputRules({ message: 'form_select_placeholder' })}
                    getValueProps={() => ({ value: customConfig.coze_workspace_id })}
                    getValueFromEvent={(value) => {
                      updateCustomConfig({ coze_workspace_id: value as string });
                      loadBots();
                      return value;
                    }}
                  >
                    <SelectPlus
                      useI18n={false}
                      options={workspaces.map((item) => ({
                        value: item.value,
                        label: item.label,
                        icon: item.logo,
                      }))}
                    />
                  </Form.Item>
                  <Form.Item
                    className="flex-1"
                    label={t('agent.name')}
                    name="custom_config.coze_bot_id"
                    rules={generateInputRules({ message: 'form_select_placeholder' })}
                    getValueProps={() => ({ value: customConfig.coze_bot_id })}
                    getValueFromEvent={(value) => {
                      updateCustomConfig({ coze_bot_id: value as string });
                      onBotChange({ value: value as string, option: bots.find(b => b.value === value) });
                      return value;
                    }}
                  >
                    <SelectPlus
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
              ) : null}
              <AgentInfo form={form} />
            </>
          ) : (
            <>
              <UseScope />
              {agentType === AGENT_TYPES.COZE_WORKFLOW_CN ? (
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

CozeCN.displayName = 'CozeCN'

export default CozeCN
