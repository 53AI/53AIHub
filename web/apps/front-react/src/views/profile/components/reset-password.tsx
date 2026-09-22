import {
  useState,
  useRef,
  forwardRef,
  useImperativeHandle,
  useEffect,
} from "react";
import { Form, Input, Button, Radio, message } from "antd";
import { useUserStore } from "@/stores/modules/user";
import { useEmail } from "@/hooks/useEmail";
import { useMobile } from "@/hooks/useMobile";
import userApi from "@/api/modules/user";
import { t } from "@/locales";
import { noSpaceKeydownHandler } from "@km/shared-utils";
import { usePasswordRules } from "@/hooks/usePasswordPolicy";
import VerifyCodeField from "@/components/VerifyCodeField";

interface ResetPasswordProps {
  onSuccess: () => void;
  /** 是否显示表单内的「更新密码」提交按钮（默认显示；放入弹窗 footer 时传 false） */
  showSubmitButton?: boolean;
  /** 提交中状态变化回调（供外部 footer 按钮同步 loading） */
  onLoadingChange?: (loading: boolean) => void;
}

export interface ResetPasswordRef {
  resetForm: () => void;
  /** 触发表单校验并提交（供外部 footer 按钮调用） */
  submit: () => void;
}

const VERIFY_WAY = {
  email_verify: "email_verify",
  mobile_verify: "mobile_verify",
} as const;

type VerifyWay = (typeof VERIFY_WAY)[keyof typeof VERIFY_WAY];

const ResetPassword = forwardRef<ResetPasswordRef, ResetPasswordProps>(
  ({ onSuccess, showSubmitButton = true, onLoadingChange }, ref) => {
    const [form] = Form.useForm();
    const userStore = useUserStore();
    const { passwordRule } = usePasswordRules();

    // 两个独立的 hook 实例，分别用于邮箱和手机验证
    const { emailCodeCount, emailCodeRule, sendEmailCode, emailSending } = useEmail();

    const {
      codeCount: mobileCodeCount,
      codeRule: mobileCodeRule,
      sendcode: sendMobileCode,
      sending: mobileSending,
    } = useMobile();

    const [verifyWay, setVerifyWay] = useState<VerifyWay>(
      VERIFY_WAY.email_verify,
    );
    const [loading, setLoading] = useState(false);

    useImperativeHandle(ref, () => ({
      resetForm: () => {
        form.resetFields();
      },
      submit: () => {
        form.submit();
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
      onLoadingChange?.(true);
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
        onLoadingChange?.(false);
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
          <VerifyCodeField
            name="verify_code"
            rule={
              verifyWay === VERIFY_WAY.email_verify
                ? emailCodeRule
                : mobileCodeRule
            }
            count={codeCount}
            loading={
              verifyWay === VERIFY_WAY.email_verify ? emailSending : mobileSending
            }
            onClick={handleGetCode}
          />

          <Form.Item
            name="new_password"
            label={t("form.new_password")}
            rules={[
              { required: true, message: t("form.new_password_placeholder") },
              passwordRule,
            ]}
          >
            <Input.Password
              placeholder={t("form.new_password_placeholder")}
              onKeyDown={noSpaceKeydownHandler}
            />
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
              onKeyDown={noSpaceKeydownHandler}
            />
          </Form.Item>

          {showSubmitButton && (
            <Button
              type="primary"
              block
              className="!h-10 !rounded-full mt-3"
              htmlType="submit"
              loading={loading}
            >
              {t("action.update_password")}
            </Button>
          )}
        </Form>
      </div>
    );
  },
);

ResetPassword.displayName = "ResetPassword";

export default ResetPassword;
