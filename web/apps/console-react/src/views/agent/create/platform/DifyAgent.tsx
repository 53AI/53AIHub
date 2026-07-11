import { forwardRef, useImperativeHandle, useState, useEffect } from "react";
import { Form, Input, Popover, message } from "antd";
import { t } from "@/locales";
import { useAgentFormStore } from "../store";
import { useAgentForm } from "../hooks";
import {
    AgentInfo,
    BaseConfig,
    ExpandConfig,
    UseScope,
    RelateAgents,
    FieldInput,
    AgentType,
} from "../components";
import { SvgIcon } from "@km/shared-components-react";
import { AGENT_TYPES, getAgentByAgentType } from "@/constants/platform/config";
import { generateRandomId } from "@/utils";
import { md5 } from "@km/shared-utils";
import { channelApi } from "@/api/modules/channel";
import { agentApi } from "@/api/modules/agent";
import { useChannelConfig } from "../context/ChannelConfigContext";
import { generateInputRules } from "@/utils/form-rule";

interface DifyAgentProps {
  showChannelConfig?: boolean;
  className?: string;
}

export interface DifyAgentRef {
  validateForm: () => Promise<boolean>;
  onChannelSave: () => Promise<void>;
  save?: () => Promise<{ data?: { agent_id?: string } }>;
}

const agentTypeOptions = [
  {
    icon: "agent",
    label: t("agent.dify.agent_type_chat"),
    description: t("agent.dify.agent_type_chat_desc"),
    value: AGENT_TYPES.DIFY_AGENT,
  },
  {
    icon: "app-one",
    label: t("agent.dify.agent_type_workflow"),
    description: t("agent.dify.agent_type_workflow_desc"),
    value: AGENT_TYPES.DIFY_WORKFLOW,
  },
];

export const DifyAgent = forwardRef<DifyAgentRef, DifyAgentProps>(
  ({ showChannelConfig, className }, ref) => {
    const channelInfo = useChannelConfig() as any;
    const [channelForm] = Form.useForm();
    const [agentForm] = Form.useForm();
    const [channelEditable, setChannelEditable] = useState(false);

    // 使用 hook 获取状态和方法
    const {
      agentType,
      agentId,
      agentData,
      formData,
      updateInputFields,
      updateOutputFields,
      setAgentType,
    } = useAgentForm();
    const inputFields = formData.settings.input_fields;
    const outputFields = formData.settings.output_fields;
    const channelConfig = formData.custom_config.channel_config;
    // 获取需要同步到 Form 的字段
    const { logo, name, group_id, sort } = formData;

    const inputUpdateRequest = async () => {
      const store = useAgentFormStore.getState();
      const channelId = store.form_data.custom_config.channel_config?.channel_id;
      // 未保存时 channel_id 为空或 0，需要提示用户先保存
      if (!channelId) {
        message.warning(t("agent_not_found"));
        return [];
      }
      const res = await agentApi.dify.workflow_field_list(channelId);
      return res.user_input_form
        .map((item: any) => {
          const type = Object.keys(item)[0];
          const value = Object.values(item)[0] as any;
          if (!type) return null;
          return {
            id: generateRandomId(6, true),
            variable: value.variable,
            type:
              type === "paragraph"
                ? "textarea"
                : type === "select"
                  ? "select"
                  : "text",
            label: value.label,
            desc: value.desc,
            required: value.required,
            multiple: value.multiple || false,
            options: (value.options || []).map((item: string) => ({
              id: generateRandomId(6, true),
              label: item,
            })),
            max_length: value.max_length || 0,
            show_word_limit: value.show_word_limit || false,
            is_system: true,
          };
        })
        .filter(Boolean);
    };

    const onChannelSave = async () => {
      try {
        const store = useAgentFormStore.getState();
        const agent = getAgentByAgentType(store.agent_type);
        const values = channelForm.getFieldsValue();
        const model =
          (agent && agent.mode === "completion" ? "workflow-" : "") +
          md5(`${values.key}_${values.base_url}`);
        const name = "dify";
        const saveData = {
          channel_id: channelInfo.channel_id,
          key: values.key,
          base_url: values.base_url,
          config: { agent_type: "chat" },
          models: [model],
          name,
        };
        const resultData = await channelApi.save({ data: saveData });
        Object.assign(channelInfo, resultData);
        if (!saveData.channel_id) saveData.channel_id = resultData.channel_id;
        useAgentFormStore.setState({
          form_data: {
            ...store.form_data,
            channel_type: agent?.channelType || store.form_data.channel_type,
            model: model,
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

    // Watch store.agent_data to initialize channel config (equivalent to Vue's watch)
    useEffect(() => {
      const channel_config = agentData?.channel_config || {};
      setChannelEditable(!!+channel_config.channel_id);
      channelInfo.channel_id = +channel_config.channel_id || 0;
      channelInfo.key = channel_config.key || "";
      channelInfo.base_url =
        channel_config.base_url || "https://api.dify.ai/v1";
      channelInfo.models = channel_config.models || [];
      channelInfo.config = {
        ...(channel_config.config || {}),
        agent_type: channel_config.config?.agent_type || "chat",
      };
      // Set form values
      channelForm.setFieldsValue({
        key: channel_config.key || "",
        base_url: channel_config.base_url || "https://api.dify.ai/v1",
      });
    }, [agentData, channelInfo, channelForm]);

    useImperativeHandle(ref, () => ({
      validateForm,
      onChannelSave,
    }));

    return (
      <div className={`${showChannelConfig ? "" : "pb-7"} ${className || ""}`}>
        {showChannelConfig && (
          <>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1">
                <h3 className="text-base text-primary">{t("dify")}</h3>
                <Popover
                  content={
                    <div
                      className="whitespace-pre-wrap text-sm text-primary leading-6"
                      dangerouslySetInnerHTML={{
                        __html: t("dify_agent_get_tip", {
                          url: `<a class='text-link underline' href='https://dify.ai/zh' target='_blank'>https://dify.ai/zh</a>`,
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
            <AgentType
              value={agentType}
              disabled={!!agentId}
              options={agentTypeOptions}
              onChange={setAgentType}
            />
            <Form form={channelForm} layout="vertical" className="mt-3">
              <div className="flex items-center gap-4">
                <Form.Item
                  className="flex-1"
                  label={t("api_host")}
                  name="base_url"
                  rules={generateInputRules({
                    message: "form_input_placeholder",
                    validator: ["text", "link"],
                  })}
                >
                  <Input placeholder={t("form_input_placeholder")} />
                </Form.Item>
                <Form.Item
                  className="flex-1"
                  label={t("api_screet")}
                  name="key"
                  rules={generateInputRules({
                    message: "form_input_placeholder",
                  })}
                >
                  <Input placeholder={t("form_input_placeholder")} />
                </Form.Item>
              </div>
            </Form>
          </>
        )}

        <Form
          form={agentForm}
          labelCol={{ style: { width: "104px" } }}
          layout="vertical"
          initialValues={{ logo, name, group_id, sort }}
        >
          {showChannelConfig ? (
            <AgentInfo className="mt-6" form={agentForm} />
          ) : (
            <>
              <UseScope />
              {agentType === AGENT_TYPES.DIFY_WORKFLOW ? (
                <>
                  <FieldInput
                    list={inputFields}
                    onChange={updateInputFields}
                    title={t("agent.input_variable")}
                    allowUpdate
                    allowAdd
                    updateRequest={inputUpdateRequest}
                    type="input"
                    agentType={agentType}
                  />
                  <FieldInput
                    list={outputFields}
                    onChange={updateOutputFields}
                    title={t("agent.output_variable")}
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
    );
  },
);

DifyAgent.displayName = "DifyAgent";

export default DifyAgent;
