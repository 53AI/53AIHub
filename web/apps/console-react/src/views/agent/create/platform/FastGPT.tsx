import {
    forwardRef,
    useImperativeHandle,
    useState,
    useEffect,
    useRef,
} from "react";
import { Form, Input, Popover } from "antd";
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
import { AGENT_TYPES, getAgentByAgentType } from "@/constants/platform/config";
import { channelApi } from "@/api/modules/channel";
import { useChannelConfig } from "../context/ChannelConfigContext";
import { md5 } from "@km/shared-utils";
import { SvgIcon } from "@km/shared-components-react";
import { generateInputRules } from "@/utils/form-rule";

interface FastGPTProps {
  showChannelConfig?: boolean;
  className?: string;
}

export interface FastGPTRef {
  validateForm: () => Promise<boolean>;
  onChannelSave: () => Promise<void>;
}

const agentTypeOptions = [
  {
    icon: "agent",
    label: t("agent.fastgpt.agent_type_chat"),
    description: t("agent.fastgpt.agent_type_chat_desc"),
    value: AGENT_TYPES.FASTGPT_AGENT,
  },
  {
    icon: "app-one",
    label: t("agent.fastgpt.agent_type_workflow"),
    description: t("agent.fastgpt.agent_type_workflow_desc"),
    value: AGENT_TYPES.FASTGPT_WORKFLOW,
  },
];

export const FastGPT = forwardRef<FastGPTRef, FastGPTProps>(
  ({ showChannelConfig, className }, ref) => {
    const channelConfig = useChannelConfig() as any;
    const [channelForm] = Form.useForm();
    const [agentForm] = Form.useForm();
    const channelFormRef = useRef<any>(null);
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
    // 获取需要同步到 Form 的字段
    const { logo, name, group_id, sort } = formData;

    // 使用 ref 存储 channelForm 状态（模拟 Vue 的 reactive）
    const channelFormState = useRef({
      key: "",
      base_url: "",
      models: [] as string[],
      config: {
        agent_type: "chat",
      },
    });

    // 数据同步 - 对应 Vue 的 watch，无条件执行（与 Vue 版本一致）
    useEffect(() => {
      if (agentData) {
        const { channel_config = {} } = agentData;
        setChannelEditable(!!+channel_config.channel_id);
        channelConfig.channel_id = +channel_config.channel_id || 0;
        channelConfig.key = channelFormState.current.key =
          channel_config.key || "";
        channelConfig.base_url = channelFormState.current.base_url =
          channel_config.base_url || "https://cloud.fastgpt.cn/api";
        channelConfig.models = channelFormState.current.models =
          channel_config.models || [];
        channelConfig.config = channelFormState.current.config = {
          ...(channel_config.config || {}),
          agent_type: channel_config.config?.agent_type || "chat",
        };
        // 同步到表单
        channelForm.setFieldsValue({
          key: channelFormState.current.key,
          base_url: channelFormState.current.base_url,
        });
      }
    }, [agentData, channelConfig, channelForm]);

    const onChannelSave = async () => {
      try {
        const values = channelForm.getFieldsValue();
        // 更新状态
        channelFormState.current.key = values.key;
        channelFormState.current.base_url = values.base_url;

        const models = [md5(`${values.key}_${values.base_url}`)];
        const name = "fastgpt_agent";
        const saveData = {
          channel_id: channelConfig.channel_id,
          key: channelFormState.current.key,
          base_url: channelFormState.current.base_url,
          config: channelFormState.current.config,
          models,
          name,
        };
        const resultData = await channelApi.save({ data: saveData });
        Object.assign(channelConfig, resultData);
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
        console.error("Channel save error:", error);
      }
    };

    const validateForm = async () => {
      try {
        if (showChannelConfig) {
          await channelForm.validateFields();
        }
        await agentForm.validateFields();
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
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1">
                <h3 className="text-base text-primary">
                  {t("agent_app.fastgpt_agent")}
                </h3>
                <Popover
                  content={
                    <div
                      className="whitespace-pre-wrap text-sm text-primary leading-6"
                      dangerouslySetInnerHTML={{
                        __html: t("fastgpt_agent_get_tip", {
                          url: `<a class='text-link underline' href='https://cloud.fastgpt.cn/login' target='_blank'>https://cloud.fastgpt.cn/login</a>`,
                        }),
                      }}
                    />
                  }
                  placement="rightTop"
                  overlayStyle={{ width: 480 }}
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
              options={agentTypeOptions}
              disabled={!!agentId}
              onChange={setAgentType}
            />
            <Form form={channelForm} layout="vertical" className="mt-3">
              <div className="flex items-center gap-4">
                <Form.Item
                  className="flex-1"
                  label={t("ap_host_fastgpt")}
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
                  label={t("api_key")}
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
          layout="vertical"
          initialValues={{ logo, name, group_id, sort }}
        >
          {showChannelConfig ? (
            <AgentInfo form={agentForm} />
          ) : (
            <>
              <UseScope />
              {agentType === AGENT_TYPES.FASTGPT_WORKFLOW ? (
                <>
                  <FieldInput
                    list={inputFields}
                    onChange={updateInputFields}
                    title={t("agent.input_variable")}
                    allowAdd
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

FastGPT.displayName = "FastGPT";

export default FastGPT;
