import { useEffect, useState, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import { Button, Input, message, Space } from 'antd'
import { commonApi } from '@/api/modules/common'
import {
  runWithCaptcha,
  isCaptchaCanceled,
} from '@km/shared-business/captcha'

interface VerificationCodeInputProps {
  value?: string
  onChange?: (val: string) => void
  account?: string
  accountType?: 'email' | 'mobile'
  bgColor?: string
  height?: string
  disabled?: boolean
  countdown?: number
  placeholder?: string
  size?: 'large' | 'middle' | 'small'
  clearable?: boolean
}

export interface VerificationCodeInputRef {
  reset: () => void
}

const MOBILE_PATTERN = /^(13[0-9]|14[0-9]|15[0-9]|16[0-9]|17[0-9]|18[0-9]|19[0-9])\d{8}$/

export const VerificationCodeInput = forwardRef<VerificationCodeInputRef, VerificationCodeInputProps>(
  (
    {
      value = '',
      onChange,
      account = '',
      accountType = 'mobile',
      bgColor = '#F1F2F3',
      height = '44px',
      disabled = false,
      countdown = 60,
      placeholder,
      size = 'large',
      clearable = true,
    },
    ref
  ) => {
    const [inputValue, setInputValue] = useState(value)
    const [sendCountdown, setSendCountdown] = useState(0)
    /** 发送中（含图形验证码弹窗交互期间），用于按钮 loading 与 in-flight 锁 */
    const [sending, setSending] = useState(false)
    const timerRef = useRef<NodeJS.Timeout | null>(null)

    const t = (window as any).$t || ((key: string) => key)

    // Determine real account type
    const realAccountType = accountType || (MOBILE_PATTERN.test(account) ? 'mobile' : 'email')

    // Send button disabled state
    const sendDisabled = disabled || !account || sendCountdown > 0 || sending

    // Clear timer on unmount
    useEffect(() => {
      return () => {
        if (timerRef.current) {
          clearInterval(timerRef.current)
        }
      }
    }, [])

    // Handle input change
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value
      setInputValue(newValue)
      onChange?.(newValue)
    }

    // Send verification code
    const onSend = async () => {
      if (!account) {
        message.warning(t(`login.${realAccountType}_placeholder`))
        return
      }

      // 验证手机号格式
      if (realAccountType === 'mobile' && !MOBILE_PATTERN.test(account)) {
        message.warning(t('form_mobile_validator'))
        return
      }

      // in-flight 锁：请求进行中忽略重复点击，避免重复发送 / 重置图形验证码弹窗会话
      if (sending) return
      setSending(true)

      try {
        if (accountType === 'mobile') {
          // 发送短信前强制图形人机校验：
          // 弹窗保持打开，只有发送成功才关闭；发送失败时原地换图并提示，
          // 用户可直接重新输入（详见 CaptchaModal 控制器）
          await runWithCaptcha(async ({ captcha_id, captcha_answer }) => {
            await commonApi.sendcode({ mobile: account, captcha_id, captcha_answer })
          })
        } else {
          await commonApi.sendEmailCode({ email: account })
        }

        message.success(t('action_send_success'))
        setSendCountdown(countdown)

        timerRef.current = setInterval(() => {
          setSendCountdown((prev) => {
            const next = prev - 1
            if (next < 0) {
              if (timerRef.current) {
                clearInterval(timerRef.current)
              }
              return 0
            }
            return next
          })
        }, 1000)
      } catch (error) {
        // 用户取消校验：静默返回，不进入发送倒计时；
        // 接口报错已由弹窗内提示，这里不再重复提示
        if (!isCaptchaCanceled(error)) {
          console.error('Failed to send code:', error)
        }
      } finally {
        setSending(false)
      }
    }

    // Reset method
    const reset = useCallback(() => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
      setInputValue('')
      setSendCountdown(0)
    }, [])

    // Expose reset method
    useImperativeHandle(ref, () => ({
      reset,
    }))

    return (
      <Space.Compact style={{ display: 'flex', width: '100%' }}>
        <Input
          value={inputValue}
          onChange={handleChange}
          size={size}
          allowClear={clearable}
          placeholder={placeholder || t('verification_code_placeholder')}
          style={{ backgroundColor: bgColor, height, flex: 1 }}
        />
        <Button
          type="primary"
          size={size}
          disabled={sendDisabled}
          loading={sending}
          onClick={onSend}
          style={{ height }}
        >
          {sendCountdown > 0
            ? `${t('action_send_success')}(${sendCountdown}s)`
            : t('get_verification_code')}
        </Button>
      </Space.Compact>
    )
  }
)

VerificationCodeInput.displayName = 'VerificationCodeInput'

export default VerificationCodeInput
