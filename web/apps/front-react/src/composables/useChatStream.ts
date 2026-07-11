import { useRef, useCallback } from 'react'
import filesApi from '@/api/modules/files'
import { t } from '@/locales'

// ============ 类型定义 ============

/** 技能运行项状态 */
export type SkillRunItemStatus = 'pending' | 'running' | 'completed'

/** 流程步骤状态 */
export type StepStatus = 'start' | 'completed' | 'success'

/** 脚本类技能项 */
export type SkillRunScriptItem = {
  type: 'script'
  title: string
  bash: string
  output: string
  status: SkillRunItemStatus
}

/** LLM 推理步骤项（聚合 llm_delta） */
export type SkillRunLlmItem = {
  type: 'llm'
  title: string
  /** 累积的内容 */
  content: string
  status: SkillRunItemStatus
}

/** 搜索类技能项 */
export type SkillRunSearchItem = {
  type: 'search'
  title: string
  icon?: string
  sourceCount?: number
  tags?: string[]
  sources?: Array<{ title: string; url?: string; icon?: string }>
  status?: SkillRunItemStatus
}

/** 意图识别结果 */
export type IntentData = {
  intent?: string
  skill_name?: string
  confidence?: number
  reasoning?: string
  keywords?: string[]
  answer?: string
  expanded_queries?: unknown
}

/** 技能类步骤（用于渲染 intentData，含内部字段） */
export type SkillRunSkillItem = {
  type: 'skill'
  title: string
  status: SkillRunItemStatus
  skillName?: string
  intentData?: IntentData
  /** 内部字段：存储 bash 供第三步使用 */
  _bash?: string
  _toolCallId?: string
}

export type SkillRunItem = SkillRunScriptItem | SkillRunSearchItem | SkillRunSkillItem | SkillRunLlmItem

/** 流程步骤数据 */
export type ProcessStep = {
  step_code: string
  status: StepStatus
  message: string
  data?: unknown
}

// ============ 工具函数 ============

export function parseJson<T>(json: string, defaultValue: T | null = null): T | null {
  try {
    return JSON.parse(json)
  } catch {
    return defaultValue
  }
}

function normalizeOutputFiles(value: unknown): any[] {
  if (!Array.isArray(value)) return []
  return value
    .map((file: any) => {
      if (!file || typeof file !== 'object') return null
      const fileName = file.file_name ?? file.fileName ?? file.filename ?? file.name
      const url = file.url ?? file.href ?? file.download_url ?? file.downloadUrl
      const id = file.id ?? file.file_id ?? file.fileId ?? url ?? fileName
      if (id == null && !url && !fileName) return null
      return {
        id: id ?? `${url || ''}|${fileName || ''}`,
        file_name: fileName != null ? String(fileName) : undefined,
        url: url != null ? String(url) : undefined,
        download_url: typeof file.download_url === 'string' ? file.download_url : typeof file.downloadUrl === 'string' ? file.downloadUrl : undefined,
        signed_download_url: typeof file.signed_download_url === 'string' ? file.signed_download_url : typeof file.signedDownloadUrl === 'string' ? file.signedDownloadUrl : undefined,
        mime_type: file.mime_type ?? file.mimeType ?? file.mime,
        size: typeof file.size === 'number' ? file.size : Number.isFinite(Number(file.size)) ? Number(file.size) : undefined,
        kind: file.kind,
        message_id: file.message_id ?? file.messageId,
        source_kind: file.source_kind ?? file.sourceKind
      }
    })
    .filter(Boolean)
}

function appendOutputFiles(message: any, files: any[]): void {
  if (!files.length) return
  const current = Array.isArray(message.outputFiles) ? message.outputFiles : []
  const merged = [...current]
  const indexByKey = new Map(merged.map((file: any, index: number) => [String(file.id ?? `${file.url || ''}|${file.file_name || ''}`), index]))
  files.forEach((file: any) => {
    const key = String(file.id ?? `${file.url || ''}|${file.file_name || ''}`)
    if (indexByKey.has(key)) {
      const index = indexByKey.get(key)!
      const existing = merged[index]
      merged[index] = {
        ...file,
        ...existing,
        mime_type: existing.mime_type ?? file.mime_type,
        size: existing.size ?? file.size,
        kind: existing.kind ?? file.kind,
        message_id: existing.message_id ?? file.message_id,
        download_url: existing.download_url ?? file.download_url,
        signed_download_url: existing.signed_download_url ?? file.signed_download_url,
        source_kind: existing.source_kind ?? file.source_kind
      }
      return
    }
    indexByKey.set(key, merged.length)
    merged.push(file)
  })
  message.outputFiles = merged
}

export function formatBash(code: string, language: string): string {
  const trimmed = (code || '').trim()
  return trimmed ? (language === 'bash' || !language ? `$ ${trimmed}` : trimmed) : ''
}

export function getIntentData(raw: unknown): IntentData | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  return {
    intent: r.intent != null ? String(r.intent) : undefined,
    skill_name: r.skill_name != null ? String(r.skill_name) : undefined,
    confidence: typeof r.confidence === 'number' ? r.confidence : undefined,
    reasoning: r.reasoning != null ? String(r.reasoning) : undefined,
    keywords: Array.isArray(r.keywords) ? r.keywords.map(String) : undefined,
    answer: r.answer != null ? String(r.answer) : undefined,
    expanded_queries: r.expanded_queries
  }
}

/** 下载沙箱文件 */
export const downloadSandboxFile = async (id: string | number, filename?: string) => {
  try {
    const res = await filesApi.downloadFile(id)
    const blob = new Blob([res.data || res])
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename || `sandbox-file-${id}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (err) {
    console.error('下载文件失败:', err)
  }
}

// ============ 列表更新辅助函数 ============

export function updateSkillItem(
  items: SkillRunItem[],
  predicate: (item: SkillRunItem) => boolean,
  updater: (item: SkillRunSkillItem) => Partial<SkillRunSkillItem>
): SkillRunItem[] {
  const idx = items.findIndex(predicate)
  if (idx === -1) return items
  const item = items[idx] as SkillRunSkillItem
  return [...items.slice(0, idx), { ...item, ...updater(item) }, ...items.slice(idx + 1)]
}

// ============ 流程步骤处理函数 ============

function handleIntentClassification(
  step: ProcessStep,
  skillRunItems: SkillRunItem[]
): SkillRunItem[] {
  if (step.status === 'start') {
    return [
      ...skillRunItems,
      { type: 'skill', title: step.message || '正在识别意图...', status: 'running' }
    ]
  }
  if (step.status === 'completed') {
    const data = step.data as { intent?: unknown } | undefined
    const intentData = getIntentData(data?.intent)
    return updateSkillItem(
      skillRunItems,
      (item) => item.type === 'skill',
      () => ({
        title: step.message,
        status: 'completed',
        skillName: intentData?.skill_name,
        intentData
      })
    )
  }
  return skillRunItems
}

function handleSkillRouting(
  step: ProcessStep,
  skillRunItems: SkillRunItem[]
): SkillRunItem[] {
  if (step.status === 'completed') {
    return updateSkillItem(
      skillRunItems,
      (item) => item.type === 'skill',
      (item) => ({
        title: item.skillName ? `技能加载完成` : step.message,
        status: 'completed'
      })
    )
  }
  return skillRunItems
}

function handleToolExecutionStart(
  step: ProcessStep,
  skillRunItems: SkillRunItem[]
): SkillRunItem[] {
  if (step.status !== 'start' || !step.data) return skillRunItems

  const data = step.data as {
    skill_name?: string
    tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>
  }
  const calls = data?.tool_calls ?? []
  if (calls.length === 0) return skillRunItems

  const firstSkill = skillRunItems.find((item) => item.type === 'skill') as SkillRunSkillItem | undefined
  const firstCall = calls[0]
  const args = parseJson<{ code?: string; language?: string }>(firstCall.function?.arguments ?? '{}') ?? {}
  const bash = formatBash(args.code ?? '', args.language ?? 'bash')
  const toolCallId = (firstCall.id ?? '') + '_running'

  // 检查是否已存在相同的 _toolCallId，防止重复添加
  const exists = skillRunItems.some(
    (item) => item.type === 'skill' && (item as SkillRunSkillItem)._toolCallId === toolCallId
  )
  if (exists) return skillRunItems

  return [
    ...skillRunItems,
    {
      type: 'skill',
      title: '正在使用技能...',
      status: 'running',
      skillName: data?.skill_name,
      intentData: firstSkill?.intentData,
      _bash: bash,
      _toolCallId: toolCallId
    }
  ]
}

function handleToolResult(
  step: ProcessStep,
  skillRunItems: SkillRunItem[]
): SkillRunItem[] {
  if (step.status !== 'completed' || !step.data) return skillRunItems

  const data = step.data as { tool_call_id?: string; result?: string; skill_name?: string }
  const toolCallId = (data?.tool_call_id ?? '') + '_running'
  const result = typeof data?.result === 'string' ? data.result : ''

  // 更新第二步状态并获取 bash
  let bash = ''
  let newItems = [...skillRunItems]
  const idx = newItems.findIndex(
    (item) => item.type === 'skill' && (item as SkillRunSkillItem)._toolCallId === toolCallId
  )
  if (idx !== -1) {
    const item = newItems[idx] as SkillRunSkillItem
    bash = item._bash ?? ''
    newItems = [...newItems.slice(0, idx), { ...item, status: 'completed' }, ...newItems.slice(idx + 1)]
  }

  // 添加第三步
  return [
    ...newItems,
    {
      type: 'script',
      title: data?.skill_name ? `技能 ${data.skill_name} 执行完成` : '技能执行完成',
      bash,
        output: result,
      status: 'completed'
    }
  ]
}

/** 处理 llm_delta 流式输出 */
function handleLlmDelta(
  step: ProcessStep,
  skillRunItems: SkillRunItem[]
): SkillRunItem[] {
  if (step.status !== 'streaming' || !step.data) return skillRunItems

  const data = step.data as { content?: string }
  const content = data?.content || ''

  // 查找当前活跃的 llm item
  const existingIdx = skillRunItems.findIndex(
    (item) => item.type === 'llm' && item.status === 'running'
  )

  if (existingIdx !== -1) {
    // 追加内容到现有的 llm item
    const existing = skillRunItems[existingIdx] as SkillRunLlmItem
    return [
      ...skillRunItems.slice(0, existingIdx),
      { ...existing, content: existing.content + content },
      ...skillRunItems.slice(existingIdx + 1)
    ]
  }

  // 创建新的 llm item
  return [
    ...skillRunItems,
    {
      type: 'llm',
      title: '思考中...',
      content,
      status: 'running'
    }
  ]
}

/** 完成 llm_delta 步骤（当遇到非 llm_delta 时调用） */
function finishLlmDelta(skillRunItems: SkillRunItem[]): SkillRunItem[] {
  const llmIdx = skillRunItems.findIndex(
    (item) => item.type === 'llm' && item.status === 'running'
  )
  if (llmIdx === -1) return skillRunItems

  const llmItem = skillRunItems[llmIdx] as SkillRunLlmItem
  return [
    ...skillRunItems.slice(0, llmIdx),
    {
      ...llmItem,
      status: 'completed',
      title: '思考完成'
    },
    ...skillRunItems.slice(llmIdx + 1)
  ]
}

export function applyProcessStep(
  step: ProcessStep,
  items: SkillRunItem[]
): { items: SkillRunItem[]; hasUpdate: boolean } {
  let newItems = [...items]

  // 首先检查是否需要完成活跃的 llm_delta
  // 当遇到非 llm_delta 的步骤时，完成活跃的 llm item
  if (step.step_code !== 'llm_delta') {
    newItems = finishLlmDelta(newItems)
  }

  switch (step.step_code) {
    case 'intent_classification':
      newItems = handleIntentClassification(step, newItems)
      break
    case 'skill_routing':
      newItems = handleSkillRouting(step, newItems)
      break
    case 'tool_execution':
      newItems = handleToolExecutionStart(step, newItems)
      break
    case 'tool_result':
      newItems = handleToolResult(step, newItems)
      break
    case 'llm_delta':
      newItems = handleLlmDelta(step, newItems)
      break
    default:
      return { items: newItems, hasUpdate: newItems !== items }
  }

  return { items: newItems, hasUpdate: newItems !== items }
}

// ============ Replay 事件转换 ============

/** AgentRun replay 事件类型 */
export interface AgentRunReplayEvent {
  seq: number
  event_type: string
  message_id: string | number
  payload: Record<string, any>
  payload_json?: string
  created_at?: number
}

/**
 * 将 replay/SSE 事件转换为 SSE 数据格式
 * 用于复用 processStreamDataItem 处理逻辑
 * @param event replay 事件或 SSE 事件（支持 event_type 或 type 字段）
 * @param actualMessageId 实际的 message_id（从 latest-run API 获取），用于覆盖事件中的 0 值
 */
export function convertReplayEventToSSE(event: AgentRunReplayEvent, actualMessageId?: string | number): any | null {
  // 支持 event_type（replay API）和 type（SSE）两种字段名
  const event_type = event.event_type || (event as any).type
  const { payload, message_id } = event
  // 使用传入的实际 message_id（如果有），否则使用事件中的 message_id
  const effectiveMessageId = actualMessageId || message_id || undefined


  switch (event_type) {
    case 'run.created':
      return effectiveMessageId ? { message_id: effectiveMessageId } : null
    case 'run.status_changed':
      return effectiveMessageId ? { message_id: effectiveMessageId } : null
    case 'process.step':
      // payload 已经是 SSE 格式: { object: "process.step", process_step: {...} }
      return { ...payload, message_id: effectiveMessageId }
    case 'message.delta':
      // payload 已经是 SSE 格式: { choices: [{ delta: { content, reasoning_content } }] }
      return {
        message_id: effectiveMessageId,
        ...payload
      }
    case 'run.completed':
      return effectiveMessageId ? { message_id: effectiveMessageId } : null
    case 'run.failed':
      return {
        message_id: effectiveMessageId,
        error: true,
        error_message: payload.error_message || '运行失败'
      }
    case 'run.cancelled':
      return effectiveMessageId ? { message_id: effectiveMessageId } : null
    default:
      return null
  }
}

/**
 * 处理单个 SSE 数据项（提取自 processStreamData，供复用）
 * 用于 SSE 流式输出和 replay 批量处理
 */
export function processStreamDataItem(
  data: any,
  message: any,
  formatRagStats: (ragStats: any, processRecords: any[]) => any
): void {
  const { message_id } = data

  // 处理错误
  if (data?.error) {
    message.error = true
    message.answer = data.error_message || t('agent.failed_tip')
    message.loading = false
    return
  }

  if (data.object === 'process.step') {
    const ps = data.process_step || {}
    const process_data = ps.data || {}

    if (!message.rag_temp) message.rag_temp = {}

    if (process_data.sources) {
      message.rag_temp.document_search = {
        chunks: process_data.sources
      }
    }
    if (!Array.isArray(message.process_records)) {
      message.process_records = []
    }
      message.process_records = [
        ...message.process_records,
        {
          ...ps,
          data: JSON.stringify(process_data)
        }
      ]
    if (process_data.document_search) {
      message.rag_temp.document_search = process_data.document_search
    }
    if (process_data.document_quotations) {
      message.rag_temp.document_quotations = process_data.document_quotations
    }
    if (process_data.file_quotations) {
      message.rag_temp.file_quotations = process_data.file_quotations
    }
    if (message.rag_temp.document_search) {
      message.rag_stats = formatRagStats(message.rag_temp, message.process_records || [])
    }
    message.rag_search_text = ps.message

    if (ps.step_code === 'output_files' && ps.status === 'completed' && ps.data) {
      appendOutputFiles(message, [
        ...normalizeOutputFiles(ps.data?.files),
        ...normalizeOutputFiles(ps.data?.media_attachments)
      ])
    }

    // 收集 skillRunItems
    if (!Array.isArray(message.skillRunItems)) message.skillRunItems = []

    const step: ProcessStep = {
      step_code: String(ps.step_code ?? ''),
      status: ps.status as StepStatus,
      message: String(ps.message ?? ''),
      data: ps.data
    }

    const { items: newItems } = applyProcessStep(step, message.skillRunItems)
    message.skillRunItems = newItems
  } else if (data.choices?.[0]?.delta) {
    // 处理普通消息内容
    const content = data.choices[0].delta.content?.replaceAll('<decision>DONE</decision>', '') || ''
    const reasoning_content = data.choices[0].delta.reasoning_content?.replaceAll('<decision>DONE</decision>', '') || ''

    if (content) {
      const failedTip = t('agent.failed_tip')
      if (content.startsWith('Upstream Error') || content.startsWith('Error: 当前应用模型余额不足')) {
        message.answer = failedTip
      } else if (message.answer === failedTip) {
        message.answer = content
      } else {
        message.answer += content
      }
    }
    if (reasoning_content) {
      message.reasoning_content += reasoning_content
    }
    if (
      message.answer?.trim() &&
      message.reasoning_content?.trim() &&
      message.reasoning_expanded
    ) {
      message.reasoning_expanded = false
    }
  }

  if (message_id) {
    message.id = message_id
  }
}

// ============ 主 Hook ============

/**
 * Chat Streaming Data Processing Hook
 */
export function useChatStream() {
  // Buffer for incomplete JSON data
  const jsonBufferRef = useRef('')

  // Process streaming data
  const processStreamData = useCallback((
    e: any,
    processedLength: number,
    message: any,
    networkSearch: boolean,
    formatRagStats: (ragStats: any, processRecords: any[]) => any
  ): number => {
    if (!e.event?.target || !message) return processedLength

    if (networkSearch) {
      message.rag_temp.type = 'web_search'
    }

    const fullResponse = e.event.target.response || ''
    const newChunk = fullResponse.substring(processedLength)
    const newProcessedLength = fullResponse.length

    try {
      const lines = newChunk
        .split('\n')
        .filter((line: string) => line.trim() !== '' && line.trim() !== 'data: [DONE]')

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          if (jsonBufferRef.current) {
            console.warn('检测到新的data:但缓冲区仍有数据，清空缓冲区:', jsonBufferRef.current.substring(0, 100))
            jsonBufferRef.current = ''
          }

          const jsonStr = line.slice(6)
          const data = parseJson(jsonStr)

          if (data) {
            if (data?.error) {
              // 提取 SSE 错误中的 message，优先使用后端返回的错误信息
              const errorObj = data.error
              let errorMessage = ''
              if(errorObj) {
                errorMessage = JSON.stringify({
                  error: errorObj
                })
              } else {
                errorMessage = t('agent.failed_tip')
              }
              message.error = true
              message.answer = errorMessage
              return newProcessedLength
            }

            processStreamDataItem(data, message, formatRagStats)
            jsonBufferRef.current = ''
          } else {
            jsonBufferRef.current = jsonStr
            console.log('JSON不完整，保存到缓冲区:', jsonStr.substring(0, 100))
          }
        } else {
          if (jsonBufferRef.current) {
            const combinedJson = jsonBufferRef.current + line
            const data = parseJson(combinedJson)

            if (data) {
              processStreamDataItem(data, message, formatRagStats)
              jsonBufferRef.current = ''
            } else {
              jsonBufferRef.current = combinedJson
              console.log('JSON仍不完整，继续累积:', combinedJson.substring(0, 100))
            }
          } else {
            message.error = true
            message.answer = line
            console.warn('收到不以data:开头的行，且无缓冲区:', line.substring(0, 50))
          }
        }
      }
    } catch (err: unknown) {
      console.error('处理流数据失败:', err)
      jsonBufferRef.current = ''
      message.error = true
      message.answer = err instanceof Error ? err.message : String(err)
    }

    return newProcessedLength
  }, [])

  // Clear JSON buffer
  const clearBuffer = useCallback(() => {
    jsonBufferRef.current = ''
  }, [])

  return {
    applyProcessStep,
    processStreamData,
    clearBuffer
  }
}

export default useChatStream
