import { forwardRef, useImperativeHandle, useState, useEffect } from "react";
import { Form, Input, Popover, Select } from "antd";
import { t } from "@/locales";
import { useAgentFormStore } from "../store";
import { useAgentForm } from "../hooks";
import {
    AgentInfo,
    BaseConfig,
    ExpandConfig,
    UseScope,
    RelateAgents,
} from "../components";
import { SvgIcon } from "@km/shared-components-react";
import { channelApi } from "@/api/modules/channel";
import { useChannelConfig } from "../context/ChannelConfigContext";
import { generateInputRules } from "@/utils/form-rule";
import { getAgentByAgentType } from "@/constants/platform/config";

interface YuanqiProps {
  showChannelConfig?: boolean;
  className?: string;
}

export interface YuanqiRef {
  validateForm: () => Promise<boolean>;
  onChannelSave: () => Promise<void>;
}

export const Yuanqi = forwardRef<YuanqiRef, YuanqiProps>(
  ({ showChannelConfig, className }, ref) => {
    const channelInfo = useChannelConfig() as any;
    const [channelForm] = Form.useForm();
    const [agentForm] = Form.useForm();
    const [channelEditable, setChannelEditable] = useState(false);

    // 使用 hook 获取状态
    const { agentData, formData } = useAgentForm();
    // 获取需要同步到 Form 的字段
    const { logo, name, group_id, sort } = formData;

    useEffect(() => {
      const { channel_config = {} } = agentData || {};
      setChannelEditable(!!+channel_config.channel_id);
      channelInfo.channel_id = +channel_config.channel_id || 0;
      channelInfo.key = channel_config.key || "";
      channelInfo.base_url =
        channel_config.base_url || "https://yuanqi.tencent.com/";
      channelInfo.models = channel_config.models || [];
      channelInfo.model = channel_config.models?.[0] || "";
      channelInfo.config = {
        ...(channel_config.config || {}),
        agent_type: channel_config.config?.agent_type || "chat",
      };
      // Set form values
      channelForm.setFieldsValue({
        key: channel_config.key || "",
        model: channel_config.models?.[0] || "",
        agent_type: channel_config.config?.agent_type || "chat",
      });
    }, [agentData, channelInfo, channelForm]);

    const onChannelSave = async () => {
      try {
        const values = channelForm.getFieldsValue();
        const models = [values.model];
        const name = "yuanqi";
        const saveData = {
          channel_id: channelInfo.channel_id,
          key: values.key,
          base_url: channelInfo.base_url || "",
          config: { agent_type: values.agent_type },
          models,
          name,
        };
        const resultData = await channelApi.save({ data: saveData });
        Object.assign(channelInfo, resultData);
        if (!saveData.channel_id) saveData.channel_id = resultData.channel_id;

        const store = useAgentFormStore.getState();
        const agent = getAgentByAgentType(store.agent_type);
        useAgentFormStore.setState({
          form_data: {
            ...store.form_data,
            channel_type: agent?.channelType || store.form_data.channel_type,
            model: models[0],
            custom_config: {
              ...store.form_data.custom_config,
              channel_config: saveData,
            },
          },
        });
        setChannelEditable(true);
      } catch (error) {
        // validation failed
      }
    };

    const validateForm = async () => {
      try {
        if (showChannelConfig && channelForm) {
          await channelForm.validateFields();
        }
        if (agentForm) {
          await agentForm.validateFields();
        }
        return true;
      } catch {
        return false;
      }
    };

    useImperativeHandle(ref, () => ({
      validateForm,
      onChannelSave,
    }));

    return (
      <div className={`${showChannelConfig ? "" : "pb-7"} ${className || ""}`}>
        {showChannelConfig && (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <h3 className="text-base text-primary">{t("yuanqi")}</h3>
                <Popover
                  content={
                    <div
                      className="whitespace-pre-wrap text-sm text-primary leading-6"
                      dangerouslySetInnerHTML={{
                        __html: t("yuanqi_agent_get_tip", {
                          url: `<a class='text-link underline' href='https://yuanqi.tencent.com/my-creation/agent' target='_blank'>https://yuanqi.tencent.com/my-creation/agent</a>`,
                        }),
                      }}
                    />
                  }
                  placement="rightTop"
                >
                  <div className="flex-center text-disabled gap-1 ml-1 cursor-pointer">
                    <SvgIcon name="help" width={14} color="#999" />
                    <span className="text-sm">{t("how_get")}</span>
                  </div>
                </Popover>
              </div>
            </div>
            <Form form={channelForm} layout="vertical" className="mt-3">
              <Form.Item
                label={t("api_botid")}
                name="model"
                rules={generateInputRules({
                  message: "form_input_placeholder",
                })}
              >
                <Input placeholder={t("form_input_placeholder")} />
              </Form.Item>
              <Form.Item
                label="Token"
                name="key"
                rules={generateInputRules({
                  message: "form_input_placeholder",
                  validator: ["text"],
                })}
              >
                <Input placeholder={t("form_input_placeholder")} />
              </Form.Item>
              <Form.Item
                label={t("agent_type")}
                name="agent_type"
                rules={generateInputRules({
                  message: "form_input_placeholder",
                })}
              >
                <Select
                  className="max-w-[360px]"
                  placeholder={t("form_select_placeholder")}
                  disabled={channelEditable}
                  options={[{ value: "chat", label: t("agent_type_chat") }]}
                />
              </Form.Item>
            </Form>
          </>
        )}

        <Form
          form={agentForm}
          labelCol={{ style: { width: "104px" } }}
          layout="vertical"
          className={showChannelConfig ? "mt-6" : ""}
          initialValues={{ logo, name, group_id, sort }}
        >
          {showChannelConfig ? (
            <AgentInfo />
          ) : (
            <>
              <UseScope />
              <BaseConfig />
              <RelateAgents />
              <ExpandConfig />
            </>
          )}
        </Form>
      </div>
    );
  },
);

Yuanqi.displayName = "Yuanqi";

export default Yuanqi;
