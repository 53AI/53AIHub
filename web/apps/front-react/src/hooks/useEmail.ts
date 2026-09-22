import { useState, useCallback, useRef, useEffect } from 'react'
import { message } from 'antd'
import commonApi from '@/api/modules/common'
import { t } from '@/locales'

export const useEmail = () => {
  const [emailCodeCount, setEmailCodeCount] = useState(0)
  /** 发送中，用于按钮 loading 与 in-flight 锁（防止连点重复发送邮件） */
  const [emailSending, setEmailSending] = useState(false)
  const countTimerRef = useRef<ReturnType<typeof setTimeout>>()

  // 邮箱验证码 6 位（手机验证码 4 位，见 useMobile）
  // 空值不在这里拦，交给 Form.Item 的 required 规则，避免一个字段同时弹出两条提示
  const emailCodeRule = {
    validator: (_rule: any, value: any) => {
      if (!value) return Promise.resolve()
      if (/^\d{4,}$/.test(value)) {
        return Promise.resolve()
      }
      return Promise.reject(new Error(t('form.verify_code_format')))
    },
    trigger: ['blur', 'change'] as const
  }

  const countdown = useCallback(() => {
    if (countTimerRef.current) {
      clearTimeout(countTimerRef.current)
    }
    countTimerRef.current = setTimeout(() => {
      setEmailCodeCount((prev) => {
        if (prev <= 1) return 0
        return prev - 1
      })
    }, 1000)
  }, [])

  // 发送邮箱验证码
  const sendEmailCode = useCallback((email: string): Promise<void> => {
    if (!email.trim()) return Promise.reject(new Error(t('form.email_required')))
    // in-flight 锁：请求进行中忽略重复点击，避免重复发送邮件
    if (emailSending) return Promise.resolve()
    setEmailSending(true)

    return commonApi
      .sendEmailCode({
        email
      })
      .then(() => {
        setEmailCodeCount(60)
        countdown()
        message.success(t('status.sent'))
      })
      .finally(() => {
        setEmailSending(false)
      })
  }, [countdown, emailSending])

  // 清理定时器
  useEffect(() => {
    return () => {
      if (countTimerRef.current) {
        clearTimeout(countTimerRef.current)
      }
    }
  }, [])

  // 当倒计时变化时继续倒计时
  useEffect(() => {
    if (emailCodeCount > 0) {
      countdown()
    }
  }, [emailCodeCount, countdown])

  return {
    emailCodeCount,
    emailCodeRule,
    sendEmailCode,
    emailSending
  }
}

export default useEmail
