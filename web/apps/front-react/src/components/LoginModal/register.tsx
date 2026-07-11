import { useState, useCallback, useRef } from 'react'
import { Form, Input, Button, message } from 'antd'
import { useUserStore } from '@/stores/modules/user'
import { useEmail } from '@/hooks/useEmail'
import { useMobile } from '@/hooks/useMobile'
import { useEnv } from '@/hooks/useEnv'
import userApi from '@/api/modules/user'
import { t } from '@/locales'

type RegisterWay = 'mobile' | 'email'

interface RegisterProps {
  openSMTP?: boolean
  onSuccess?: () => void
  onClose?: () => void
}

interface UsernameCache {
  exists: boolean
  timestamp: number
}

export function Register({ openSMTP = false, onSuccess, onClose }: RegisterProps) {
  const [form] = Form.useForm()
  const userStore = useUserStore()
  const { isOpLocalEnv } = useEnv()
  const { emailCodeCount, emailCodeRule, sendEmailCode } = useEmail()
  const { codeCount, codeRule, sendcode } = useMobile()

  const [registerWay, setRegisterWay] = useState<RegisterWay>(isOpLocalEnv ? 'email' : 'mobile')
  const [existingAccount, setExistingAccount] = useState(false)
  const [isRegister, setIsRegister] = useState(false)
  const [loading, setLoading] = useState(false)

  const usernameCacheRef = useRef(new Map<string, UsernameCache>())

  const registerWays = [
    { value: 'mobile' as RegisterWay, label: t('form.mobile') },
    { value: 'email' as RegisterWay, label: t('form.email') }
  ]

  const filteredRegisterWays = isOpLocalEnv
    ? registerWays.filter((way) => way.value === 'email')
    : registerWays

  const getCodeCount = registerWay === 'email' ? emailCodeCount : codeCount

  const getCodeRule = () => registerWay === 'email' ? emailCodeRule : codeRule

  const isFormatCorrect = useCallback((username: string) => {
    const patterns = {
      mobile: /^1[3-9]\d{9}$/,
      email: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
    }
    return patterns[registerWay].test(username)
  }, [registerWay])

  const checkUsername = async (username: string): Promise<boolean> => {
    if (!isFormatCorrect(username)) return false

    const cache = usernameCacheRef.current
    if (cache.has(username)) {
      const cachedResult = cache.get(username)!
      if (Date.now() - cachedResult.timestamp < 2 * 60 * 1000) {
        setIsRegister(!cachedResult.exists)
        return !cachedResult.exists
      }
    }

    try {
      const res = await userApi.checkUsername(username)
      const exists = res.data?.exists ?? false
      setIsRegister(!exists)
      cache.set(username, { exists, timestamp: Date.now() })
      return !exists
    } catch (error) {
      console.error('Failed to check username:', error)
      return false
    }
  }

  const handleGetCode = async () => {
    const username = form.getFieldValue('username')
    if (!username || !isFormatCorrect(username)) {
      message.warning(t('form.input_placeholder') + (registerWay === 'email' ? t('form.email') : t('form.mobile')))
      return
    }

    if (registerWay === 'email') {
      await sendEmailCode(username)
    } else {
      await sendcode(username)
    }
  }

  const handleSubmit = async () => {
    try {
      // 根据条件决定需要验证的字段
      const needVerifyCode = !isOpLocalEnv || (isOpLocalEnv && openSMTP)
      const fieldsToValidate = needVerifyCode
        ? ['username', 'verify_code', 'password']
        : ['username', 'password']

      const values = await form.validateFields(fieldsToValidate)
      setLoading(true)

      try {
        await userStore.register({
          username: values.username,
          password: values.password,
          verify_code: values.verify_code || ''
        })

        message.success(t('action.register') + t('status.success'))
        onSuccess?.()
      } catch (err) {
      }
    } catch (formError: any) {
      // 表单验证错误，antd 会自动显示
      console.error('Form validation error:', formError)
    } finally {
      setLoading(false)
    }
  }

  const handleRegisterWayChange = (way: RegisterWay) => {
    setRegisterWay(way)
    form.resetFields()
    setExistingAccount(false)
    setIsRegister(false)
  }

  const handleUsernameBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
    const username = e.target.value.trim()
    if (!username || !isFormatCorrect(username)) {
      setExistingAccount(false)
      return
    }

    const canRegister = await checkUsername(username)
    setExistingAccount(!canRegister)
  }

  const handleClose = () => {
    form.resetFields()
    setExistingAccount(false)
    setIsRegister(false)
    onClose?.()
  }

  return (
    <div>
      {/* Tab Header */}
      <div className="flex justify-center gap-10 mt-5">
        {filteredRegisterWays.map((way, index) => (
          <Button
            key={way.value}
            type="text"
            className={`bg-transparent border-0 rounded-none px-0 ${
              index === 1 ? 'ml-7.5' : ''
            }`}
            onClick={() => handleRegisterWayChange(way.value)}
          >
            <h4
              className={`text-xl mb-3 ${
                registerWay === way.value
                  ? 'text-[#1D1E1F] font-bold'
                  : 'text-[#94959B]'
              }`}
            >
              {way.label}{t('action.register')}
            </h4>
          </Button>
        ))}
      </div>

      {/* Form */}
      <Form
        form={form}
        layout="vertical"
        className="px-2 mt-7"
      >
        <Form.Item
          label={registerWay === 'email' ? t('form.email') : t('form.mobile')}
          name="username"
          rules={[
            { required: true, message: t('form.input_placeholder') + (registerWay === 'email' ? t('form.email') : t('form.mobile')) },
            {
              pattern: registerWay === 'email'
                ? /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
                : /^1[3-9]\d{9}$/,
              message: t('form.input_placeholder') + (registerWay === 'email' ? t('form.email') : t('form.mobile'))
            }
          ]}
          help={existingAccount && (
            <div className="text-xs text-[#f56c6c]">
              {t(`form.existing_${registerWay}`)}
              <button type="button" className="text-xs text-[#2563EB] underline ml-1" onClick={handleClose}>
                {t('action.login')}
              </button>
            </div>
          )}
        >
          <Input
            size="large"
            placeholder={t('form.input_placeholder') + (registerWay === 'email' ? t('form.email') : t('form.mobile'))}
            onBlur={handleUsernameBlur}
            allowClear
          />
        </Form.Item>

        {(!isOpLocalEnv || (isOpLocalEnv && openSMTP)) && (
          <Form.Item
            label={t('form.verify_code')}
            name="verify_code"
            rules={[
              { required: true, message: t('form.input_placeholder') + t('form.verify_code') },
              getCodeRule()
            ]}
          >
            <Input
              size="large"
              placeholder={t('form.input_placeholder') + t('form.verify_code')}
              addonAfter={
                <Button
                  type="link"
                  disabled={!isRegister || getCodeCount > 0}
                  onClick={handleGetCode}
                >
                  <span className={isRegister && getCodeCount === 0 ? 'text-[#2563EB]' : 'text-[#9A9A9A]'}>
                    {getCodeCount > 0 ? `${getCodeCount}s` : t('form.get_verify_code')}
                  </span>
                </Button>
              }
            />
          </Form.Item>
        )}

        {/* 隐藏字段：op-local 无 SMTP 时不需要验证码，添加空值默认 */}
        {isOpLocalEnv && !openSMTP && (
          <Form.Item name="verify_code" hidden initialValue="">
            <Input type="hidden" />
          </Form.Item>
        )}

        <Form.Item
          label={t('form.password')}
          name="password"
          rules={[
            { required: true, message: t('form.input_placeholder') + t('form.password') },
            { min: 8, max: 20, message: t('form.password_length') }
          ]}
        >
          <Input.Password
            size="large"
            placeholder={t('form.input_placeholder') + t('form.password')}
          />
        </Form.Item>

        {/* Already have account */}
        <div className="flex justify-end items-center">
          <span className="text-[#9A9A9A]">{t('status.existing_account')},</span>
          <Button type="link" className="!px-0" onClick={handleClose}>
            {t('action.login_directly')}
          </Button>
        </div>

        {/* Register Button */}
        <Button
          type="primary"
          size="large"
          block
          shape="round"
          className="mt-5 h-10"
          onClick={handleSubmit}
          loading={loading}
        >
          {t('action.register')}
        </Button>

        {/* Terms */}
        <div className="text-xs text-[#9A9A9A] text-center mt-5">
          {t('register.agree')}
          <a className="text-[#4F5052] cursor-pointer underline"> {t('register.terms_of_service')} </a>
          {t('action.and')}
          <a className="text-[#4F5052] cursor-pointer underline"> {t('register.privacy_policy')}</a>
        </div>
      </Form>
    </div>
  )
}

export default Register
