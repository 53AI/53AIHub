import { useEffect, useState } from "react";
import { Button, Form, Input, message, Space } from "antd";
import { CheckCircleFilled } from "@ant-design/icons";
import { SvgIcon } from "@km/shared-components-react";
import { useEnterpriseStore, useUserStore } from "@/stores";
import { VerificationCodeInput } from "@/components/VerificationCodeInput";
import { authApi } from "@/api/modules/auth";
import { DOMAIN_SUFFIX } from "@/constants/domain";
import { t } from "@/locales";

interface CreateNewEnterpriseProps {
  onLogin: () => void;
  onList: () => void;
}

export function CreateNewEnterprise(props: CreateNewEnterpriseProps) {
  const { onLogin, onList } = props;
  const userStore = useUserStore();
  const enterpriseStore = useEnterpriseStore();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeStep, setActiveStep] = useState<"form" | "waiting">("form");
  const [isAccountValid, setIsAccountValid] = useState(false);
  const [isAccountExists, setIsAccountExists] = useState(true);
  const [isAccountValidNow, setIsAccountValidNow] = useState(true);
  const [, forceUpdate] = useState({});

  const domainSuffix = DOMAIN_SUFFIX;

  const handleCheckAccount = async () => {
    try {
      await form.validateFields(["username"]);
      setIsAccountValid(true);
      setIsAccountValidNow(true);
      const username = form.getFieldValue("username") as string;
      const { exists = false } = await authApi.checkAccount({
        data: { account: username },
      });
      setIsAccountExists(exists);
    } catch {
      setIsAccountValidNow(false);
    }
  };

  // 手机验证码登录
  const mobileLogin = async (formValues: any) => {
    try {
      await userStore.login({
        type: "mobile",
        data: formValues,
        hideError: true,
      });
    } catch (err: any) {
      message.warning(
        t(
          err?.origin_message === "unauthorized"
            ? "response_message.user_not_found"
            : "response_message.username_or_password_is_incorrect",
        ),
      );
      throw err;
    }
  };

  // 注册
  const register = async (formValues: any) => {
    try {
      await userStore.login({
        type: "password",
        data: {
          username: formValues.username,
          password: formValues.password,
          verify_code: formValues.verify_code,
        },
        hideError: false,
      });
    } catch (err) {
      throw err;
    }
  };

  // 设置初始密码
  const setPassword = async (formValues: any) => {
    try {
      await userStore.resetPassword({
        data: {
          mobile: formValues.username,
          email: "",
          new_password: formValues.password,
          confirm_password: formValues.password,
          verify_code: formValues.verify_code,
        },
      });
    } catch (err) {
      throw err;
    }
  };

  // 创建企业
  const createEnterprise = async (formValues: any) => {
    try {
      await enterpriseStore.apply({
        data: {
          contact_name: formValues.enterprise_name,
          enterprise_name: formValues.enterprise_name,
          domain: formValues.domain,
          phone: formValues.username,
          email: "",
        },
        hideError: false,
      });
      onList();
      message.success(t("apply.create_success"));
    } catch (err) {
      throw err;
    }
  };

  const handleSubmit = async () => {
    try {
      const valid = await form.validateFields();
      if (!valid) return;
    } catch {
      return;
    }

    const values = form.getFieldsValue();
    const { enterprise_name, domain, username, verify_code, password } = values;

    setSubmitting(true);

    try {
      // 已登录 - 创建企业
      if ((userStore.info as any).username) {
        await createEnterprise(values);
        resetForm();
        return;
      }

      // 未登录
      // 手机号未注册
      if (!isAccountExists) {
        // 注册
        await register(values);
        // 设置初始密码
        await setPassword(values);
      }
      // 验证码登录
      await mobileLogin(values);
      // 创建企业
      await createEnterprise(values);
      resetForm();
    } catch (error) {
      console.log("error", error);
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    form.setFieldsValue({
      enterprise_name: "",
      domain: "",
      username: "",
      verify_code: "",
      password: "",
    });
  };

  // 初始化：检查已登录用户的待审核状态
  useEffect(() => {
    const init = async () => {
      form.setFieldValue("username", (userStore.info as any).username);
      if ((userStore.info as any).unRegistered_username) {
        form.setFieldValue(
          "username",
          (userStore.info as any).unRegistered_username,
        );
        handleCheckAccount();
      }
      const access_token = (userStore.info as any).access_token;
      if (access_token) {
        setLoading(true);
        try {
          // 待审核状态
          const { list = [] } = await enterpriseStore.loadListData({
            data: { status: 0 },
          });
          if (list.length > 0) {
            setActiveStep("waiting");
          }
        } finally {
          setLoading(false);
        }
      }
      if (localStorage.getItem("login_type")) {
        localStorage.removeItem("login_type");
      }
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disabledConfirm = () => {
    const enterprise_name = form.getFieldValue("enterprise_name");
    const domain = form.getFieldValue("domain");
    const username = form.getFieldValue("username");
    const verify_code = form.getFieldValue("verify_code");
    const password = form.getFieldValue("password");

    if ((userStore.info as any).username) {
      return !(enterprise_name && domain);
    }
    if (isAccountExists) {
      return !(enterprise_name && domain && username && verify_code);
    }
    return !(enterprise_name && domain && username && verify_code && password);
  };

  return (
    <>
      <button
        type="button"
        className="absolute top-6 right-8 text-sm flex items-center gap-1 text-gray-600 hover:text-gray-800"
        onClick={onLogin}
      >
        <SvgIcon name="account" width="13" />
        {t("action_login")}
      </button>
      <div className="relative w-full max-w-[440px]">
        {activeStep === "form" && (
          <Form
            form={form}
            layout="vertical"
            onValuesChange={() => forceUpdate({})}
          >
            <h4 className="text-3xl text-primary font-bold text-center mb-10">
              {t("apply.create_title", { project: "KM" })}
            </h4>

            <Form.Item
              name="enterprise_name"
              label={t("name")}
              rules={[
                { required: true, message: t("apply.enterprise_not_empty") },
              ]}
            >
              <Input
                size="large"
                placeholder={t("apply.enterprise_name_placeholder")}
              />
            </Form.Item>

            <Form.Item
              name="domain"
              label={t("apply.domain")}
              rules={[
                {
                  required: true,
                  validator: async (_, value) => {
                    if (!/^[a-z0-9-]{5,20}$/.test(value || "")) {
                      throw new Error(t("module.domain_exclusive_validator_1"));
                    }
                    try {
                      const { available } =
                        await import("@/api/modules/domain").then((m) =>
                          m.domainApi.checkIsDomainExists(value),
                        );
                      if (!available) {
                        throw new Error(
                          t("apply.domain_already_use", { domain: value }),
                        );
                      }
                    } catch {
                      throw new Error(
                        t("apply.domain_already_use", { domain: value }),
                      );
                    }
                  },
                },
              ]}
            >
              <Space.Compact style={{ display: "flex" }}>
                <Input
                  size="large"
                  placeholder={t("apply.domain_placeholder")}
                  style={{ flex: 1 }}
                />
                <Input
                  size="large"
                  disabled
                  value={domainSuffix}
                  style={{ width: "130px", textAlign: "center" }}
                />
              </Space.Compact>
            </Form.Item>

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
                disabled={(userStore.info as any).username}
                onBlur={handleCheckAccount}
                onChange={handleCheckAccount}
              />
            </Form.Item>

            {!(userStore.info as any).username &&
              isAccountValidNow &&
              !isAccountExists && (
                <div className="text-xs leading-3 text-[#07C160] mb-2">
                  {t("apply.mobile_unregistered_tip")}
                </div>
              )}

            {!(userStore.info as any).username && isAccountValid && (
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
            )}

            {!(userStore.info as any).username &&
              isAccountValid &&
              !isAccountExists && (
                <Form.Item
                  name="password"
                  label={t("password")}
                  rules={[
                    {
                      required: true,
                      message: t("login.password_placeholder"),
                    },
                    { min: 8, max: 20, message: t("login.password_length_v2") },
                  ]}
                >
                  <Input.Password
                    size="large"
                    placeholder={t("login.password_placeholder")}
                  />
                </Form.Item>
              )}

            <Button
              type="primary"
              block
              className="mt-6 h-10"
              loading={submitting}
              disabled={disabledConfirm()}
              onClick={handleSubmit}
              shape="round"
            >
              {t("action_confirm")}
            </Button>
          </Form>
        )}

        {activeStep === "waiting" && (
          <div className="h-[424px] p-10 box-border bg-[#EFF9FF] rounded-lg flex flex-col items-center justify-center text-center">
            <div className="flex items-center justify-center gap-2">
              <CheckCircleFilled style={{ color: "#4CBF65", fontSize: 28 }} />
              <span className="text-primary text-2xl font-bold">
                {t("apply.waiting_audit")}
              </span>
            </div>
            <div className="text-tertiary text-sm mt-4">
              {t("apply_success_desc")}
            </div>
            <img
              className="w-[148px] object-contain mt-14"
              src="/images/upgrade-qrcode.png"
              alt=""
            />
          </div>
        )}
      </div>
    </>
  );
}
