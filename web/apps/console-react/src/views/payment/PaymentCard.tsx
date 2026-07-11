import { Tag } from 'antd'
import { Dropdown } from '@km/shared-components-react'
import { EllipsisOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { t } from '@/locales'
import { SvgIcon } from '@km/shared-components-react'
import { PAYMENT_TYPE_ICON_MAP, PAYMENT_TYPE_LABEL_MAP, PAYMENT_COMMAND } from '@/constants/payment'
import type { PaymentType } from '@/constants/payment'
import type { PaymentSetting } from '@/api/modules/payment/types'

interface Props {
  settingInfo: Partial<PaymentSetting>
  type: string
  onCommand: (command: string, type: string) => void
}

export function PaymentCard({ settingInfo, type, onCommand }: Props) {
  const iconName = PAYMENT_TYPE_ICON_MAP.get(settingInfo.pay_type as any) || 'default'

  const getPaymentLabel = (payType: PaymentType) => {
    const label = PAYMENT_TYPE_LABEL_MAP.get(payType)
    return label || ''
  }

  const paymentLabel = getPaymentLabel(settingInfo.pay_type as PaymentType)

  const formatUpdateTime = settingInfo.updated_time?.slice(0, 16) || ''

  const handleMenuClick: MenuProps['onClick'] = (e) => {
    onCommand(e.key, type)
  }

  const menuItems: MenuProps['items'] = [
    {
      key: PAYMENT_COMMAND.SETTING,
      label: t('action_setting'),
    },
    ...(settingInfo.pay_setting_id
      ? settingInfo.pay_status
        ? [{ key: PAYMENT_COMMAND.DISABLE, label: t('action_disable') }]
        : [{ key: PAYMENT_COMMAND.ENABLE, label: t('action_enable') }]
      : []),
  ]

  return (
    <div className="border rounded-lg p-5 pb-8 group">
      <div className="relative w-full flex items-center gap-3">
        <SvgIcon name={iconName} width="24" />
        <label className="font-semibold text-primary">{paymentLabel}</label>
        {settingInfo.pay_status && (
          <Tag
            className="!border-none !bg-[#E3F6E0] !text-[#09BB07]"
            color="success"
          >
            {t('enabled')}
          </Tag>
        )}
        <div className="flex-1" />
        <Dropdown
          placement="bottom"
          menu={{ items: menuItems, onClick: handleMenuClick }}
          trigger={['click']}
        >
          <div className="!border-none !outline-none p-1 cursor-pointer rounded overflow-hidden invisible group-hover:visible hover:bg-[#F0F0F0]">
            <EllipsisOutlined style={{ fontSize: 16, transform: 'rotate(90deg)' }} />
          </div>
        </Dropdown>
      </div>
      <div className="mt-3 text-sm text-secondary">
        {settingInfo.pay_setting_id ? (
          <>
            {t('setting')} · {t('updated_at')} {formatUpdateTime}
          </>
        ) : (
          t('not_setting')
        )}
      </div>
    </div>
  )
}

export default PaymentCard
