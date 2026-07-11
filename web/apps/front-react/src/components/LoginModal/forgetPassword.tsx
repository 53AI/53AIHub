import { useState, useEffect, forwardRef, useImperativeHandle, useRef } from 'react'
import { Form, Input, Button, Radio, message } from 'antd'
import { useUserStore } from '@/stores/modules/user'
import { useEmail } from '@/hooks/useEmail'
import { useMobile } from '@/hooks/useMobile'
import { useEnv } from '@/hooks/useEnv'
import userApi from '@/api/modules/user'
import { t } from '@/locales'

type VerifyWay = 'email_verify' | 'mobile_verify'

interface ForgetPasswordProps {
  onSuccess?: () => void
  onClose?: () => void
}

export interface ForgetPasswordRef {
  resetForm: () => void
}

interface UsernameCache {
  exists: boolean
  timestamp: number
}

export const ForgetPassword = forwardRef<ForgetPasswordRef, ForgetPasswordProps>(
  ({ onSuccess, onClose }, ref) => {
    const [form] = Form.useForm()
    const userStore = useUserStore()
    const { isOpLocalEnv } = useEnv()
    const { emailCodeCount, sendEmailCode } = useEmail()
    const { codeCount, sendcode } = useMobile()

    const [verifyWay, setVerifyWay] = useState<VerifyWay>('email_verify')
    const [isSending, setIsSending] = useState(false)
    const [existingAccount, setExistingAccount] = useState(true)
    const [isRegister, setIsRegister] = useState(true)

    const usernameCacheRef = useRef(new Map<string, UsernameCache>())

    useImperativeHandle(ref, () => ({
      resetForm: () => {
        form.resetFields()
        setExistingAccount(true)
        setIsRegister(true)
      }
    }))

    const getCodeCount = verifyWay === 'email_verify' ? emailCodeCount : codeCount

    const isFormatCorrect = (username: string) => {
      const patterns = {
        mobile_verify: /^1[3-9]\d{9}$/,
        email_verify: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
      }
      return patterns[verifyWay].test(username)
    }

    const checkUsername = async (username: string): Promise<boolean> => {
      if (!isFormatCorrect(username)) return false

      const cache = usernameCacheRef.current
      if (cache.has(username)) {
        const cachedResult = cache.get(username)!
        if (Date.now() - cachedResult.timestamp < 2 * 60 * 1000) {
          setIsRegister(!cachedResult.exists)
          return cachedResult.exists
        }
      }

      try {
        const res = await userApi.checkUsername(username)
        const exists = res.data?.exists ?? false
        setIsRegister(!exists)
        cache.set(username, { exists, timestamp: Date.now() })
        return exists
      } catch (error) {
        console.error('Failed to check username:', error)
        return false
      }
    }

    const handleGetCode = async () => {
      const username = form.getFieldValue('username')
      if (!username || !isFormatCorrect(username)) {
        message.warning(t('form.input_placeholder') + (verifyWay === 'email_verify' ? t('form.email') : t('form.mobile')))
        return
      }

      if (verifyWay === 'email_verify') {
        await sendEmailCode(username)
      } else {
        await sendcode(username)
      }
    }

    const handleVerifyWayChange = (way: VerifyWay) => {
      setVerifyWay(way)
      form.resetFields()
      setExistingAccount(true)
      setIsRegister(true)
    }

    const handleSubmit = async () => {
      try {
        const values = await form.validateFields()

        if (verifyWay === 'email_verify') {
          await userStore.reset_password({
            email: values.username,
            verify_code: values.verify_code,
            new_password: values.new_password,
            confirm_password: values.confirm_password
          })
        } else {
          await userStore.reset_password({
            mobile: values.username,
            verify_code: values.verify_code,
            new_password: values.new_password,
            confirm_password: values.confirm_password
          })
        }

        message.success(t('status.update_success'))
        onSuccess?.()
        form.resetFields()
      } catch (error: any) {
        const response = error.response || {}
        const data = response.data || {}
        message.error(data.message || t('status.update_fail'))
      }
    }

    const handleUsernameBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
      const username = e.target.value.trim()
      if (!username || !isFormatCorrect(username)) return

      const exists = await checkUsername(username)
      if (!exists) {
        setExistingAccount(false)
      } else {
        setExistingAccount(true)
      }
    }

    const handleClose = () => {
      form.resetFields()
      setExistingAccount(true)
      setIsRegister(true)
      onClose?.()
    }

    useEffect(() => {
      setIsSending(emailCodeCount > 0 || codeCount > 0)
    }, [emailCodeCount, codeCount])

    return (
      <div>
        {!isOpLocalEnv && (
          <div className="mb-4">
            <h3 className="mb-2">{t('form.reset_password_method')}</h3>
            <Radio.Group
              value={verifyWay}
              onChange={(e) => handleVerifyWayChange(e.target.value)}
            >
              <Radio value="email_verify">{t('form.email_verify')}</Radio>
              <Radio value="mobile_verify">{t('form.mobile_verify')}</Radio>
            </Radio.Group>
          </div>
        )}

        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            label={verifyWay === 'email_verify' ? t('form.email') : t('form.mobile')}
            name="username"
            rules={[
              { required: true, message: t('form.input_placeholder') + (verifyWay === 'email_verify' ? t('form.email') : t('form.mobile')) },
              {
                pattern: verifyWay === 'email_verify'
                  ? /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
                  : /^1[3-9]\d{9}$/,
                message: t('form.input_placeholder') + (verifyWay === 'email_verify' ? t('form.email') : t('form.mobile'))
              }
            ]}
            help={!existingAccount && (
              <div className="text-xs text-[#f56c6c]">
                {t('status.not_found_account')}
                <button type="button" className="text-xs text-[#2563EB] underline ml-1" onClick={handleClose}>
                  {t('action.register')}
                </button>
              </div>
            )}
          >
            <Input
              size="large"
              placeholder={t('form.input_placeholder') + (verifyWay === 'email_verify' ? t('form.email') : t('form.mobile'))}
              onBlur={handleUsernameBlur}
              allowClear
            />
          </Form.Item>

          <Form.Item
            label={t('form.verify_code')}
            name="verify_code"
            rules={[
              { required: true, message: t('form.input_placeholder') + t('form.verify_code') },
              { pattern: /^\d{6}$/, message: t('form.verify_code_format') }
            ]}
          >
            <Input
              size="large"
              placeholder={t('form.input_placeholder') + t('form.verify_code')}
              addonAfter={
                <Button
                  type="link"
                  disabled={isRegister || isSending}
                  onClick={handleGetCode}
                >
                  <span className={isRegister || isSending ? 'text-[#9A9A9A]' : 'text-[#2563EB]'}>
                    {getCodeCount > 0 ? `${getCodeCount}s` : t('form.get_verify_code')}
                  </span>
                </Button>
              }
            />
          </Form.Item>

          <Form.Item
            label={t('form.new_password')}
            name="new_password"
            rules={[
              { required: true, message: t('form.new_password_placeholder') },
              { min: 8, max: 20, message: t('form.password_length') }
            ]}
          >
            <Input.Password size="large" placeholder={t('form.new_password_placeholder')} />
          </Form.Item>

          <Form.Item
            label={t('form.new_password_confirm')}
            name="confirm_password"
            dependencies={['new_password']}
            rules={[
              { required: true, message: t('form.new_password_confirm_placeholder') },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('new_password') === value) {
                    return Promise.resolve()
                  }
                  return Promise.reject(new Error(t('form.password_mismatch')))
                }
              })
            ]}
          >
            <Input.Password size="large" placeholder={t('form.new_password_confirm_placeholder')} />
          </Form.Item>

          <Button type="primary" size="large" block shape="round" className="mt-3 h-10" htmlType="submit">
            {t('action.update_password')}
          </Button>
        </Form>
      </div>
    )
  }
)

ForgetPassword.displayName = 'ForgetPassword'

export default ForgetPassword
