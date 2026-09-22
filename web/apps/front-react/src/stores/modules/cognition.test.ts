import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/modules/recording', () => ({
  default: {
    getCognitionOverview: vi.fn(),
  },
}))

import recordingApi from '@/api/modules/recording'
import { useCognitionStore } from './cognition'

const getOverview = recordingApi.getCognitionOverview as unknown as ReturnType<typeof vi.fn>

describe('cognition store refresh coalescing', () => {
  beforeEach(() => {
    getOverview.mockReset()
    useCognitionStore.setState({ coreCount: 0, situationalCount: 0, pendingCount: 0 })
  })

  it('coalesces concurrent refresh() calls into a single request', async () => {
    let resolveOverview!: (value: unknown) => void
    getOverview.mockImplementation(
      () => new Promise((resolve) => {
        resolveOverview = resolve
      }),
    )

    const first = useCognitionStore.getState().refresh()
    const second = useCognitionStore.getState().refresh()
    expect(getOverview).toHaveBeenCalledTimes(1)

    resolveOverview({ core_count: 3, situational_count: 4, pending_count: 5 })
    await Promise.all([first, second])

    expect(getOverview).toHaveBeenCalledTimes(1)
    const state = useCognitionStore.getState()
    expect([state.coreCount, state.situationalCount, state.pendingCount]).toEqual([3, 4, 5])
  })

  it('issues a new request after the previous one settles', async () => {
    getOverview.mockResolvedValue({ core_count: 1, situational_count: 2, pending_count: 3 })

    await useCognitionStore.getState().refresh()
    await useCognitionStore.getState().refresh()

    expect(getOverview).toHaveBeenCalledTimes(2)
  })

  it('keeps previous values when the request fails', async () => {
    useCognitionStore.setState({ coreCount: 7, situationalCount: 8, pendingCount: 9 })
    getOverview.mockRejectedValue(new Error('boom'))

    await useCognitionStore.getState().refresh()

    const state = useCognitionStore.getState()
    expect([state.coreCount, state.situationalCount, state.pendingCount]).toEqual([7, 8, 9])
  })

  it('clears the in-flight latch even when the request throws synchronously', async () => {
    getOverview.mockImplementationOnce(() => {
      throw new Error('sync boom')
    })
    await useCognitionStore.getState().refresh()

    getOverview.mockResolvedValueOnce({ core_count: 2, situational_count: 3, pending_count: 4 })
    await useCognitionStore.getState().refresh()

    expect(getOverview).toHaveBeenCalledTimes(2)
    const state = useCognitionStore.getState()
    expect([state.coreCount, state.situationalCount, state.pendingCount]).toEqual([2, 3, 4])
  })
})
