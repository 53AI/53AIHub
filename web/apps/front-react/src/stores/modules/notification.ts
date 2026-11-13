import { create } from 'zustand'
import notificationsApi from '@/api/modules/notifications'
import type { NotificationStatsResponse } from '@/api/modules/notifications/types'

export type NotificationType = 'system' | 'pending' | 'mention_comment'

export type NotificationCounts = NotificationStatsResponse['counts']

interface NotificationStore {
  /** 未读总数 */
  unreadTotal: number
  /** 分类型未读数 */
  counts: NotificationCounts
  /** 从服务端拉取未读统计；并发调用共享同一个在途请求 */
  refresh: () => Promise<void>
  /** 已读写操作后的延迟刷新：等服务端统计落定（默认 1s），多次调用合并为一次 */
  refreshDeferred: () => void
  /** 单条已读：本地立即递减，避免等下一个轮询周期 */
  decreaseUnread: (type?: string) => void
  /** 全部已读：本地清零 */
  clearUnread: () => void
  /** 启动轮询（幂等） */
  start: () => void
  /** 停止轮询并清空计数 */
  stop: () => void
}

const POLLING_INTERVAL = 60000
/** 已读写操作后等 1s 再拉统计，避开服务端统计的写入延迟 */
const READ_SETTLE_DELAY = 1000

const EMPTY_COUNTS: NotificationCounts = { system: 0, pending: 0, mention_comment: 0 }

const toNotificationType = (type?: string): NotificationType | null =>
  type === 'system' || type === 'pending' || type === 'mention_comment' ? type : null

/**
 * 未读消息统计的单一来源。
 *
 * 侧边栏头像红点、紧凑模式徽标、消息中心 Tab 角标都从这里取数，组件不再各自持有
 * 一份 unreadCount / counts，也不再各自起定时器。
 *
 * 生命周期：登录即 `start()`、登出 `stop()`，由 App 层统一启停，与页面 / 布局分支
 * 无关 —— 红点在任何页面都要能亮。轮询间隔 60s，页面隐藏时跳过请求，回到前台立即补一次。
 *
 * 已读相关写操作（单条已读 / 全部已读）由调用方先本地递减保证红点即时消失，再调
 * `refreshDeferred()` 等 1s 后拉服务端结果校正。
 */
export const useNotificationStore = create<NotificationStore>((set, get) => {
  // 在途请求句柄：并发调用共享它，保证同一时刻只有一个 stats 请求
  let inflight: Promise<void> | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let deferredTimer: ReturnType<typeof setTimeout> | null = null
  let visibilityHandler: (() => void) | null = null
  // stop() 时自增，用于丢弃 stop 之前发出、stop 之后才返回的请求结果
  let generation = 0

  const tick = () => {
    // 页面隐藏时跳过，回到前台由 visibilitychange 立即补一次
    if (typeof document !== 'undefined' && document.hidden) return
    void get().refresh()
  }

  return {
    unreadTotal: 0,
    counts: EMPTY_COUNTS,

    refresh: () => {
      if (inflight) return inflight
      const current = generation
      // 用链上 .finally() 而非 IIFE 体内 finally 清理：后者在首个 await 前同步执行，
      // 若取数同步抛出会先于 `inflight = request` 赋值完成，inflight 永不落空。
      const request = (async () => {
        try {
          const response: NotificationStatsResponse = await notificationsApi.stats({ scope: 'unread' })
          // 请求期间发生过 stop（登出/切账号），丢弃这次结果
          if (current !== generation) return
          set({
            unreadTotal: typeof response?.total === 'number' ? response.total : 0,
            counts: {
              system: response?.counts?.system ?? 0,
              pending: response?.counts?.pending ?? 0,
              mention_comment: response?.counts?.mention_comment ?? 0,
            },
          })
        } catch {
          // 失败静默保留旧值，不打断调用方
        }
      })().finally(() => {
        if (inflight === request) inflight = null
      })
      inflight = request
      return request
    },

    refreshDeferred: () => {
      // 连续已读（悬停划过多条）只保留最后一次延迟，避免打一串请求
      if (deferredTimer) clearTimeout(deferredTimer)
      deferredTimer = setTimeout(() => {
        deferredTimer = null
        // 已存在的在途请求可能是在已读之前发出的，复用它会把旧值写回（红点复活），
        // 先等它落定再发一次新的
        const pending = inflight
        const run = () => void get().refresh()
        if (pending) pending.then(run, run)
        else run()
      }, READ_SETTLE_DELAY)
    },

    decreaseUnread: (type) => {
      const key = toNotificationType(type)
      set((state) => {
        const nextTotal = Math.max(0, state.unreadTotal - 1)
        if (!key) return { unreadTotal: nextTotal }
        return {
          unreadTotal: nextTotal,
          counts: { ...state.counts, [key]: Math.max(0, state.counts[key] - 1) },
        }
      })
    },

    clearUnread: () => set({ unreadTotal: 0, counts: EMPTY_COUNTS }),

    start: () => {
      if (timer) return
      tick()
      timer = setInterval(tick, POLLING_INTERVAL)
      if (typeof document !== 'undefined') {
        visibilityHandler = () => {
          if (!document.hidden) void get().refresh()
        }
        document.addEventListener('visibilitychange', visibilityHandler)
      }
    },

    stop: () => {
      generation += 1
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      if (deferredTimer) {
        clearTimeout(deferredTimer)
        deferredTimer = null
      }
      if (visibilityHandler && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', visibilityHandler)
        visibilityHandler = null
      }
      inflight = null
      set({ unreadTotal: 0, counts: EMPTY_COUNTS })
    },
  }
})
