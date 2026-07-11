import {
  forwardRef,
  useImperativeHandle,
  useState,
  useEffect,
} from "react";
import { Form, Input, Modal, Image } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { useAgentCreateAdapter } from "../adapters";
import { useAgentFormStore } from "../store";
import { useAgentForm, usePlatformChannel } from "../hooks";
import {
  BaseConfig,
  ExpandConfig,
  RelateAgents,
  FieldInput,
} from "../components";
import { AGENT_TYPES } from "../constants";
import { generateInputRules } from "@km/shared-utils";

interface N8NProps {
  showChannelConfig?: boolean;
  className?: string;
}

export interface N8NRef {
  validateForm: () => Promise<boolean>;
  onChannelSave: () => Promise<void>;
}

export const N8N = forwardRef<N8NRef, N8NProps>(
  ({ showChannelConfig, className }, ref) => {
    const [guideVisible, setGuideVisible] = useState(false);
    const adapter = useAgentCreateAdapter();

    // N8N model 生成：从 base_url 提取最后一部分
    const generateN8NModel = (values: any) => {
      const model = values.base_url?.split("/").pop() || '';
      const store = useAgentFormStore.getState();
      const agentConfig = adapter?.getAgentConfig?.(store.agent_type);
      return agentConfig?.mode === "completion" ? `workflow-${model}` : model;
    };

    const {
      channelForm,
      agentForm,
      validateForm,
      t,
      formData,
      onChannelSave,
    } = usePlatformChannel({
      platformName: "n8n",
      generateModel: generateN8NModel,
    });

    const {
      agentType,
      updateInputFields,
      updateOutputFields,
    } = useAgentForm();
    const inputFields = formData.settings.input_fields;
    const outputFields = formData.settings.output_fields;
    const { logo, name, group_id, sort } = formData;

    // onMounted - 设置 agent_type
    useEffect(() => {
      useAgentFormStore.setState({ agent_type: AGENT_TYPES.N8N_WORKFLOW });
    }, []);

    const guideList = [
      {
        title: t("platform_auth.n8n.tip", {
          url: '<a style="color: #586D9A;" href="https://n8n.io/" target="_blank">https://n8n.io/</a>',
        }),
        imageList: [],
      },
      {
        title: t("platform_auth.n8n.tip_1"),
        imageList: [
          "/images/n8n-guide/guide-1.png",
          "/images/n8n-guide/guide-2.png",
        ],
      },
      {
        title: t("platform_auth.n8n.tip_2", {
          headerAuth: '<span style="color: #FA5151;"> Header Auth</span>',
        }),
        imageList: ["/images/n8n-guide/guide-3.png"],
      },
      {
        title: t("platform_auth.n8n.tip_3", {
          authorization: '<span style="color: #FA5151;">authorization</span>',
        }),
        imageList: ["/images/n8n-guide/guide-4.png"],
      },
      {
        title: t("platform_auth.n8n.tip_4", {
          select: '<span style="color: #FA5151;">When Last Node Finishes</span>',
        }),
        imageList: ["/images/n8n-guide/guide-5.png"],
      },
    ];

    const getPublicPath = (url: string) => {
      return adapter?.getPublicPath?.(url) || url;
    };

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
                <h3 className="text-base text-[#1D1E1F]">{t("n8n")}</h3>
                <div
                  className="flex-center text-[#9A9A9A] gap-1 ml-1 cursor-pointer"
                  onClick={() => setGuideVisible(true)}
                >
                  <SvgIcon name="help" width={14} color="#999" />
                  <span className="text-sm">{t("term.how_get")}</span>
                </div>
              </div>
            </div>
            
            <div className="p-4 border rounded-xl bg-white mt-3">
              <Form form={channelForm} layout="vertical">
                <Form.Item
                  label={t("module.platform_model_webhook_url")}
                  name="base_url"
                  rules={generateInputRules({
                    message: "form_input_placeholder",
                    validator: ["link"],
                  })}
                >
                  <Input placeholder={t("form.input_placeholder")} />
                </Form.Item>
                <Form.Item
                  label="Value"
                  name="key"
                  rules={generateInputRules({
                    message: "form_input_placeholder",
                    validator: ["text"],
                  })}
                  className="mb-0"
                >
                  <Input placeholder={t("form.input_placeholder")} />
                </Form.Item>
              </Form>
            </div>
            {
              agentType === AGENT_TYPES.N8N_WORKFLOW && (
                <>
                  <FieldInput
                    list={inputFields}
                    onChange={updateInputFields}
                    title={t("agent.input_variable")}
                    allowAdd
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
          label-width="104px"
          className={showChannelConfig ? "mt-6" : ""}
          initialValues={{ logo, name, group_id, sort }}
        >
          {showChannelConfig ? null : (
            <>
              {agentType === AGENT_TYPES.N8N_WORKFLOW ? (
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

        <Modal
          open={guideVisible}
          title={t("term.how_get")}
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
                className="flex flex-col gap-2 text-[#1D1E1F] text-sm"
              >
                <div
                  className="text-wrap break-words whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{ __html: item.title }}
                />
                {item.imageList.map((image, imageIndex) => (
                  <div key={imageIndex} className="w-full">
                    <Image
                      src={getPublicPath(image)}
                      className="w-full"
                      preview={{
                        src: getPublicPath(image),
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
