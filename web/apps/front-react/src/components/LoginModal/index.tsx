import {
  useState,
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Modal, Form, Input, Button, Divider, message } from "antd";
import {
  LeftOutlined,
  WechatOutlined,
  SafetyOutlined,
  MobileOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { useUserStore } from "@/stores/modules/user";
import { useAgentStore } from "@/stores/modules/agent";
import { useEnterpriseStore } from "@/stores/modules/enterprise";
import { useMobile } from "@/hooks/useMobile";
import { useEnv } from "@/hooks/useEnv";
import { getPublicPath } from "@/utils/config";
import { checkVersion } from "@/utils/version";
import { VERSION_MODULE } from "@/constants/enterprise";
import { t } from "@/locales";
import enterpriseApi from "@/api/modules/enterprise";
import Register from "./register";
import ForgetPassword, { ForgetPasswordRef } from "./forgetPassword";
import WechatLogin from "./wechat";
import WecomLogin from "./wecom";
import Policy from "./policy";
import "./LoginModal.css";

type LoginWay =
  | "password_login"
  | "message_login"
  | "wechat_login"
  | "wecom_login"
  | "bind_mobile";

const LOGIN_WAY = {
  password_login: "password_login",
  message_login: "message_login",
  wechat_login: "wechat_login",
  wecom_login: "wecom_login",
  bind_mobile: "bind_mobile",
} as const;

const LOGIN_WAY_LIST = [
  { icon: "wechat", label: "wechat_login", value: LOGIN_WAY.wechat_login },
  { icon: "safe", label: "password_login", value: LOGIN_WAY.password_login },
  { icon: "iphone", label: "message_login", value: LOGIN_WAY.message_login },
];

interface LoginModalProps {
  onLogin?: () => void;
  onClose?: () => void;
}

export interface LoginModalRef {
  open: (data?: { way?: LoginWay; openid?: string; unionid?: string }) => void;
  close: () => void;
}

export const LoginModal = forwardRef<LoginModalRef, LoginModalProps>(
  ({ onLogin, onClose }, ref) => {
    const [isVisible, setIsVisible] = useState(false);
    const [loginWay, setLoginWay] = useState<LoginWay>(
      LOGIN_WAY.password_login,
    );
    const [registerVisible, setRegisterVisible] = useState(false);
    const [forgetPasswordVisible, setForgetPasswordVisible] = useState(false);
    const [openSMTP, setOpenSMTP] = useState(false);
    const [isSending, setIsSending] = useState(true);
    const [oauthData, setOauthData] = useState<any>({});

    const [form] = Form.useForm();
    const forgetPasswordRef = useRef<ForgetPasswordRef>(null);

    const userStore = useUserStore();
    const agentStore = useAgentStore();
    const enterpriseStore = useEnterpriseStore();
    const { sendcode, codeCount } = useMobile();
    const { isOpLocalEnv, isPrivatePremEnv } = useEnv();

    const timerRef = useRef<NodeJS.Timeout | null>(null);

    // Expose open/close methods via ref
    useImperativeHandle(ref, () => ({
      open: (data = {}) => {
        if (data.way === LOGIN_WAY.wechat_login && data.openid) {
          handleOauthSuccess({
            openid: data.openid,
            unionid: data.unionid,
          });
        }
        setOauthData(data);
        setIsVisible(true);
        form.resetFields();
      },
      close: () => {
        setIsVisible(false);
        form.resetFields();
        onClose?.();
      },
    }));

    // Listen for custom event to open modal
    useEffect(() => {
      const handleOpenModal = (event: CustomEvent) => {
        setIsVisible(true);
        form.resetFields();
      };
      window.addEventListener(
        "open-login-modal",
        handleOpenModal as EventListener,
      );
      return () =>
        window.removeEventListener(
          "open-login-modal",
          handleOpenModal as EventListener,
        );
    }, []);

    // Load SMTP config
    useEffect(() => {
      loadSMTP();
    }, []);

    // Watch code countdown
    useEffect(() => {
      setIsSending(codeCount > 0);
    }, [codeCount]);

    // Cleanup timer on unmount
    useEffect(() => {
      return () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
      };
    }, []);

    const loadSMTP = async () => {
      try {
        const { data } = await enterpriseApi.getSMTPInfo("smtp");
        setOpenSMTP(data);
      } catch (error) {
        console.error("Failed to load SMTP config:", error);
      }
    };

    const dialogStyle = {
      backgroundImage: `url(${getPublicPath("/images/login_bg.png")})`,
      borderRadius: "12px",
    };

    const filteredLoginWayList = LOGIN_WAY_LIST.filter((item) => {
      // Private prem env: only password and message login
      if (isPrivatePremEnv) {
        return [
          LOGIN_WAY.password_login as LoginWay,
          LOGIN_WAY.message_login as LoginWay,
        ].includes(item.value);
      }
      // Op local env: only password login
      if (isOpLocalEnv) {
        return item.value === LOGIN_WAY.password_login;
      }
      return true;
    }).filter((item) => {
      // WeCom login: check if installed
      return item.value === LOGIN_WAY.wecom_login
        ? enterpriseStore.is_install_wecom
        : true;
    });

    // Use Form.useWatch to make username reactive
    const usernameValue = Form.useWatch("username", form);
    const isMobile = /^1[3-9]\d{9}$/.test(usernameValue || "");

    const getUsernameLabel = () => {
      return loginWay === LOGIN_WAY.password_login
        ? t("form.account")
        : t("form.mobile");
    };

    const getVerifyCodeLabel = () => {
      return loginWay === LOGIN_WAY.bind_mobile ? "" : t("form.verify_code");
    };

    const handleGetCode = () => {
      const username = form.getFieldValue("username");
      if (!username || !/^1[3-9]\d{9}$/.test(username)) {
        return;
      }
      sendcode(username);
    };

    const handleSubmit = async () => {
      try {
        const values = await form.validateFields();

        if (loginWay === LOGIN_WAY.bind_mobile) {
          await userStore.bind_wechat({
            mobile: values.username,
            verify_code: values.verify_code,
            openid: oauthData.openid,
            unionid: oauthData.unionid,
            nickname: oauthData.nickname,
          });
        } else if (loginWay === LOGIN_WAY.message_login) {
          await userStore.sms_login({
            mobile: values.username,
            verify_code: values.verify_code,
          });
        } else {
          await userStore.login({
            username: values.username,
            password: values.password,
          });
        }

        agentStore.loadAgentList();
        close();
      } catch (error: any) {
        await handleLoginError(error);
      }
    };

    const handleLoginError = async (error: any) => {
      const response = error.response || {};
      const data = response.data || {};
      const errorMessage = data.message || "";

      if (errorMessage.includes("record not found")) {
        if (isOpLocalEnv && !openSMTP) {
          // Auto register in op-local env without SMTP
          const values = form.getFieldsValue();
          try {
            await userStore.register({
              username: values.username,
              password: values.password,
            });
            message.success(t("status.login_success"));
            agentStore.loadAgentList();
            setIsVisible(false);
          } catch (regError) {
            // handleError already showed the message
          }
        } else {
          message.warning(t("status.not_found_account"));
        }
      }
      // Other errors are already handled by handleError in userApi.login
    };

    const handleLoginWayChange = (way: LoginWay) => {
      setLoginWay(way);
      form.resetFields();
    };

    const handleRegister = () => {
      setIsVisible(false);
      setRegisterVisible(true);
      form.resetFields();
    };

    const handleForgetPassword = () => {
      setIsVisible(false);
      setForgetPasswordVisible(true);
      form.resetFields();
    };

    const handleClose = () => {
      setIsVisible(true);
      setRegisterVisible(false);
      setForgetPasswordVisible(false);
      form.setFieldValue("verify_code", "");
      setLoginWay(LOGIN_WAY.password_login);
    };

    const handleClosePaw = () => {
      setForgetPasswordVisible(false);
      setRegisterVisible(true);
    };

    const handleOauthSuccess = async (data: any) => {
      try {
        await userStore.wechat_login({ unionid: data.unionid });
        message.success(t("status.login_success"));
        agentStore.loadAgentList();
        close();
      } catch (error) {
        setOauthData(data);
        setLoginWay(LOGIN_WAY.bind_mobile);
      }
    };

    const close = () => {
      setIsVisible(false);
      form.resetFields();
      onLogin?.();
      onClose?.();
    };

    const showVerifyCode = [
      LOGIN_WAY.message_login as LoginWay,
      LOGIN_WAY.bind_mobile as LoginWay,
    ].includes(loginWay);

    return (
      <>
        {/* Main Login Modal */}
        <Modal
          open={isVisible}
          onCancel={
            loginWay !== LOGIN_WAY.bind_mobile
              ? () => setIsVisible(false)
              : undefined
          }
          footer={null}
          className="login-modal"
          centered
          destroyOnHidden
          style={dialogStyle}
          closeIcon={loginWay !== LOGIN_WAY.bind_mobile ? undefined : null}
          mask={{ closable: false }}
        >
          {/* Header */}
          {loginWay === LOGIN_WAY.bind_mobile ? (
            <div className="flex justify-center mt-5">
              <h4 className="text-xl text-[#1D1E1F] font-semibold w-full flex items-center">
                <LeftOutlined
                  className="mr-1 cursor-pointer text-[#4E4F51]"
                  onClick={() => handleLoginWayChange(LOGIN_WAY.wechat_login)}
                />
                {t("login.bind_mobile")}
              </h4>
            </div>
          ) : (
            <div className="flex justify-center mt-5">
              <h4 className="text-xl text-[#1D1E1F] font-bold text-center">
                {t(`login.${loginWay}_title`)}
              </h4>
            </div>
          )}

          {/* WeChat/WeCom Login */}
          {loginWay === LOGIN_WAY.wechat_login ||
          loginWay === LOGIN_WAY.wecom_login ? (
            <>
              {loginWay === LOGIN_WAY.wechat_login ? (
                <WechatLogin height="292px" onSuccess={handleOauthSuccess} />
              ) : (
                <WecomLogin height="292px" />
              )}
              <div className="text-center">
                <Policy />
              </div>
            </>
          ) : (
            <>
              {/* Form */}
              <Form
                form={form}
                layout="vertical"
                className="mt-7"
                onFinish={handleSubmit}
              >
                <Form.Item
                  label={getUsernameLabel()}
                  name="username"
                  rules={[
                    {
                      required: true,
                      message: t("form.input_placeholder") + getUsernameLabel(),
                    },
                    ...(loginWay === LOGIN_WAY.password_login
                      ? []
                      : [
                          {
                            pattern: /^1[3-9]\d{9}$/,
                            message: t("form.mobile_format_error"),
                          },
                        ]),
                  ]}
                >
                  <Input
                    size="large"
                    placeholder={
                      t("form.input_placeholder") + getUsernameLabel()
                    }
                    allowClear
                  />
                </Form.Item>

                {loginWay === LOGIN_WAY.password_login && (
                  <Form.Item
                    label={t("form.password")}
                    name="password"
                    rules={[
                      {
                        required: true,
                        message:
                          t("form.input_placeholder") + t("form.password"),
                      },
                    ]}
                  >
                    <Input.Password
                      size="large"
                      placeholder={
                        t("form.input_placeholder") + t("form.password")
                      }
                    />
                  </Form.Item>
                )}

                {showVerifyCode && (
                  <Form.Item
                    label={getVerifyCodeLabel()}
                    name="verify_code"
                    rules={[
                      {
                        required: true,
                        message:
                          t("form.input_placeholder") + t("form.verify_code"),
                      },
                    ]}
                  >
                    <Input
                      size="large"
                      placeholder={
                        t("form.input_placeholder") + t("form.verify_code")
                      }
                      addonAfter={
                        <Button
                          type="link"
                          disabled={isSending || !isMobile}
                          onClick={handleGetCode}
                          className="!bg-[#f5f5f5] border-0 w-29 no-left-radius"
                        >
                          <span
                            className={
                              isSending || !isMobile
                                ? "text-[#9A9A9A]"
                                : "text-[#2563EB]"
                            }
                          >
                            {codeCount
                              ? `${codeCount}s`
                              : t("form.get_verify_code")}
                          </span>
                        </Button>
                      }
                    />
                  </Form.Item>
                )}

                {loginWay !== LOGIN_WAY.bind_mobile && (
                  <div className="flex items-center justify-between mt-3 max-md:flex-col max-md:gap-2">
                    <Policy />
                    <div className="flex-1 flex items-center justify-end">
                      {checkVersion(VERSION_MODULE.REGISTERED_USER) &&
                        !enterpriseStore.is_enterprise && (
                          <Button
                            type="link"
                            className="mr-1 !px-0"
                            onClick={handleRegister}
                          >
                            {t("action.user_register")}
                          </Button>
                        )}
                      {(!isOpLocalEnv || (isOpLocalEnv && openSMTP)) && (
                        <>
                          {!enterpriseStore.is_enterprise && (
                            <div className="border-l border-[#E6E8EB] mx-1 h-4" />
                          )}
                          <Button
                            type="link"
                            className="!px-0"
                            onClick={handleForgetPassword}
                          >
                            {t("action.forget_password")}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {loginWay === LOGIN_WAY.bind_mobile ? (
                  <div className="flex items-center justify-end">
                    <Button
                      type="primary"
                      disabled={
                        !form.getFieldValue("verify_code") &&
                        !form.getFieldValue("username")
                      }
                      size="large"
                      className="min-w-[96px]"
                      htmlType="submit"
                    >
                      {t("action.ok")}
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="primary"
                    size="large"
                    block
                    shape="round"
                    className="mt-5"
                    htmlType="submit"
                  >
                    {t("action.login")}
                  </Button>
                )}
              </Form>
            </>
          )}

          {/* Other login ways */}
          {!isOpLocalEnv && loginWay !== LOGIN_WAY.bind_mobile && (
            <>
              <Divider className="my-8">
                <span className="text-[#9A9A9A] text-sm">
                  {t("login.other_login_way")}
                </span>
              </Divider>
              <div className="flex items-center justify-center mt-5">
                {filteredLoginWayList.map((item) => {
                  const renderIcon = () => {
                    switch (item.icon) {
                      case "wechat":
                        return <WechatOutlined style={{ fontSize: 24 }} />;
                      case "wecom":
                        return <TeamOutlined style={{ fontSize: 24 }} />;
                      case "safe":
                        return <SafetyOutlined style={{ fontSize: 24 }} />;
                      case "iphone":
                        return <MobileOutlined style={{ fontSize: 24 }} />;
                      default:
                        return null;
                    }
                  };
                  return (
                    <div
                      key={item.value}
                      className={`flex-1 flex flex-col items-center justify-center gap-3 cursor-pointer ${
                        item.value === loginWay
                          ? "text-[#2563EB]"
                          : "text-[#9A9A9A]"
                      }`}
                      onClick={() => handleLoginWayChange(item.value)}
                    >
                      <div className="size-6">{renderIcon()}</div>
                      <p className="text-sm">{t(`login.${item.label}`)}</p>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Modal>

        {/* Register Modal */}
        <Modal
          open={registerVisible}
          onCancel={() => setRegisterVisible(false)}
          footer={null}
          className="login-modal"
          centered
          destroyOnHidden
          style={dialogStyle}
          mask={{ closable: false }}
        >
          <Register
            openSMTP={openSMTP}
            onSuccess={handleClose}
            onClose={handleClose}
          />
        </Modal>

        {/* Forget Password Modal */}
        <Modal
          open={forgetPasswordVisible}
          onCancel={() => setForgetPasswordVisible(false)}
          footer={null}
          className="login-modal"
          centered
          destroyOnHidden
          style={dialogStyle}
          mask={{ closable: false }}
        >
          <Button
            type="link"
            className="absolute top-8 left-8 !px-0 !text-[#B9BEC2]"
            onClick={handleClose}
          >
            <LeftOutlined className="mr-1" />
            {t("action.back")}
          </Button>
          <div className="pb-2">
            <h4 className="text-xl text-[#1D1E1F] font-bold text-center pb-8">
              {t("form.reset_password")}
            </h4>
            <ForgetPassword
              ref={forgetPasswordRef}
              onSuccess={handleClose}
              onClose={handleClosePaw}
            />
          </div>
        </Modal>
      </>
    );
  },
);

LoginModal.displayName = "LoginModal";

export default LoginModal;
