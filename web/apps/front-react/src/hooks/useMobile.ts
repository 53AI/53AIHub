import { useState, useCallback, useRef, useEffect } from 'react'
import { message } from 'antd'
import { t } from '@/locales'
import { runWithCaptcha, isCaptchaCanceled } from '@km/shared-business/captcha'

export function useMobile() {
  const [codeCount, setCodeCount] = useState(0)
  /** 发送中（含图形验证码弹窗交互期间），用于按钮 loading 与 in-flight 锁 */
  const [sending, setSending] = useState(false)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  // 手机验证码 4 位
  // 空值不在这里拦，交给 Form.Item 的 required 规则，避免一个字段同时弹出两条提示
  const codeRule = {
    validator: (_rule: any, value: any) => {
      if (!value) return Promise.resolve()
      if (/^\d{4,}$/.test(value)) {
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
    // in-flight 锁：请求进行中忽略重复点击，避免重置图形验证码弹窗会话
    if (sending) return
    setSending(true)

    try {
      // 发送短信前强制图形人机校验：
      // 弹窗会一直保持打开，只有发送成功才关闭；发送失败时弹窗原地换图并提示，
      // 用户可直接重新输入，不必经历「关窗 - 重开 - 重新看图」。
      await runWithCaptcha(async ({ captcha_id, captcha_answer }) => {
        const commonApi = (await import('@/api/modules/common')).default
        await commonApi.sendcode({
          mobile,
          source: 'companyibos',
          captcha_id,
          captcha_answer
        })
      })
    } catch (error) {
      // 用户取消校验：静默返回，不进入发送倒计时
      if (!isCaptchaCanceled(error)) {
        console.error('发送验证码失败:', error)
      }
      return
    } finally {
      setSending(false)
    }

    setCodeCount(60)
    message.success(t('status.sent'))
  }, [sending])

  return {
    codeCount,
    codeRule,
    sendcode,
    sending
  }
}

export default useMobile
