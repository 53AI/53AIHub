import { Modal, Form, Select, InputNumber, Radio, Button, message, Spin } from 'antd'
import { useState, useMemo, forwardRef, useImperativeHandle, useRef, useEffect } from 'react'
import { t } from '@/locales'
import { orderApi } from '@/api/modules/order'
import { subscriptionApi } from '@/api/modules/subscription'
import { useUserStore } from '@/stores'

interface FormData {
  user_id: string | number
  subscription_id: string | number
  subscription_duration: number
  subscription_unit: string
  amount: number | null
}

interface OriginData {
  id?: string
  user_id?: number
  nickname?: string
  service_id?: string
  duration?: number
  time_unit?: string
  amount?: number
  currency?: string
}

export interface AddDialogRef {
  open: (params: { data?: OriginData }) => void
  close: () => void
  reset: () => void
}

interface AddDialogProps {
  onSuccess: () => void
}

export const AddDialog = forwardRef<AddDialogRef, AddDialogProps>(
  function AddDialog({ onSuccess }, ref) {
    const userStore = useUserStore()
    const [form] = Form.useForm<FormData>()
    const [visible, setVisible] = useState(false)
    const [editable, setEditable] = useState(false)
    const [loading, setLoading] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [userOptions, setUserOptions] = useState<{ value: number; label: string }[]>([])
    const [subscriptionOptions, setSubscriptionOptions] = useState<any[]>([])
    const originDataRef = useRef<OriginData>({})

    const subscriptionUnitOptions = [
      { value: 'month', label: t('month') },
      { value: 'year', label: t('year') },
    ]

    const subscriptionId = Form.useWatch('subscription_id', form)
    const subscriptionUnit = Form.useWatch('subscription_unit', form)
    const userId = Form.useWatch('user_id', form)

    const activeSubscriptionOption = useMemo(() => {
      return subscriptionOptions.find(item => item.group_id === subscriptionId) || {}
    }, [subscriptionOptions, subscriptionId])

    const activeTimeOption = useMemo(() => {
      const { month_info = {}, year_info = {} } = activeSubscriptionOption
      return subscriptionUnit === 'month' ? month_info : year_info
    }, [activeSubscriptionOption, subscriptionUnit])

    const activeUserOption = useMemo(() => {
      return userOptions.find(item => item.value === userId) || {}
    }, [userOptions, userId])

    // 计算金额
    const computedAmountValue = useMemo(() => {
      const { amount = 0 } = activeTimeOption
      const duration = form.getFieldValue('subscription_duration') || 1
      return Number(Number(amount) * duration)
    }, [activeTimeOption, form])

    // 订阅版本选项
    const subscriptionRadioOptions = useMemo(() => {
      return subscriptionOptions.map(item => ({
        value: item.group_id,
        label: item.group_name,
      }))
    }, [subscriptionOptions])

    // 设置默认订阅版本
    useEffect(() => {
      if (subscriptionOptions.length > 0 && !subscriptionId) {
        const firstOption = subscriptionOptions[0]
        form.setFieldValue('subscription_id', firstOption.group_id)
        // 设置默认金额
        const timeInfo = firstOption.month_info || {}
        const amount = timeInfo.amount || 0
        form.setFieldValue('amount', Number(amount))
      }
    }, [subscriptionOptions, subscriptionId, form])

    const open = async ({ data = {} } = {}) => {
      setEditable(!!data.id)
      originDataRef.current = data
      setVisible(true)
      setLoading(true)

      try {
        await Promise.all([fetchUserData(), fetchSubscriptionData()])
      } catch {
        setLoading(false)
      }

      if (data.id) {
        form.setFieldsValue({
          user_id: data.user_id || '',
          subscription_id: data.service_id || '',
          subscription_duration: Number(data.duration) || 1,
          subscription_unit: data.time_unit || 'month',
          amount: data.amount ? Number((Number(data.amount) / 100).toFixed(2)) : null,
        })
        originDataRef.current = data
      } else {
        // 新建模式设置默认值
        form.setFieldsValue({
          user_id: '',
          subscription_id: '',
          subscription_duration: 1,
          subscription_unit: 'month',
          amount: null,
        })
      }
      setLoading(false)
    }

    const close = () => {
      setVisible(false)
      reset()
    }

    const reset = () => {
      form.resetFields()
      form.setFieldsValue({
        user_id: '',
        subscription_id: '',
        subscription_duration: 1,
        subscription_unit: 'month',
        amount: null,
      })
    }

    const handleConfirm = async () => {
      try {
        const values = await form.validateFields()
        const data: Record<string, any> = {
          id: originDataRef.current.id,
          user_id: values.user_id,
          nickname: activeUserOption.label,
          subscription_id: values.subscription_id,
          subscription_name: activeSubscriptionOption.group_name,
          time_unit: values.subscription_unit,
          duration: values.subscription_duration,
          currency: activeTimeOption.currency,
          amount: Number(values.amount * 100),
        }
        if (editable) {
          data.user_id = originDataRef.current.user_id
          data.nickname = originDataRef.current.nickname
        }
        setSubmitting(true)
        await orderApi.save(data).finally(() => {
          setSubmitting(false)
        })
        message.success(t('action_save_success'))
        close()
        onSuccess()
      } catch (error) {
        console.error('Save order error:', error)
      }
    }

    const fetchUserData = async () => {
      if (userOptions.length) return Promise.resolve()
      const { list = [] } = await userStore.loadListData({ data: { limit: 1000 } })
      setUserOptions(list.map((item: any) => ({
        value: +item.user_id || 0,
        label: item.nickname || '',
      })))
    }

    const fetchSubscriptionData = async () => {
      if (subscriptionOptions.length) return Promise.resolve()
      const list = await subscriptionApi.list({ params: { limit: 1000 } })
      setSubscriptionOptions(list)
    }

    const handleSubscriptionChange = () => {
      setTimeout(() => {
        const currentUnit = form.getFieldValue('subscription_unit')
        const currentSubscriptionId = form.getFieldValue('subscription_id')
        const currentOption = subscriptionOptions.find(item => item.group_id === currentSubscriptionId) || {}
        const timeInfo = currentUnit === 'month' ? currentOption.month_info : currentOption.year_info
        const { amount = 0 } = timeInfo || {}
        const duration = form.getFieldValue('subscription_duration') || 1
        form.setFieldValue('amount', Number(Number(amount) * duration))
      }, 0)
    }

    const handleDurationChange = () => {
      const { amount = 0 } = activeTimeOption
      const duration = form.getFieldValue('subscription_duration') || 1
      form.setFieldValue('amount', Number(Number(amount) * duration))
    }

    const handleUnitChange = () => {
      const currentUnit = form.getFieldValue('subscription_unit')
      const currentSubscriptionId = form.getFieldValue('subscription_id')
      const currentOption = subscriptionOptions.find(item => item.group_id === currentSubscriptionId) || {}
      const timeInfo = currentUnit === 'month' ? currentOption.month_info : currentOption.year_info
      const { amount = 0 } = timeInfo || {}
      const duration = form.getFieldValue('subscription_duration') || 1
      form.setFieldValue('amount', Number(Number(amount) * duration))
    }

    useImperativeHandle(ref, () => ({
      open,
      close,
      reset,
    }))

    return (
      <Modal
        open={visible}
        title={t(editable ? 'action_edit' : 'action_add')}
        onCancel={close}
        width={700}
        destroyOnHidden
        mask={{ closable: false }}
        footer={[
          <Button key="cancel" type="default" onClick={close}>
            {t('action_cancel')}
          </Button>,
          <Button key="confirm" type="primary" loading={submitting} onClick={handleConfirm}>
            {t('action_confirm')}
          </Button>,
        ]}
      >
        <Form form={form} layout="vertical">
          <Spin spinning={loading}>
            <Form.Item
              label={t('user')}
              name="user_id"
              rules={[
                {
                  validator: (_, value) => {
                    if (!value) return Promise.reject(new Error(t('form_select_placeholder') + t('user')))
                    return Promise.resolve()
                  },
                },
              ]}
            >
              {editable ? (
                <Select
                  disabled
                  options={[{ label: originDataRef.current.nickname, value: originDataRef.current.user_id }]}
                />
              ) : (
                <Select
                  showSearch
                  allowClear
                  filterOption={(input, option) => (option?.label ?? '').toString().includes(input)}
                  options={userOptions}
                  placeholder={t('form_select_placeholder') + t('user')}
                />
              )}
            </Form.Item>
            <Form.Item label={t('order_subscription_version')} name="subscription_id">
              <Radio.Group
                options={subscriptionRadioOptions}
                onChange={handleSubscriptionChange}
              />
            </Form.Item>
            <Form.Item label={t('order_subscription_duration')}>
              <div className="flex items-center">
                <Form.Item name="subscription_duration" noStyle>
                  <InputNumber
                    min={1}
                    controls={false}
                    className="!w-[108px] mr-4"
                    placeholder={t('form_input_placeholder')}
                    onChange={handleDurationChange}
                    styles={{ input: { textAlign: 'left' } }}
                  />
                </Form.Item>
                <Form.Item name="subscription_unit" noStyle>
                  <Radio.Group
                    options={subscriptionUnitOptions}
                    onChange={handleUnitChange}
                  />
                </Form.Item>
              </div>
            </Form.Item>
            <Form.Item label={t('order_amount')}>
              <div className="flex">
                <div className="border border-[#DCDFE6] border-r-0 h-8 px-5 rounded-s flex items-center justify-center">
                  {activeTimeOption.currency || 'CNY'}
                </div>
                <Form.Item
                  name="amount"
                  noStyle
                  rules={[
                    {
                      validator: (_, value) => {
                        if (!value || value <= 0) {
                          return Promise.reject(new Error(t('form_input_placeholder')))
                        }
                        return Promise.resolve()
                      },
                    },
                  ]}
                >
                  <InputNumber
                    min={0.01}
                    precision={2}
                    controls={false}
                    className="flex-1 amount-input"
                    placeholder={t('form_input_placeholder')}
                    style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
                    styles={{ input: { textAlign: 'left' } }}
                  />
                </Form.Item>
              </div>
            </Form.Item>
          </Spin>
        </Form>
      </Modal>
    )
  }
)

export default AddDialog
