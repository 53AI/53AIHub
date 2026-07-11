import { create } from 'zustand'
import { message } from 'antd'
import { agentRunApi } from '@/api/modules/agentRun'
import { AgentRun, RUNNING_STATUSES, TERMINAL_EVENTS } from '@/api/modules/agentRun/types'
import type { ChatMessage } from '@/views/index/work-ai-chat'
import { api_host } from '@/utils/config'

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

  private handlers: {
    onEvent: (event: AgentRun.Event) => void
    onHeartbeat?: () => void
    onError: (error: Error) => void
    onStatusChange: (status: AgentRun.ConnectionStatus) => void
    onReconnectNeeded: (runId: string) => void
  }

  constructor(handlers: AgentRunSSEConnection['handlers']) {
    this.handlers = handlers
  }

  connect(runId: string, afterSeq = 0): void {
    if (this.isRunning) {
      this.disconnect()
    }

    this.runId = runId
    this.reconnectAttempts = 0
    this.isRunning = true
    this.handlers.onStatusChange('connecting')

    const accessToken = localStorage.getItem('access_token') || ''
    const params = new URLSearchParams({
      after_seq: String(afterSeq),
      limit: '200'
    })

    const url = `${api_host}/api/agent-runs/${runId}/subscribe?${params.toString()}`
    this.createConnection(url, accessToken)
  }

  private async createConnection(url: string, token: string): Promise<void> {
    this.abortController = new AbortController()

    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'text/event-stream'
        },
        signal: this.abortController.signal
      })

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status}`)
      }

      if (!response.body) {
        throw new Error('No response body')
      }

      this.handlers.onStatusChange('connected')
      this.startHeartbeatMonitor()

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (this.isRunning) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })

        // SSE 标准用双换行分隔事件块
        const eventBlocks = buffer.split('\n\n')
        buffer = eventBlocks.pop() || ''

        for (const block of eventBlocks) {
          // 跳过空块
          if (!block.trim()) continue

          // 处理 SSE 注释（如 `: ping` 心跳）
          if (block.startsWith(':')) {
            this.lastHeartbeatTime = Date.now()
            this.handlers.onHeartbeat?.()
            continue
          }

          // 解析完整事件块
          this.parseSSEBlock(block)
        }
      }

      if (this.isRunning) {
        this.handlers.onStatusChange('disconnected')
      }
    } catch (error: any) {
      if (error.name === 'AbortError') return

      if (this.isRunning) {
        this.handlers.onError(error instanceof Error ? error : new Error(String(error)))
        this.handlers.onStatusChange('disconnected')
      }
    }
  }

  /**
   * 解析完整的 SSE 事件块
   * SSE 标准格式：event: xxx\ndata: yyy（用单换行分隔字段）
   */
  private parseSSEBlock(block: string): void {
    const lines = block.split('\n')
    let eventType = ''
    for (const line of lines) {
      // 处理 event: 行
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim()
        continue
      }

      // 处理 data: 行（兼容有空格和无空格的情况）
      if (line.startsWith('data:')) {
        const data = line.startsWith('data: ') ? line.slice(6) : line.slice(5)
        if (data === '[DONE]') {
          continue
        }
        this.handleMessage(data, eventType)
      }
    }
  }

  private handleMessage(rawData: string, eventType?: string): void {
    try {
      const data = JSON.parse(rawData)

      // 使用传入的 eventType 或从 data 中提取
      const type = eventType || data.event_type

      if (type === 'heartbeat') {
        this.lastHeartbeatTime = Date.now()
        this.handlers.onHeartbeat?.()
        return
      }

      let event: AgentRun.Event
      if (data.payload_json) {
        event = {
          seq: data.seq,
          type: type,
          payload: JSON.parse(data.payload_json),
          created_at: data.created_at,
          message_id: data.message_id,
          run_id: data.run_id,
          request_id: data.request_id
        }
      } else {
        // 从 data 中构建 payload，data.id 作为 seq
        event = {
          seq: data.seq || data.id,
          type: type,
          payload: data,
          created_at: data.created_at,
          message_id: data.message_id,
          run_id: data.run_id,
          request_id: data.request_id
        }
      }
      this.handlers.onEvent(event)

      if (TERMINAL_EVENTS.includes(event.type)) {
        this.disconnect()
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
    this.handlers.onStatusChange('reconnecting')
    this.abortController?.abort()

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)

    this.reconnectTimeout = setTimeout(() => {
      if (this.runId && this.isRunning) {
        this.handlers.onReconnectNeeded(this.runId)
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
    this.handlers.onStatusChange('disconnected')
  }
}

// ============= 事件转换函数 =============

function isErrorContent(content: string): boolean {
  if (!content) return false
  const errorPatterns = [
    'Upstream Error',
    'Error:',
    'error:',
    '请求失败',
    '服务异常',
    '模型余额不足'
  ]
  return errorPatterns.some(pattern => content.includes(pattern))
}

function applyEventToMessage(
  message: ChatMessage,
  event: AgentRun.Event
): ChatMessage {
  const { type, payload } = event

  switch (type) {
    case 'run.created':
      return {
        ...message,
        id: payload.message_id || message.id,
        role: 'assistant',
        loading: true,
        answer: '',
        reasoning_content: '',
        content: ''
      }

    case 'run.status_changed':
      return {
        ...message,
        loading: payload.status === 'running' || payload.status === 'queued'
      }

    case 'message.delta':
      // SSE 格式: payload.choices[0].delta.content/reasoning_content
      const delta = payload.choices?.[0]?.delta || payload
      const content = delta.content || ''
      const reasoning = delta.reasoning_content || ''

      if (isErrorContent(content)) {
        return {
          ...message,
          answer: '请求失败，请稍后重试',
          content: '请求失败，请稍后重试',
          error: true,
          loading: false
        }
      }

      const newAnswer = (message.answer || '') + content
      return {
        ...message,
        answer: newAnswer,
        content: newAnswer,
        reasoning_content: message.reasoning_content
          ? message.reasoning_content + reasoning
          : reasoning,
        reasoning_expanded: content.trim() ? false : message.reasoning_expanded
      }

    case 'message.completed':
      return {
        ...message,
        loading: false,
        id: payload.message_id || message.id,
        content: message.answer || message.content
      }

    case 'step.created':
    case 'process.step':
      // process.step 的数据在 payload.process_step 中
      const ps = type === 'process.step' ? payload.process_step : payload
      const stepData = {
        step_code: ps.step_code,
        status: ps.status,
        message: ps.message,
        data: JSON.stringify(ps.data || {})
      }

      const existingRecords = message.process_records || []
      const existingIndex = existingRecords.findIndex(
        (r: any) => r.step_code === stepData.step_code
      )

      let newProcessRecords = [...existingRecords]
      if (existingIndex >= 0) {
        newProcessRecords[existingIndex] = {
          ...newProcessRecords[existingIndex],
          ...stepData
        }
      } else {
        newProcessRecords.push(stepData)
      }

      if (
        ps.step_code === 'output_files' &&
        ps.status === 'completed' &&
        ps.data?.files
      ) {
        const newOutputFiles = ps.data.files.map((file: any) => ({
          id: file.id,
          file_name: file.file_name,
          url: file.url
        }))

        return {
          ...message,
          process_records: newProcessRecords,
          rag_search_text: ps.message,
          outputFiles: message.outputFiles
            ? [...message.outputFiles, ...newOutputFiles]
            : newOutputFiles
        }
      }

      return {
        ...message,
        process_records: newProcessRecords,
        rag_search_text: ps.message
      }

    case 'run.completed':
      return { ...message, loading: false }

    case 'run.failed':
      return {
        ...message,
        loading: false,
        error: true,
        answer: payload.error_message || '运行失败',
        content: payload.error_message || '运行失败'
      }

    case 'run.cancelled':
      return { ...message, loading: false }

    default:
      return message
  }
}

export function eventsToMessage(events: AgentRun.Event[]): ChatMessage | null {
  if (!events.length) return null

  let message: ChatMessage = {
    id: 'temp',
    role: 'assistant',
    content: '',
    time: '',
    loading: true
  }

  for (const event of events) {
    message = applyEventToMessage(message, event)
  }

  return message
}

// ============= 轮询等待 message_id =============

/**
 * 轮询获取最新 run 信息
 *
 * @param conversationId 会话 ID
 * @param signal 可选的 AbortSignal，用于取消请求
 * @param interval 轮询间隔（毫秒），默认 1000ms
 * @param timeout 超时时间（毫秒），默认 10000ms（10秒）
 * @returns AgentRun.Info 或 null（无运行中的 run）
 */
async function pollLatestRunForMessageId(
  conversationId: string,
  signal?: AbortSignal,
  interval = 1000,
  timeout = 10000
): Promise<AgentRun.Info | null> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    // ✅ 检查是否已取消
    if (signal?.aborted) {
      throw new Error('Aborted')
    }

    try {
      const run = await agentRunApi.latest(conversationId)

      // ✅ 请求完成后再次检查取消状态
      if (signal?.aborted) {
        throw new Error('Aborted')
      }

      // 有有效的 message_id
      if (run.message_id && run.message_id !== 0) {
        return run
      }

      // 状态不是运行中，直接返回
      if (!RUNNING_STATUSES.includes(run.status)) {
        return run
      }

      // 等待后继续轮询
      await new Promise(resolve => setTimeout(resolve, interval))
    } catch (error: any) {
      // ✅ 取消错误向上抛出
      if (error.message === 'Aborted' || error.name === 'AbortError') {
        throw error
      }

      // ✅ 404 是正常情况，表示没有运行中的 run
      if (error?.response?.status === 404) {
        return null
      }

      // ✅ 其他错误记录并返回 null
      console.warn('pollLatestRunForMessageId error:', error)
      return null
    }
  }

  // ✅ 超时返回 null 而不是抛异常（更友好的处理方式）
  console.warn('pollLatestRunForMessageId timeout after', timeout, 'ms')
  return null
}

// ============= Zustand Store =============

interface AgentRunState {
  currentRun: AgentRun.Info | null
  events: AgentRun.Event[]
  lastSeq: number
  connectionStatus: AgentRun.ConnectionStatus
  isReplaying: boolean
  _connection: AgentRunSSEConnection | null

  recover: (conversationId: string, callbacks: {
    onStart?: () => void
    onMessage?: (options: { isRunning: boolean; messageId?: string | number }) => Promise<void>
  }) => Promise<{ run: AgentRun.Info | null; isrunning: boolean }>
  subscribe: (runId: string, afterSeq?: number) => void
  disconnect: () => void
  cancel: () => Promise<void>
  setCurrentRun: (run: AgentRun.Info | null) => void
}

export const useAgentRunStore = create<AgentRunState>((set, get) => ({
  currentRun: null,
  events: [],
  lastSeq: 0,
  connectionStatus: 'disconnected',
  isReplaying: false,
  _connection: null,

  recover: async (conversationId: string, callbacks: {
    onStart?: () => void
    onMessage?: (options: { isRunning: boolean; messageId?: string | number }) => Promise<void>
  }): Promise<{ run: AgentRun.Info | null; isrunning: boolean }> => {
    try {
      // 立即通知外部开始恢复，设置 loading 状态
      callbacks.onStart?.()

      // ✅ pollLatestRunForMessageId 现在可能返回 null
      const run = await pollLatestRunForMessageId(conversationId)

      // ✅ 无运行中的 run，等待 onMessage 完成后返回
      if (!run) {
        await callbacks.onMessage?.({ isRunning: false, messageId: '' })
        return { run: null, isrunning: false }
      }

      const isRunning = RUNNING_STATUSES.includes(run.status)

      // ✅ 不在运行中，等待 onMessage 完成后返回
      if (!isRunning) {
        await callbacks.onMessage?.({ isRunning: false, messageId: '' })
        return { run: null, isrunning: false }
      }

      // ✅ 只有有 messageId 时才调用 onMessage，等待完成
      await callbacks.onMessage?.({ isRunning, messageId: run.message_id })
      set({ currentRun: run, events: [], lastSeq: 0 })

      try {
        const replayData = await agentRunApi.replay(run.run_id)
        const replayIsRunning = RUNNING_STATUSES.includes(replayData.run.status)
        if (replayData.events.length > 0) {
          set({ isReplaying: true, events: replayData.events })
          const maxSeq = Math.max(...replayData.events.map(e => e.seq))
          set({ lastSeq: maxSeq })
        }
        set({ isReplaying: false })

        // ✅ 如果 replay 后状态变化，更新 isRunning
        if (replayIsRunning) {
          get().subscribe(run.run_id, get().lastSeq)
        }
        return { run, isrunning: replayIsRunning }
      } catch (replayError) {
        // ✅ replay 失败但 run 仍在运行，尝试订阅
        console.warn('Replay failed, attempting to subscribe:', replayError)
        if (isRunning) {
          get().subscribe(run.run_id, get().lastSeq)
        }
        return { run, isrunning: isRunning }
      }
    } catch (error: any) {
      // ✅ Aborted 错误向上抛出
      if (error.message === 'Aborted') {
        throw error
      }
      // 404 表示没有运行中的 run，是正常情况
      if (error?.response?.status !== 404) {
        console.error('Failed to recover run:', error)
      }
      return { run: null, isrunning: false }
    }
  },

  subscribe: (runId: string, afterSeq = 0) => {
    const { _connection } = get()
    if (_connection) {
      _connection.disconnect()
    }

    const connection = new AgentRunSSEConnection({
      onEvent: (event) => {
        const { lastSeq } = get()
        if (event.seq <= lastSeq) {
          return
        }

        set(state => {
          return {
            events: [...state.events, event],
            lastSeq: event.seq,
          }
        })
      },
      onError: (error) => {
        console.error('SSE error:', error)
      },
      onStatusChange: (status) => {
        set({ connectionStatus: status })
      },
      onReconnectNeeded: (runId) => {
        const { lastSeq } = get()
        get().subscribe(runId, lastSeq)
      }
    })

    set({ _connection: connection, connectionStatus: 'connecting' })
    connection.connect(runId, afterSeq)
  },

  disconnect: () => {
    const { _connection } = get()
    if (_connection) {
      _connection.disconnect()
    }

    set({
      _connection: null,
      connectionStatus: 'disconnected',
      events: [],
      lastSeq: 0,
    })
  },

  cancel: async () => {
    const { currentRun } = get()
    if (!currentRun) return

    try {
      await agentRunApi.cancel(currentRun.run_id)
    } catch (error) {
      // message.error('取消失败')
    }
  },

  setCurrentRun: (run: AgentRun.Info | null) => {
    set({ currentRun: run })
  }
}))

export default useAgentRunStore