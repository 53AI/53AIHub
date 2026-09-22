import { useState, useRef, forwardRef, useImperativeHandle } from "react";
import { Form, Input, Button, message } from "antd";
import { useUserStore } from "@/stores/modules/user";
import { useEmail } from "@/hooks/useEmail";
import commonApi from "@/api/modules/common";
import VerifyCodeField from "@/components/VerifyCodeField";
import { t } from "@/locales";
import { RESPONSE_CODE } from "@/api/code";

interface EmailBindProps {
  onSuccess: () => void;
  onClose: () => void;
}

export interface EmailBindRef {
  resetForm: () => void;
}

const EmailBind = forwardRef<EmailBindRef, EmailBindProps>(
  ({ onSuccess, onClose }, ref) => {
    const [form] = Form.useForm();
    const userStore = useUserStore();
    const { emailCodeCount, emailCodeRule, sendEmailCode, emailSending } = useEmail();
    const [loading, setLoading] = useState(false);

    // 验证邮箱格式
    const isEmailValid = (email: string) => {
      return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
    };

    useImperativeHandle(ref, () => ({
      resetForm: () => {
        form.resetFields();
      },
    }));

    const handleSubmit = async (values: {
      email: string;
      verify_code: string;
    }) => {
      setLoading(true);
      try {
        await commonApi.verifyEmailcode(
          { email: values.email, code: values.verify_code },
          userStore.info.user_id.toString(),
        );
        message.success(t("status.save_success"));
        onSuccess();
      } catch (error) {
        console.error("Failed to bind email:", error);
      } finally {
        setLoading(false);
      }
    };

    const handleSendCode = async () => {
      const email = form.getFieldValue("email");
      if (!email) {
        message.warning(t("form.email_validator"));
        return;
      }
      if (!isEmailValid(email)) {
        message.warning(t("form.email_format"));
        return;
      }
      try {
        await sendEmailCode(email);
      } catch (error) {
        console.error("Failed to send code:", error);
      }
    };

    // 监听邮箱值变化来控制按钮状态
    const emailValue = Form.useWatch("email", form);
    const isEmail = isEmailValid(emailValue || "");

    return (
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        <Form.Item
          name="email"
          label={t("form.new_email")}
          rules={[
            { required: true, message: t("form.email_validator") },
            { type: "email" as const, message: t("form.email_format") },
          ]}
        >
          <Input
            placeholder={t("form.input_placeholder") + t("form.email")}
            allowClear
          />
        </Form.Item>

        <VerifyCodeField
          name="verify_code"
          rule={emailCodeRule}
          count={emailCodeCount}
          loading={emailSending}
          disabled={!isEmail}
          onClick={handleSendCode}
        />

        <div className="flex justify-end gap-2 mt-7">
          <Button onClick={onClose}>{t("action.cancel")}</Button>
          <Button type="primary" htmlType="submit" loading={loading}>
            {t("action.ok")}
          </Button>
        </div>
      </Form>
    );
  },
);

EmailBind.displayName = "EmailBind";

export default EmailBind;
