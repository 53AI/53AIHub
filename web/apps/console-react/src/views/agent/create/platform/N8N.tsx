import {
    forwardRef,
    useImperativeHandle,
    useState,
    useEffect,
    useRef,
} from "react";
import { Form, Input, Modal, Image } from "antd";
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
} from "../components";
import { channelApi } from "@/api/modules/channel";
import { useChannelConfig } from "../context/ChannelConfigContext";
import {
    AGENT_TYPES,
    AGENT_MODES,
    getAgentByAgentType,
} from "@/constants/platform/config";
import { SvgIcon } from "@km/shared-components-react";
import { generateInputRules } from "@/utils/form-rule";
import { methods } from "@/global/methods";

interface N8NProps {
  showChannelConfig?: boolean;
  className?: string;
}

export interface N8NRef {
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

const guideList = [
  {
    title: window.$t("platform_auth.n8n.tip", {
      url: '<a style="color: #586D9A;" href="https://n8n.io/" target="_blank">https://n8n.io/</a>',
    }),
    imageList: [],
  },
  {
    title: window.$t("platform_auth.n8n.tip_1"),
    imageList: [
      "/images/n8n-guide/guide-1.png",
      "/images/n8n-guide/guide-2.png",
    ],
  },
  {
    title: window.$t("platform_auth.n8n.tip_2", {
      headerAuth: '<span style="color: #FA5151;"> Header Auth</span>',
    }),
    imageList: ["/images/n8n-guide/guide-3.png"],
  },
  {
    title: window.$t("platform_auth.n8n.tip_3", {
      authorization: '<span style="color: #FA5151;">authorization</span>',
    }),
    imageList: ["/images/n8n-guide/guide-4.png"],
  },
  {
    title: window.$t("platform_auth.n8n.tip_4", {
      select: '<span style="color: #FA5151;">When Last Node Finishes</span>',
    }),
    imageList: ["/images/n8n-guide/guide-5.png"],
  },
];

export const N8N = forwardRef<N8NRef, N8NProps>(
  ({ showChannelConfig, className }, ref) => {
    const channelConfig = useChannelConfig() as any;
    const [channelForm] = Form.useForm();
    const channelFormRef = useRef<any>(null);
    const agentFormRef = useRef<any>(null);
    const [channelEditable, setChannelEditable] = useState(false);
    const [guideVisible, setGuideVisible] = useState(false);

    // 使用 hook 获取状态和方法
    const {
      agentType,
      agentData,
      formData,
      updateInputFields,
      updateOutputFields,
    } = useAgentForm();
    const inputFields = formData.settings.input_fields;
    const outputFields = formData.settings.output_fields;
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
        agent_type: AGENT_MODES.COMPLETION,
      },
    });

    // 数据同步 - 对应 Vue 的 watch agent_data
    useEffect(() => {
      if (agentData) {
        const { channel_config = {} } = agentData;
        setChannelEditable(!!+channel_config.channel_id);
        channelConfig.channel_id = +channel_config.channel_id || 0;
        channelConfig.key = channelFormState.current.key =
          channel_config.key || "";
        channelConfig.base_url = channelFormState.current.base_url =
          channel_config.base_url || "";
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
        });
      }
    }, [agentData]);

    // onMounted - 设置 agent_type
    useEffect(() => {
      useAgentFormStore.setState({ agent_type: AGENT_TYPES.N8N_WORKFLOW });
    }, []);

    const handleOpenDialog = () => {
      setGuideVisible(true);
    };

    const onChannelSave = async () => {
      try {
        const values = channelForm.getFieldsValue();
        const currentState = useAgentFormStore.getState();
        const agent = getAgentByAgentType(currentState.agent_type);

        // 更新状态
        channelFormState.current.key = values.key;
        channelFormState.current.base_url = values.base_url;

        // 对应 Vue: if (!channelForm.model) { ... }
        if (!channelFormState.current.model) {
          const model = values.base_url.split("/").pop();
          if (agent?.mode === "completion") {
            channelFormState.current.model = `workflow-${model}`;
          } else {
            channelFormState.current.model = model;
          }
        }

        const models = [channelFormState.current.model];
        const name = "n8n";
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
        useAgentFormStore.setState({
          form_data: {
            ...currentState.form_data,
            channel_type:
              agent?.channelType || currentState.form_data.channel_type,
            model: models[0],
            custom_config: {
              ...currentState.form_data.custom_config,
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
                <h3 className="text-base text-primary">{t("n8n")}</h3>
                <div
                  className="flex-center text-disabled gap-1 ml-1 cursor-pointer"
                  onClick={handleOpenDialog}
                >
                  <SvgIcon name="help" width={14} color="#999" />
                  <span className="text-sm">{t("how_get")}</span>
                </div>
              </div>
            </div>
            <Form form={channelForm} layout="vertical" className="mt-3">
              <Form.Item
                label={t("module.platform_model_webhook_url")}
                name="base_url"
                rules={generateInputRules({
                  message: "form_input_placeholder",
                  validator: ["link"],
                })}
              >
                <Input placeholder={t("form_input_placeholder")} />
              </Form.Item>
              <Form.Item
                label="Value"
                name="key"
                rules={generateInputRules({
                  message: "form_input_placeholder",
                  validator: ["text"],
                })}
              >
                <Input placeholder={t("form_input_placeholder")} />
              </Form.Item>
            </Form>
          </>
        )}

        <Form
          form={agentForm}
          layout="vertical"
          label-width="104px"
          className={showChannelConfig ? "mt-6" : ""}
          initialValues={{ logo, name, group_id, sort }}
        >
          {showChannelConfig ? (
            <AgentInfo form={agentForm} />
          ) : (
            <>
              <UseScope />
              {agentType === AGENT_TYPES.N8N_WORKFLOW ? (
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

        <Modal
          open={guideVisible}
          title={t("how_get")}
          centered
          width={860}
          destroyOnHidden
          onCancel={() => setGuideVisible(false)}
          footer={null}
        >
          <ul className="flex flex-col gap-4 pb-4 box-border max-h-[84vh] overflow-y-auto">
            {guideList.map((item, index) => (
              <li
                key={index}
                className="flex flex-col gap-2 text-primary text-sm"
              >
                <div
                  className="text-wrap break-words whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{ __html: item.title }}
                />
                {item.imageList.map((image, imageIndex) => (
                  <div key={imageIndex} className="w-full">
                    <Image
                      src={methods.$getRealPath({ url: image })}
                      className="w-full"
                      preview={{
                        src: methods.$getRealPath({ url: image }),
                      }}
                    />
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </Modal>
      </div>
    );
  },
);

N8N.displayName = "N8N";

export default N8N;
