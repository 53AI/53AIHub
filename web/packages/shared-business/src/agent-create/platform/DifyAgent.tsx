import { forwardRef, useImperativeHandle, useCallback } from 'react'
import { Form, Input, Popover, message } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import { useAgentCreateAdapter } from '../adapters'
import { useAgentForm, usePlatformChannel } from '../hooks'
import { useAgentFormStore } from '../store'
import { BaseConfig, ExpandConfig, RelateAgents, FieldInput } from '../components'
import { AGENT_TYPES } from '../constants'
import { generateInputRules, md5 } from '@km/shared-utils'

interface DifyAgentProps {
  showChannelConfig?: boolean
  className?: string
}

export interface DifyAgentRef {
  validateForm: () => Promise<boolean>
  onChannelSave: () => Promise<void>
}

export const DifyAgent = forwardRef<DifyAgentRef, DifyAgentProps>(
  ({ showChannelConfig, className }, ref) => {
    const adapter = useAgentCreateAdapter()
    const t = adapter.t || ((key: string) => key)

    // Dify 使用 md5(key + base_url) 作为 model
    const generateDifyModel = useCallback((values: any) => {
      const store = useAgentFormStore.getState()
      const agentConfig = adapter?.getAgentConfig?.(store.agent_type)
      return (agentConfig?.mode === 'completion' ? 'workflow-' : '') + md5(`${values.key}_${values.base_url}`)
    }, [adapter])

    // 使用 usePlatformChannel hook 获取基础功能
    const {
      channelForm,
      agentForm,
      validateForm,
      formData,
      onChannelSave,
    } = usePlatformChannel({
      platformName: 'dify',
      defaultBaseUrl: 'https://api.dify.ai/v1',
      generateModel: generateDifyModel,
    })

    // 使用 useAgentForm hook 获取状态和方法
    const {
      agentType,
      updateInputFields,
      updateOutputFields,
    } = useAgentForm()
    const inputFields = formData.settings.input_fields
    const outputFields = formData.settings.output_fields
    const { logo, name, group_id, sort } = formData

    // Dify workflow 输入字段同步请求
    const inputUpdateRequest = useCallback(async () => {
      const store = useAgentFormStore.getState()

      const channelId = store.form_data.custom_config.channel_config?.channel_id
      if (!channelId) {
        message.warning(t('agent_not_found'))
        return []
      }
      const result = await adapter.getPlatformConfig?.({
        platform: AGENT_TYPES.DIFY_WORKFLOW,
        type: 'workflow_fields',
        channel_id: channelId,
      })
      const fields = result?.user_input_form || []
      return fields
        .map((item: any) => {
          const type = Object.keys(item)[0]
          const value = Object.values(item)[0] as any
          if (!type) return null
          return {
            id: Math.random().toString(36).substring(2, 15),
            variable: value.variable,
            type:
              type === 'paragraph'
                ? 'textarea'
                : type === 'select'
                  ? 'select'
                  : 'text',
            label: value.label,
            desc: value.desc,
            required: value.required,
            multiple: value.multiple || false,
            options: (value.options || []).map((item: string) => ({
              id: Math.random().toString(36).substring(2, 15),
              label: item,
            })),
            max_length: value.max_length || 0,
            show_word_limit: value.show_word_limit || false,
            is_system: true,
          }
        })
        .filter(Boolean)
    }, [adapter, t])

    useImperativeHandle(ref, () => ({
      validateForm: () => validateForm(showChannelConfig),
      onChannelSave,
    }))

    return (
      <div className={`${className || ''}`}>
        {showChannelConfig && (
          <>
            <div className="text-sm font-medium text-primary mb-3">{t("provider_platform.platform_auth")}</div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1">
                <h3 className="text-sm text-[#1D1E1F]">{t('dify')}</h3>
                <Popover
                  content={
                    <div
                      className="whitespace-pre-wrap text-sm text-[#333] leading-6"
                      dangerouslySetInnerHTML={{
                        __html: t('dify_agent_get_tip', {
                          url: `<a class='text-[#5A6D9E] underline' href='https://cloud.dify.ai/' target='_blank'>https://cloud.dify.ai/</a>`,
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
              <Form form={channelForm} layout="vertical">
                <div className="flex items-center gap-4">
                  <Form.Item
                    className="flex-1 mb-0"
                    label={t('api_host')}
                    name="base_url"
                    rules={generateInputRules({
                      message: 'form_input_placeholder',
                      validator: ['text', 'link'],
                    })}
                  >
                    <Input placeholder={t('form_input_placeholder')} />
                  </Form.Item>
                  <Form.Item
                    className="flex-1 mb-0"
                    label={t('api_screet')}
                    name="key"
                    rules={generateInputRules({
                      message: 'form_input_placeholder',
                    })}
                  >
                    <Input placeholder={t('form_input_placeholder')} />
                  </Form.Item>
                </div>
              </Form>
            </div>
            {
              agentType === AGENT_TYPES.DIFY_WORKFLOW && (
                <>
                  <FieldInput
                    list={inputFields}
                    onChange={updateInputFields}
                    title={t('agent.input_variable')}
                    allowUpdate
                    allowAdd
                    updateRequest={inputUpdateRequest}
                    type="input"
                    agentType={agentType}
                    className="mt-2"
                  />
                  <FieldInput
                    list={outputFields}
                    onChange={updateOutputFields}
                    title={t("agent.output_variable")}
                    allowAdd
                    type="output"
                    agentType={agentType}
                    className="mt-2"
                  />
                </>
              )
            }
          </>
        )}

        <Form
          form={agentForm}
          layout="vertical"
          initialValues={{ logo, name, group_id, sort }}
        >
          {showChannelConfig ? null : (
            <>
              {agentType === AGENT_TYPES.DIFY_WORKFLOW ? (
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

DifyAgent.displayName = 'DifyAgent'

export default DifyAgent