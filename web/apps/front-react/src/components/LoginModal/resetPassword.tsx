import { useState, useEffect, forwardRef, useImperativeHandle } from 'react'
import { Form, Input, Button, Radio, message } from 'antd'
import { useUserStore } from '@/stores/modules/user'
import { useEmail } from '@/hooks/useEmail'
import { useMobile } from '@/hooks/useMobile'
import { useEnv } from '@/hooks/useEnv'
import { t } from '@/locales'

interface ResetPasswordProps {
  onSuccess?: () => void
}

export interface ResetPasswordRef {
  resetForm: () => void
}

const ResetPassword = forwardRef<ResetPasswordRef, ResetPasswordProps>(({ onSuccess }, ref) => {
  const [form] = Form.useForm()
  const userStore = useUserStore()
  const { isOpLocalEnv } = useEnv()
  const { emailCodeRule, sendEmailCode, emailCodeCount } = useEmail()
  const { sendcode, codeRule, codeCount } = useMobile()

  const [verifyWay, setVerifyWay] = useState<'email_verify' | 'mobile_verify'>(
    userStore.info?.email ? 'email_verify' : 'mobile_verify'
  )
  const [isSending, setIsSending] = useState(false)

  const getCodeRules = () => {
    return verifyWay === 'email_verify' ? emailCodeRule : codeRule
  }

  const getCodeCount = () => {
    return verifyWay === 'email_verify' ? emailCodeCount : codeCount
  }

  const handleGetCode = () => {
    const target = verifyWay === 'email_verify' ? userStore.info?.email : userStore.info?.mobile
    if (verifyWay === 'email_verify') {
      sendEmailCode(target || '')
    } else {
      sendcode(target || '')
    }
    setIsSending(Boolean(getCodeCount()))
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()

      const resetData = {
        verify_code: values.verify_code,
        new_password: values.new_password,
        confirm_password: values.confirm_password
      }

      if (verifyWay === 'email_verify') {
        await userStore.reset_password({
          email: userStore.info?.email,
          ...resetData
        })
      } else {
        await userStore.reset_password({
          mobile: userStore.info?.mobile,
          ...resetData
        })
      }

      message.success(t('status.update_success'))
      onSuccess?.()
      resetForm()
    } catch (error) {
      message.error(t('status.update_fail'))
    }
  }

  const resetForm = () => {
    form.resetFields()
    form.setFieldsValue({
      verify_code: '',
      new_password: '',
      confirm_password: ''
    })
  }

  const handleVerifyWayChange = (e: any) => {
    setVerifyWay(e.target.value)
    resetForm()
  }

  useImperativeHandle(ref, () => ({
    resetForm
  }))

  // Watch code countdown
  useEffect(() => {
    setIsSending(emailCodeCount > 0 || codeCount > 0)
  }, [emailCodeCount, codeCount])

  return (
    <>
      {!isOpLocalEnv && (
        <div className="mb-2">
          <h3>{t('form.reset_password_method')}</h3>
          <Radio.Group value={verifyWay} onChange={handleVerifyWayChange}>
            <Radio value="email_verify" disabled={!userStore.info?.email}>
              {t('form.email_verify')}
            </Radio>
            <Radio value="mobile_verify" disabled={!userStore.info?.mobile}>
              {t('form.mobile_verify')}
            </Radio>
          </Radio.Group>
        </div>
      )}

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
      >
        <Form.Item
          label={t('form.verify_code')}
          name="verify_code"
          rules={[{ required: true, message: t('form.input_placeholder') + t('form.verify_code') }]}
        >
          <div className="flex items-center w-full">
            <Input
              size="large"
              className="md:min-w-80 flex-1"
              placeholder={t('form.input_placeholder') + t('form.verify_code')}
              addonAfter={
                <Button
                  disabled={isSending}
                  className="w-29"
                  onClick={handleGetCode}
                >
                  <span className={isSending ? 'text-[#9A9A9A]' : 'text-[#2563EB]'}>
                    {getCodeCount() ? `${getCodeCount()}s` : t('form.get_verify_code')}
                  </span>
                </Button>
              }
            />
          </div>
        </Form.Item>

        <Form.Item
          label={t('form.new_password')}
          name="new_password"
          rules={[
            { required: true, message: t('form.new_password_placeholder') },
            { min: 8, max: 20, message: t('form.password_length') }
          ]}
        >
          <Input.Password
            size="large"
            placeholder={t('form.new_password_placeholder')}
          />
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
          <Input.Password
            size="large"
            placeholder={t('form.new_password_confirm_placeholder')}
          />
        </Form.Item>

        <Button
          type="primary"
          size="large"
          block
          shape="round"
          className="mt-3 h-10"
          htmlType="submit"
        >
          {t('action.update_password')}
        </Button>
      </Form>
    </>
  )
})

ResetPassword.displayName = 'ResetPassword'

export default ResetPassword
