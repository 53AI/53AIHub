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
import { md5, generateInputRules } from "@km/shared-utils";

interface MaxKBProps {
  showChannelConfig?: boolean;
  className?: string;
}

export interface MaxKBRef {
  validateForm: () => Promise<boolean>;
  onChannelSave: () => Promise<void>;
}

export const MaxKB = forwardRef<MaxKBRef, MaxKBProps>(
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
      platformName: "maxkb_agent",
      generateModel: (values) => md5(`${values.key}_${values.base_url}`),
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
                <h3 className="text-sm text-[#1D1E1F]">
                  {t("provider_platform.maxkb")}
                </h3>
                <Popover
                  content={
                    <div
                      className="whitespace-pre-wrap text-sm text-[#333] leading-6"
                      dangerouslySetInnerHTML={{
                        __html: t("maxkb_agent_get_tip", {
                          url: `<a class='text-[#5A6D9E] underline' href='https://maxkb.cn/' target='_blank'>https://maxkb.cn/</a>`,
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
                  label={t("module.platform_model_base_url_maxkb")}
                  name="base_url"
                  rules={generateInputRules({
                    message: "form_input_placeholder",
                    validator: ["link"],
                  })}
                >
                  <Input placeholder={t("form.input_placeholder")} />
                </Form.Item>
                <Form.Item
                  label="API Key"
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
                    className="w-full"
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

MaxKB.displayName = "MaxKB";

export default MaxKB;
