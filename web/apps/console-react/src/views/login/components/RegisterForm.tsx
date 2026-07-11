import { Button, Form, Input, message } from 'antd'
import { useRef, useState } from 'react'
import { t } from '@/locales'
import { useUserStore, useEnterpriseStore } from '@/stores'
import { authApi } from '@/api/modules/auth'
import { VerificationCodeInput } from '@/components/VerificationCodeInput'
import { validateEmail, validateMobile } from '@/utils/form-validator'

interface RegisterFormProps {
  onLogin?: () => void
}

interface FormValues {
  username: string
  username_type: 'email' | 'mobile'
  password: string
  verification_code: string
}

export function RegisterForm({ onLogin }: RegisterFormProps) {
  
  const [form] = Form.useForm<FormValues>()
  const userStore = useUserStore()
  const enterpriseStore = useEnterpriseStore()
  
  const [submitting, setSubmitting] = useState(false)
  const [accountExists, setAccountExists] = useState(false)
  const [isAccountValid, setIsAccountValid] = useState(false)
  const verificationCodeRef = useRef<any>(null)

  // Check account validation
  const checkAccountValidation = async () => {
    const username = form.getFieldValue('username')
    const usernameType = form.getFieldValue('username_type') || 'mobile'
    
    if (usernameType === 'email') {
      setIsAccountValid(validateEmail(username))
    } else {
      setIsAccountValid(validateMobile(username))
    }
  }

  // Check if account exists
  const checkAccount = async () => {
    try {
      const username = form.getFieldValue('username')
      if (!username) return false
      
      await form.validateFields(['username'])
      
      const { exists = false } = await authApi.checkAccount({ data: { account: username } })
      setAccountExists(exists)
      return exists
    } catch {
      return false
    }
  }

  // Handle register
  const handleRegister = async () => {
    try {
      const values = await form.validateFields()
      setSubmitting(true)
      
      const exists = await checkAccount()
      if (exists) {
        message.warning(t('login.account_exists'))
        setSubmitting(false)
        return
      }

      await userStore.login({
        data: {
          username: values.username,
          password: values.password,
          verify_code: values.verification_code,
        },
        hideError: false,
      })

      const { list = [] } = await enterpriseStore.loadListData({ data: { status: 0 } })
      
      if (list.length > 0) {
        message.warning(t('login.apply_open_repetition'))
        setSubmitting(false)
        return
      }

      message.success(t('action_login_success'))
      form.resetFields()
      onLogin?.()
    } catch (error) {
      console.error('Register error:', error)
    } finally {
      setSubmitting(false)
    }
  }

  // Reset form
  const reset = () => {
    form.resetFields()
    setAccountExists(false)
    setIsAccountValid(false)
  }

  // Handle username type change
  const handleUsernameTypeChange = () => {
    form.setFieldValue('username', '')
    form.setFieldValue('verification_code', '')
    verificationCodeRef.current?.reset?.()
    form.resetFields(['username', 'verification_code'])
  }

  return (
    <Form
      form={form}
      layout="vertical"
      className="relative max-w-[440px] w-full"
      initialValues={{ username_type: 'mobile' }}
    >
      <h4 className="text-3xl text-primary font-bold text-center mb-10">
        {t('account_register')}
      </h4>

      {/* Account */}
      <Form.Item
        label={<span className="text-primary">{t('account')}</span>}
        name="username"
        className="relative"
        rules={[
          { required: true, message: t('login.mobile_placeholder') },
          ({ getFieldValue }) => ({
            validator(_, value) {
              const type = getFieldValue('username_type') || 'mobile'
              if (!value) return Promise.resolve()
              if (type === 'email' && !validateEmail(value)) {
                return Promise.reject(new Error(t('form.email_invalid')))
              }
              if (type === 'mobile' && !validateMobile(value)) {
                return Promise.reject(new Error(t('form.mobile_invalid')))
              }
              return Promise.resolve()
            },
          }),
        ]}
      >
        <Input
          size="large"
          style={{ height: 44 }}
          placeholder={t('login.mobile_placeholder')}
          autoComplete="new-username"
          onBlur={() => {
            checkAccountValidation()
            checkAccount()
          }}
          onChange={checkAccountValidation}
          allowClear
        />
      </Form.Item>
      
      {accountExists && (
        <div className="absolute -bottom-5 left-0 text-red-500 text-xs">
          {t('login.mobile_exists')}
          <Button type="link" size="small" className="!p-0 !bg-transparent -ml-1" onClick={onLogin}>
            {t('action_login')}
          </Button>
        </div>
      )}

      {/* Verification Code */}
      <Form.Item
        label={<span className="text-primary">{t('verification_code')}</span>}
        name="verification_code"
        className="relative mt-6"
        rules={[{ required: true, message: t('verification_code_placeholder') }]}
      >
        <VerificationCodeInput
          ref={verificationCodeRef}
          account={form.getFieldValue('username') || ''}
          accountType={form.getFieldValue('username_type') || 'mobile'}
          disabled={accountExists || !isAccountValid}
          maxlength={form.getFieldValue('username_type') === 'mobile' ? 4 : 6}
        />
      </Form.Item>

      {/* Password */}
      <Form.Item
        label={<span className="text-primary">{t('password')}</span>}
        name="password"
        className="relative"
        rules={[
          { required: true, message: t('login.password_placeholder') },
          { min: 8, max: 20, message: t('login.password_length') },
        ]}
      >
        <Input.Password
          size="large"
          style={{ height: 44 }}
          placeholder={t('login.password_placeholder')}
          autoComplete="new-password"
          allowClear
        />
      </Form.Item>

      {/* Submit Button */}
      <Form.Item shouldUpdate>
        {() => (
          <Button
            type="primary"
            shape="round"
            size="large"
            className="w-full mt-6 !h-10"
            loading={submitting}
            disabled={
              !form.getFieldValue('username') ||
              !form.getFieldValue('password') ||
              !form.getFieldValue('verification_code')
            }
            onClick={handleRegister}
          >
            {t('action_register')}
          </Button>
        )}
      </Form.Item>

      {/* Login Link */}
      <div className="w-full flex justify-center mt-4 text-sm text-disabled">
        {t('login.has_account')}
        <Button type="link" className="!p-0 !bg-transparent" onClick={onLogin}>
          {t('login.direct_login')}
        </Button>
      </div>
    </Form>
  )
}

export default RegisterForm