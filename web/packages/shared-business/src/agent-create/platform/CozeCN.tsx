import { forwardRef, useImperativeHandle, useState, useEffect, useRef } from 'react'
import { Form, Input, Select } from 'antd'
import { SelectPlus } from '@km/shared-components-react'
import { useAgentCreateAdapter } from '../adapters'
import { useAgentFormStore } from '../store'
import { useAgentForm, createValidateForm } from '../hooks'
import { BaseConfig, ExpandConfig, RelateAgents, FieldInput } from '../components'
import { AGENT_TYPES } from '../constants'
import { generateInputRules } from '@km/shared-utils'

interface CozeCNProps {
  showChannelConfig?: boolean
  className?: string
}

export interface CozeCNRef {
  validateForm: () => Promise<boolean>
}

export const CozeCN = forwardRef<CozeCNRef, CozeCNProps>(
  ({ showChannelConfig, className }, ref) => {
    const [form] = Form.useForm()
    const [providers, setProviders] = useState<any[]>([])
    const [workspaces, setWorkspaces] = useState<any[]>([])
    const [bots, setBots] = useState<any[]>([])
    const formRef = useRef<any>(null)
    const adapter = useAgentCreateAdapter()
    const t = adapter.t || ((key: string) => key)


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
      const result = await adapter.getPlatformConfig?.({
        platform: AGENT_TYPES.COZE_AGENT_CN,
        type: 'bots',
        workspace_id: store.form_data.custom_config.coze_workspace_id,
        provider_id: store.form_data.custom_config.provider_id,
      })
      const list = result?.bots || []
      setBots(list)
    }

    const loadCozeWorkspaces = async () => {
      const store = useAgentFormStore.getState()
      const result = await adapter.getPlatformConfig?.({
        platform: AGENT_TYPES.COZE_AGENT_CN,
        type: 'workspaces',
        provider_id: store.form_data.custom_config.provider_id,
      })
      const list = result?.workspaces || []
      setWorkspaces(list)

      if (list.length && !store.form_data.custom_config.coze_workspace_id) {
        updateCustomConfig({ coze_workspace_id: list[0].value })
      }
      loadBots()
    }

    const loadProviders = async () => {
      const result = await adapter.getPlatformConfig?.({
        platform: AGENT_TYPES.COZE_AGENT_CN,
        type: 'providers',
      })
      const list = result?.providers || []
      setProviders(list)

      const store = useAgentFormStore.getState()
      if (list.length && !store.form_data.custom_config.provider_id) {
        updateCustomConfig({ provider_id: list[0].provider_id })
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
      <div className={`${className || ''}`}>
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
              <div className="text-sm font-medium text-primary mb-3">{t("provider_platform.platform_auth")}</div>
              <div className="p-4 border rounded-xl bg-white">
                <Form.Item label={t('agent_app.coze_agent_cn')}>
                  <Select
                    className="w-full"
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
                    className="mb-0"
                  >
                    <Input placeholder={t('form.input_placeholder')} />
                  </Form.Item>
                ) : agentType === AGENT_TYPES.COZE_AGENT_CN ? (
                  <div className="flex items-center gap-4">
                    <Form.Item
                      className="flex-1 mb-0"
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
                        className="w-full"
                        t={t}
                        useI18n={false}
                        options={workspaces.map((item) => ({
                          value: item.value,
                          label: item.label,
                          icon: item.logo,
                        }))}
                      />
                    </Form.Item>
                    <Form.Item
                      className="flex-1 mb-0"
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
                        t={t}
                        className="w-full"
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
              </div>
              { agentType === AGENT_TYPES.COZE_WORKFLOW_CN && (
                <>
                  <FieldInput
                    list={inputFields}
                    onChange={updateInputFields}
                    title={t('agent.input_variable')}
                    allowAdd
                    type="input"
                    agentType={agentType}
                    className="mt-2"
                  />
                  <FieldInput
                    list={outputFields}
                    onChange={updateOutputFields}
                    title={t('agent.output_variable')}
                    allowAdd
                    type="output"
                    agentType={agentType}
                    className="mt-2"
                  />
                </>
              ) }
            </>
          ) : (
            <>
              {agentType === AGENT_TYPES.COZE_WORKFLOW_CN ? (
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

CozeCN.displayName = 'CozeCN'

export default CozeCN