import { useState, useEffect } from "react";
import { Modal, Form, Input, Button, Select, DatePicker, message } from "antd";
import dayjs from "dayjs";
import { t } from "@/locales";
import { useUserStore } from "@/stores";
import { ImageUpload } from "@/components/Upload/image";
import { getTimeStamp } from "@km/shared-utils";
import { SvgIcon } from "@km/shared-components-react";

interface UserAddDialogProps {
  open: boolean;
  data?: {
    user_id?: number;
    avatar?: string;
    nickname?: string;
    password?: string;
    group_id?: number;
    expired_time?: string;
    mobile?: string;
    email?: string;
    open_id?: string;
    google_account?: string;
  };
  subscriptionOptions?: {
    value: number;
    label: string;
    group_id?: number;
    group_name?: string;
  }[];
  onClose: () => void;
  onSuccess?: () => void;
}

export default function UserAddDialog({
  open,
  data = {},
  subscriptionOptions = [],
  onClose,
  onSuccess,
}: UserAddDialogProps) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const editable = !!data.user_id;
  const userStore = useUserStore();

  useEffect(() => {
    if (open) {
      const filteredOptions = subscriptionOptions.filter((item) => item.value !== 0);
      const defaultGroupId = data.group_id || (subscriptionOptions[0] || {}).value || 0;
      const validGroupId = subscriptionOptions.find((item) => item.value === defaultGroupId)
        ? defaultGroupId
        : undefined;

      form.setFieldsValue({
        avatar: data.avatar || "",
        nickname: data.nickname || "",
        password: "",
        group_id: validGroupId,
        expired_time: data.expired_time ? dayjs(data.expired_time) : null,
      });
    }
    // 注意：不在这里处理 else 分支重置表单
    // 因为 destroyOnHidden 会在关闭时销毁 Form，此时调用 form.resetFields() 会产生警告
  }, [open, data, subscriptionOptions, form]);

  const handleClose = () => {
    onClose();
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);

      await userStore.save({
        data: {
          user_id: data.user_id,
          avatar: values.avatar,
          nickname: values.nickname,
          password: values.password,
          group_id: values.group_id,
          expired_time:
            values.expired_time && getTimeStamp
              ? getTimeStamp(values.expired_time)
              : 0,
        },
      });

      message.success(t("action_save_success"));
      onSuccess?.();
      handleClose();
    } catch (error) {
      console.error("Save user error:", error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={t(editable ? "action_edit" : "action_add")}
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
        <h1 className="text-sm text-gray-800">{t("user_info")}</h1>

        <Form.Item className="mt-4" name="avatar">
          <div className="flex items-center gap-2">
            <ImageUpload value={form.getFieldValue("avatar")} onChange={(url) => form.setFieldValue("avatar", url)} />
            <span className="text-gray-400 text-sm">{t("avatar")}</span>
          </div>
        </Form.Item>

        <Form.Item
          label={t("user")}
          name="nickname"
          rules={[
            {
              required: true,
              message: t("form_input_placeholder"),
            },
          ]}
        >
          <Input maxLength={20} showCount placeholder={t("form_input_placeholder")} />
        </Form.Item>

        <Form.Item
          label={t("subscription.title")}
          name="group_id"
          rules={[
            {
              required: true,
              message: t("form_select_placeholder"),
            },
          ]}
        >
          <Select placeholder={t("form_input_placeholder")}>
            {subscriptionOptions
              .filter((item) => item.value !== 0)
              .map((item) => (
                <Select.Option key={item.value} value={item.value}>
                  {item.label}
                </Select.Option>
              ))}
          </Select>
        </Form.Item>

        <Form.Item label={t("subscription.end_at")} name="expired_time">
          <DatePicker
            format="YYYY-MM-DD HH:mm"
            showTime
            style={{ width: "100%" }}
            placeholder={t("permanent_effect")}
          />
        </Form.Item>

        <h1 className="text-sm text-gray-800 mt-6">{t("bind_account")}</h1>

        <ul className="mb-4">
          <li className="flex items-center gap-2 mt-4 text-sm text-gray-800">
            <SvgIcon name="mobile-circle" className="flex-none" width={20} height={20} />
            <div className="flex-none w-[88px]">{t("mobile_v2")}</div>
            <div className="text-gray-400">{data.mobile || t("not_bound")}</div>
          </li>
          <li className="flex items-center gap-2 mt-4 text-sm text-gray-800">
            <SvgIcon name="email-circle" className="flex-none" width={20} height={20} />
            <div className="flex-none w-[88px]">{t("email")}</div>
            <div className="text-gray-400">{data.email || t("not_bound")}</div>
          </li>
        </ul>
      </Form>
    </Modal>
  );
}
