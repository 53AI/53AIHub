import { useState } from "react";
import { Button, Form, Input, Radio, message } from "antd";
import { useUserStore } from "@/stores";
import { VerificationCodeInput } from "@/components/VerificationCodeInput";
import { authApi } from "@/api/modules/auth";

interface ForgetFormProps {
  onLogin: () => void;
  onRegister: () => void;
}

type UsernameType = "email" | "mobile";

interface ForgetFormValues {
  username: string;
  username_type: UsernameType;
  password: string;
  confirm_password: string;
  verification_code: string;
}

export function ForgetForm(props: ForgetFormProps) {
  const { onLogin, onRegister } = props;
  const userStore = useUserStore();
  const [form] = Form.useForm<ForgetFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [accountExists, setAccountExists] = useState(true);
  const [isAccountValid, setIsAccountValid] = useState(false);
  const t = (window as any).$t || ((key: string) => key);

  // 手机号格式验证
  const MOBILE_PATTERN = /^(13[0-9]|14[0-9]|15[0-9]|16[0-9]|17[0-9]|18[0-9]|19[0-9])\d{8}$/;
  // 邮箱格式验证
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const handleCheckAccountValidation = async () => {
    const username = form.getFieldValue("username");
    const usernameType = form.getFieldValue("username_type");

    if (!username) {
      setIsAccountValid(false);
      return;
    }

    // 根据类型验证格式
    if (usernameType === "mobile") {
      setIsAccountValid(MOBILE_PATTERN.test(username));
    } else {
      setIsAccountValid(EMAIL_PATTERN.test(username));
    }
  };

  const handleCheckAccount = async () => {
    await handleCheckAccountValidation();
    const username = form.getFieldValue("username");
    if (!username) return;
    const { exists = false } = await authApi.checkAccount({
      data: { account: username },
    });
    setAccountExists(exists);
  };

  const handleUsernameTypeChange = () => {
    form.setFieldsValue({ username: "", verification_code: "" });
    setAccountExists(true);
    setIsAccountValid(false);
  };

  const handleRegister = () => {
    const usernameType = form.getFieldValue("username_type");
    if (usernameType === "mobile") {
      (userStore as any).unRegistered_username = form.getFieldValue("username");
    } else {
      (userStore as any).unRegistered_username = "";
    }
    onRegister();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);

      // 检查账号是否存在
      const { exists = false } = await authApi.checkAccount({
        data: { account: values.username },
      });
      if (!exists) {
        message.warning(t("login.account_no_exists"));
        return;
      }

      // 重置密码
      await userStore.resetPassword({
        data: {
          mobile: values.username_type === "mobile" ? values.username : "",
          email: values.username_type === "email" ? values.username : "",
          new_password: values.password,
          confirm_password: values.confirm_password,
          verify_code: values.verification_code,
        },
      } as any);
      message.success(t("action_update_success"));
      form.resetFields();
      onLogin();
    } finally {
      setSubmitting(false);
    }
  };

  const usernameType =
    Form.useWatch("username_type", form) || ("email" as UsernameType);
  const username = Form.useWatch("username", form) || "";
  const password = Form.useWatch("password", form) || "";
  const verificationCode = Form.useWatch("verification_code", form) || "";
  const confirmPassword = Form.useWatch("confirm_password", form) || "";

  return (
    <div className="relative w-full max-w-[440px]">
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          username_type: "email",
        }}
      >
        <h4 className="text-3xl text-primary font-bold text-center mb-10">
          {t("login.reset_password")}
        </h4>

        <Form.Item name="username_type" label={t("login.select_reset_password_way")}>
          <Radio.Group onChange={handleUsernameTypeChange}>
            <Radio value="email">{t("login.email_validate")}</Radio>
            <Radio value="mobile">{t("login.mobile_validate")}</Radio>
          </Radio.Group>
        </Form.Item>

        <Form.Item
          name="username"
          label={t(usernameType)}
          rules={[
            {
              required: true,
              message: t(`login.${usernameType}_placeholder` as string),
            },
            {
              pattern: usernameType === "mobile" ? MOBILE_PATTERN : EMAIL_PATTERN,
              message: t(usernameType === "mobile" ? "form_mobile_validator" : "form_email_validator"),
            },
          ]}
        >
          <Input
            size="large"
            placeholder={t(`login.${usernameType}_placeholder` as string)}
            onBlur={handleCheckAccount}
            onChange={handleCheckAccountValidation}
          />
        </Form.Item>

        {!accountExists && (
          <div className="text-red-500 text-xs mb-2">
            {t(`login.${usernameType}_no_exists` as string)}
            <Button
              type="link"
              size="small"
              className="!p-0 !bg-transparent -ml-1"
              onClick={handleRegister}
            >
              {t("action_register")}
            </Button>
          </div>
        )}

        <Form.Item
          name="verification_code"
          label={t("verification_code")}
          rules={[
            { required: true, message: t("verification_code_placeholder") },
          ]}
        >
          <VerificationCodeInput
            account={username}
            accountType={usernameType}
            disabled={!accountExists || !isAccountValid}
            maxLength={usernameType === "mobile" ? 4 : 6}
            bgColor="#fff"
          />
        </Form.Item>

        <Form.Item
          name="password"
          label={t("login.new_password")}
          rules={[
            { required: true, message: t("login.new_password_placeholder") },
            { min: 8, max: 20, message: t("login.password_length") },
          ]}
        >
          <Input.Password
            size="large"
            placeholder={t("login.new_password_placeholder")}
          />
        </Form.Item>

        <Form.Item
          name="confirm_password"
          label={t("login.confirm_password")}
          rules={[
            {
              required: true,
              message: t("login.confirm_password_placeholder"),
            },
            { min: 8, max: 20, message: t("login.password_length") },
            {
              validator: (_, value) => {
                if (value && value !== form.getFieldValue("password")) {
                  return Promise.reject(
                    new Error(t("login.password_not_match")),
                  );
                }
                return Promise.resolve();
              },
            },
          ]}
        >
          <Input.Password
            size="large"
            placeholder={t("login.confirm_password_placeholder")}
          />
        </Form.Item>

        <Button
          type="primary"
          block
          className="mt-6 h-10"
          shape="round"
          disabled={!username || !password || !verificationCode || !confirmPassword}
          loading={submitting}
          onClick={handleSubmit}
        >
          {t("login.update_password")}
        </Button>

        <Button type="link" className="mt-4 block mx-auto" onClick={onLogin}>
          {t("login.back_to_login")}
        </Button>
      </Form>
    </div>
  );
}
