import { useState, useEffect } from "react";
import { Modal, Form, Input, Button, message } from "antd";
import { t } from "@/locales";
import { departmentApi } from "@/api";

interface DepartmentAddDialogProps {
  open: boolean;
  data?: {
    did?: number;
    name?: string;
    pdid?: number;
    sort?: number;
  };
  parentDid?: number;
  parentChildren?: any[];
  onClose: () => void;
  onSuccess?: (data?: any) => void;
}

const DEFAULT_SORT = 999999;

export default function DepartmentAddDialog({
  open,
  data = {},
  parentDid = 0,
  parentChildren = [],
  onClose,
  onSuccess,
}: DepartmentAddDialogProps) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const editable = !!data.did;

  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        name: data.name || "",
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
        did: data.did,
        name: values.name,
        pdid: +parentDid || +data.pdid || 0,
        sort: data.sort || DEFAULT_SORT - parentChildren.length,
      };

      await departmentApi.save(saveData);

      message.success(t("action_save_success"));
      onSuccess?.(saveData);
      handleClose();
    } catch (error) {
      console.error("Save department error:", error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={t(editable ? "internal_user.department.edit" : "internal_user.department.create")}
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
          {t("action_save")}
        </Button>,
      ]}
    >
      <Form form={form} layout="vertical" className="mt-4">
        <Form.Item
          label={t("internal_user.department.name")}
          name="name"
          rules={[
            {
              required: true,
              message: t("internal_user.department.name_placeholder"),
            },
          ]}
        >
          <Input
            maxLength={20}
            showCount
            placeholder={t("internal_user.department.name_placeholder")}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
