import { useState, useRef, forwardRef, useImperativeHandle } from "react";
import { Form, Input, Button, message } from "antd";
import { useUserStore } from "@/stores/modules/user";
import { useMobile } from "@/hooks/useMobile";
import userApi from "@/api/modules/user";
import VerifyCodeField from "@/components/VerifyCodeField";
import { t } from "@/locales";

interface ChangeMobileProps {
  onSuccess: () => void;
  onClose: () => void;
}

export interface ChangeMobileRef {
  resetForm: () => void;
}

const ChangeMobile = forwardRef<ChangeMobileRef, ChangeMobileProps>(
  ({ onSuccess, onClose }, ref) => {
    const [form] = Form.useForm();
    const userStore = useUserStore();

    // 两个独立的 hook 实例，分别用于旧手机和新手机验证
    const {
      codeCount: oldCodeCount,
      codeRule: oldCodeRule,
      sendcode: sendOldCode,
      sending: oldSending,
    } = useMobile();

    const {
      codeCount: newCodeCount,
      codeRule: newCodeRule,
      sendcode: sendNewCode,
      sending: newSending,
    } = useMobile();

    const [loading, setLoading] = useState(false);

    useImperativeHandle(ref, () => ({
      resetForm: () => {
        form.resetFields();
      },
    }));

    // 验证手机号格式
    const isMobileValid = (mobile: string) => {
      return /^1[3-9]\d{9}$/.test(mobile);
    };

    // 新手机号未填写/格式不对时，禁用「获取验证码」按钮
    const newMobileValue = Form.useWatch("new_mobile", form);
    const isNewMobileValid = isMobileValid(newMobileValue || "");

    // 发送旧手机验证码
    const handleGetOldCode = async () => {
      await sendOldCode(userStore.info.mobile);
    };

    // 发送新手机验证码
    const handleGetNewCode = async () => {
      const newMobile = form.getFieldValue("new_mobile");
      if (!isMobileValid(newMobile)) {
        message.warning(t("form.mobile_format"));
        return;
      }
      await sendNewCode(newMobile);
    };

    const handleClose = () => {
      form.resetFields();
      onClose();
    };

    const handleSubmit = async (values: {
      old_code?: string;
      new_mobile: string;
      new_code: string;
    }) => {
      setLoading(true);
      try {
        const id = userStore.info.user_id;

        if (userStore.info.mobile) {
          // 有旧手机号 - 需要验证旧手机
          await userApi.change_mobile(id, {
            new_code: values.new_code,
            new_mobile: values.new_mobile,
            old_code: values.old_code,
          });
          message.success(t("profile.change") + t("status.success"));
        } else {
          // 没有旧手机号 - 只需验证新手机
          await userApi.change_mobile(id, {
            new_code: values.new_code,
            new_mobile: values.new_mobile,
          });
          message.success(t("status.save_success"));
        }

        form.resetFields();
        onSuccess();
      } catch (error) {
        console.error("Failed to change mobile:", error);
      } finally {
        setLoading(false);
      }
    };

    return (
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        {/* 旧手机验证码 - 仅当有旧手机号时显示 */}
        {userStore.info.mobile && (
          <VerifyCodeField
            name="old_code"
            rule={oldCodeRule}
            count={oldCodeCount}
            loading={oldSending}
            onClick={handleGetOldCode}
          />
        )}

        {/* 新手机号 */}
        <Form.Item
          name="new_mobile"
          label={
            userStore.info.mobile ? t("form.new_mobile") : t("form.mobile")
          }
          rules={[
            { required: true, message: t("form.mobile_format") },
            { pattern: /^1[3-9]\d{9}$/, message: t("form.mobile_format") },
          ]}
        >
          <Input
            placeholder={
              userStore.info.mobile
                ? t("form.input_placeholder") + t("form.new_mobile")
                : t("form.input_placeholder") + t("form.mobile")
            }
            allowClear
          />
        </Form.Item>

        {/* 新手机验证码：新手机号未填写/格式不对时禁用获取按钮 */}
        <VerifyCodeField
          name="new_code"
          rule={newCodeRule}
          count={newCodeCount}
          disabled={!isNewMobileValid}
          loading={newSending}
          onClick={handleGetNewCode}
        />

        <div className="flex justify-end gap-2 mt-7">
          <Button onClick={handleClose}>{t("action.cancel")}</Button>
          <Button type="primary" htmlType="submit" loading={loading}>
            {t("action.ok")}
          </Button>
        </div>
      </Form>
    );
  },
);

ChangeMobile.displayName = "ChangeMobile";

export default ChangeMobile;
