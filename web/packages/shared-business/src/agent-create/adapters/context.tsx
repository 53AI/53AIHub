import React, { createContext, useContext, useMemo } from 'react'
import type { IAgentCreateAdapter, AdapterContextValue } from './types'
import { useAgentFormStore } from '../store'

const AdapterContext = createContext<AdapterContextValue | null>(null)

export interface AdapterProviderProps {
  adapter: IAgentCreateAdapter
  children: React.ReactNode
}

/**
 * 适配器 Provider
 *
 * 必须包裹在 AgentCreatePage 外层，提供适配器实例
 * 自动将 adapter 同步到 Zustand store，确保 API 方法可用
 *
 * @example
 * ```tsx
 * import { AdapterProvider } from '@km/shared-business/agent-create'
 * import { consoleAgentAdapter } from '@/adapters/agent-create-adapter'
 *
 * function App() {
 *   return (
 *     <AdapterProvider adapter={consoleAgentAdapter}>
 *       <AgentCreatePage />
 *     </AdapterProvider>
 *   )
 * }
 * ```
 */
export function AdapterProvider({ adapter, children }: AdapterProviderProps) {
  // 立即同步 adapter 到 store（在渲染阶段）
  // 这是安全的：Zustand setState 是同步的，且只有 adapter 变化时才触发更新
  const currentStoreAdapter = useAgentFormStore.getState().adapter
  if (currentStoreAdapter !== adapter) {
    useAgentFormStore.getState().setAdapter?.(adapter)
  }

  const value = useMemo<AdapterContextValue>(() => ({
    adapter,
    supportedPlatforms: adapter.supportedPlatforms,
  }), [adapter])

  return (
    <AdapterContext.Provider value={value}>
      {children}
    </AdapterContext.Provider>
  )
}

/**
 * 获取适配器实例
 *
 * @throws 如果未包裹 AdapterProvider
 */
export function useAgentCreateAdapter(): IAgentCreateAdapter {
  const context = useContext(AdapterContext)
  if (!context) {
    throw new Error(
      'useAgentCreateAdapter must be used within an AdapterProvider. ' +
      'Please wrap your AgentCreatePage with <AdapterProvider adapter={yourAdapter}>'
    )
  }
  return context.adapter
}

/**
 * 获取支持的平台列表
 */
export function useSupportedPlatforms(): IAgentCreateAdapter['supportedPlatforms'] {
  const context = useContext(AdapterContext)
  if (!context) {
    throw new Error('useSupportedPlatforms must be used within an AdapterProvider')
  }
  return context.supportedPlatforms
}

export { AdapterContext }
