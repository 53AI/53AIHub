import { Form, Input, Button, Switch, message } from "antd";
import { useRef, useEffect, useState } from "react";
import { t } from "@/locales";
import { useEnterpriseStore } from "@/stores";

interface SMTPFormData {
  smtp_host: string;
  smtp_port: string;
  smtp_username: string;
  smtp_password: string;
  smtp_from: string;
  smtp_to: string;
  smtp_is_ssl: boolean;
}

const COUNTDOWN_DURATION = 60;

export function EmailForm() {
  const enterpriseStore = useEnterpriseStore();
  const [form] = Form.useForm<SMTPFormData>();
  const [isSaving, setIsSaving] = useState(false);
  const [countDown, setCountDown] = useState(0);

  // Load existing config
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const data = await enterpriseStore.loadSMTPDetail({
          data: { type: "smtp" },
        });
        if (data?.content) {
          const content = JSON.parse(data.content);
          form.setFieldsValue({
            smtp_host: content.smtp_host || "",
            smtp_port: content.smtp_port || "",
            smtp_username: content.smtp_username || "",
            smtp_password: content.smtp_password || "",
            smtp_from: content.smtp_from || "",
            smtp_to: content.smtp_to || "",
            smtp_is_ssl: content.smtp_is_ssl ?? true,
          });
        }
      } catch (error) {
        console.error("Load email config error:", error);
      }
    };
    loadConfig();
  }, []);

  // Countdown timer
  useEffect(() => {
    if (countDown <= 0) return;

    const timer = setInterval(() => {
      setCountDown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [countDown > 0]);

  // Handle save
  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setIsSaving(true);

      await enterpriseStore.saveSMTPInfo({
        data: {
          content: JSON.stringify(values),
          enabled: true,
          type: "smtp",
        },
      });
      message.success(t("action_save_success"));
    } catch (error) {
      console.error("Save email config error:", error);
    } finally {
      setIsSaving(false);
    }
  };

  // Handle reset
  const handleReset = () => {
    form.resetFields();
    form.setFieldsValue({
      smtp_is_ssl: true,
    });
  };

  // Handle send test email
  const handleSendEmail = async () => {
    try {
      const values = await form.validateFields();

      await enterpriseStore.sendTestEmail({
        data: {
          from: values.smtp_from,
          host: values.smtp_host,
          is_ssl: values.smtp_is_ssl,
          password: values.smtp_password,
          port: Number(values.smtp_port),
          to: values.smtp_to,
          username: values.smtp_username,
        },
      });

      message.success(t("action_send_success"));
      setCountDown(COUNTDOWN_DURATION);
    } catch (error) {
      console.error("Send test email error:", error);
    }
  };

  return (
    <div className="mt-5 w-3/5">
      <Form form={form} layout="vertical" initialValues={{ smtp_is_ssl: true }}>
        {/* SMTP Server */}
        <Form.Item
          label={t("module.SMTP_server")}
          name="smtp_host"
          rules={[{ required: true, message: t("form.input_placeholder") }]}
        >
          <Input placeholder={t("form.input_placeholder")} allowClear />
        </Form.Item>

        {/* SMTP Port */}
        <Form.Item
          label={t("module.SMTP_port")}
          name="smtp_port"
          rules={[{ required: true, message: t("form.input_placeholder") }]}
        >
          <Input placeholder={t("form.input_placeholder")} allowClear />
        </Form.Item>

        {/* Email Account */}
        <Form.Item
          label={t("module.SMTP_email_account")}
          name="smtp_username"
          rules={[
            { required: true, message: t("form.input_placeholder") },
            { type: "email", message: t("form.email_invalid") },
          ]}
        >
          <Input placeholder={t("form.input_placeholder")} allowClear />
        </Form.Item>

        {/* Email Password */}
        <Form.Item
          label={t("module.SMTP_email_password")}
          name="smtp_password"
          rules={[{ required: true, message: t("form.input_placeholder") }]}
        >
          <Input.Password placeholder={t("form.input_placeholder")} allowClear />
        </Form.Item>

        {/* Sender Email */}
        <Form.Item
          label={t("module.SMTP_addresser_email")}
          name="smtp_from"
          rules={[
            { required: true, message: t("form.input_placeholder") },
            { type: "email", message: t("form.email_invalid") },
          ]}
        >
          <Input placeholder={t("form.input_placeholder")} allowClear />
        </Form.Item>

        {/* Enable TLS/SSL */}
        <Form.Item
          label={t("module.SMTP_openTLS")}
          name="smtp_is_ssl"
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>

        {/* Receiver Email and Test Send */}
        <Form.Item
          label={t("module.SMTP_receiver_email")}
          name="smtp_to"
          rules={[
            { required: true, message: t("form.input_placeholder") },
            { type: "email", message: t("form.email_invalid") },
          ]}
        >
          <div className="w-full flex gap-3">
            <Input
              className="flex-1"
              placeholder={t("form.input_placeholder")}
              allowClear
            />
            <Button
              type="primary"
              ghost
              disabled={countDown > 0}
              onClick={handleSendEmail}
            >
              {countDown > 0 ? `${countDown}s` : t("module.SMTP_send_email")}
            </Button>
          </div>
        </Form.Item>
      </Form>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <Button
          type="primary"
          className="w-24 h-9"
          loading={isSaving}
          onClick={handleSave}
        >
          {t("action.save")}
        </Button>
        <Button className="w-24 h-9" onClick={handleReset}>
          {t("action_reset")}
        </Button>
      </div>
    </div>
  );
}

export default EmailForm;
