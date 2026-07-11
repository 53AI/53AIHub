import { forwardRef, useImperativeHandle, useState, useEffect } from 'react'
import { Form, Input, Select, Popover } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import { useAgentCreateAdapter } from '../adapters'
import { useAgentFormStore } from '../store'
import { useAgentForm, createValidateForm } from '../hooks'
import { BaseConfig, ExpandConfig, RelateAgents, FieldInput } from '../components'
import { AGENT_TYPES } from '../constants'
import { generateInputRules } from '@km/shared-utils'

interface CozeOSVProps {
  showChannelConfig?: boolean
  className?: string
}

export interface CozeOSVRef {
  validateForm: () => Promise<boolean>
}

export const CozeOSV = forwardRef<CozeOSVRef, CozeOSVProps>(
  ({ showChannelConfig, className }, ref) => {
    const [form] = Form.useForm()
    const [providers, setProviders] = useState<any[]>([])
    const adapter = useAgentCreateAdapter()
    const t = adapter.t || ((key: string) => key)

    // 使用 hook 获取状态和方法
    const {
      agentType,
      formData,
      updateCustomConfig,
      updateInputFields,
      updateOutputFields,
    } = useAgentForm()
    const customConfig = formData.custom_config
    const inputFields = formData.settings.input_fields
    const outputFields = formData.settings.output_fields
    const channelConfig = customConfig.channel_config || {}

    const loadProviders = async () => {
      const result = await adapter.getPlatformConfig?.({
        platform: AGENT_TYPES.COZE_AGENT_OSV,
        type: 'providers',
      })
      const list = result?.providers || []
      setProviders(list)

      const store = useAgentFormStore.getState()
      if (list.length && !store.form_data.custom_config.provider_id) {
        updateCustomConfig({ provider_id: list[0].provider_id })
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

    // 同步字段到 Form
    useEffect(() => {
      form.setFieldsValue({
        base_url: channelConfig.base_url || '',
        'custom_config.provider_id': customConfig.provider_id,
      })
    }, [form, channelConfig.base_url, customConfig.provider_id])

    return (
      <div className={`${className || ''}`}>
        {showChannelConfig && (
          <>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1">
                <h3 className="text-base text-[#1D1E1F]">{t('agent_app.coze_agent_cn')}</h3>
                <Popover
                  content={
                    <div
                      className="whitespace-pre-wrap text-sm text-[#333] leading-6"
                      dangerouslySetInnerHTML={{
                        __html: t('coze_agent_get_tip', {
                          url: `<a class='text-[#5A6D9E] underline' href='https://www.coze.com/' target='_blank'>https://www.coze.com/</a>`,
                        }),
                      }}
                    />
                  }
                  placement="rightTop"
                >
                  <div className="flex-center text-[#9A9A9A] gap-1 ml-1 cursor-pointer">
                    <SvgIcon name="help" width={14} color="#999" />
                    <span className="text-sm">{t('how_get')}</span>
                  </div>
                </Popover>
              </div>
            </div>
            <div className="p-4 border rounded-xl bg-white mt-3">
              <Form form={form} layout="vertical">
                <Form.Item label={t('module.website_info_name')}>
                  <Select
                    className="w-full"
                    value={customConfig.provider_id}
                    onChange={(value) => updateCustomConfig({ provider_id: value })}
                    options={providers.map((item) => ({
                      label: item.name,
                      value: item.provider_id,
                    }))}
                  />
                </Form.Item>
                {agentType === AGENT_TYPES.COZE_WORKFLOW_OSV ? (
                  <Form.Item
                    label={t('agent.coze.workflow_link')}
                    name="base_url"
                    rules={generateInputRules({ message: 'form_link_validator', validator: ['link'] })}
                    getValueProps={() => ({ value: channelConfig.base_url || '' })}
                    getValueFromEvent={(e) => {
                      const val = e?.target?.value ?? e
                      updateCustomConfig({
                        channel_config: {
                          ...channelConfig,
                          base_url: val,
                        },
                      })
                      return val
                    }}
                    className="0"
                  >
                    <Input placeholder={t('form_input_placeholder')} />
                  </Form.Item>
                ) : (
                  <Form.Item
                    className="0"
                    label={t('agent.coze.agent_link')}
                    name="base_url"
                    rules={generateInputRules({ message: 'form_link_validator', validator: ['link'] })}
                    getValueProps={() => ({ value: channelConfig.base_url || '' })}
                    getValueFromEvent={(e) => {
                      const val = e?.target?.value ?? e
                      updateCustomConfig({
                        channel_config: {
                          ...channelConfig,
                          base_url: val,
                        },
                      })
                      return val
                    }}
                  >
                    <Input placeholder={t('form_input_placeholder')} />
                  </Form.Item>
                )}
              </Form>
            </div>
            { agentType === AGENT_TYPES.COZE_WORKFLOW_OSV && (
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
            )}
          </>
        )}

        <Form
          form={form}
          layout="vertical"
          initialValues={{ logo, name, group_id, sort }}
        >
          {showChannelConfig ? null : (
            <>
              {agentType === AGENT_TYPES.COZE_WORKFLOW_OSV ? (
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
  },
)

CozeOSV.displayName = 'CozeOSV'

export default CozeOSV