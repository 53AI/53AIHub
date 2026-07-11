import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { wakeLockService, WakeLockStatus } from './wake-lock'

describe('WakeLockService', () => {
  // Store original navigator
  const originalNavigator = global.navigator

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Restore navigator
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true,
    })
  })

  describe('isSupported', () => {
    it('should return true when wakeLock API is available', () => {
      Object.defineProperty(global.navigator, 'wakeLock', {
        value: {},
        writable: true,
        configurable: true,
      })

      expect(wakeLockService.isSupported()).toBe(true)
    })

    it('should return false when wakeLock API is not available', () => {
      Object.defineProperty(global.navigator, 'wakeLock', {
        value: undefined,
        writable: true,
        configurable: true,
      })

      expect(wakeLockService.isSupported()).toBe(false)
    })
  })

  describe('getStatus', () => {
    it('should return unsupported when wakeLock API is not available', () => {
      Object.defineProperty(global.navigator, 'wakeLock', {
        value: undefined,
        writable: true,
        configurable: true,
      })

      expect(wakeLockService.getStatus()).toBe('unsupported')
    })
  })

  describe('isActive', () => {
    it('should return false when status is not active', () => {
      Object.defineProperty(global.navigator, 'wakeLock', {
        value: undefined,
        writable: true,
        configurable: true,
      })

      expect(wakeLockService.isActive()).toBe(false)
    })
  })

  describe('request', () => {
    it('should return false when wakeLock is not supported', async () => {
      Object.defineProperty(global.navigator, 'wakeLock', {
        value: undefined,
        writable: true,
        configurable: true,
      })

      const result = await wakeLockService.request()
      expect(result).toBe(false)
    })

    it('should request screen wake lock and return true on success', async () => {
      const mockSentinel = {
        addEventListener: vi.fn(),
        released: false,
      }

      Object.defineProperty(global.navigator, 'wakeLock', {
        value: {
          request: vi.fn().mockResolvedValue(mockSentinel),
        },
        writable: true,
        configurable: true,
      })

      const result = await wakeLockService.request()
      expect(result).toBe(true)
      expect(mockSentinel.addEventListener).toHaveBeenCalledWith('release', expect.any(Function))
    })

    it('should return false when wake lock request fails', async () => {
      Object.defineProperty(global.navigator, 'wakeLock', {
        value: {
          request: vi.fn().mockRejectedValue(new Error('Wake Lock request failed')),
        },
        writable: true,
        configurable: true,
      })

      const result = await wakeLockService.request()
      expect(result).toBe(false)
    })

    it('should release existing sentinel before requesting new one', async () => {
      const firstSentinel = {
        addEventListener: vi.fn(),
        released: false,
        release: vi.fn().mockResolvedValue(undefined),
      }

      const secondSentinel = {
        addEventListener: vi.fn(),
        released: false,
        release: vi.fn().mockResolvedValue(undefined),
      }

      const mockRequest = vi.fn()
        .mockResolvedValueOnce(firstSentinel)
        .mockResolvedValueOnce(secondSentinel)

      Object.defineProperty(global.navigator, 'wakeLock', {
        value: {
          request: mockRequest,
        },
        writable: true,
        configurable: true,
      })

      await wakeLockService.request()
      await wakeLockService.request()

      expect(firstSentinel.release).toHaveBeenCalled()
    })
  })

  describe('release', () => {
    it('should release the wake lock sentinel', async () => {
      const mockSentinel = {
        addEventListener: vi.fn(),
        released: false,
        release: vi.fn().mockResolvedValue(undefined),
      }

      Object.defineProperty(global.navigator, 'wakeLock', {
        value: {
          request: vi.fn().mockResolvedValue(mockSentinel),
        },
        writable: true,
        configurable: true,
      })

      await wakeLockService.request()
      await wakeLockService.release()

      expect(mockSentinel.release).toHaveBeenCalled()
    })

    it('should not throw when no sentinel exists', async () => {
      Object.defineProperty(global.navigator, 'wakeLock', {
        value: undefined,
        writable: true,
        configurable: true,
      })

      await expect(wakeLockService.release()).resolves.not.toThrow()
    })
  })

  describe('onReleased', () => {
    it('should register a callback for release events', async () => {
      let releaseCallback: () => void = () => {}

      const mockSentinel = {
        addEventListener: vi.fn((event, cb) => {
          if (event === 'release') {
            releaseCallback = cb
          }
        }),
        released: false,
        release: vi.fn().mockResolvedValue(undefined),
      }

      Object.defineProperty(global.navigator, 'wakeLock', {
        value: {
          request: vi.fn().mockResolvedValue(mockSentinel),
        },
        writable: true,
        configurable: true,
      })

      const callback = vi.fn()
      await wakeLockService.request()
      wakeLockService.onReleased(callback)

      // Simulate release event
      releaseCallback()

      expect(callback).toHaveBeenCalled()
    })

    it('should return unsubscribe function', async () => {
      let releaseCallback: () => void = () => {}

      const mockSentinel = {
        addEventListener: vi.fn((event, cb) => {
          if (event === 'release') {
            releaseCallback = cb
          }
        }),
        released: false,
        release: vi.fn().mockResolvedValue(undefined),
      }

      Object.defineProperty(global.navigator, 'wakeLock', {
        value: {
          request: vi.fn().mockResolvedValue(mockSentinel),
        },
        writable: true,
        configurable: true,
      })

      const callback = vi.fn()
      await wakeLockService.request()
      const unsubscribe = wakeLockService.onReleased(callback)

      // Unsubscribe
      unsubscribe()

      // Simulate release event
      releaseCallback()

      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe('handleVisibilityChange', () => {
    it('should re-request wake lock when page becomes visible', async () => {
      // First set up a wake lock that gets released
      const mockSentinel = {
        addEventListener: vi.fn(),
        released: true, // Already released
        release: vi.fn().mockResolvedValue(undefined),
      }

      const newMockSentinel = {
        addEventListener: vi.fn(),
        released: false,
        release: vi.fn().mockResolvedValue(undefined),
      }

      const mockRequest = vi.fn()
        .mockResolvedValueOnce(mockSentinel)
        .mockResolvedValueOnce(newMockSentinel)

      Object.defineProperty(global.navigator, 'wakeLock', {
        value: {
          request: mockRequest,
        },
        writable: true,
        configurable: true,
      })

      // Mock document.visibilityState
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      })

      // First request
      await wakeLockService.request()

      // Simulate that the sentinel was released
      // by manually releasing and resetting status
      await wakeLockService.release()

      const result = await wakeLockService.handleVisibilityChange()
      expect(result).toBe(true)
    })

    it('should return false when page is not visible', async () => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        writable: true,
        configurable: true,
      })

      const result = await wakeLockService.handleVisibilityChange()
      expect(result).toBe(false)
    })
  })
})
