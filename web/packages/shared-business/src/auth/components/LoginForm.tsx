import { useState, useEffect, useRef, useCallback } from "react";
import { Modal, Form, Input, Button, Divider, Spin, message } from "antd";
import {
  WechatOutlined,
  SafetyOutlined,
  MobileOutlined
} from "@ant-design/icons";
import { useTranslation } from "../i18n";
import "./LoginForm.css";

type LoginWay = "password_login" | "message_login" | "wechat_login";

const LOGIN_WAY = {
  password_login: "password_login",
  message_login: "message_login",
  wechat_login: "wechat_login",
} as const;

interface LoginFormProps {
  open?: boolean;
  onClose?: () => void;
  onLogin?: (username: string, password: string) => Promise<void>;
  onSmsLogin?: (mobile: string, verifyCode: string) => Promise<void>;
  onWechatLogin?: (data: { openid: string; unionid: string; nickname: string }) => Promise<void>;
  apiHost?: string;
  wechatAppId?: string;
}

const DEFAULT_WECHAT_URL = "https://work.wescrm.com/wechat_oauth_login.html?plain=1&height=280&appid=wxbe904d4182458106&suiteid=53aihub";

export function LoginForm({
  open = true,
  onClose,
  onLogin,
  onSmsLogin,
  onWechatLogin,
  apiHost = "",
  wechatAppId,
}: LoginFormProps) {
  const { t } = useTranslation();
  const [loginWay, setLoginWay] = useState<LoginWay>(LOGIN_WAY.password_login);
  const [loading, setLoading] = useState(false);
  const [wechatLoading, setWechatLoading] = useState(false);
  const [codeCount, setCodeCount] = useState(0);
  const [form] = Form.useForm();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const codeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const usernameValue = Form.useWatch("username", form);
  const isMobile = /^1[3-9]\d{9}$/.test(usernameValue || "");

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (codeTimerRef.current) clearInterval(codeTimerRef.current);
    };
  }, []);

  // WeChat iframe message handling
  useEffect(() => {
    if (loginWay !== LOGIN_WAY.wechat_login || !onWechatLogin) return;

    setWechatLoading(true);
    timerRef.current = setInterval(() => {
      const contentWindow = iframeRef.current?.contentWindow;
      if (contentWindow) {
        try {
          const oauthData = (contentWindow as any).sessionStorage?.getItem("oauth_login_data");
          if (oauthData) {
            const data = JSON.parse(oauthData);
            handleWechatSuccess(data);
          }
        } catch {
          // Ignore cross-origin errors
        }
      }
    }, 2000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [loginWay, onWechatLogin]);

  const handleWechatSuccess = async (data: { openid?: string; unionid?: string; nickname?: string; access_token?: string }) => {
    if (timerRef.current) clearInterval(timerRef.current);

    if (data.access_token) {
      localStorage.setItem("access_token", data.access_token);
      window.location.reload();
      return;
    }

    if (data.openid && onWechatLogin) {
      try {
        await onWechatLogin({
          openid: data.openid,
          unionid: data.unionid || "",
          nickname: data.nickname || "",
        });
      } catch (err: any) {
        message.error(err?.message || t("auth.login_failed"));
      }
    }
  };

  const handleGetCode = useCallback(async () => {
    const username = form.getFieldValue("username");
    if (!username || !isMobile) return;

    try {
      const res = await fetch(`${apiHost}/api/sms/sendcode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile: username }),
      });
      const data = await res.json();
      if (data.code === 0 || data.message === "success") {
        message.success(t("auth.code_sent"));
        setCodeCount(60);
        codeTimerRef.current = setInterval(() => {
          setCodeCount((prev) => {
            if (prev <= 1) {
              if (codeTimerRef.current) clearInterval(codeTimerRef.current);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        message.error(data.message || t("auth.code_send_failed"));
      }
    } catch {
      message.error(t("auth.code_send_failed"));
    }
  }, [form, isMobile, apiHost, t]);

  const handleSubmit = async (values: { username: string; password?: string; verify_code?: string }) => {
    setLoading(true);
    try {
      if (loginWay === LOGIN_WAY.message_login) {
        if (onSmsLogin) {
          await onSmsLogin(values.username, values.verify_code || "");
        }
      } else {
        if (onLogin) {
          await onLogin(values.username, values.password || "");
        }
      }
      message.success(t("auth.login_success"));
      form.resetFields();
    } catch (err: any) {
      message.error(err?.message || t("auth.login_failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleLoginWayChange = (way: LoginWay) => {
    setLoginWay(way);
    form.resetFields();
  };

  const getUsernameLabel = () => {
    return loginWay === LOGIN_WAY.password_login
      ? t("auth.account")
      : t("auth.mobile");
  };

  const wechatLoginUrl = wechatAppId
    ? `${DEFAULT_WECHAT_URL}&appid=${wechatAppId}&api=${encodeURIComponent(apiHost + "/api/saas/wechat/redirect")}&redirect_url=${encodeURIComponent(location.origin + "/oauth_login.html")}`
    : `${DEFAULT_WECHAT_URL}&api=${encodeURIComponent(apiHost + "/api/saas/wechat/redirect")}&redirect_url=${encodeURIComponent(location.origin + "/oauth_login.html")}`;

  const content = (
    <>
      {/* Header */}
      <div className="flex justify-center mt-5 mb-6">
        <h4 className="text-xl text-[#1D1E1F] font-bold text-center">
          {t(`auth.${loginWay}_title`)}
        </h4>
      </div>

      {/* WeChat Login */}
      {loginWay === LOGIN_WAY.wechat_login ? (
        <>
          <div className="relative w-full" style={{ height: 280 }}>
            {wechatLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/80">
                <Spin />
              </div>
            )}
            <iframe
              ref={iframeRef}
              onLoad={() => setWechatLoading(false)}
              className="w-full overflow-hidden"
              style={{ height: 280, transform: "translateX(-6px)" }}
              scrolling="no"
              src={wechatLoginUrl}
              frameBorder="0"
              title="WeChat Login"
            />
          </div>
        </>
      ) : (
        /* Form */
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            label={getUsernameLabel()}
            name="username"
            rules={[
              { required: true, message: t("auth.input_placeholder") + getUsernameLabel() },
              ...(loginWay === LOGIN_WAY.password_login
                ? []
                : [{ pattern: /^1[3-9]\d{9}$/, message: t("auth.mobile_format_error") }]),
            ]}
          >
            <Input
              size="large"
              placeholder={t("auth.input_placeholder") + getUsernameLabel()}
              allowClear
            />
          </Form.Item>

          {loginWay === LOGIN_WAY.password_login && (
            <Form.Item
              label={t("auth.password")}
              name="password"
              rules={[{ required: true, message: t("auth.input_placeholder") + t("auth.password") }]}
            >
              <Input.Password
                size="large"
                placeholder={t("auth.input_placeholder") + t("auth.password")}
              />
            </Form.Item>
          )}

          {loginWay === LOGIN_WAY.message_login && (
            <Form.Item
              label={t("auth.verify_code")}
              name="verify_code"
              rules={[{ required: true, message: t("auth.input_placeholder") + t("auth.verify_code") }]}
            >
              <Input
                size="large"
                placeholder={t("auth.input_placeholder") + t("auth.verify_code")}
                addonAfter={
                  <Button
                    type="link"
                    disabled={codeCount > 0 || !isMobile}
                    onClick={handleGetCode}
                    className="!bg-[#f5f5f5] border-0"
                    style={{ width: 80 }}
                  >
                    <span className={codeCount > 0 || !isMobile ? "text-[#9A9A9A]" : "text-[#2563EB]"}>
                      {codeCount > 0 ? `${codeCount}s` : t("auth.get_code")}
                    </span>
                  </Button>
                }
              />
            </Form.Item>
          )}

          <Button
            type="primary"
            size="large"
            block
            shape="round"
            className="mt-5"
            htmlType="submit"
            loading={loading}
          >
            {t("auth.login")}
          </Button>
        </Form>
      )}

      {/* Other login ways */}
      <Divider className="my-6">
        <span className="text-[#9A9A9A] text-sm">{t("auth.other_login_way")}</span>
      </Divider>
      <div className="flex items-center justify-center gap-10">
        {[
          { icon: WechatOutlined, value: LOGIN_WAY.wechat_login, label: t("auth.wechat_login") },
          { icon: SafetyOutlined, value: LOGIN_WAY.password_login, label: t("auth.password_login") },
          { icon: MobileOutlined, value: LOGIN_WAY.message_login, label: t("auth.message_login") },
        ].map((item) => (
          <div
            key={item.value}
            className={`flex flex-col items-center gap-2 cursor-pointer ${
              item.value === loginWay ? "text-[#2563EB]" : "text-[#9A9A9A]"
            }`}
            onClick={() => handleLoginWayChange(item.value)}
          >
            <item.icon style={{ fontSize: 24 }} />
            <p className="text-sm">{item.label}</p>
          </div>
        ))}
      </div>
    </>
  );

  // Render as page (not modal)
  if (open && !onClose) {
    return (
      <div className="login-page">
        <div className="login-container">
          {content}
        </div>
      </div>
    );
  }

  // Render as modal
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      className="login-modal"
      width={400}
      destroyOnClose
    >
      {content}
    </Modal>
  );
}

export default LoginForm;
