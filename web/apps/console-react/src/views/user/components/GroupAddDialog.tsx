import { useState, useEffect } from "react";
import { Modal, Form, Input, Button, message } from "antd";
import { t } from "@/locales";
import { groupApi } from "@/api/modules/group";
import { GROUP_TYPE } from "@/constants/group";

interface GroupAddDialogProps {
  open: boolean;
  data?: {
    group_id?: number;
    group_name?: string;
    sort?: number;
  };
  onClose: () => void;
  onSuccess?: () => void;
}

export default function GroupAddDialog({
  open,
  data = {},
  onClose,
  onSuccess,
}: GroupAddDialogProps) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const editable = !!data.group_id;

  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        name: data.group_name || "",
      });
    } else {
      form.resetFields();
    }
  }, [open, data, form]);

  const handleClose = () => {
    onClose();
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);

      const saveData = {
        group_id: data.group_id,
        group_type: GROUP_TYPE.INTERNAL_USER,
        group_name: values.name,
        sort: +data.sort || 0,
      };

      await groupApi.single_save(saveData);

      message.success(t("action_save_success"));
      onSuccess?.();
      handleClose();
    } catch (error) {
      console.error("Save group error:", error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={t(editable ? "action_edit" : "action_create")}
      open={open}
      onCancel={handleClose}
      destroyOnHidden
      mask={{ closable: false }}
      width={600}
      footer={[
        <Button key="cancel" onClick={handleClose}>
          {t("action_cancel")}
        </Button>,
        <Button key="submit" type="primary" loading={submitting} onClick={handleSave}>
          {t("action_confirm")}
        </Button>,
      ]}
    >
      <Form form={form} layout="vertical" className="mt-4">
        <Form.Item
          label={t("name")}
          name="name"
          rules={[
            {
              required: true,
              message: t("form_input_placeholder"),
            },
          ]}
        >
          <Input
            maxLength={20}
            showCount
            placeholder={t("form_input_placeholder")}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
