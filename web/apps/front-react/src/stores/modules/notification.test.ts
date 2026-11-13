import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/modules/notifications', () => ({
  default: { stats: vi.fn() },
}))

import notificationsApi from '@/api/modules/notifications'
import { useNotificationStore } from '@/stores/modules/notification'

const stats = notificationsApi.stats as unknown as ReturnType<typeof vi.fn>

describe('notification store', () => {
  beforeEach(() => {
    stats.mockReset()
    useNotificationStore.setState({ unreadTotal: 0, counts: { system: 0, pending: 0, mention_comment: 0 } })
  })

  it('coalesces concurrent refresh()', async () => {
    let resolve!: (v: unknown) => void
    stats.mockImplementation(() => new Promise((r) => { resolve = r }))
    const a = useNotificationStore.getState().refresh()
    const b = useNotificationStore.getState().refresh()
    expect(stats).toHaveBeenCalledTimes(1)
    resolve({ total: 2, counts: { system: 1, pending: 1, mention_comment: 0 } })
    await Promise.all([a, b])
    expect(useNotificationStore.getState().unreadTotal).toBe(2)
  })

  it('decreaseUnread clamps at 0 and updates type count', () => {
    useNotificationStore.setState({ unreadTotal: 1, counts: { system: 1, pending: 0, mention_comment: 0 } })
    useNotificationStore.getState().decreaseUnread('system')
    expect(useNotificationStore.getState()).toMatchObject({ unreadTotal: 0, counts: { system: 0 } })
    useNotificationStore.getState().decreaseUnread('system')
    expect(useNotificationStore.getState().unreadTotal).toBe(0)
  })

  it('refreshDeferred waits for in-flight request then refetches', async () => {
    vi.useFakeTimers()
    let resolveFirst!: (v: unknown) => void
    stats.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r }))
    const first = useNotificationStore.getState().refresh()
    stats.mockResolvedValue({ total: 0, counts: { system: 0, pending: 0, mention_comment: 0 } })

    useNotificationStore.getState().refreshDeferred()
    vi.advanceTimersByTime(1000)
    expect(stats).toHaveBeenCalledTimes(1)

    resolveFirst({ total: 5, counts: { system: 5, pending: 0, mention_comment: 0 } })
    await first
    await Promise.resolve()
    await Promise.resolve()
    expect(stats).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('discards response arriving after stop()', async () => {
    let resolve!: (v: unknown) => void
    stats.mockImplementation(() => new Promise((r) => { resolve = r }))
    const p = useNotificationStore.getState().refresh()
    useNotificationStore.getState().stop()
    resolve({ total: 9, counts: { system: 9, pending: 0, mention_comment: 0 } })
    await p
    expect(useNotificationStore.getState().unreadTotal).toBe(0)
  })
})
