import { forwardRef, useImperativeHandle } from 'react'
import { Form, Input, Popover } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import { useAgentForm, usePlatformChannel } from '../hooks'
import { BaseConfig, ExpandConfig, RelateAgents, FieldInput } from '../components'
import { AGENT_TYPES } from '../constants'
import { generateInputRules, md5 } from '@km/shared-utils'

interface FastGPTProps {
  showChannelConfig?: boolean
  className?: string
}

export interface FastGPTRef {
  validateForm: () => Promise<boolean>
  onChannelSave: () => Promise<void>
}

export const FastGPT = forwardRef<FastGPTRef, FastGPTProps>(
  ({ showChannelConfig, className }, ref) => {
    // 使用 usePlatformChannel hook 获取基础功能
    const {
      channelConfig,
      channelForm,
      agentForm,
      onChannelSave,
      validateForm,
      formData,
      t,
    } = usePlatformChannel({
      platformName: 'fastgpt_agent',
      defaultBaseUrl: 'https://cloud.fastgpt.cn/api',
      generateModel: (values) => md5(`${values.key}_${values.base_url}`),
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
                <h3 className="text-sm text-[#1D1E1F]">{t('agent_app.fastgpt_agent')}</h3>
                <Popover
                  content={
                    <div
                      className="whitespace-pre-wrap text-sm text-[#333] leading-6"
                      dangerouslySetInnerHTML={{
                        __html: t('fastgpt_agent_get_tip', {
                          url: `<a class='text-[#5A6D9E] underline' href='https://cloud.fastgpt.cn/login' target='_blank'>https://cloud.fastgpt.cn/login</a>`,
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
                    label={t('ap_host_fastgpt')}
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
                    label={t('api_key')}
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
            { agentType === AGENT_TYPES.FASTGPT_WORKFLOW && (
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
          form={agentForm}
          layout="vertical"
          initialValues={{ logo, name, group_id, sort }}
        >
          {showChannelConfig ? null : (
            <>
              {agentType === AGENT_TYPES.FASTGPT_WORKFLOW ? (
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

FastGPT.displayName = 'FastGPT'

export default FastGPT