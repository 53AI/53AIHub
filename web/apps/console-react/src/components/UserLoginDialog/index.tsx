import { Modal, Form, Input, Button, message } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { t } from "@/locales";
import { useUserStore } from "@/stores";
import { eventBus } from "@km/shared-utils";

export const RESPONSE_CODE_UNAUTHORIZED_ERROR = 7;

export interface UserLoginDialogRef {
  open: () => void;
  close: () => void;
  reset: () => void;
}

export const UserLoginDialog = forwardRef<UserLoginDialogRef>((_, ref) => {
  const userStore = useUserStore();
  const [visible, setVisible] = useState(false);
  const [form] = Form.useForm();

  // Open dialog
  const open = () => {
    setVisible(true);
  };

  // Close dialog
  const close = () => {
    setVisible(false);
    reset();
  };

  // Reset form
  const reset = () => {
    form.resetFields();
  };

  // Handle login
  const handleLogin = async () => {
    try {
      const values = await form.validateFields();
      await userStore.login({ data: values, hideError: true }).catch((err: any) => {
        // 用户不存在时，尝试注册
        if (
          err.code === RESPONSE_CODE_UNAUTHORIZED_ERROR &&
          err.origin_message === "unauthorized: user not found"
        ) {
          handleRegister();
        } else {
          message.warning(t(err.message) || "登录失败");
        }
        return Promise.reject(err);
      });
      message.success(t("action_login_success"));
      close();
    } catch (error: any) {
      // 错误已在上面处理
    }
  };

  // Handle register
  const handleRegister = async () => {
    try {
      const values = form.getFieldsValue();
      await userStore.register({ data: values });
      message.success(t("action_login_success"));
      close();
    } catch (error: any) {
      message.warning(t(error.message) || "注册失败");
    }
  };

  // Handle forget password
  const handleForgetPassword = () => {
    message.warning(t("feature_coming_soon"));
  };

  // Handle agreement click
  const handleAgree = () => {
    message.warning(t("feature_coming_soon"));
  };

  const handlePolicy = () => {
    message.warning(t("feature_coming_soon"));
  };

  // Listen for open event
  useEffect(() => {
    eventBus.on("user-login-open", open);
    return () => {
      eventBus.off("user-login-open", open);
    };
  }, []);

  useImperativeHandle(ref, () => ({
    open,
    close,
    reset,
  }));

  return (
    <Modal
      open={visible}
      onCancel={close}
      footer={null}
      width={504}
      centered
      closable={false}
      destroyOnHidden
      style={{
        borderRadius: 16,
        backgroundImage: "url('/images/login_bg.png')",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
        backgroundSize: "cover",
      }}
    >
      <div className="pt-8 pb-4 relative">
        <CloseOutlined
          className="absolute top-2 right-1 cursor-pointer"
          style={{ fontSize: 20, color: "#9A9A9A" }}
          onClick={close}
        />

        <h4 className="text-3xl text-primary font-bold text-center mb-3">
          {t("login.password_login")}
        </h4>
        <p className="text-sm text-disabled text-center">
          {t("login.unregistered_account_desc")}
        </p>

        <Form form={form} layout="vertical" className="mt-8">
          <Form.Item
            name="username"
            label={<span className="text-primary">{t("account")}</span>}
            rules={[{ required: true, message: t("login.account_placeholder") }]}
          >
            <Input
              placeholder={t("login.account_placeholder")}
              allowClear
              style={{ backgroundColor: "#f1f2f3", borderColor: "transparent" }}
            />
          </Form.Item>

          <Form.Item
            name="password"
            label={<span className="text-primary">{t("password")}</span>}
            rules={[{ required: true, message: t("login.password_placeholder") }]}
            className="relative"
          >
            <Input.Password
              placeholder={t("login.password_placeholder")}
              allowClear
              style={{ backgroundColor: "#f1f2f3", borderColor: "transparent" }}
            />
            <Button
              type="link"
              className="text-disabled text-sm absolute right-0 -bottom-8"
              onClick={handleForgetPassword}
            >
              {t("login.forget_password")}
            </Button>
          </Form.Item>

          <Form.Item shouldUpdate className="mt-8">
            {() => (
              <Button
                type="primary"
                shape="round"
                block
                className="!h-10"
                disabled={
                  !form.getFieldValue("username") ||
                  !form.getFieldValue("password")
                }
                onClick={handleLogin}
              >
                {t("action_login")}
              </Button>
            )}
          </Form.Item>

          <div className="text-xs text-disabled text-center mt-5">
            {
              t("login.agree_and_policy", {
                agree: "",
                policy: "",
              }).split("{agree}{policy}")[0]
            }
            <Button
              type="link"
              className="text-secondary text-xs underline"
              onClick={handleAgree}
            >
              {t("login.agree")}
            </Button>
            <Button
              type="link"
              className="text-secondary text-xs underline"
              onClick={handlePolicy}
            >
              {t("login.policy")}
            </Button>
          </div>
        </Form>
      </div>
    </Modal>
  );
});

UserLoginDialog.displayName = "UserLoginDialog";

export default UserLoginDialog;
