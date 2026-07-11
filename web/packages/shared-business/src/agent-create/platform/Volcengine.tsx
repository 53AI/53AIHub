import {
  forwardRef,
  useImperativeHandle,
} from "react";
import { Form, Input, Popover, Select } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { usePlatformChannel } from "../hooks";
import {
  BaseConfig,
  ExpandConfig,
  RelateAgents,
} from "../components";
import { generateInputRules } from "@km/shared-utils";

interface VolcengineProps {
  showChannelConfig?: boolean;
  className?: string;
}

export interface VolcengineRef {
  validateForm: () => Promise<boolean>;
  onChannelSave: () => Promise<void>;
}

export const Volcengine = forwardRef<VolcengineRef, VolcengineProps>(
  ({ showChannelConfig, className }, ref) => {
    const {
      channelForm,
      channelEditable,
      agentForm,
      onChannelSave,
      validateForm,
      formData,
      t,
    } = usePlatformChannel({
      platformName: "volcengine",
      defaultBaseUrl: "https://ark.cn-beijing.volces.com",
    });

    const { logo, name, group_id, sort } = formData;

    useImperativeHandle(ref, () => ({
      validateForm: () => validateForm(showChannelConfig),
      onChannelSave,
    }));

    return (
      <div className={`${className || ""}`}>
        {showChannelConfig && (
          <>
            <div className="text-sm font-medium text-primary mb-3">{t("provider_platform.platform_auth")}</div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <h3 className="text-sm text-[#1D1E1F]">{t("platform.volcengine")}</h3>
                <Popover
                  content={
                    <div
                      className="whitespace-pre-wrap text-sm text-[#333] leading-6"
                      dangerouslySetInnerHTML={{
                        __html: t("volcengine_agent_get_tip", {
                          url: `<a class='text-[#5A6D9E] underline' href='https://www.volcengine.com/' target='_blank'>https://www.volcengine.com/</a>`,
                          my_url: `<a class='text-[#5A6D9E] underline' href='https://console.volcengine.com/ark/region:ark+cn-beijing/assistant' target='_blank'>https://console.volcengine.com/ark/region:ark+cn-beijing/assistant</a>`,
                        }),
                      }}
                    />
                  }
                  placement="rightTop"
                  overlayStyle={{ width: 480 }}
                >
                  <div className="flex-center text-[#9A9A9A] gap-1 ml-1 cursor-pointer">
                    <SvgIcon name="help" width={14} color="#999" />
                    <span className="text-sm">{t("term.how_get")}</span>
                  </div>
                </Popover>
              </div>
            </div>
            <div className="p-4 border rounded-xl bg-white mt-3">
              <Form form={channelForm} layout="vertical">
                <Form.Item
                  label={t("module.platform_model_base_url")}
                  name="base_url"
                  rules={generateInputRules({
                    message: "form_input_placeholder",
                    validator: ["text", "link"],
                  })}
                >
                  <Input placeholder={t("form.input_placeholder")} />
                </Form.Item>
                <Form.Item
                  label={t("term.api_botid_en")}
                  name="model"
                  rules={generateInputRules({
                    message: "form_input_placeholder",
                  })}
                >
                  <Input placeholder={t("form.input_placeholder")} />
                </Form.Item>
                <Form.Item
                  label={t("term.api_key")}
                  name="key"
                  rules={generateInputRules({
                    message: "form_input_placeholder",
                    validator: ["text"],
                  })}
                >
                  <Input placeholder={t("form.input_placeholder")} />
                </Form.Item>
                <Form.Item
                  label={t("term.agent_type")}
                  name={["config", "agent_type"]}
                  rules={generateInputRules({
                    message: "form_input_placeholder",
                  })}
                  className="mb-0"
                >
                  <Select
                    className="max-w-[360px]"
                    placeholder={t("form.select_placeholder")}
                    disabled={channelEditable}
                    options={[{ value: "chat", label: t("term.agent_type_chat") }]}
                  />
                </Form.Item>
              </Form>
            </div>
          </>
        )}

        <Form
          form={agentForm}
          layout="vertical"
          initialValues={{ logo, name, group_id, sort }}
        >
          {showChannelConfig ? null : (
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
    );
  },
);

Volcengine.displayName = "Volcengine";

export default Volcengine;
