import {
    forwardRef,
    useImperativeHandle,
    useState,
    useEffect,
    useRef,
} from "react";
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
import { channelApi } from "@/api/modules/channel";
import { useChannelConfig } from "../context/ChannelConfigContext";
import { SvgIcon } from "@km/shared-components-react";
import { generateInputRules } from "@/utils/form-rule";
import { getAgentByAgentType } from "@/constants/platform/config";

interface VolcengineProps {
  showChannelConfig?: boolean;
  className?: string;
}

export interface VolcengineRef {
  validateForm: () => Promise<boolean>;
  onChannelSave: () => Promise<void>;
}

// ChannelForm 状态接口
interface ChannelFormState {
  key: string;
  base_url: string;
  models: string[];
  model: string;
  config: {
    agent_type: string;
  };
}

export const Volcengine = forwardRef<VolcengineRef, VolcengineProps>(
  ({ showChannelConfig, className }, ref) => {
    const channelConfig = useChannelConfig() as any;
    const [channelForm] = Form.useForm();
    const [channelEditable, setChannelEditable] = useState(false);

    // 使用 hook 获取状态
    const { agentData, formData } = useAgentForm();
    // 获取需要同步到 Form 的字段
    const { logo, name, group_id, sort } = formData;
    const [agentForm] = Form.useForm();

    // 使用 ref 存储 channelForm 状态（模拟 Vue 的 reactive）
    const channelFormState = useRef<ChannelFormState>({
      key: "",
      base_url: "",
      models: [],
      model: "",
      config: {
        agent_type: "chat",
      },
    });

    // 数据同步 - 对应 Vue 的 watch
    useEffect(() => {
      if (agentData) {
        const { channel_config = {} } = agentData;
        setChannelEditable(!!+channel_config.channel_id);
        channelConfig.channel_id = +channel_config.channel_id || 0;
        channelConfig.key = channelFormState.current.key =
          channel_config.key || "";
        channelConfig.base_url = channelFormState.current.base_url =
          channel_config.base_url || "https://ark.cn-beijing.volces.com";
        channelConfig.models = channelFormState.current.models =
          channel_config.models || [];
        channelConfig.model = channelFormState.current.model =
          channelFormState.current.models[0] || "";
        channelConfig.config = channelFormState.current.config = {
          ...(channel_config.config || {}),
          agent_type: channel_config.config?.agent_type || "chat",
        };
        // 同步到表单
        channelForm.setFieldsValue({
          key: channelFormState.current.key,
          base_url: channelFormState.current.base_url,
          model: channelFormState.current.model,
          config: {
            agent_type: channelFormState.current.config.agent_type,
          },
        });
      }
    }, [agentData, channelConfig, channelForm]);

    const onChannelSave = async () => {
      try {
        const values = channelForm.getFieldsValue();
        // 更新状态
        channelFormState.current.key = values.key;
        channelFormState.current.base_url = values.base_url;
        channelFormState.current.model = values.model;
        channelFormState.current.config.agent_type =
          values.config?.agent_type || "chat";

        const models = [channelFormState.current.model];
        const name = "volcengine";
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <h3 className="text-base text-primary">{t("volcengine")}</h3>
                <Popover
                  content={
                    <div
                      className="whitespace-pre-wrap text-sm text-primary leading-6"
                      dangerouslySetInnerHTML={{
                        __html: t("volcengine_agent_get_tip", {
                          url: `<a class='text-link underline' href='https://www.volcengine.com/' target='_blank'>https://www.volcengine.com/</a>`,
                          my_url: `<a class='text-link underline' href='https://console.volcengine.com/ark/region:ark+cn-beijing/assistant' target='_blank'>https://console.volcengine.com/ark/region:ark+cn-beijing/assistant</a>`,
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
            <Form form={channelForm} layout="vertical" className="mt-3">
              <Form.Item
                label={t("module.platform_model_base_url")}
                name="base_url"
                rules={generateInputRules({
                  message: "form_input_placeholder",
                  validator: ["text", "link"],
                })}
              >
                <Input placeholder={t("form_input_placeholder")} />
              </Form.Item>
              <Form.Item
                label={t("api_botid_en")}
                name="model"
                rules={generateInputRules({
                  message: "form_input_placeholder",
                })}
              >
                <Input placeholder={t("form_input_placeholder")} />
              </Form.Item>
              <Form.Item
                label={t("api_key")}
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
                name={["config", "agent_type"]}
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
          layout="vertical"
          initialValues={{ logo, name, group_id, sort }}
        >
          {showChannelConfig ? (
            <AgentInfo form={agentForm} />
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

Volcengine.displayName = "Volcengine";

export default Volcengine;
