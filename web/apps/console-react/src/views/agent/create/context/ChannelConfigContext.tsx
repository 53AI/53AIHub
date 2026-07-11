/**
 * 渠道配置 Context
 * 用于在组件树中共享渠道配置信息
 */

import { createContext, useContext } from 'react'
import type { ChannelConfig } from '../types'

const ChannelConfigContext = createContext<ChannelConfig>({})

export const useChannelConfig = () => useContext(ChannelConfigContext)

export default ChannelConfigContext
