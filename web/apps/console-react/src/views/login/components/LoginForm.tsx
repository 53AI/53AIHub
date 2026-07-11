import { useState } from "react";
import { Button, Divider, Form, Input, message } from "antd";
import { useUserStore } from "@/stores";
import { VerificationCodeInput } from "@/components/VerificationCodeInput";
import { SvgIcon } from "@km/shared-components-react";
import { WeChatLogin } from "./WeChatLogin";
import { Policy } from "./Policy";

type LoginType = "mobile" | "wechat" | "password" | "bind_mobile";

interface LoginFormProps {
  onForget: () => void;
  onApply: () => void;
  onList: () => void;
  onLogin: () => void;
}

const loginWayOptions: { type: LoginType; icon: string; label: string }[] = [
  {
    type: "wechat",
    icon: "wechat-new",
    label: (window as any).$t ? (window as any).$t("wechat") : "微信登录",
  },
  {
    type: "password",
    icon: "account",
    label: (window as any).$t ? (window as any).$t("account_psd") : "账号密码",
  },
  {
    type: "mobile",
    icon: "mobile-new",
    label: (window as any).$t
      ? (window as any).$t("mobile_login")
      : "手机号登录",
  },
];

export function LoginForm(props: LoginFormProps) {
  const { onForget, onApply, onList } = props;
  const userStore = useUserStore();
  const [form] = Form.useForm();
  const [type, setType] = useState<LoginType>("password");
  const [submitting, setSubmitting] = useState(false);
  const [isAccountValid, setIsAccountValid] = useState(false);
  const [oauthData, setOauthData] = useState<{
    unionid?: string;
    openid?: string;
    nickname?: string;
  } | null>(null);

  // 手机号格式验证
  const MOBILE_PATTERN =
    /^(13[0-9]|14[0-9]|15[0-9]|16[0-9]|17[0-9]|18[0-9]|19[0-9])\d{8}$/;

  // 检查账号验证状态
  const checkAccountValidation = async () => {
    try {
      await form.validateFields(["username"]);
      const username = form.getFieldValue("username");
      setIsAccountValid(MOBILE_PATTERN.test(username));
    } catch {
      setIsAccountValid(false);
    }
  };

  const handleLogin = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);

      if (type === "password" || type === "mobile") {
        const { username, password = "", verify_code = "" } = values;
        try {
          await userStore.login({
            type: type === "mobile" ? "mobile" : "password",
            data: { username, password, verify_code },
            hideError: true,
          });
          const t = (window as any).$t || ((key: string) => key);
          message.success(t("action_login_success"));
          onList();
          form.resetFields();
        } catch (err: any) {
          const t = (window as any).$t || ((key: string) => key);
          const msgKey =
            err?.origin_message === "unauthorized"
              ? "response_message.user_not_found"
              : "response_message.username_or_password_is_incorrect";
          message.warning(t(msgKey));
        }
      } else if (type === "bind_mobile") {
        const { username, verify_code } = values;
        if (!oauthData) return;
        try {
          await userStore.bind_wechat({
            mobile: username,
            verify_code,
            openid: oauthData.openid || "",
            unionid: oauthData.unionid,
            nickname: oauthData.nickname,
            from: "saas",
          });
          const tLocal = (window as any).$t || ((key: string) => key);
          message.success(tLocal("action_login_success"));
          onList();
          form.resetFields();
        } catch (err: any) {
          message.error(err?.message || "绑定手机号失败");
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const changeLoginType = (next: LoginType) => {
    setType(next);
    form.resetFields();
    setIsAccountValid(false);
  };

  const t = (window as any).$t || ((key: string) => key);

  const username = Form.useWatch("username", form);
  const password = Form.useWatch("password", form);
  const verifyCode = Form.useWatch("verify_code", form);

  const disabledByType =
    type === "password"
      ? !username || !password
      : type === "mobile" || type === "bind_mobile"
        ? !username || !verifyCode
        : false;

  return (
    <>
      <button
        type="button"
        className="absolute top-6 right-8 flex items-center gap-1 text-sm text-gray-600 hover:text-gray-800"
        onClick={onApply}
      >
        <SvgIcon name="create" />
        {t("create_new_enterprise")}
      </button>
      <div className="relative w-full max-w-[440px]">
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            type: "password",
            username: "",
            password: "",
            verify_code: "",
          }}
        >
          <h4 className="text-3xl text-primary font-bold text-center mb-10">
            {t(`login.${type}_login` as string)}
          </h4>

          {type === "mobile" && (
            <>
              <Form.Item
                name="username"
                label={t("mobile")}
                rules={[
                  { required: true, message: t("login.mobile_placeholder") },
                  {
                    pattern: MOBILE_PATTERN,
                    message: t("form_mobile_validator"),
                  },
                ]}
              >
                <Input
                  size="large"
                  placeholder={t("login.mobile_placeholder")}
                  onPressEnter={handleLogin}
                  autoComplete="new-username"
                  onChange={checkAccountValidation}
                  onBlur={checkAccountValidation}
                />
              </Form.Item>
              <Form.Item
                name="verify_code"
                label={t("verification_code")}
                rules={[
                  {
                    required: true,
                    message: t("verification_code_placeholder"),
                  },
                ]}
              >
                <VerificationCodeInput
                  account={form.getFieldValue("username")}
                  accountType="mobile"
                  disabled={!isAccountValid}
                  maxLength={4}
                  bgColor="#fff"
                />
              </Form.Item>
              <div className="mt-2">
                <Policy />
              </div>
            </>
          )}

          {type === "password" && (
            <>
              <Form.Item
                name="username"
                label={t("account")}
                rules={[
                  { required: true, message: t("login.account_placeholder") },
                ]}
              >
                <Input
                  size="large"
                  placeholder={t("login.account_placeholder")}
                  autoComplete="username"
                />
              </Form.Item>
              <Form.Item
                name="password"
                label={t("password")}
                rules={[
                  { required: true, message: t("login.password_placeholder") },
                  { min: 8, max: 20, message: t("login.password_length_v2") },
                ]}
              >
                <Input.Password
                  size="large"
                  placeholder={t("login.password_placeholder")}
                  onPressEnter={handleLogin}
                />
              </Form.Item>

              <div className="flex justify-between items-center -mt-4 mb-4 text-sm gap-2">
                <Policy />
                <button
                  type="button"
                  className="text-gray-500 hover:text-gray-700"
                  onClick={onForget}
                >
                  {t("login.forget_password")}
                </button>
              </div>
            </>
          )}

          {type === "wechat" && (
            <div className="mb-6">
              <WeChatLogin
                onOauthSuccess={async (data) => {
                  try {
                    await userStore
                      .wechat_login({
                        unionid: data.unionid || "",
                        from: "saas",
                      })
                      .catch((err) => {
                        // 需要绑定手机号
                        setOauthData({
                          unionid: data.unionid,
                          openid: data.openid,
                          nickname: data.nickname,
                        });
                        setType("bind_mobile");
                        return Promise.reject(err);
                      });
                    const tLocal = (window as any).$t || ((key: string) => key);
                    message.success(tLocal("action_login_success"));
                    onList();
                    form.resetFields();
                  } catch {
                    // 已切换到 bind_mobile，交给后续流程处理
                  }
                }}
              />
            </div>
          )}

          {type === "bind_mobile" && (
            <>
              <Form.Item
                name="username"
                label={t("mobile")}
                rules={[
                  { required: true, message: t("login.mobile_placeholder") },
                ]}
              >
                <Input
                  size="large"
                  placeholder={t("login.mobile_placeholder")}
                  autoComplete="new-username"
                />
              </Form.Item>
              <Form.Item
                name="verify_code"
                label={t("verification_code")}
                rules={[
                  {
                    required: true,
                    message: t("verification_code_placeholder"),
                  },
                ]}
              >
                <VerificationCodeInput
                  account={form.getFieldValue("username")}
                  accountType="mobile"
                  disabled={!form.getFieldValue("username")}
                  maxLength={4}
                  bgColor="#fff"
                />
              </Form.Item>
            </>
          )}

          {["mobile", "password", "bind_mobile"].includes(type) && (
            <Button
              type="primary"
              block
              className="mt-4 h-10"
              disabled={disabledByType}
              loading={submitting}
              onClick={handleLogin}
              shape="round"
            >
              {t(type === "bind_mobile" ? "action_confirm" : "action_login")}
            </Button>
          )}

          <Divider className="!w-[80%] !mx-auto !mt-8 !mb-4">
            <span className="text-sm text-disabled">
              {t("other_login_method")}
            </span>
          </Divider>

          <div className="flex justify-around text-sm">
            {loginWayOptions.map((item) => (
              <div
                key={item.type}
                className={`w-14 flex flex-col items-center gap-3 cursor-pointer hover:opacity-70 ${
                  type === item.type ? "text-brand" : "text-secondary"
                }`}
                onClick={() => changeLoginType(item.type)}
              >
                <SvgIcon
                  name={item.icon}
                  size={22}
                  color={type === item.type ? "#2563eb" : "#4f5052"}
                />
                {item.label}
              </div>
            ))}
          </div>
        </Form>
      </div>
    </>
  );
}
