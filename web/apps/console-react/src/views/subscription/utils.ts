import { deepCopy } from '@/utils'
import { img_host } from '@/utils/config'
import type { SubscriptionItem, PricingInfo } from '@/types/subscription'

/**
 * 创建默认的价格信息
 */
export const createDefaultPricingInfo = (
  timeUnit: 'year' | 'month',
  type: 1 | 2 = 1,
  amount: string = '0.00'
): PricingInfo => ({
  amount,
  currency: type === 1 ? 'CNY' : '',
  relation_id: 0,
  time_unit: timeUnit,
  type,
})

/**
 * 创建新的订阅项数据
 */
export const createNewSubscriptionItem = (
  template: SubscriptionItem,
  index: number
): SubscriptionItem => {
  if (!template) {
    throw new Error('No template subscription item found')
  }

  const newItem = deepCopy(template)

  return {
    ...newItem,
    delete: false,
    group_id: 0,
    setting_id: 0,
    sort: 0,
    group_name: '',
    is_default: false,
    logo_url: `${img_host}/subscription/vip-${index}.png`,
    ai_enabled: false,
    relations: [],
    year_info: createDefaultPricingInfo('year', 1),
    month_info: createDefaultPricingInfo('month', 1),
    point_month_info: createDefaultPricingInfo('month', 2, '0'),
    agents: [],
  }
}

/**
 * 转换订阅项为保存格式
 */
export const transformSubscriptionItemForSave = (
  item: SubscriptionItem,
  index: number,
  totalLength: number
) => ({
  delete: false,
  group_id: item.group_id || 0,
  setting_id: item.setting_id || 0,
  ai_enabled: !!+item.ai_enabled,
  sort: totalLength - index,
  group_name: item.group_name || '',
  logo_url: item.logo_url || '',
  relations: [
    {
      amount: Math.round(Number(item.year_info.amount) * 10000) / 100,
      currency: item.year_info.currency,
      relation_id: item.year_info.relation_id || 0,
      time_unit: item.year_info.time_unit,
      type: item.year_info.type,
    },
    {
      amount: Math.round(Number(item.month_info.amount) * 10000) / 100,
      currency: item.month_info.currency,
      relation_id: item.month_info.relation_id || 0,
      time_unit: item.month_info.time_unit,
      type: item.month_info.type,
    },
    {
      amount: Number(item.point_month_info.amount || 0),
      currency: item.point_month_info.currency,
      relation_id: item.point_month_info.relation_id || 0,
      time_unit: item.point_month_info.time_unit,
      type: item.point_month_info.type,
    },
  ],
})
