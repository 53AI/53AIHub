import { createContext, useContext } from 'react'
import type { RecordingCognitionDomain } from '@/api/modules/recording/types'

/**
 * 认知模型页共享的页面级数据与“变更后刷新”协调载体。
 *
 * 页面数据（领域 / 核心统计 + 全局 loading）在概览卡、抽屉、各弹窗间共享；
 * 任意写操作成功后统一经 `refresh` / `refreshAfterMutation` 刷新。
 * 三个统计数（核心/领域/待确认）收敛到 `useCognitionStore`，不在此重复。
 *
 * `refreshAfterMutation(pending)` 除重拉页面数据外，还会递增对应的 mutation tick：
 * 抽屉订阅 tick，在其打开期间据此重拉“已确认列表”和（可选）“待确认子抽屉”，
 * 从而让各弹窗（编辑/详情/审核）与抽屉解耦，无需互相传刷新回调。
 */
export interface CognitionContextValue {
  loading: boolean
  domainRegistry: RecordingCognitionDomain[]
  coreTotals: Record<string, number>
  refresh: () => Promise<void>
  refreshAfterMutation: (pending?: boolean) => Promise<void>
  mutationTick: number
  pendingTick: number
}

export const CognitionContext = createContext<CognitionContextValue | null>(null)

export function useCognitionContext(): CognitionContextValue {
  const ctx = useContext(CognitionContext)
  if (!ctx) {
    throw new Error('useCognitionContext 必须在 CognitionContext.Provider 内使用')
  }
  return ctx
}