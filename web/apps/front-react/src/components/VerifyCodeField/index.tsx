import { Button, Form, Input, Space } from "antd";
import { t } from "@/locales";

interface VerifyCodeFieldProps {
  /** 表单字段名 */
  name: string;
  /** 字段标签（默认「验证码」） */
  label?: string;
  /** 验证码校验规则（如 emailCodeRule / codeRule），与 required 规则合并 */
  rule?: object;
  /** 占位文案（默认「请输入验证码」） */
  placeholder?: string;
  /** 倒计时秒数，>0 时按钮显示倒计时并禁用 */
  count?: number;
  /** 额外禁用条件（发送中 / 未填账号 / 未注册等） */
  disabled?: boolean;
  /** 发送请求进行中（按钮转圈并禁用，防连点重复发送） */
  loading?: boolean;
  /** 点击「获取验证码」 */
  onClick: () => void;
  /** 输入框尺寸 */
  size?: "large" | "middle" | "small";
}

/**
 * 验证码输入框 + 获取/倒计时按钮
 *
 * 收敛 LoginModal 与 profile/components 里 8+ 处重复的「验证码字段」：
 * 输入 + 倒计时按钮 + 校验规则。倒计时与发送逻辑仍由调用方（useEmail / useMobile）负责。
 */
const VerifyCodeField = ({
  name,
  label = t("form.verify_code"),
  rule,
  placeholder = t("form.input_placeholder") + t("form.verify_code"),
  count = 0,
  disabled = false,
  loading = false,
  onClick,
  size,
}: VerifyCodeFieldProps) => {
  const isCounting = count > 0;
  const btnDisabled = disabled || isCounting;

  return (
    <Form.Item
      name={name}
      label={label}
      rules={[
        {
          required: true,
          message: t("form.input_placeholder") + t("form.verify_code"),
        },
        ...(rule ? [rule] : []),
      ]}
    >
      <Space.Compact className="w-full">
        <Input className="flex-1" placeholder={placeholder} size={size} />
        <Button
          type={btnDisabled ? 'default' : 'primary'}
          size={size}
          disabled={btnDisabled}
          loading={loading}
          onClick={onClick}
          className="!px-2 w-28"
        >
          <span className="!text-sm">
            {isCounting ? `${count}s` : t("form.get_verify_code")}
          </span>
        </Button>
      </Space.Compact>
    </Form.Item>
  );
};

export default VerifyCodeField;
