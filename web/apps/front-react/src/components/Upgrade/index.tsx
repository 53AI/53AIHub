import { useState, useMemo, useRef, forwardRef, useImperativeHandle, useEffect } from 'react'
import { Modal, Button, Divider, Radio, message, Avatar } from 'antd'
import {
  CloseOutlined,
  LeftOutlined,
  RightOutlined,
  ArrowUpOutlined,
} from '@ant-design/icons'
import PaymentQrcode, { PaymentQrcodeRef } from './payment-qrcode'
import subscriptionApi from '@/api/modules/subscription'
import { PAYMENT_TYPE, PAYMENT_TYPE_LABEL_MAP, type PaymentType } from '@/constants/payment'
import paymentApi from '@/api/modules/payment'
import { useUserStore } from '@/stores/modules/user'
import { getPublicPath } from '@/utils/config'
import { SubscriptionContext, type SubscriptionOption } from './context'
import { t } from '@/locales'
import './upgrade.css'

// Re-export the hook
export { useSubscriptionContext } from './context'

export interface UpgradeRef {
  open: () => Promise<void>
  close: () => void
  validateUpgrade: () => Promise<boolean>
}

interface UpgradeProps {
  onSuccess?: () => void
}

export const Upgrade = forwardRef<UpgradeRef, UpgradeProps>(({ onSuccess }, ref) => {
  const userStore = useUserStore()
  const paymentQrcodeRef = useRef<PaymentQrcodeRef>(null)
  const scrollbarRef = useRef<HTMLDivElement>(null)

  const [visible, setVisible] = useState(false)
  const [loading, setLoading] = useState(false)
  const [subscriptionOptions, setSubscriptionOptions] = useState<SubscriptionOption[]>([])
  const [activeGroupId, setActiveGroupId] = useState<string | number>('')
  const [activeTimeUnit, setActiveTimeUnit] = useState('month')
  const [scrollLeft, setScrollLeft] = useState(0)
  const [scrollLeftLimit, setScrollLeftLimit] = useState(0)
  const [scrollLeftDistance, setScrollLeftDistance] = useState(0)
  const [activePayment, setActivePayment] = useState<PaymentType>(PAYMENT_TYPE.WECHAT)
  const [paymentOptions, setPaymentOptions] = useState<{ pay_type: PaymentType; label: string }[]>([])
  const [displayPaymentDetail, setDisplayPaymentDetail] = useState(false)

  const isSingleOption = subscriptionOptions.length <= 1

  const activeSubscriptionInfo = useMemo(
    () => subscriptionOptions.find((item) => item.group_id === activeGroupId) || null,
    [subscriptionOptions, activeGroupId]
  )

  const activeTimeInfo = useMemo(
    () => (activeSubscriptionInfo as any)?.[`${activeTimeUnit}_info`] || null,
    [activeSubscriptionInfo, activeTimeUnit]
  )

  const payDisabled = useMemo(
    () => !Number(activeTimeInfo?.amount || 0),
    [activeTimeInfo]
  )

  const contextValue = useMemo(
    () => ({
      activeSubscriptionInfo,
      activeTimeInfo,
      activePayment,
    }),
    [activeSubscriptionInfo, activeTimeInfo, activePayment]
  )

  const open = async () => {
    setVisible(true)
    setDisplayPaymentDetail(false)
    loadPaymentSettingData()
    await loadSubscriptionData()
    if (subscriptionOptions[0]) {
      setActiveGroupId(subscriptionOptions[0].group_id)
    }
    calculateScrollLimits()
  }

  const close = () => {
    setVisible(false)
  }

  const loadSubscriptionData = async () => {
    const { access_token } = userStore.info
    if (!access_token) return subscriptionOptions

    if (subscriptionOptions.length) return subscriptionOptions

    setLoading(true)
    try {
      const { list = [] } = await subscriptionApi.list()
      setSubscriptionOptions(list)
      updateUserGroup()
      return list
    } finally {
      setLoading(false)
    }
  }

  const loadPaymentSettingData = async ({ defaultDisabled = false } = {}) => {
    const list = await paymentApi.getAvailableList()
    const options = list
      .filter(
        (item: any) =>
          [PAYMENT_TYPE.WECHAT, PAYMENT_TYPE.ALIPAY, PAYMENT_TYPE.MANUAL].includes(item.pay_type) &&
          item.enabled &&
          item.configured
      )
      .map((item: any) => ({
        ...item,
        label: PAYMENT_TYPE_LABEL_MAP[item.pay_type as PaymentType],
      }))
    setPaymentOptions(options)
    if (!defaultDisabled && options[0]) {
      setActivePayment(options[0].pay_type)
    }
  }

  const validateUpgrade = async () => {
    await loadSubscriptionData()
    return subscriptionOptions.length > 0
  }

  const updateUserGroup = async ({ refresh = false } = {}) => {
    if (refresh) await userStore.getUserInfo()
    const subscriptionData = subscriptionOptions.find(
      (item) => item.group_id === userStore.info.group_id
    )
    if (subscriptionData) {
      userStore.setGroupName(subscriptionData.group_name || userStore.info.group_name)
    }
  }

  const calculateScrollLimits = () => {
    setTimeout(() => {
      if (!scrollbarRef.current) return
      const viewEl = scrollbarRef.current.querySelector('.upgrade-scrollbar-view')
      if (!viewEl) return
      const children = viewEl.children
      if (children.length > 3) {
        const childWidth = children[0].getBoundingClientRect().width
        setScrollLeftDistance(childWidth + 16)
        setScrollLeftLimit(childWidth + 16 * (children.length - 3))
      }
    }, 100)
  }

  const handleVersionSelect = (item: SubscriptionOption) => {
    setActiveGroupId(item.group_id || activeGroupId)
    setActiveTimeUnit('month')
    if (
      !Number(item.month_info?.amount) &&
      Number(item.year_info?.amount)
    ) {
      setActiveTimeUnit('year')
    }
  }

  const handleTimeUnitSelect = (unit: string) => {
    setActiveTimeUnit(unit)
  }

  const handleScrollLeft = () => {
    for (let i = 0; i < scrollLeftDistance; i += 6) {
      setTimeout(() => {
        const newScrollLeft = scrollLeft - 6
        setScrollLeft(newScrollLeft)
        if (scrollbarRef.current) {
          scrollbarRef.current.scrollLeft = newScrollLeft
        }
      }, 1)
    }
  }

  const handleScrollRight = () => {
    for (let i = 0; i < scrollLeftDistance; i += 6) {
      setTimeout(() => {
        const newScrollLeft = scrollLeft + 6
        setScrollLeft(newScrollLeft)
        if (scrollbarRef.current) {
          scrollbarRef.current.scrollLeft = newScrollLeft
        }
      }, 1)
    }
  }

  const handleQrcodeOpen = async () => {
    await loadPaymentSettingData({ defaultDisabled: true })
    if (!paymentOptions.length) {
      message.warning(t('authority.payment_not_setting'))
    } else {
      paymentQrcodeRef.current?.open()
    }
  }

  const handleAIAssistantOpen = (type: 'windows' | 'ios' | 'chrome') => {
    // TODO: Implement AI assistant download links
    console.log('Open AI assistant:', type)
  }

  useImperativeHandle(ref, () => ({
    open,
    close,
    validateUpgrade,
  }))

  // Listen for custom event to open modal
  useEffect(() => {
    const handleOpenModal = () => {
      open()
    }
    window.addEventListener('open-upgrade-modal', handleOpenModal)
    return () => window.removeEventListener('open-upgrade-modal', handleOpenModal)
  }, [])

  return (
    <SubscriptionContext.Provider value={contextValue}>
      <Modal
        open={visible}
        onCancel={close}
        footer={null}
        closable={false}
        width="90%"
        style={{ maxWidth: 1200 }}
        className="upgrade-modal"
        destroyOnHidden
      >
        <div className="upgrade-container">
          {/* Main content */}
          <div className="upgrade-main">
            {/* Close button - only visible on mobile */}
            <CloseOutlined className="upgrade-close mobile-show" onClick={close} />

            <h1 className="upgrade-title">{t('subscription.version_title')}</h1>

            <div className="upgrade-versions">
              {scrollLeft > 0 && (
                <Button
                  className="upgrade-scroll-btn left"
                  shape="circle"
                  icon={<LeftOutlined />}
                  onClick={handleScrollLeft}
                />
              )}

              <div ref={scrollbarRef} className="upgrade-scrollbar">
                <div className="upgrade-scrollbar-view">
                  {subscriptionOptions.map((item) => (
                    <div
                      key={item.group_id}
                      className={`upgrade-version-card ${
                        item.group_id === activeGroupId ? 'active' : ''
                      } ${isSingleOption ? 'single' : ''}`}
                      onClick={() => handleVersionSelect(item)}
                    >
                      <header className="upgrade-version-header">
                        <img
                          src={
                            !/\.png$/.test(item.logo || '')
                              ? getPublicPath(`/images/subscription/${item.logo || ''}.png`)
                              : item.logo || ''
                          }
                          alt={item.group_name}
                          className="upgrade-version-logo"
                        />
                        <h2 className={`upgrade-version-name ${isSingleOption ? 'flex-none' : 'flex-1'}`}>
                          {item.group_name}
                        </h2>
                        {/* Single option: show price in header */}
                        {isSingleOption && (
                          <>
                            <div className="flex-1" />
                            <div>
                              <div className="flex items-center gap-1">
                                <span className="text-lg font-bold text-black">
                                  {item.month_info.currency_symbol}
                                  {item.month_info.amount}
                                </span>
                                <span className="text-xs text-[#333]">
                                  / {t(`subscription.${item.month_info.time_unit}`)}
                                </span>
                              </div>
                              <div className="text-xs text-[#9A9A9A]">
                                {t('subscription.credit_month_amount', { amount: ` ${item.credit_month_info?.amount || 0} ` })}
                              </div>
                            </div>
                          </>
                        )}
                      </header>

                      <Divider className="!my-4 !border-[#E7ECF7]" />

                      {/* Multiple options: show price below divider */}
                      {!isSingleOption && (
                        <>
                          <div className="flex items-center gap-1">
                            <span className="text-lg font-bold text-black">
                              {item.month_info.currency_symbol}
                              {item.month_info.amount}
                            </span>
                            <span className="text-xs text-[#333]">
                              / {t(`subscription.${item.month_info.time_unit}`)}
                            </span>
                          </div>
                          <div className="text-xs text-[#9A9A9A]">
                            {t('subscription.credit_month_amount', { amount: ` ${item.credit_month_info?.amount || 0} ` })}
                          </div>
                        </>
                      )}

                      {/* Content section */}
                      <div className={isSingleOption ? 'flex flex-row' : ''}>
                        {/* Agent bots list */}
                        {item.agents && item.agents.length > 0 && (
                          <div className={isSingleOption ? 'flex-1' : 'mt-6'}>
                            <h3 className="text-sm font-semibold text-[#1D1E1F]">
                              {t('subscription.agent_bots_title')}
                            </h3>
                            <ul className="flex flex-wrap gap-3.5 mt-4">
                              {item.agents.map((agent, idx) => (
                                <li key={idx} className="flex items-center gap-2 w-full" title={agent.name}>
                                  <img
                                    src={agent.logo || ''}
                                    alt={agent.name}
                                    className="flex-none w-4 h-4 rounded-full overflow-hidden"
                                  />
                                  <div className="flex-1 text-sm text-[#4F5052] truncate">
                                    {agent.name}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* AI Assistant download buttons */}
                        <div className={isSingleOption ? 'flex-1' : 'mt-5'}>
                          <h3 className="text-sm font-semibold text-[#1D1E1F]">
                            {t('subscription.ai_assistant_title')}
                          </h3>
                          <div className="mt-4 flex flex-wrap items-center gap-2">
                            <Button
                              className="!p-1.5"
                              type="default"
                              disabled={!item.ai_enabled}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleAIAssistantOpen('windows')
                              }}
                            >
                              <img
                                src={getPublicPath('/images/windows.png')}
                                className="w-4 h-4 object-cover mr-1"
                                alt="Windows"
                              />
                              <span className="text-xs">Windows</span>
                            </Button>
                            <Button
                              className="!p-1.5 !ml-0"
                              type="default"
                              disabled={!item.ai_enabled}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleAIAssistantOpen('ios')
                              }}
                            >
                              <img
                                src={getPublicPath('/images/ios.png')}
                                className="w-4 h-4 object-cover mr-1"
                                alt="macOS"
                              />
                              <span className="text-xs">macOS</span>
                            </Button>
                            <Button
                              className="!p-1.5 !ml-0"
                              type="default"
                              disabled={!item.ai_enabled}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleAIAssistantOpen('chrome')
                              }}
                            >
                              <img
                                src={getPublicPath('/images/chrome.png')}
                                className="w-4 h-4 object-cover mr-1"
                                alt="Chrome"
                              />
                              <span className="text-xs">Google</span>
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {scrollLeft < scrollLeftLimit && scrollLeftLimit > 0 && (
                <Button
                  className="upgrade-scroll-btn right"
                  shape="circle"
                  icon={<RightOutlined />}
                  onClick={handleScrollRight}
                />
              )}
            </div>

            {/* Time unit selection */}
            {(Number(activeSubscriptionInfo?.month_info?.amount) > 0 || Number(activeSubscriptionInfo?.year_info?.amount) > 0) && (
              <>
                <h1 className="upgrade-title">{t('subscription.time_title')}</h1>
                <ul className="upgrade-time-options">
                  {['month', 'year'].map((key) => {
                    const info = (activeSubscriptionInfo as any)?.[`${key}_info`]
                    if (!info || !Number(info.amount)) return null
                    return (
                      <li
                        key={key}
                        className={`upgrade-time-option ${key === activeTimeUnit ? 'active' : ''}`}
                        onClick={() => handleTimeUnitSelect(key)}
                      >
                        <div className="time-label">{t(`subscription.time_unit_${key}`)}</div>
                        <div className="time-price">
                          <span className="text-lg font-bold text-black">
                            {info.currency_symbol || '￥'}
                          </span>
                          <span className="text-2xl font-bold text-black mx-1">
                            {info.amount || 0}
                          </span>
                          <span className="text-sm text-[#333]">
                            / {t(`subscription.${key}`)}
                          </span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </div>

          {/* Desktop aside */}
          <aside className="upgrade-aside">
            <CloseOutlined className="upgrade-close" onClick={close} />
            <h2 className="upgrade-aside-title">{t('subscription.aside_title')}</h2>
            <p className="upgrade-aside-desc">{t('subscription.aside_desc')}</p>
            <div className="upgrade-user">
              <Avatar size={32} src={userStore.info.avatar} className="flex-none" />
              <div className="flex-1 text-sm font-medium text-[#333]">
                {userStore.info.nickname}
              </div>
            </div>
            <Divider className="!my-5 !border-[#E7ECF7]" />
            <div className="upgrade-order-info">
              <span>{activeSubscriptionInfo?.group_name || '- -'}</span>
              <span>
                {activeTimeInfo?.currency_symbol || '￥'}
                {activeTimeInfo?.amount || 0}
              </span>
            </div>
            {Number(activeTimeInfo?.amount) > 0 && (
              <>
                <Divider className="!my-5 !border-[#E7ECF7]" />
                {paymentOptions.length > 1 && (
                  <div className="upgrade-payment">
                    <h2 className="upgrade-payment-title">{t('subscription.payment')}</h2>
                    <Radio.Group
                      value={activePayment}
                      onChange={(e) => setActivePayment(e.target.value)}
                      disabled={payDisabled}
                      className="mt-2"
                    >
                      {paymentOptions.map((opt) => (
                        <Radio key={opt.pay_type} value={opt.pay_type}>
                          <span className="text-[#333]">{t(`${opt.label}`)}</span>
                        </Radio>
                      ))}
                    </Radio.Group>
                  </div>
                )}
                <div className="upgrade-total">
                  <span>{t('subscription.total')}</span>
                  <span>
                    {activeTimeInfo?.currency_symbol || '￥'}
                    {Number(activeTimeInfo?.amount || 0).toFixed(2)}
                  </span>
                </div>
                <Button
                  type="primary"
                  size="large"
                  block
                  disabled={payDisabled}
                  onClick={handleQrcodeOpen}
                >
                  {t('action.pay')}
                </Button>
              </>
            )}
          </aside>

          {/* Mobile footer */}
          {Number(activeTimeInfo?.amount) > 0 && (
            <footer className="upgrade-footer">
              <div className={`min-h-1 ${displayPaymentDetail ? 'pb-0' : 'pb-1'}`}>
                {displayPaymentDetail && (
                  <div>
                    <h2 className="mt-10 text-2xl font-semibold text-black">
                      {t('subscription.aside_title')}
                    </h2>
                    <p className="mt-2 text-sm text-[#333]">{t('subscription.aside_desc')}</p>
                    <div className="w-full flex items-center gap-2 mt-3">
                      <Avatar size={32} src={userStore.info.avatar} className="flex-none" />
                      <div className="flex-1 text-sm font-medium text-[#333]">
                        {userStore.info.nickname}
                      </div>
                    </div>
                    <Divider className="!my-5 !border-[#E7ECF7]" />
                    <div className="w-full flex items-center justify-between text-lg text-black min-h-[48px] border-b">
                      <span>{activeSubscriptionInfo?.group_name || '- -'}</span>
                      <span>{activeTimeInfo?.currency_symbol || '￥'}{activeTimeInfo?.amount || 0}</span>
                    </div>
                  </div>
                )}

                {paymentOptions.length > 1 && (
                  <div className="flex flex-row items-center gap-4 min-h-max">
                    <h2 className="text-lg text-black whitespace-nowrap">{t('subscription.payment')}</h2>
                    <Radio.Group
                      value={activePayment}
                      onChange={(e) => setActivePayment(e.target.value)}
                      disabled={payDisabled}
                    >
                      {paymentOptions.map((opt) => (
                        <Radio key={opt.pay_type} value={opt.pay_type}>
                          <span className="text-[#333]">{t(`${opt.label}`)}</span>
                        </Radio>
                      ))}
                    </Radio.Group>
                  </div>
                )}

                <div className="flex flex-row items-end gap-4">
                  <div className="mt-4 flex gap-1 items-end">
                    <span className="text-lg text-black">
                      {activeTimeInfo?.currency_symbol || '￥'}
                    </span>
                    <span className="text-4xl font-semibold text-black">
                      {Number(activeTimeInfo?.amount || 0).toFixed(2)}
                    </span>
                  </div>

                  <div
                    className="whitespace-nowrap min-w-max flex items-center gap-1 cursor-pointer"
                    onClick={() => setDisplayPaymentDetail(!displayPaymentDetail)}
                  >
                    <span className="text-sm text-[#333]">明细</span>
                    <ArrowUpOutlined
                      className="text-sm text-[#333] transition-transform"
                      style={{ transform: displayPaymentDetail ? 'rotate(180deg)' : 'none' }}
                    />
                  </div>

                  <Button
                    className="w-full mt-4"
                    type="primary"
                    size="large"
                    disabled={payDisabled}
                    onClick={handleQrcodeOpen}
                  >
                    {t('action.pay')}
                  </Button>
                </div>
              </div>
            </footer>
          )}
        </div>
      </Modal>

      <PaymentQrcode
        ref={paymentQrcodeRef}
        onSuccess={() => updateUserGroup({ refresh: true })}
      />
    </SubscriptionContext.Provider>
  )
})

export default Upgrade
