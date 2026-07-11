import { useState, useCallback, useRef, useEffect } from 'react'
import { message } from 'antd'
import commonApi from '@/api/modules/common'
import { t } from '@/locales'

export const useEmail = () => {
  const [emailCodeCount, setEmailCodeCount] = useState(0)
  const countTimerRef = useRef<ReturnType<typeof setTimeout>>()

  const emailCodeRule = {
    validator: (_rule: any, value: any) => {
      if (/^\d{6}$/.test(value)) {
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

    return commonApi
      .sendEmailCode({
        email
      })
      .then(() => {
        setEmailCodeCount(60)
        countdown()
        message.success(t('status.sent'))
      })
  }, [countdown])

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
    sendEmailCode
  }
}

export default useEmail
