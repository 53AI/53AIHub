/**
 * BroadcastChannel-based multi-tab synchronization service.
 * Broadcasts recording state across browser tabs to prevent concurrent recordings.
 */

const CHANNEL_NAME = 'km-recording'

// ── Message type interfaces ──────────────────────────────────────────────

export interface RecordingStartedMessage {
  type: 'RECORDING_STARTED'
  recordingId: string
  startTime: number
}

export interface RecordingTickMessage {
  type: 'RECORDING_TICK'
  duration: number
  recordingId: string
}

export interface RecordingPausedMessage {
  type: 'RECORDING_PAUSED'
  duration: number
  recordingId: string
}

export interface RecordingResumedMessage {
  type: 'RECORDING_RESUMED'
  recordingId: string
}

export interface RecordingStoppedMessage {
  type: 'RECORDING_STOPPED'
}

export interface QueryStatusMessage {
  type: 'QUERY_STATUS'
  requestId: string
}

export interface QueryResponseMessage {
  type: 'QUERY_RESPONSE'
  requestId: string
  busy: boolean
  recordingId?: string
}

export type ChannelMessage =
  | RecordingStartedMessage
  | RecordingTickMessage
  | RecordingPausedMessage
  | RecordingResumedMessage
  | RecordingStoppedMessage
  | QueryStatusMessage
  | QueryResponseMessage

// ── Event types ──────────────────────────────────────────────────────────

export type ChannelEventType =
  | 'recordingStarted'
  | 'recordingTick'
  | 'recordingPaused'
  | 'recordingResumed'
  | 'recordingStopped'
  | 'queryStatus'

// ── RecordingChannel class ───────────────────────────────────────────────

type EventHandler = (data: any) => void

class RecordingChannel {
  private channel: BroadcastChannel
  private isMainRecorder = false
  private eventHandlers = new Map<ChannelEventType, Set<EventHandler>>()
  private lastTickTime = 0
  private tickCheckTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.channel = new BroadcastChannel(CHANNEL_NAME)
    this.channel.onmessage = (event: MessageEvent<ChannelMessage>) => {
      this.handleMessage(event.data)
    }
  }

  private handleMessage(message: ChannelMessage): void {
    switch (message.type) {
      case 'RECORDING_STARTED':
        this.isMainRecorder = false
        this.startTickCheck()
        this.emit('recordingStarted', message)
        break

      case 'RECORDING_TICK':
        this.lastTickTime = Date.now()
        this.emit('recordingTick', message)
        break

      case 'RECORDING_PAUSED':
        this.emit('recordingPaused', message)
        break

      case 'RECORDING_RESUMED':
        this.lastTickTime = Date.now()
        this.emit('recordingResumed', message)
        break

      case 'RECORDING_STOPPED':
        this.stopTickCheck()
        this.emit('recordingStopped', { timeout: false })
        break

      case 'QUERY_STATUS':
        this.emit('queryStatus', message)
        break

      case 'QUERY_RESPONSE':
        if (message.busy) {
          this.isMainRecorder = false
        }
        break
    }
  }

  broadcast(message: ChannelMessage): void {
    this.channel.postMessage(message)
  }

  async checkOtherTabRecording(): Promise<{ busy: boolean; recordingId?: string }> {
    return new Promise((resolve) => {
      // Fallback for non-HTTPS environments where crypto.randomUUID may not be available
      const requestId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`

      const responseHandler = (data: ChannelMessage) => {
        if (data.type === 'QUERY_RESPONSE' && data.requestId === requestId) {
          cleanup()
          resolve({ busy: data.busy, recordingId: data.recordingId })
        }
      }

      const onMessage = (event: MessageEvent<ChannelMessage>) => {
        responseHandler(event.data)
      }

      this.channel.addEventListener('message', onMessage)

      const cleanup = () => {
        this.channel.removeEventListener('message', onMessage)
        clearTimeout(timeoutId)
      }

      const timeoutId = setTimeout(() => {
        cleanup()
        resolve({ busy: false })
      }, 1000)

      this.broadcast({ type: 'QUERY_STATUS', requestId })
    })
  }

  respondQuery(requestId: string, busy: boolean, recordingId?: string): void {
    this.broadcast({ type: 'QUERY_RESPONSE', requestId, busy, recordingId })
  }

  setAsMainRecorder(): void {
    this.isMainRecorder = true
  }

  isMainRecorderTab(): boolean {
    return this.isMainRecorder
  }

  private startTickCheck(): void {
    this.stopTickCheck()
    this.lastTickTime = Date.now()
    this.tickCheckTimer = setInterval(() => {
      if (Date.now() - this.lastTickTime > 5000) {
        this.stopTickCheck()
        this.emit('recordingStopped', { timeout: true })
      }
    }, 5000)
  }

  private stopTickCheck(): void {
    if (this.tickCheckTimer !== null) {
      clearInterval(this.tickCheckTimer)
      this.tickCheckTimer = null
    }
  }

  on(event: ChannelEventType, handler: EventHandler): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    this.eventHandlers.get(event)!.add(handler)

    return () => {
      this.eventHandlers.get(event)?.delete(handler)
    }
  }

  private emit(event: ChannelEventType, data: any): void {
    this.eventHandlers.get(event)?.forEach((handler) => handler(data))
  }

  destroy(): void {
    this.stopTickCheck()
    this.channel.onmessage = null  // Clear handler before closing
    this.channel.close()
    this.eventHandlers.clear()
  }
}

export const recordingChannel = new RecordingChannel()
