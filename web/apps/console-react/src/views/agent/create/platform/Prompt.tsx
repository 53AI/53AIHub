import { forwardRef, useImperativeHandle, useEffect } from "react";
import { Form, Tooltip, message } from "antd";
import { t } from "@/locales";
import { useAgentForm } from "../hooks";
import {
    AgentInfo,
    BaseConfig,
    ExpandConfig,
    UseScope,
    RelateAgents,
} from "../components";
import { ModelSelect } from "@/components/Model/select";
import { copyToClip } from "@km/shared-utils";
import { PromptInput } from "@/components/Prompt/input";
import { SvgIcon } from "@km/shared-components-react";
import Fullscreen from "@/components/Fullscreen";

interface PromptProps {
  showChannelConfig?: boolean;
  className?: string;
}

export interface PromptRef {
  validateForm: () => Promise<boolean>;
}

export const Prompt = forwardRef<PromptRef, PromptProps>(
  ({ showChannelConfig, className }, ref) => {
    const [antdForm] = Form.useForm();
    const form = useAgentForm();

    // 使用 hook 获取状态
    const model = form.formData.model;
    const prompt = form.formData.prompt;
    const name = form.formData.name;
    const logo = form.formData.logo;
    const group_id = form.formData.group_id;
    const sort = form.formData.sort;

    // 同步表单数据到 Ant Design Form
    useEffect(() => {
      antdForm.setFieldsValue({
        model,
        name,
        logo,
        group_id,
        sort,
      });
    }, [model, name, logo, group_id, sort, antdForm]);

    const onModelChange = (value: string, option: any) => {
      form.updateFields({
        model: value,
        settings: {
          ...form.formData.settings,
          image_parse: {
            ...form.formData.settings.image_parse,
            vision: option?.vision || false,
          },
        },
        custom_config: {
          ...form.formData.custom_config,
          image_parse: option?.vision
            ? form.formData.custom_config.image_parse
            : { enable: false },
        },
      });
      form.setSupportImage(option?.vision || false);
    };

    const onPromptChange = (value: string) => {
      form.updateField("prompt", value);
    };

    const onOptimize = () => {
      return message.warning(t("feature_coming_soon"));
    };

    const onGenerate = () => {
      return message.warning(t("feature_coming_soon"));
    };

    const onCopy = async (text: string) => {
      await copyToClip(text);
      message.success(t("action_copy_success"));
    };

    const validateForm = async () => {
      try {
        await antdForm.validateFields();
        return true;
      } catch {
        return false;
      }
    };

    useImperativeHandle(ref, () => ({
      validateForm,
    }));

    return (
      <div className={`${showChannelConfig ? "" : "pb-7"} ${className || ""}`}>
        <Form
          form={antdForm}
          layout="vertical"
          initialValues={{ model, name, logo, group_id, sort }}
        >
          {showChannelConfig ? (
            <>
              <h3 className="text-base text-primary mb-3">
                {t("agent_app.prompt_v2")}
              </h3>
              <div className="text-sm text-secondary mb-4">
                {t("access_model")}
              </div>
              <Form.Item
                name="model"
                rules={[{ required: true, message: t("form_select_placeholder") }]}
                getValueProps={() => ({ value: model })}
                getValueFromEvent={(value) => {
                  return value;
                }}
              >
                <ModelSelect
                  valueKey="model_value"
                  onChange={onModelChange}
                />
              </Form.Item>
              <AgentInfo form={antdForm} />
            </>
          ) : (
            <>
              <UseScope />
              <div className="text-sm text-secondary mb-4">
                {t("role_instruction")}
              </div>
              <Form.Item className="mb-6">
                <Fullscreen className="w-full" zIndex={9}>
                  {({ isFullscreen, toggleFullscreen }) => (
                    <div className="border rounded w-full flex flex-col !bg-[#FAFBFC] overflow-auto relative">
                      <div
                        className={`min-h-10 pl-3 pr-2 border-b flex items-center justify-between rounded-t bg-[#FBFBFC] ${isFullscreen ? "sticky top-0 left-0 right-0 z-10" : ""}`}
                      >
                        <div
                          className="flex-1 text-sm text-secondary truncate"
                          title={t("role_instruction_desc")}
                        >
                          *{t("role_instruction_desc")}
                        </div>
                        <div className="flex items-center gap-1">
                          <Tooltip placement="top" title={t("optimize_tip")}>
                            <span
                              className="flex-center gap-1 text-brand text-sm px-1 cursor-pointer opacity-60 pointer-events-none"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOptimize();
                              }}
                            >
                              <SvgIcon name="hglt" width="18px" />
                              {t("optimize")}
                            </span>
                          </Tooltip>
                          <div className="flex-none h-4 w-px border-r border-[#E1E2E6]" />
                          <Tooltip placement="top" title={t("generate_tip")}>
                            <span
                              className="text-dark px-1 cursor-pointer opacity-60 pointer-events-none"
                              onClick={(e) => {
                                e.stopPropagation();
                                onGenerate();
                              }}
                            >
                              <SvgIcon name="magic-stick" width="18px" />
                            </span>
                          </Tooltip>
                          <Tooltip placement="top" title={t("action_copy")}>
                            <span
                              className="text-dark px-1 cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation();
                                onCopy(prompt);
                              }}
                            >
                              <SvgIcon name="copy" width="18px" />
                            </span>
                          </Tooltip>
                          <Tooltip
                            placement="top"
                            title={
                              isFullscreen
                                ? t("action_shrink")
                                : t("action_amplify")
                            }
                          >
                            <span
                              className="text-dark px-1 cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFullscreen();
                              }}
                            >
                              <SvgIcon
                                name={!isFullscreen ? "amplify" : "shrink"}
                                width="18px"
                              />
                            </span>
                          </Tooltip>
                        </div>
                      </div>
                      <PromptInput
                        value={prompt}
                        onChange={onPromptChange}
                        style={{
                          flex: isFullscreen ? "1" : "auto",
                          height: 280,
                          minHeight: "max-content",
                        }}
                        showLine
                        wordWrap
                      />
                    </div>
                  )}
                </Fullscreen>
              </Form.Item>
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

Prompt.displayName = "Prompt";

export default Prompt;
