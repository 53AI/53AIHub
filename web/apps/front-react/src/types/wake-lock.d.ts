// Wake Lock API type declarations
// https://developer.mozilla.org/en-US/docs/Web/API/Wake_Lock_API

interface WakeLockSentinel extends EventTarget {
  readonly released: boolean
  readonly type: 'screen'
  release(): Promise<void>
  addEventListener(
    type: 'release',
    callback: () => void,
    options?: boolean | AddEventListenerOptions
  ): void
  removeEventListener(
    type: 'release',
    callback: () => void,
    options?: boolean | EventListenerOptions
  ): void
}

interface WakeLock {
  request(type: 'screen'): Promise<WakeLockSentinel>
}

declare global {
  interface Navigator {
    wakeLock: WakeLock
  }
}

export {}
