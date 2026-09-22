import { create } from 'zustand'
import recordingApi from '@/api/modules/recording'

/**
 * 认知模块跨组件共享状态。
 *
 * 三个统计数（核心认知 / 领域认知 / 待确认）的单一来源，由 `refresh()` 统一从
 * `getCognitionOverview()` 拉取后写入，两处触发：
 * - 周期兜底：侧边栏低频轮询调用 `refresh()`，覆盖外部会话/设备的变化
 * - 主动刷新：认知识别页面任意写操作成功后调用 `refresh()`，即时反映计数
 * 页面卡片与侧边栏徽标从同一 store 取数，保证两侧显示一致，不再各自持有一份 overview。
 *
 * `refresh()` 对同一时刻的并发调用做 in-flight 合并：任意时刻只允许一个 overview
 * 请求在途，StrictMode 双挂载 / 轮询与写操作叠加时共享同一个请求，不再重复打接口。
 */
export interface CognitionCounts {
  /** 核心认知数（overview.core_count） */
  core: number
  /** 领域认知数（overview.situational_count） */
  situational: number
  /** 待确认数（overview.pending_count） */
  pending: number
}

interface CognitionStore {
  coreCount: number
  situationalCount: number
  pendingCount: number
  setCounts: (counts: Partial<CognitionCounts>) => void
  /** 重新拉取 overview 并写入三个统计数；失败静默保留旧值；在途请求会被并发调用复用。 */
  refresh: () => Promise<void>
}

export const useCognitionStore = create<CognitionStore>((set) => {
  // 在途请求句柄：并发调用共享它，保证同一时刻只有一个 overview 请求
  let inflight: Promise<void> | null = null

  const setCounts = (counts: Partial<CognitionCounts>) =>
    set({
      ...(counts.core !== undefined && { coreCount: counts.core }),
      ...(counts.situational !== undefined && { situationalCount: counts.situational }),
      ...(counts.pending !== undefined && { pendingCount: counts.pending }),
    })

  return {
    coreCount: 0,
    situationalCount: 0,
    pendingCount: 0,
    setCounts,
    refresh: () => {
      if (inflight) return inflight
      // 用 .finally() 而非 IIFE 体内的 finally 清理：后者在首个 await 之前会同步执行，
      // 若取数同步抛出，清理先于 `inflight = request` 赋值完成，inflight 永不落空。
      // 链上 .finally() 以微任务运行，保证赋值之后再清理。
      const request = (async () => {
        try {
          const overview = await recordingApi.getCognitionOverview()
          setCounts({
            core: typeof overview?.core_count === 'number' ? overview.core_count : 0,
            situational: typeof overview?.situational_count === 'number' ? overview.situational_count : 0,
            pending: typeof overview?.pending_count === 'number' ? overview.pending_count : 0,
          })
        } catch {
          // 拉取失败时静默保留旧值，不打断调用方
        }
      })().finally(() => {
        if (inflight === request) inflight = null
      })
      inflight = request
      return request
    },
  }
})
