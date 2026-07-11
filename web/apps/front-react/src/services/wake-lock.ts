export type WakeLockStatus = 'active' | 'released' | 'unsupported'

export class WakeLockService {
  private sentinel: WakeLockSentinel | null = null
  private status: WakeLockStatus = 'unsupported'
  private onReleasedCallbacks: Set<() => void> = new Set()

  isSupported(): boolean {
    return Boolean(navigator.wakeLock)
  }

  async request(): Promise<boolean> {
    if (!this.isSupported()) {
      this.status = 'unsupported'
      return false
    }

    try {
      // Release any existing sentinel first
      if (this.sentinel) {
        if (typeof this.sentinel.release === 'function') {
          await this.sentinel.release()
        }
        this.sentinel = null
      }

      const sentinel = await navigator.wakeLock.request('screen')
      this.sentinel = sentinel
      this.status = 'active'

      sentinel.addEventListener('release', () => {
        this.status = 'released'
        this.sentinel = null
        this.onReleasedCallbacks.forEach((cb) => cb())
      })

      return true
    } catch {
      this.status = 'released'
      return false
    }
  }

  async release(): Promise<void> {
    if (this.sentinel) {
      if (typeof this.sentinel.release === 'function') {
        await this.sentinel.release()
      }
      this.sentinel = null
    }
    this.status = 'released'
  }

  getStatus(): WakeLockStatus {
    return this.status
  }

  isActive(): boolean {
    return this.status === 'active'
  }

  onReleased(callback: () => void): () => void {
    this.onReleasedCallbacks.add(callback)
    return () => {
      this.onReleasedCallbacks.delete(callback)
    }
  }

  async handleVisibilityChange(): Promise<boolean> {
    if (document.visibilityState === 'visible' && this.status === 'released') {
      return this.request()
    }
    return false
  }
}

export const wakeLockService = new WakeLockService()
