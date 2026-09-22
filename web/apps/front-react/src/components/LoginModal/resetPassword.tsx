import { useState, forwardRef, useImperativeHandle } from 'react'
import { Form, Input, Button, Radio, message } from 'antd'
import { useUserStore } from '@/stores/modules/user'
import { useEmail } from '@/hooks/useEmail'
import { useMobile } from '@/hooks/useMobile'
import { useEnv } from '@/hooks/useEnv'
import { t } from '@/locales'
import { noSpaceKeydownHandler } from '@km/shared-utils'
import { usePasswordRules } from '@/hooks/usePasswordPolicy'
import VerifyCodeField from '@/components/VerifyCodeField'

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
  const { emailCodeRule, sendEmailCode, emailCodeCount, emailSending } = useEmail()
  const { sendcode, codeRule, codeCount, sending } = useMobile()
  const { passwordRule } = usePasswordRules()

  const [verifyWay, setVerifyWay] = useState<'email_verify' | 'mobile_verify'>(
    userStore.info?.email ? 'email_verify' : 'mobile_verify'
  )

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
        <VerifyCodeField
          name="verify_code"
          rule={getCodeRules()}
          count={getCodeCount()}
          loading={verifyWay === 'email_verify' ? emailSending : sending}
          onClick={handleGetCode}
          size="large"
        />

        <Form.Item
          label={t('form.new_password')}
          name="new_password"
          rules={[
            { required: true, message: t('form.new_password_placeholder') },
            passwordRule
          ]}
        >
          <Input.Password
            size="large"
            placeholder={t('form.new_password_placeholder')}
            onKeyDown={noSpaceKeydownHandler}
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
                return Promise.reject(new Error(t('form.password_not_match')))
              }
            })
          ]}
        >
          <Input.Password
            size="large"
            placeholder={t('form.new_password_confirm_placeholder')}
            onKeyDown={noSpaceKeydownHandler}
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
