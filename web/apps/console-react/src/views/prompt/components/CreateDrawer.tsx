import { Form, Input, InputNumber, message } from "antd";
import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { t } from "@/locales";
import { GroupSelect } from "@/components/GroupSelect";
import { GROUP_TYPE } from "@/constants/group";
import { usePromptFormDataStore } from "../create/store";

export interface CreateDrawerRef {
  validate: () => Promise<boolean>;
}

interface CreateDrawerProps {
  onChange?: (data: any) => void;
}

const CreateDrawer = forwardRef<CreateDrawerRef, CreateDrawerProps>(
  ({ onChange }, ref) => {
    const [form] = Form.useForm();
    const formData = usePromptFormDataStore((state) => state.formData);
    const setFormData = usePromptFormDataStore((state) => state.set);

    // Initialize form when formData changes
    useEffect(() => {
      form.setFieldsValue({
        group_ids: formData.group_ids || [],
        sort: formData.sort || 0,
        name: formData.name || "",
        description: formData.description || "",
      });
    }, [formData.prompt_id]);

    // Validate and get values
    const validate = async () => {
      try {
        const values = await form.validateFields();
        setFormData(values);
        if (onChange) {
          onChange(values);
        }
        return true;
      } catch {
        return false;
      }
    };

    useImperativeHandle(ref, () => ({
      validate,
    }));

    return (
      <div className="prompt-create-drawer">
        <Form form={form} layout="vertical">
          {/* Groups */}
          <Form.Item
            label={t("group")}
            name="group_ids"
            rules={[{ required: true, message: t("group_min_one") }]}
          >
            <GroupSelect
              groupType={GROUP_TYPE.PROMPT}
              mode="multiple"
              defaultFirst
              placeholder={t("form_select_placeholder")}
            />
          </Form.Item>

          {/* Sort */}
          <Form.Item
            label={t("action_sort")}
            name="sort"
            rules={[{ required: true, message: t("form_input_placeholder") }]}
          >
            <InputNumber
              className="!w-[200px]"
              controls={false}
              precision={0}
              min={0}
              max={99999999}
              placeholder={t("form_input_placeholder")}
            />
          </Form.Item>
          <div className="w-full text-sm text-disabled -mt-3 mb-4">
            {t("module.agent_sort_desc")}
          </div>

          {/* Name */}
          <Form.Item
            label={t("title")}
            name="name"
            rules={[{ required: true, message: t("form_input_placeholder") }]}
          >
            <Input
              placeholder={t("form_input_placeholder")}
              maxLength={20}
              showCount
              allowClear
            />
          </Form.Item>

          {/* Description */}
          <Form.Item label={t("description")} name="description">
            <Input.TextArea
              rows={6}
              placeholder={t("form_input_placeholder")}
              maxLength={200}
              showCount
              allowClear
              style={{ resize: "none" }}
            />
          </Form.Item>
        </Form>
      </div>
    );
  },
);

CreateDrawer.displayName = "CreateDrawer";

export default CreateDrawer;
