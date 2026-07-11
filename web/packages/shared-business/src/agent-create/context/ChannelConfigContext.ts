/**
 * 渠道配置 Context
 * 用于在组件树中共享渠道配置信息
 */

import { createContext, useContext } from 'react'

export interface ChannelConfig {
  channel_type?: number
  name?: string
  label?: string
  value?: string
  [key: string]: any
}

const ChannelConfigContext = createContext<ChannelConfig>({})

export const useChannelConfig = () => useContext(ChannelConfigContext)

export default ChannelConfigContext
