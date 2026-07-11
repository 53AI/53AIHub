import { Button, Form, Input, Steps, message } from 'antd'
import { CheckCircleFilled } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import { t } from '@/locales'
import { useUserStore, useEnterpriseStore } from '@/stores'

interface ApplyFormProps {
  onLogin?: () => void
}

interface FormValues {
  website_name: string
  contact_name: string
}

export function ApplyForm({ onLogin }: ApplyFormProps) {
  
  const [form] = Form.useForm<FormValues>()
  const userStore = useUserStore()
  const enterpriseStore = useEnterpriseStore()

  const [activeStep, setActiveStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(false)

  // Load existing application status
  useEffect(() => {
    const loadData = async () => {
      const { access_token } = userStore.info
      if (access_token) {
        setLoading(true)
        try {
          const { list = [] } = await enterpriseStore.loadListData({ data: { status: 0 } })
          if (list.length > 0) {
            setActiveStep(1)
          }
        } finally {
          setLoading(false)
        }
      }
      // Clear login_type from localStorage
      localStorage.removeItem('login_type')
    }
    loadData()
  }, [])

  // Handle next step
  const handleNextStep = async () => {
    try {
      const values = await form.validateFields()
      
      if (activeStep === 0) {
        setSubmitting(true)
        try {
          await enterpriseStore.apply({
            data: {
              contact_name: values.contact_name,
              enterprise_name: values.website_name,
              phone: userStore.info.username,
              email: '',
            },
          })
          message.success(t('apply.create_success'))
          onLogin?.()
        } finally {
          setSubmitting(false)
        }
      }
    } catch (error) {
      console.error('Apply error:', error)
    }
  }

  // Reset form
  const reset = () => {
    form.resetFields()
  }

  const steps = [
    t('module.website_info'),
    t('apply.waiting_audit'),
    t('apply.create_success'),
  ]

  return (
    <Form
      form={form}
      layout="vertical"
      className="relative max-w-[440px] w-full"
    >
      <h4 className="text-3xl text-primary font-bold text-center mb-10">
        {t('apply.create_site')}
      </h4>

      {/* Steps - hidden for now as backend auto-approves */}
      {false && (
        <Steps
          current={activeStep}
          className="mb-8"
          items={steps.map((label, index) => ({
            title: (
              <span
                className={
                  index < activeStep
                    ? 'text-[#B3C7FA]'
                    : index === activeStep
                      ? 'text-brand'
                      : 'text-disabled'
                }
              >
                {label}
              </span>
            ),
            icon: (
              <div className="w-9 h-9 bg-[#F2F3F3] rounded-full flex items-center justify-center">
                <div
                  className={`w-7 h-7 rounded-full text-white text-sm flex items-center justify-center ${
                    index < activeStep
                      ? 'bg-[#82A2F7]'
                      : index === activeStep
                        ? 'bg-[#3664F0]'
                        : 'bg-[#CFD1D6]'
                  }`}
                >
                  {index + 1}
                </div>
              </div>
            ),
          }))}
        />
      )}

      {activeStep === 0 && (
        <>
          {/* Website Name */}
          <Form.Item
            label={<span className="text-primary">{t('login.website_name')}</span>}
            name="website_name"
            rules={[{ required: true, message: t('login.website_name_placeholder') }]}
          >
            <Input
              size="large"
              style={{ height: 44 }}
              placeholder={t('login.website_name_placeholder')}
              allowClear
            />
          </Form.Item>

          {/* Contact Name */}
          <Form.Item
            label={<span className="text-primary">{t('login.contact_name')}</span>}
            name="contact_name"
            rules={[{ required: true, message: t('login.contact_name_placeholder') }]}
          >
            <Input
              size="large"
              style={{ height: 44 }}
              placeholder={t('login.contact_name_placeholder')}
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
                disabled={!form.getFieldValue('website_name') || !form.getFieldValue('contact_name')}
                onClick={handleNextStep}
              >
                {t('action_confirm')}
              </Button>
            )}
          </Form.Item>
        </>
      )}

      {activeStep === 1 && (
        <div className="h-[424px] p-10 box-border bg-[#EFF9FF] rounded-lg flex flex-col items-center justify-center text-center">
          <div className="flex items-center justify-center gap-2">
            <CheckCircleFilled style={{ color: '#4CBF65', fontSize: 28 }} />
            <span className="text-primary text-2xl font-bold">{t('apply.waiting_audit')}</span>
          </div>
          <div className="text-tertiary text-sm mt-4">
            {t('apply_success_desc')}
          </div>
          <img
            className="w-[148px] object-contain mt-14"
            src="//chat.53ai.com/images/upgrade-qrcode.png"
            alt="QR Code"
          />
        </div>
      )}

      {/* Back to Login */}
      <Button
        type="link"
        className="!p-0 mt-4 !mx-auto block !bg-transparent"
        onClick={onLogin}
      >
        {t('login.back_to_login')}
      </Button>
    </Form>
  )
}

export default ApplyForm