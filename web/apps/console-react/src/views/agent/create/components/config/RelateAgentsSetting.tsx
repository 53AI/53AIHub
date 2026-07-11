import {
    useState,
    useMemo,
    forwardRef,
    useImperativeHandle,
    useRef,
} from "react";
import { Modal, Form, Button, Image } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { t } from "@/locales";
import { useAgentForm } from "../../hooks";
import { PromptInput, PromptInputRef } from "@/components/Prompt/input";
import { AGENT_MODES } from "@/constants/platform/config";
import { deepCopy } from "@/utils";

interface RelateAgent {
  id: string;
  name: string;
  logo: string;
  input_fields: { id: string; label: string; required: boolean }[];
  field_mapping: Record<string, string>;
  execution_rule: "auto" | "manual";
}

interface RelateAgentsSettingProps {
  onSave: (value: RelateAgent) => void;
}

interface RelateAgentsSettingRef {
  open: (item: RelateAgent) => void;
  close: () => void;
}

export const RelateAgentsSetting = forwardRef<
  RelateAgentsSettingRef,
  RelateAgentsSettingProps
>(({ onSave }, ref) => {
  const [form] = Form.useForm();
  const { formData, getAgentOptionData } = useAgentForm();
  const [visible, setVisible] = useState(false);
  const [agent, setAgent] = useState<RelateAgent>({} as RelateAgent);
  const promptInputRefs = useRef<Record<number, PromptInputRef | null>>({});

  const agentInfo = useMemo(
    () => ({
      icon: formData.logo || "",
      name: formData.name || "",
    }),
    [formData.logo, formData.name],
  );

  const variables = useMemo(() => {
    const isChatAgent = getAgentOptionData()?.mode === AGENT_MODES.CHAT;
    if (isChatAgent) {
      return [
        {
          label: window.$t("output_variable"),
          children: [{ label: "{#text#}", value: "{#text#}" }],
        },
      ];
    }
    return [
      {
        label: window.$t("output_variable"),
        children: (formData.settings.output_fields || []).map((item: any) => ({
          label: `{#${item.label}#}`,
          value: `{#${item.variable}#}`,
        })),
      },
    ];
  }, [getAgentOptionData, formData.settings.output_fields]);

  const open = (item: RelateAgent) => {
    const copiedAgent = deepCopy(item);
    setAgent(copiedAgent);
    // 设置表单初始值，将 field_mapping 同步到表单
    const initialValues: Record<string, string> = {};
    copiedAgent.input_fields?.forEach((field: { id: string }) => {
      initialValues[field.id] = copiedAgent.field_mapping?.[field.id] || "";
    });
    form.setFieldsValue(initialValues);
    setVisible(true);
  };

  const close = () => {
    setVisible(false);
  };

  const handleSelectVariable = (index: number) => {
    promptInputRefs.current[index]?.showTooltip();
  };

  const handleExecutionRule = (rule: "auto" | "manual") => {
    setAgent({ ...agent, execution_rule: rule });
  };

  const handleFieldMappingChange = (fieldId: string, value: string) => {
    // 同时更新 agent 状态和表单字段值
    setAgent({
      ...agent,
      field_mapping: { ...agent.field_mapping, [fieldId]: value },
    });
    form.setFieldValue(fieldId, value);
  };

  const handleSave = async () => {
    try {
      await form.validateFields();
      onSave(agent);
      close();
    } catch (error) {
      console.error("Validation failed:", error);
    }
  };

  useImperativeHandle(ref, () => ({
    open,
    close,
  }));

  return (
    <Modal
      open={visible}
      onCancel={close}
      onOk={handleSave}
      title={t("action.setting")}
      width={600}
      className="el-dialog--footer-center"
      footer={
        <>
          <Button className="text-primary" type="default" onClick={close}>
            {t("action_cancel")}
          </Button>
          <Button type="primary" onClick={handleSave}>
            {t("action_confirm")}
          </Button>
        </>
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item label={t("agent.relate_app.input_mapping")}>
          <div className="w-full border rounded">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-dashed">
              <Image
                src={agent.logo}
                width={32}
                height={32}
                className="rounded-md"
                fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
                preview={false}
              />
              <p className="flex-1 text-sm text-primary truncate">
                {agent.name}
              </p>
            </div>
            <div className="py-4 px-5 max-h-[300px] overflow-y-auto">
              {agent.input_fields?.map((field, index) => (
                <Form.Item
                  key={field.id}
                  name={field.id}
                  rules={[
                    {
                      required: field.id === "input" ? true : field.required,
                      message:
                        field.id === "input"
                          ? t("form.input_placeholder")
                          : t("form.input_placeholder") + field.label,
                    },
                  ]}
                  className="!mb-3"
                >
                  <div className="w-full">
                    <div className="flex items-center justify-between mb-1">
                      <div
                        className={`flex-1 text-sm text-primary ${
                          field.id === "input" || field.required
                            ? "required-label"
                            : ""
                        }`}
                      >
                        {field.label}
                      </div>
                      <span
                        className="text-brand cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectVariable(index);
                        }}
                      >
                        {`{#}`}
                      </span>
                    </div>
                    <div className="h-28 border rounded p-2 w-full">
                      <PromptInput
                        ref={(el) => {
                          promptInputRefs.current[index] = el;
                        }}
                        value={agent.field_mapping?.[field.id] || ""}
                        onChange={(v) => handleFieldMappingChange(field.id, v)}
                        placeholder={t("form.set_variable_placeholder")}
                        style={{ height: "100%" }}
                        variables={variables}
                        agentInfo={agentInfo}
                      />
                    </div>
                  </div>
                </Form.Item>
              ))}
            </div>
          </div>
        </Form.Item>

        <Form.Item label={t("agent.relate_app.execution_rule")}>
          <div className="w-full flex items-center gap-4">
            <div
              className={`flex-1 h-8 flex items-center gap-2 px-3 border rounded cursor-pointer ${
                agent.execution_rule === "auto"
                  ? "border-[#2563EB] text-brand"
                  : ""
              }`}
              onClick={() => handleExecutionRule("auto")}
            >
              <div className="size-4 flex items-center justify-center">
                {agent.execution_rule === "auto" ? (
                  <SvgIcon name="check" />
                ) : (
                  <SvgIcon name="circle" />
                )}
              </div>
              {t("agent.relate_app.auto_execution")}
            </div>
            <div
              className={`flex-1 h-8 flex items-center gap-2 px-3 border rounded cursor-pointer ${
                agent.execution_rule === "manual"
                  ? "border-[#2563EB] text-brand"
                  : ""
              }`}
              onClick={() => handleExecutionRule("manual")}
            >
              <div className="size-4 flex items-center justify-center">
                {agent.execution_rule === "manual" ? (
                  <SvgIcon name="check" />
                ) : (
                  <SvgIcon name="circle" />
                )}
              </div>
              {t("agent.relate_app.manual_execution")}
            </div>
          </div>
        </Form.Item>
      </Form>

      <style>{`
          .required-label::after {
            content: '*';
            color: #f00;
          }
        `}</style>
    </Modal>
  );
});

RelateAgentsSetting.displayName = "RelateAgentsSetting";

export default RelateAgentsSetting;
