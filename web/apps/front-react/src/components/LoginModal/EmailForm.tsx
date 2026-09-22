import React, { useMemo } from "react";
import { Form, Input, Button, message } from "antd";
import { getEmailRules } from "@/utils/form-rules";
import commonApi from "@/api/modules/common";
import { useUserStore } from "@/stores/modules/user";
import useEmail from "@/hooks/useEmail";
import VerifyCodeField from "@/components/VerifyCodeField";
import { t } from "@/locales";

interface EmailFormProps {
  onSuccess?: () => void;
  onClose?: () => void;
}

const EmailForm: React.FC<EmailFormProps> = ({ onSuccess, onClose }) => {
  const [form] = Form.useForm();
  const userStore = useUserStore();
  const { sendEmailCode, emailCodeRule, emailCodeCount, emailSending } = useEmail();

  const isEmail = useMemo(() => {
    const email = form.getFieldValue("email") || "";
    return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
  }, [form]);

  const handleGetCode = () => {
    const email = form.getFieldValue("email");
    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) return;
    sendEmailCode(email);
  };

  const handleClose = () => {
    onClose?.();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      await userStore.getUserInfo();
      const id = userStore.info.user_id;

      await commonApi.verifyEmailcode(
        {
          email: values.email,
          code: values.verify_code,
        },
        id,
      );

      const msg = userStore.info.email
        ? (t?.("profile.bind") || "绑定") + (t?.("status.success") || "成功")
        : (t?.("profile.change") || "更换") + (t?.("status.success") || "成功");

      message.success(msg);
      onSuccess?.();
    } catch (error) {
      // Handle error
    }
  };

  return (
    <Form form={form} layout="vertical" onFinish={handleSubmit}>
      <Form.Item
        label={t?.("form.new_email") || "新邮箱"}
        name="email"
        rules={[getEmailRules()]}
      >
        <Input
          size="large"
          placeholder={
            (t?.("form.input_placeholder") || "请输入") +
            (t?.("form.email") || "邮箱")
          }
          allowClear
        />
      </Form.Item>
      <VerifyCodeField
        name="verify_code"
        rule={emailCodeRule}
        count={emailCodeCount}
        loading={emailSending}
        onClick={handleGetCode}
        size="large"
      />

      {/* 更换按钮 */}
      <div className="flex justify-end mt-7.5">
        <Button className="w-24 h-9" onClick={handleClose}>
          {t?.("action.cancel") || "取消"}
        </Button>
        <Button type="primary" className="w-24 h-9 ml-2" onClick={handleSubmit}>
          {t?.("action.ok") || "确定"}
        </Button>
      </div>
    </Form>
  );
};

export default EmailForm;
