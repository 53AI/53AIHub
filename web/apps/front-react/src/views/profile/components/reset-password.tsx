import {
  useState,
  useRef,
  forwardRef,
  useImperativeHandle,
  useEffect,
} from "react";
import { Form, Input, Button, Radio, Space, message } from "antd";
import { useUserStore } from "@/stores/modules/user";
import { useEmail } from "@/hooks/useEmail";
import { useMobile } from "@/hooks/useMobile";
import userApi from "@/api/modules/user";
import { t } from "@/locales";

interface ResetPasswordProps {
  onSuccess: () => void;
}

export interface ResetPasswordRef {
  resetForm: () => void;
}

const VERIFY_WAY = {
  email_verify: "email_verify",
  mobile_verify: "mobile_verify",
} as const;

type VerifyWay = (typeof VERIFY_WAY)[keyof typeof VERIFY_WAY];

const ResetPassword = forwardRef<ResetPasswordRef, ResetPasswordProps>(
  ({ onSuccess }, ref) => {
    const [form] = Form.useForm();
    const userStore = useUserStore();

    // 两个独立的 hook 实例，分别用于邮箱和手机验证
    const { emailCodeCount, emailCodeRule, sendEmailCode } = useEmail();

    const {
      codeCount: mobileCodeCount,
      codeRule: mobileCodeRule,
      sendcode: sendMobileCode,
    } = useMobile();

    const [verifyWay, setVerifyWay] = useState<VerifyWay>(
      VERIFY_WAY.email_verify,
    );
    const [loading, setLoading] = useState(false);

    useImperativeHandle(ref, () => ({
      resetForm: () => {
        form.resetFields();
      },
    }));

    // 根据用户信息设置默认验证方式
    useEffect(() => {
      if (!userStore.info.email) {
        setVerifyWay(VERIFY_WAY.mobile_verify);
      }
    }, [userStore.info.email]);

    // 获取验证码
    const handleGetCode = async () => {
      if (verifyWay === VERIFY_WAY.email_verify) {
        await sendEmailCode(userStore.info.email);
      } else {
        await sendMobileCode(userStore.info.mobile);
      }
    };

    const handleSubmit = async (values: {
      verify_code: string;
      new_password: string;
      confirm_password: string;
    }) => {
      setLoading(true);
      try {
        const data: any = {
          verify_code: values.verify_code,
          new_password: values.new_password,
          confirm_password: values.confirm_password,
        };

        if (verifyWay === VERIFY_WAY.email_verify) {
          data.email = userStore.info.email;
        } else {
          data.mobile = userStore.info.mobile;
        }

        await userApi.reset_password(data);
        message.success(t("status.save_success"));
        onSuccess();
        form.resetFields();
      } catch (error) {
        console.error("Failed to reset password:", error);
      } finally {
        setLoading(false);
      }
    };

    const codeCount =
      verifyWay === VERIFY_WAY.email_verify ? emailCodeCount : mobileCodeCount;

    return (
      <div>
        {/* 验证方式选择 */}
        <div className="mb-2">
          <h3>{t("form.reset_password_method")}</h3>
          <Radio.Group
            value={verifyWay}
            onChange={(e) => setVerifyWay(e.target.value)}
          >
            <Radio
              value={VERIFY_WAY.email_verify}
              disabled={!userStore.info.email}
            >
              {t("form.email_verify")}
            </Radio>
            <Radio
              value={VERIFY_WAY.mobile_verify}
              disabled={!userStore.info.mobile}
            >
              {t("form.mobile_verify")}
            </Radio>
          </Radio.Group>
        </div>

        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="verify_code"
            label={t("form.verify_code")}
            rules={[
              verifyWay === VERIFY_WAY.email_verify
                ? emailCodeRule
                : mobileCodeRule,
            ]}
          >
            <Space.Compact className="w-full">
              <Input
                className="flex-1"
                placeholder={
                  t("form.input_placeholder") + t("form.verify_code")
                }
              />
              <Button
                disabled={!!codeCount}
                className="w-28"
                onClick={handleGetCode}
              >
                <span
                  className={codeCount ? "text-[#9A9A9A]" : "text-[#2563EB]"}
                >
                  {codeCount ? `${codeCount}s` : t("form.get_verify_code")}
                </span>
              </Button>
            </Space.Compact>
          </Form.Item>

          <Form.Item
            name="new_password"
            label={t("form.new_password")}
            rules={[
              { required: true, message: t("form.new_password_placeholder") },
              { min: 8, max: 20, message: t("form.password_length") },
              {
                validator: (_, value) => {
                  if (value && /[\u4e00-\u9fa5]/.test(value)) {
                    return Promise.reject(
                      new Error(t("form.password_no_chinese")),
                    );
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Input.Password placeholder={t("form.new_password_placeholder")} />
          </Form.Item>

          <Form.Item
            name="confirm_password"
            label={t("form.new_password_confirm")}
            dependencies={["new_password"]}
            rules={[
              {
                required: true,
                message: t("form.new_password_confirm_placeholder"),
              },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue("new_password") === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(
                    new Error(t("form.password_not_match")),
                  );
                },
              }),
            ]}
          >
            <Input.Password
              placeholder={t("form.new_password_confirm_placeholder")}
            />
          </Form.Item>

          <Button
            type="primary"
            block
            className="!h-10 !rounded-full mt-3"
            htmlType="submit"
            loading={loading}
          >
            {t("action.update_password")}
          </Button>
        </Form>
      </div>
    );
  },
);

ResetPassword.displayName = "ResetPassword";

export default ResetPassword;
