import { useState, useRef, forwardRef, useImperativeHandle } from "react";
import { Form, Input, Button, message, Space } from "antd";
import { useUserStore } from "@/stores/modules/user";
import { useEmail } from "@/hooks/useEmail";
import commonApi from "@/api/modules/common";
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
    const { emailCodeCount, sendEmailCode } = useEmail();
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

        <Form.Item
          name="verify_code"
          label={t("form.verify_code")}
          rules={[{ required: true, message: t("form.verify_code_format") }]}
        >
          <Space.Compact className="w-full">
            <Input
              className="flex-1"
              placeholder={t("form.input_placeholder") + t("form.verify_code")}
            />
            <Button
              disabled={!!emailCodeCount || !isEmail}
              onClick={handleSendCode}
              className="w-28"
            >
              <span
                className={emailCodeCount ? "text-[#9A9A9A]" : "text-[#2563EB]"}
              >
                {emailCodeCount
                  ? `${emailCodeCount}s`
                  : t("form.get_verify_code")}
              </span>
            </Button>
          </Space.Compact>
        </Form.Item>

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
