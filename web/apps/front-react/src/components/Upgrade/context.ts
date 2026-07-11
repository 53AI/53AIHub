import { createContext, useContext } from 'react'
import { PAYMENT_TYPE, type PaymentType } from '@/constants/payment'

export interface SubscriptionOption {
  group_id: number
  group_name: string
  logo_url: string
  logo?: string
  is_default?: boolean
  sort?: number
  ai_enabled?: boolean
  agents?: { name: string; logo: string }[]
  relations?: any[]
  year_info: {
    amount: string
    currency: string
    currency_symbol: string
    relation_id: number
    time_unit: string
    type: number
  }
  month_info: {
    amount: string
    currency: string
    currency_symbol: string
    relation_id: number
    time_unit: string
    type: number
  }
  credit_month_info: {
    amount: string
    currency: string
    currency_symbol: string
    relation_id: number
    time_unit: string
    type: number
  }
  [key: string]: any
}

interface SubscriptionContextValue {
  activeSubscriptionInfo: SubscriptionOption | null
  activeTimeInfo: { currency_symbol?: string; amount?: string; currency?: string; time_unit?: string } | null
  activePayment: PaymentType
}

export const SubscriptionContext = createContext<SubscriptionContextValue>({
  activeSubscriptionInfo: null,
  activeTimeInfo: null,
  activePayment: PAYMENT_TYPE.WECHAT,
})

export const useSubscriptionContext = () => useContext(SubscriptionContext)
