import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import { Modal, Button, Image } from 'antd'
import { CheckCircleFilled } from '@ant-design/icons'
import { QRCodeSVG } from 'qrcode.react'
import { subscriptionApi, setOrderCache } from '@/api/modules/subscription'
import { useUserStore } from '@/stores/modules/user'
import { PAYMENT_TYPE } from '@/constants/payment'
import paymentApi from '@/api/modules/payment'
import { useSubscriptionContext } from './context'
import { md5 } from '@km/shared-utils'

export interface PaymentQrcodeRef {
  open: () => Promise<void>
  close: () => void
}

interface PaymentQrcodeProps {
  onSuccess?: () => void
}

export const PaymentQrcode = forwardRef<PaymentQrcodeRef, PaymentQrcodeProps>(
  ({ onSuccess }, ref) => {
    const userStore = useUserStore()
    const { activeSubscriptionInfo, activeTimeInfo, activePayment } = useSubscriptionContext()

    const [visible, setVisible] = useState(false)
    const [loading, setLoading] = useState(false)
    const [payUrl, setPayUrl] = useState('')
    const [payDesc, setPayDesc] = useState('')
    const [successVisible, setSuccessVisible] = useState(false)
    const [orderInfo, setOrderInfo] = useState<any>({})

    const timerRef = useRef<NodeJS.Timeout | null>(null)

    const getOrderParams = () => ({
      user_id: userStore.info.user_id,
      nickname: userStore.info.nickname,
      subscription_id: activeSubscriptionInfo?.group_id,
      subscription_name: activeSubscriptionInfo?.group_name,
      pay_type: activePayment,
      amount: Math.round(Number(activeTimeInfo?.amount || 0).toFixed(2) * 10000) / 100,
      currency: activeTimeInfo?.currency,
      duration: 1,
      time_unit: activeTimeInfo?.time_unit,
    })

    const open = async () => {
      setPayUrl('')

      if (activePayment === PAYMENT_TYPE.ALIPAY) {
        await subscriptionApi.createOrder({
          params: getOrderParams(),
          return_url: window.location.href,
        })
        return
      }

      if (activePayment === PAYMENT_TYPE.WECHAT) {
        const order = await subscriptionApi.createOrder({
          params: getOrderParams(),
        })
        setOrderInfo(order)
        queryOrderStatus()
        setPayUrl(order.code_url)
      } else {
        const { pay_settings = [] } = await paymentApi.getPaymentConfig()
        const paySetting = pay_settings.find((item: any) => item.pay_type === activePayment)
        let extraConfig: any = {}
        try {
          extraConfig = JSON.parse(paySetting?.extra_config || '{}')
        } catch {
          extraConfig = {}
        }
        setPayUrl(extraConfig.pay_qrcode || '')
        setPayDesc(extraConfig.pay_desc || '')
      }

      setVisible(true)
      setLoading(false)
    }

    const close = () => {
      setVisible(false)
      clearOrderStatusTimer()
    }

    const queryOrderStatus = () => {
      getOrderStatus()
      clearOrderStatusTimer()
      timerRef.current = setInterval(() => {
        getOrderStatus()
      }, 5000)
    }

    const clearOrderStatusTimer = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }

    const getOrderStatus = () => {
      return subscriptionApi
        .getOrderStatus({ order_id: orderInfo.payment_order_id })
        .then((data: any) => {
          if (data.originalStatus === 'SUCCESS') {
            setOrderCache({ key: md5(JSON.stringify(getOrderParams())), value: {} })
            clearOrderStatusTimer()
            setSuccessVisible(true)
          }
        })
    }

    const paySuccess = () => {
      setSuccessVisible(false)
      close()
      onSuccess?.()
    }

    const handlePayed = async () => {
      if (PAYMENT_TYPE.WECHAT !== activePayment) {
        const order = await subscriptionApi.createOrder({
          params: getOrderParams(),
        })
        setOrderInfo(order)
      }
      setSuccessVisible(true)
    }

    useEffect(() => {
      return () => {
        clearOrderStatusTimer()
      }
    }, [])

    useImperativeHandle(ref, () => ({
      open,
      close,
    }))

    return (
      <>
        <Modal
          open={visible}
          title="订单支付"
          onCancel={close}
          footer={null}
          mask={{ closable: false }}
          width={640}
          destroyOnHidden
        >
          <div className="flex flex-col items-center justify-center">
            <h4 className="text-sm text-[#4F5052]">支付金额</h4>
            <div className="mt-2 text-2xl font-bold text-[#3664EF]">
              <span className="text-base mr-1">{activeTimeInfo?.currency_symbol || '¥'}</span>
              <span>{Number(activeTimeInfo?.amount || 0).toFixed(2)}</span>
            </div>

            {activePayment === PAYMENT_TYPE.WECHAT ? (
              <>
                <div className="mt-3 w-[200px] h-[200px] rounded-lg flex items-center justify-center">
                  {payUrl && <QRCodeSVG value={payUrl} size={180} level="H" />}
                </div>
                <div className="mt-3 text-lg text-primary">微信扫码支付</div>
                <div className="mt-2 text-xs text-[#666666]">
                  支付即表示同意
                  <a href="#" target="_blank" rel="noopener noreferrer" className="text-[#2F74FF]">
                    《隐私政策协议》
                  </a>
                </div>
                <Button className="mt-8 mb-6" onClick={close}>
                  取消
                </Button>
              </>
            ) : (
              <>
                <Image className="mt-3 size-[180px]" src={payUrl} />
                {payDesc && (
                  <div className="mt-3 text-base text-primary text-center">{payDesc}</div>
                )}
                <div className="mt-8 mb-6 flex items-center justify-center gap-2">
                  <span className="text-sm text-gray-500">支付完成后请确认</span>
                  <Button type="primary" size="large" onClick={handlePayed}>
                    已支付
                  </Button>
                </div>
              </>
            )}
          </div>
        </Modal>

        <Modal
          open={successVisible}
          onCancel={paySuccess}
          footer={null}
          centered
          width={420}
          mask={{ closable: false }}
          destroyOnHidden
        >
          <div className="mt-8 flex flex-col items-center justify-center gap-4">
            <CheckCircleFilled style={{ fontSize: 58, color: '#3ABA52' }} />
            <span className="text-2xl text-black">
              {activePayment === PAYMENT_TYPE.WECHAT ? '支付成功' : '申请已提交'}
            </span>
          </div>
          {activePayment !== PAYMENT_TYPE.WECHAT && (
            <div className="mt-4 text-sm text-gray-400 text-center">
              请等待管理员审核
            </div>
          )}
          <div className="mt-6 mb-6 flex justify-center">
            <Button type="primary" size="large" onClick={paySuccess}>
              确定
            </Button>
          </div>
        </Modal>
      </>
    )
  }
)

export default PaymentQrcode
