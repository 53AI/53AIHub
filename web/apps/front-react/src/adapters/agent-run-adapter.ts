/**
 * Agent Run Adapter
 *
 * 将 `apps/front-react/src/api/modules/agentRun` 的 axios + 内部 SSE 实现
 * 适配为 `@km/shared-business/chat` 中 `IAgentRunApi` 的契约。
 *
 * - latest / events / replay / cancel：直接桥接到 `agentRunApi`
 * - subscribe：在内部重新实现 SSE（基于 fetch ReadableStream），并把
 *   `AgentRunSSEConnection` 的 handlers 翻译为 `AgentRunCallbacks`
 *
 * 该文件独立于 `@/stores/modules/agentRun` 的 Zustand store，避免循环依赖，
 * 也无需把内部的 `AgentRunSSEConnection` 升级为公共 API。
 */

import { agentRunApi } from '@/api/modules/agentRun'
import { AgentRun, RUNNING_STATUSES, TERMINAL_EVENTS } from '@/api/modules/agentRun/types'
import { api_host } from '@/utils/config'
import type {
  IAgentRunApi,
  AgentRunInfo,
  AgentRunEvent,
  AgentRunConnection,
  AgentRunCallbacks,
} from '@km/shared-business/chat'

// ===== 类型转换 =====

function toIsoString(value: number | string | undefined | null): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  // number 视为 unix 毫秒
  return new Date(value).toISOString()
}

function transformInfo(info: AgentRun.Info): AgentRunInfo {
  return {
    id: info.id,
    run_id: info.run_id,
    conversation_id: info.conversation_id,
    message_id: info.message_id !== undefined && info.message_id !== null
      ? String(info.message_id)
      : undefined,
    status: info.status,
    created_at: toIsoString(info.created_at),
    updated_at: toIsoString(info.updated_at),
  }
}

function transformEvent(event: AgentRun.Event): AgentRunEvent {
  return {
    seq: event.seq,
    type: (event.event_type ?? event.type) as AgentRunEvent['type'],
    payload: event.payload || {},
    created_at: toIsoString(event.created_at),
    message_id: event.message_id !== undefined && event.message_id !== null
      ? String(event.message_id)
      : undefined,
    run_id: event.run_id,
  }
}

function transformEventRaw(raw: AgentRun.EventRaw): AgentRunEvent {
  let payload: Record<string, unknown> = {}
  if (raw.payload_json) {
    try {
      payload = JSON.parse(raw.payload_json)
    } catch {
      payload = {}
    }
  }
  return {
    seq: raw.seq,
    type: (raw.event_type ?? raw.type) as AgentRunEvent['type'],
    payload,
    created_at: toIsoString(raw.created_at),
  }
}

// ===== SSE 连接（自包含实现） =====

interface AgentRunSSEHandlers {
  onEvent: (event: AgentRunEvent) => void
  onError: (error: Error) => void
  onReconnect: () => void
  onTerminal: () => void
}

class AgentRunSSEConnection {
  private runId: string | null = null
  private abortController: AbortController | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private lastHeartbeatTime = 0
  private heartbeatTimeout = 30000
  private reconnectAttempts = 0
  private maxReconnectAttempts = 3
  private reconnectDelay = 1000
  private isRunning = false
  private afterSeq = 0
  private hasTerminalEvent = false

  constructor(private handlers: AgentRunSSEHandlers) {}

  connect(runId: string, afterSeq = 0): void {
    if (this.isRunning) {
      this.disconnect()
    }

    this.runId = runId
    this.afterSeq = afterSeq
    this.reconnectAttempts = 0
    this.hasTerminalEvent = false
    this.isRunning = true

    const accessToken = localStorage.getItem('access_token') || ''
    const params = new URLSearchParams({
      after_seq: String(afterSeq),
      limit: '200',
    })
    const url = `${api_host}/api/agent-runs/${runId}/subscribe?${params.toString()}`
    void this.createConnection(url, accessToken)
  }

  private async createConnection(url: string, token: string): Promise<void> {
    this.abortController = new AbortController()

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'text/event-stream',
        },
        signal: this.abortController.signal,
      })

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status}`)
      }
      if (!response.body) {
        throw new Error('No response body')
      }

      this.startHeartbeatMonitor()

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (this.isRunning) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() || ''

        for (const block of blocks) {
          if (!block.trim()) continue
          if (block.startsWith(':')) {
            this.lastHeartbeatTime = Date.now()
            continue
          }
          this.parseSSEBlock(block)
        }

        if (this.hasTerminalEvent) {
          break
        }
      }
    } catch (error: unknown) {
      const err = error as { name?: string }
      if (err?.name === 'AbortError') return
      if (this.isRunning) {
        this.handlers.onError(
          error instanceof Error ? error : new Error(String(error)),
        )
      }
    }
  }

  private parseSSEBlock(block: string): void {
    const lines = block.split('\n')
    let eventType = ''
    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim()
        continue
      }
      if (line.startsWith('data:')) {
        const data = line.startsWith('data: ') ? line.slice(6) : line.slice(5)
        if (data === '[DONE]') continue
        this.handleMessage(data, eventType)
      }
    }
  }

  private handleMessage(rawData: string, eventType?: string): void {
    try {
      const data = JSON.parse(rawData) as Record<string, any>
      const type = (eventType || data.event_type) as AgentRunEvent['type']

      if (type === ('heartbeat' as AgentRunEvent['type'])) {
        this.lastHeartbeatTime = Date.now()
        return
      }

      const payload: Record<string, unknown> = data.payload_json
        ? JSON.parse(data.payload_json)
        : data

      const event: AgentRunEvent = {
        seq: data.seq ?? data.id,
        type,
        payload,
        created_at: toIsoString(data.created_at),
        message_id:
          data.message_id !== undefined && data.message_id !== null
            ? String(data.message_id)
            : undefined,
        run_id: data.run_id,
      }

      this.lastHeartbeatTime = Date.now()
      this.handlers.onEvent(event)

      if (TERMINAL_EVENTS.includes(type)) {
        this.hasTerminalEvent = true
        this.handlers.onTerminal()
      }
    } catch (error) {
      console.error('Failed to parse SSE message:', error)
    }
  }

  private startHeartbeatMonitor(): void {
    this.stopHeartbeatMonitor()
    this.lastHeartbeatTime = Date.now()

    this.heartbeatTimer = setInterval(() => {
      if (!this.isRunning) return
      if (Date.now() - this.lastHeartbeatTime > this.heartbeatTimeout) {
        this.triggerReconnect()
      }
    }, 5000)
  }

  private stopHeartbeatMonitor(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private triggerReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.handlers.onError(new Error('Max reconnect attempts reached'))
      this.disconnect()
      return
    }
    this.reconnectAttempts++
    this.abortController?.abort()

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)
    this.reconnectTimeout = setTimeout(() => {
      if (this.runId && this.isRunning) {
        this.handlers.onReconnect()
        this.connect(this.runId, this.afterSeq)
      }
    }, delay)
  }

  disconnect(): void {
    this.isRunning = false
    this.stopHeartbeatMonitor()
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    this.abortController?.abort()
    this.abortController = null
    this.runId = null
    this.reconnectAttempts = 0
    this.hasTerminalEvent = false
  }
}

// ===== Adapter 实现 =====

export function createAgentRunAdapter(): IAgentRunApi {
  return {
    async latest(conversationId: string) {
      try {
        // 注意:agentRunApi.latest 已经经过 axios interceptor + request() 双重解包,
        // 返回值就是 AgentRun.Info 本体,不要再 .data,否则拿到 undefined,
        // 会导致 useAgentRun.recover 走 onMessage(false) 分支,跳过 subscribe。
        const info = (await agentRunApi.latest(conversationId)) as AgentRun.Info | null
        if (!info) {
          return { run: null, isrunning: false }
        }
        return {
          run: transformInfo(info),
          isrunning: RUNNING_STATUSES.includes(info.status),
        }
      } catch (error: unknown) {
        // 404 表示没有运行中的 run —— 视为正常情况
        const status = (error as { response?: { status?: number } })?.response?.status
        if (status === 404) {
          return { run: null, isrunning: false }
        }
        throw error
      }
    },

    async events(runId: string, params?: { after_seq?: number; limit?: number }) {
      const afterSeq = params?.after_seq ?? 0
      const limit = params?.limit ?? 200
      const response = (await agentRunApi.events(runId, afterSeq, limit)) as
        | { events?: AgentRun.EventRaw[] }
        | null
      return (response?.events || []).map(transformEventRaw)
    },

    async replay(runId: string, params?: { after_seq?: number }) {
      const afterSeq = params?.after_seq ?? 0
      const response = (await agentRunApi.replay(runId, afterSeq)) as
        | AgentRun.ReplayResponse
        | null
      return {
        run: transformInfo(response?.run as AgentRun.Info),
        events: (response?.events || []).map(transformEvent),
      }
    },

    async cancel(runId: string) {
      await agentRunApi.cancel(runId)
    },

    subscribe(
      runId: string,
      callbacks: AgentRunCallbacks,
      params?: { after_seq?: number },
    ): AgentRunConnection {
      const connection = new AgentRunSSEConnection({
        onEvent: callbacks.onEvent,
        onError: callbacks.onError,
        onReconnect: callbacks.onReconnect,
        onTerminal: callbacks.onTerminal,
      })
      connection.connect(runId, params?.after_seq ?? 0)
      return {
        disconnect: () => connection.disconnect(),
      }
    },
  }
}

export default createAgentRunAdapter