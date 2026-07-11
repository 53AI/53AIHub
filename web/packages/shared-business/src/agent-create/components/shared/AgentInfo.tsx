import { Input, InputNumber, Select, Form } from "antd";
import { useEffect, useRef } from "react";
import { useAgentForm } from "../../hooks";
import { useAgentCreateAdapter } from "../../adapters";
import { numberInputKeydownHandler } from "@km/shared-utils";

interface AgentInfoProps {
  className?: string;
  form?: ReturnType<typeof Form.useForm>[0];
}

export function AgentInfo({ className, form }: AgentInfoProps) {
  const logoWrapperRef = useRef<HTMLDivElement>(null);
  const { formData, updateField, groupOptions } = useAgentForm();
  const adapter = useAgentCreateAdapter();
  const t = adapter.t || ((key: string) => key);
  const ImageUploadComponent = adapter.ImageUploadComponent;

  const { logo, name, group_id, sort, description } = formData;

  // 同步数据到父组件的 Form 实例
  useEffect(() => {
    if (form) {
      form.setFieldsValue({
        logo,
        name,
        group_id,
        sort,
      });
    }
  }, [form, logo, name, group_id, sort]);

  return (
    <div className={className}>
      <div className="flex items-center gap-4">
        {ImageUploadComponent && (
          <div ref={logoWrapperRef}>
            <Form.Item
              name="logo"
              rules={[{ required: true, message: t("form.upload_placeholder") }]}
              getValueProps={() => ({ value: logo })}
              getValueFromEvent={(url) => {
                updateField('logo', url);
                return url;
              }}
            >
              <ImageUploadComponent className="w-12 h-12" />
            </Form.Item>
          </div>
        )}
        <div className="flex-1">
          <Form.Item
            name="name"
            label={t("common.name")}
            rules={[{ required: true, message: t("form.input_placeholder") }]}
            getValueProps={() => ({ value: name })}
            getValueFromEvent={(e) => {
              const val = e?.target?.value ?? e;
              updateField('name', val);
              return val;
            }}
          >
            <Input
              maxLength={20}
              showCount
              placeholder={t("form.input_placeholder")}
            />
          </Form.Item>
        </div>
        <div className="flex-1">
          <Form.Item
            name="group_id"
            label={t("common.group")}
            rules={[{ required: true, message: t("form.select_placeholder") }]}
            getValueProps={() => ({ value: group_id })}
            getValueFromEvent={(value) => {
              updateField('group_id', value);
              return value;
            }}
          >
            <Select
              options={groupOptions.map((item) => ({
                value: item.value,
                label: item.label,
              }))}
              style={{ width: '100%' }}
            />
          </Form.Item>
        </div>
      </div>
      <div className="mt-4">
        <Form.Item label={t("common.description")}>
          <Input.TextArea
            value={description}
            onChange={(e) => updateField('description', e.target.value)}
            rows={3}
            maxLength={200}
            showCount
            style={{ resize: 'none' }}
          />
        </Form.Item>
      </div>
      <div className="mt-4">
        <Form.Item
          name="sort"
          label={t("action.sort")}
          rules={[{ required: true, message: t("form.input_placeholder") }]}
          getValueProps={() => ({ value: sort })}
          getValueFromEvent={(value) => {
            updateField('sort', value ?? 0);
            return value ?? 0;
          }}
        >
          <InputNumber
            className="!w-[300px] ant-input-number--left"
            controls={false}
            precision={0}
            min={0}
            max={99999999}
            placeholder={t("form.input_placeholder")}
            onKeyDown={(e) => numberInputKeydownHandler(e as unknown as KeyboardEvent)}
          />
        </Form.Item>
        <div className="w-full text-sm text-[#9A9A9A] -mt-3">
          {t("module.agent_sort_desc")}
        </div>
      </div>
    </div>
  );
}

export default AgentInfo;
