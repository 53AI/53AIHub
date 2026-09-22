import { useCallback, useEffect, useRef, useState } from 'react'
import { message } from 'antd'
import { post } from '@/api/config'
import { debounce } from '@/directive/debounce'
import { runWithCaptcha, isCaptchaCanceled } from '@km/shared-business/captcha'

export type MobileForm = {
  mobile: string
  code: string
  countdown: number
}

type ValidatorFn = (rule: unknown, value: string, callback: (err?: Error) => void) => void

export type MobileRules = {
  mobile?: Array<{ validator: ValidatorFn; trigger: string[] }>
  code?: Array<{ validator: ValidatorFn; trigger: string[] }>
}

export function useMobile() {
  const [mobileForm, setMobileForm] = useState<MobileForm>({
    mobile: '',
    code: '',
    countdown: 0,
  })

  const isMobile = /^1\d{10}$/.test(mobileForm.mobile)

  const mobileRules: MobileRules = {
    mobile: [
      {
        validator: (_rule: unknown, value: string, callback: (err?: Error) => void) => {
          if (/^1\d{10}$/.test(value)) callback()
          else callback(new Error('请输入正确的手机号'))
        },
        trigger: ['blur', 'change'],
      },
    ],
    code: [
      {
        validator: (_rule: unknown, value: string, callback: (err?: Error) => void) => {
          if (/^\d{4,}$/.test(value)) callback()
          else callback(new Error('请输入正确的验证码'))
        },
        trigger: ['blur', 'change'],
      },
    ],
  }

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  const startCountdown = useCallback((initial = 60) => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    setMobileForm(prev => ({ ...prev, countdown: initial }))
    intervalRef.current = setInterval(() => {
      setMobileForm(prev => {
        const next = Math.max(0, prev.countdown - 1)
        if (next === 0 && intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
        return { ...prev, countdown: next }
      })
    }, 1000)
  }, [])

  const mobileRef = useRef(mobileForm.mobile)
  mobileRef.current = mobileForm.mobile

  const handleSendCode = useCallback(
    debounce(async () => {
      try {
        // 发送短信前强制图形人机校验：
        // 弹窗保持打开，只有发送成功才关闭；发送失败时原地换图并提示
        await runWithCaptcha(async ({ captcha_id, captcha_answer }) => {
          await post<unknown>('/api/sms/sendcode', {
            mobile: mobileRef.current,
            captcha_id,
            captcha_answer,
          })
        })
        startCountdown(60)
        message.success('已发送')
      } catch (e) {
        // 用户取消校验：静默返回；其他错误由 api 统一处理
        if (isCaptchaCanceled(e)) return
      }
    }, 1000, true),
    [startCountdown],
  )

  return {
    mobileForm,
    setMobileForm,
    mobileRules,
    isMobile,
    handleSendCode,
  }
}

export default useMobile
