import { useEffect, useState, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import { Button, Input, message, Space } from 'antd'
import { commonApi } from '@/api/modules/common'

interface VerificationCodeInputProps {
  value?: string
  onChange?: (val: string) => void
  account?: string
  accountType?: 'email' | 'mobile'
  bgColor?: string
  height?: string
  disabled?: boolean
  countdown?: number
  maxlength?: number
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
      maxlength = 4,
      placeholder,
      size = 'large',
      clearable = true,
    },
    ref
  ) => {
    const [inputValue, setInputValue] = useState(value)
    const [sendCountdown, setSendCountdown] = useState(0)
    const timerRef = useRef<NodeJS.Timeout | null>(null)

    const t = (window as any).$t || ((key: string) => key)

    // Determine real account type
    const realAccountType = accountType || (MOBILE_PATTERN.test(account) ? 'mobile' : 'email')

    // Send button disabled state
    const sendDisabled = disabled || !account || sendCountdown > 0

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

      try {
        if (accountType === 'mobile') {
          await commonApi.sendcode({ mobile: account })
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
        console.error('Failed to send code:', error)
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
          maxLength={maxlength}
          size={size}
          allowClear={clearable}
          placeholder={placeholder || t('verification_code_placeholder')}
          style={{ backgroundColor: bgColor, height, flex: 1 }}
        />
        <Button
          type="primary"
          size={size}
          disabled={sendDisabled}
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
