import React, { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react'
import { Modal, Button, message, Image } from 'antd'
import { CheckCircleFilled } from '@ant-design/icons'
import { QRCodeSVG } from 'qrcode.react'
import { subscriptionApi, setOrderCache } from '@/api/modules/subscription'
import { md5 } from '@km/shared-utils'
import { useUserStore } from '@/stores/modules/user'
import { PAYMENT_TYPE } from '@/constants/payment'
import paymentApi from '@/api/modules/payment'

interface PaymentQrcodeRef {
  open: () => Promise<void>
  close: () => void
}

interface PaymentQrcodeProps {
  onSuccess?: () => void
  activeSubscriptionInfo?: {
    group_id: string
    group_name: string
    month_info?: { amount: number; currency_symbol: string; time_unit: string }
    year_info?: { amount: number; currency_symbol: string; time_unit: string }
  }
  activeTimeInfo?: {
    amount: number
    currency: string
    currency_symbol: string
    time_unit: string
  }
  activePayment?: PaymentType
}

const PaymentQrcode = forwardRef<PaymentQrcodeRef, PaymentQrcodeProps>((props, ref) => {
  const { onSuccess, activeSubscriptionInfo, activeTimeInfo, activePayment } = props
  const userStore = useUserStore()

  // Use props or fallback to default values
  const subscriptionInfo = activeSubscriptionInfo || { group_id: '', group_name: '' }
  const timeInfo = activeTimeInfo || { amount: 0, currency: 'CNY', currency_symbol: '￥', time_unit: 'month' }
  const paymentType = activePayment || PAYMENT_TYPE.WECHAT

  const [visible, setVisible] = useState(false)
  const [loading, setLoading] = useState(false)
  const [payUrl, setPayUrl] = useState('')
  const [payDesc, setPayDesc] = useState('')
  const [successVisible, setSuccessVisible] = useState(false)
  const [orderInfo, setOrderInfo] = useState<any>({})
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const clearOrderStatusTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      clearOrderStatusTimer()
    }
  }, [clearOrderStatusTimer])

  const getOrderParams = () => {
    return {
      user_id: userStore.info?.user_id || '',
      nickname: userStore.info?.nickname || '',
      subscription_id: subscriptionInfo.group_id,
      subscription_name: subscriptionInfo.group_name,
      pay_type: paymentType,
      amount: Math.round(Number(timeInfo.amount || 0).toFixed(2) * 10000) / 100,
      currency: timeInfo.currency,
      duration: 1,
      time_unit: timeInfo.time_unit,
    }
  }

  const queryOrderStatus = useCallback(() => {
    return subscriptionApi
      .getOrderStatus({ order_id: orderInfo.payment_order_id })
      .then((data: any) => {
        // NOTPAY or SUCCESS
        if (data.originalStatus === 'SUCCESS') {
          setOrderCache({ key: md5(JSON.stringify(getOrderParams())), value: {} })
          clearOrderStatusTimer()
          setSuccessVisible(true)
        }
      })
  }, [orderInfo.payment_order_id, clearOrderStatusTimer])

  const startOrderStatusPolling = useCallback(() => {
    queryOrderStatus()
    clearOrderStatusTimer()
    timerRef.current = setInterval(() => {
      queryOrderStatus()
    }, 5000)
  }, [queryOrderStatus, clearOrderStatusTimer])

  const open = async () => {
    setPayUrl('')
    if (paymentType === PAYMENT_TYPE.ALIPAY) {
      await subscriptionApi.createOrder({
        params: getOrderParams(),
        return_url: window.location.href,
      })
      return
    }
    if (paymentType === PAYMENT_TYPE.WECHAT) {
      const order = await subscriptionApi.createOrder({
        params: getOrderParams(),
      })
      setOrderInfo(order)
      startOrderStatusPolling()
      setPayUrl(order.code_url)
    } else {
      const { pay_settings = [] } = await paymentApi.getPaymentConfig()
      const pay_setting = pay_settings.find((item: any) => item.pay_type === paymentType)
      let extra_config: any = {}
      try {
        extra_config = JSON.parse(pay_setting?.extra_config || '{}')
      } catch (err) {
        extra_config = {}
      }
      setPayUrl(extra_config.pay_qrcode || '')
      setPayDesc(extra_config.pay_desc || '')
    }
    setVisible(true)
    setLoading(false)
  }

  const close = () => {
    setVisible(false)
    clearOrderStatusTimer()
  }

  const paySuccess = async () => {
    setSuccessVisible(false)
    close()
    onSuccess?.()
  }

  const handlePayed = async () => {
    if (PAYMENT_TYPE.WECHAT !== paymentType) {
      const order = await subscriptionApi.createOrder({
        params: getOrderParams(),
      })
      setOrderInfo(order)
    }
    setSuccessVisible(true)
  }

  useImperativeHandle(ref, () => ({
    open,
    close,
  }))

  const t = (key: string) => {
    const translations: Record<string, string> = {
      'subscription.order_title': '订单支付',
      'subscription.pay_amount': '支付金额',
      'subscription.pay_by_wechat': '请使用微信扫码支付',
      'subscription.pay_policy': '支付即代表同意{policy}',
      'subscription.pay_confirm': '请在{type}转账后点击"已支付"按钮',
      'subscription.payed': '已支付',
      'subscription.pay_success': '支付成功',
      'subscription.manual_pay_success_title': '已提交',
      'subscription.manual_pay_success_desc': '我们将在确认收款后为您开通会员',
      'action.cancel': '取消',
      'action.ok_v2': '确定',
    }
    return translations[key] || key
  }

  return (
    <>
      <Modal
        open={visible}
        title={t('subscription.order_title')}
        width={640}
        onCancel={close}
        mask={{ closable: false }}
        destroyOnHidden
        footer={null}
      >
        <div className="flex flex-col items-center justify-center">
          <h4 className="text-sm text-[#4F5052]">{t('subscription.pay_amount')}</h4>
          <div className="mt-2 text-2xl font-bold text-[#3664EF]">
            <span className="text-base mr-1">
              {timeInfo.currency_symbol || '￥'}
            </span>
            <span>{Number(timeInfo.amount || 0).toFixed(2)}</span>
          </div>

          {PAYMENT_TYPE.WECHAT === paymentType ? (
            <>
              <div className="mt-3 w-[200px] h-[200px] rounded-lg flex items-center justify-center">
                {payUrl && <QRCodeSVG value={payUrl} size={180} level="H" />}
              </div>
              <div className="mt-3 text-lg text-[#2563EB]">{t('subscription.pay_by_wechat')}</div>
              <div
                className="mt-2 text-xs text-[#666666]"
                dangerouslySetInnerHTML={{
                  __html: t('subscription.pay_policy').replace(
                    '{policy}',
                    `<a style='color: #2F74FF;' href='#' target='_blank'>《隐私政策协议》</a>`
                  ),
                }}
              />
            </>
          ) : (
            <>
              <Image className="mt-3 size-[180px]" src={payUrl} preview={false} />
              {payDesc && (
                <div className="mt-3 text-base text-[#2563EB] text-center">{payDesc}</div>
              )}
            </>
          )}
        </div>

        {PAYMENT_TYPE.WECHAT === paymentType ? (
          <Button
            className="relative mt-8 mb-6 left-1/2 -translate-x-1/2 !px-8 !bg-[#F6F7F8] !text-[#333]"
            onClick={close}
          >
            {t('action.cancel')}
          </Button>
        ) : (
          <div className="mt-8 mb-6 flex items-center justify-center gap-2">
            <span className="text-sm text-[#4F5052]">{t('subscription.pay_confirm')}</span>
            <Button className="min-w-[90px]" type="primary" size="large" onClick={handlePayed}>
              {t('subscription.payed')}
            </Button>
          </div>
        )}
      </Modal>

      <Modal
        open={successVisible}
        centered
        width={420}
        mask={{ closable: false }}
        destroyOnHidden
        onCancel={paySuccess}
        footer={
          <Button className="mt-6 mb-6 !px-8" type="primary" size="large" onClick={paySuccess}>
            {t('action.ok_v2')}
          </Button>
        }
      >
        <div className="mt-8 flex flex-col items-center justify-center gap-4">
          <CheckCircleFilled style={{ fontSize: 58, color: '#3ABA52' }} />
          <span className="text-2xl text-black">
            {t(
              PAYMENT_TYPE.WECHAT === paymentType
                ? 'subscription.pay_success'
                : 'subscription.manual_pay_success_title'
            )}
          </span>
        </div>
        {PAYMENT_TYPE.WECHAT !== paymentType && (
          <div className="mt-4 text-sm text-[#999999] text-center">
            {t('subscription.manual_pay_success_desc')}
          </div>
        )}
      </Modal>
    </>
  )
})

PaymentQrcode.displayName = 'PaymentQrcode'

export default PaymentQrcode