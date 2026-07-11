import { useState, useCallback, useRef, useEffect } from 'react'
import { message } from 'antd'
import { t } from '@/locales'

export function useMobile() {
  const [codeCount, setCodeCount] = useState(0)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const codeRule = {
    validator: (_rule: any, value: any) => {
      if (/^\d{4}$/.test(value)) {
        return Promise.resolve()
      }
      return Promise.reject(new Error(t('form.verify_code_format')))
    },
    trigger: ['blur', 'change']
  }

  const countdown = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    timerRef.current = setTimeout(() => {
      setCodeCount((prev) => {
        if (prev <= 1) {
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }, [])

  useEffect(() => {
    if (codeCount > 0) {
      countdown()
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [codeCount, countdown])

  const sendcode = useCallback(async (mobile: string) => {
    if (!mobile.trim()) return

    try {
      const commonApi = (await import('@/api/modules/common')).default
      await commonApi.sendcode({
        mobile,
        source: 'companyibos'
      })
      setCodeCount(60)
      message.success(t('status.sent'))
    } catch (error) {
      console.error('发送验证码失败:', error)
      message.error(t('status.send_fail'))
    }
  }, [])

  return {
    codeCount,
    codeRule,
    sendcode
  }
}

export default useMobile
