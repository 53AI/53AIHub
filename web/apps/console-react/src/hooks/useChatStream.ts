import { useRef, useCallback } from 'react'
import { filesApi } from '@/api'

// ============ 类型定义 ============

/** 技能运行项状态 */
export type SkillRunItemStatus = 'pending' | 'running' | 'completed'

/** 流程步骤状态 */
export type StepStatus = 'start' | 'streaming' | 'completed'

/** 脚本类技能项 */
export type SkillRunScriptItem = {
  type: 'script'
  title: string
  bash: string
  output: string
  status: SkillRunItemStatus
}

/** LLM 思考流步骤 */
export type SkillRunLlmItem = {
  type: 'llm'
  title: string
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

export function parseJson<T>(json: string): T | null {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

function formatBash(code: string, language: string): string {
  const trimmed = (code || '').trim()
  return trimmed ? (language === 'bash' || !language ? `$ ${trimmed}` : trimmed) : ''
}

function getIntentData(raw: unknown): IntentData | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  return {
    intent: r.intent != null ? String(r.intent) : undefined,
    skill_name: r.skill_name != null ? String(r.skill_name) : undefined,
    confidence: typeof r.confidence === 'number' ? r.confidence : undefined,
    reasoning: r.reasoning != null ? String(r.reasoning) : undefined,
    keywords: Array.isArray(r.keywords) ? r.keywords.map(String) : undefined,
    answer: r.answer != null ? String(r.answer) : undefined,
    expanded_queries: r.expanded_queries,
  }
}

/** 序列化 skillRunItems 为 skill-run 块字符串 */
export function serializeSkillRunItems(items: SkillRunItem[]): string {
  const serialized = items.map((item) => {
    if (item.type === 'skill') {
      const { _bash, _toolCallId, ...rest } = item as SkillRunSkillItem
      return rest
    }
    return item
  })
  const hasSkill = serialized.some((item) => item.type === 'skill' && item.skillName)
  const hasLlm = serialized.some((item) => item.type === 'llm')
  return serialized.length && (hasSkill || hasLlm)
    ? '```skill-run\n' + JSON.stringify(serialized) + '\n```\n\n'
    : ''
}

/** 提取意图识别的 reasoning */
export function extractReasoningFromItems(items: SkillRunItem[]): string {
  for (const item of items) {
    if (item.type === 'skill' && item.intentData?.reasoning) {
      return `${item.intentData.reasoning}\n\n`
    }
  }
  return ''
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

function updateSkillItem(
  items: SkillRunItem[],
  predicate: (item: SkillRunItem) => boolean,
  updater: (item: SkillRunSkillItem) => Partial<SkillRunSkillItem>,
): SkillRunItem[] {
  const idx = items.findIndex(predicate)
  if (idx === -1) return items
  const item = items[idx] as SkillRunSkillItem
  return [...items.slice(0, idx), { ...item, ...updater(item) }, ...items.slice(idx + 1)]
}

// ============ 独立的流程处理函数（不依赖 React hooks） ============

/** 处理意图识别 */
export function handleIntentClassification(step: ProcessStep, skillRunItems: SkillRunItem[]): SkillRunItem[] {
  if (step.status === 'start') {
    return [...skillRunItems, { type: 'skill', title: step.message || '正在识别意图...', status: 'running' }]
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
        intentData,
      }),
    )
  }
  return skillRunItems
}

/** 处理技能路由 */
export function handleSkillRouting(step: ProcessStep, skillRunItems: SkillRunItem[]): SkillRunItem[] {
  if (step.status === 'completed') {
    return updateSkillItem(
      skillRunItems,
      (item) => item.type === 'skill',
      (item) => ({
        title: item.skillName ? `技能加载完成` : step.message,
        status: 'completed',
      }),
    )
  }
  return skillRunItems
}

/** 处理工具执行开始 -> 第二步：正在使用技能 */
export function handleToolExecutionStart(step: ProcessStep, skillRunItems: SkillRunItem[]): SkillRunItem[] {
  if (step.status !== 'start' || !step.data) return skillRunItems

  const data = step.data as {
    skill_name?: string
    tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>
  }
  const calls = data?.tool_calls ?? []
  const firstSkill = skillRunItems.find((item) => item.type === 'skill') as SkillRunSkillItem | undefined

  let newItems = [...skillRunItems]
  for (const call of calls) {
    const args = parseJson<{ code?: string; language?: string }>(call.function?.arguments ?? '{}') ?? {}
    const bash = formatBash(args.code ?? '', args.language ?? 'bash')

    newItems = [
      ...newItems,
      {
        type: 'skill',
        title: '正在使用技能...',
        status: 'running',
        skillName: data?.skill_name,
        intentData: firstSkill?.intentData,
        _bash: bash,
        _toolCallId: (call.id ?? '') + '_running',
      },
    ]
  }
  return newItems
}

/** 处理工具执行结果 -> 第三步：技能执行完成 */
export function handleToolResult(step: ProcessStep, skillRunItems: SkillRunItem[]): SkillRunItem[] {
  if (step.status !== 'completed' || !step.data) return skillRunItems

  const data = step.data as { tool_call_id?: string; result?: string; skill_name?: string }
  const toolCallId = (data?.tool_call_id ?? '') + '_running'
  const result = typeof data?.result === 'string' ? data.result : ''

  // 更新第二步状态并获取 bash
  let bash = ''
  let newItems = [...skillRunItems]
  const idx = newItems.findIndex(
    (item) => item.type === 'skill' && (item as SkillRunSkillItem)._toolCallId === toolCallId,
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
      status: 'completed',
    },
  ]
}

/** 处理 Agent 规划轮的 LLM 输出，并保持在 skill-run 流程块中 */
export function handleLlmDelta(step: ProcessStep, skillRunItems: SkillRunItem[]): SkillRunItem[] {
  if ((step.status !== 'streaming' && step.status !== 'completed') || !step.data) return skillRunItems

  const data = step.data as { content?: unknown }
  const content = typeof data.content === 'string' ? data.content : ''
  if (!content) return skillRunItems

  const completed = step.status === 'completed'

  const existingIdx = skillRunItems.findIndex((item) => item.type === 'llm' && item.status === 'running')
  if (existingIdx !== -1) {
    const existing = skillRunItems[existingIdx] as SkillRunLlmItem
    return [
      ...skillRunItems.slice(0, existingIdx),
      {
        ...existing,
        title: completed ? '思考完成' : existing.title,
        content: completed && content.startsWith(existing.content) ? content : existing.content + content,
        status: completed ? 'completed' : 'running',
      },
      ...skillRunItems.slice(existingIdx + 1),
    ]
  }

  return [
    ...skillRunItems,
    {
      type: 'llm',
      title: completed ? '思考完成' : '思考中...',
      content,
      status: completed ? 'completed' : 'running',
    },
  ]
}

function finishLlmDelta(skillRunItems: SkillRunItem[]): SkillRunItem[] {
  const llmIdx = skillRunItems.findIndex((item) => item.type === 'llm' && item.status === 'running')
  if (llmIdx === -1) return skillRunItems
  const item = skillRunItems[llmIdx] as SkillRunLlmItem
  return [
    ...skillRunItems.slice(0, llmIdx),
    { ...item, title: '思考完成', status: 'completed' },
    ...skillRunItems.slice(llmIdx + 1),
  ]
}

/** 应用流程步骤到 skillRunItems，返回更新后的 items 和是否有数据变化 */
export function applyProcessStep(step: ProcessStep, items: SkillRunItem[]): { items: SkillRunItem[]; hasUpdate: boolean } {
  let newItems = [...items]

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

// ============ 主 Hook ============

/**
 * 聊天流式数据处理 Hook
 */
export const useChatStream = () => {
  // 用于缓存不完整的JSON数据
  const jsonBufferRef = useRef('')

  // 处理流式数据的函数
  const processStreamData = useCallback(
    (
      e: any,
      processedLength: number,
      messageList: any[],
      networkSearch: boolean,
      formatRagStats: (ragStats: any) => any,
    ): number => {
      const lastMessage = messageList[messageList.length - 1]
      if (!e.event?.target || !lastMessage) return processedLength

      // 调试日志
      console.log('[useChatStream] onDownloadProgress triggered', {
        hasTarget: !!e.event?.target,
        response: e.event?.target?.response?.substring(0, 200),
        lastMessageId: lastMessage?.id,
      })

      if (networkSearch) {
        lastMessage.rag_temp.type = 'web_search'
      }

      const fullResponse = e.event.target.response || ''
      const newChunk = fullResponse.substring(processedLength)
      const newProcessedLength = fullResponse.length

      // 调试日志
      if (newChunk) {
        console.log('[useChatStream] newChunk:', newChunk.substring(0, 100))
      }

      // 处理解析成功的JSON数据
      const handleParsedData = (data: any) => {
        const { message_id } = data
        if (data.object === 'process.step') {
          const ps = data.process_step || {}
          const process_data = ps.data || {}

          // llm_delta 是一个连续流，不能按 step_code + status 去重；
          // 其它步骤仍按原有规则去重。
          const isLlmDelta = ps.step_code === 'llm_delta'
          const stepId = ps.step_id ?? `${ps.step_code}_${ps.status}`
          if (!Array.isArray(lastMessage.processedStepIds)) lastMessage.processedStepIds = []
          if (!isLlmDelta && lastMessage.processedStepIds.includes(stepId)) {
            // 已处理过，跳过
            return
          }
          if (!isLlmDelta) lastMessage.processedStepIds.push(stepId)

          if (process_data.sources) {
            lastMessage.rag_temp.document_search = {
              chunks: process_data.sources,
            }
          }
          if (process_data.document_search) {
            lastMessage.rag_temp.document_search = process_data.document_search
          }
          if (process_data.document_quotations) {
            lastMessage.rag_temp.document_quotations = process_data.document_quotations
          }
          if (process_data.file_quotations) {
            lastMessage.rag_temp.file_quotations = process_data.file_quotations
          }
          if (lastMessage.rag_temp.document_search) {
            lastMessage.rag_stats = formatRagStats(lastMessage.rag_temp, lastMessage.process_records || [])
          }
          lastMessage.rag_search_text = ps.message

          if (ps.step_code === 'output_files' && ps.status === 'completed' && ps.data) {
            const files = ps.data?.files
            if (Array.isArray(files) && files.length > 0) {
              if (!Array.isArray(lastMessage.outputFiles)) {
                lastMessage.outputFiles = []
              }
              lastMessage.outputFiles.push(
                ...files.map((file: any) => ({
                  id: file.id,
                  file_name: file.file_name,
                  url: file.url,
                })),
              )
            }
          }

          // 收集 skillRunItems 并流式更新 answer
          if (!Array.isArray(lastMessage.skillRunItems)) lastMessage.skillRunItems = []

          const step: ProcessStep = {
            step_code: String(ps.step_code ?? ''),
            status: ps.status as StepStatus,
            message: String(ps.message ?? ''),
            data: ps.data,
          }

          const { items: newItems, hasUpdate } = applyProcessStep(step, lastMessage.skillRunItems)
          lastMessage.skillRunItems = newItems

          // 只有在有数据更新时才重新渲染 skill-run 块
          if (hasUpdate && newItems?.length) {
            const reasoningBlock = extractReasoningFromItems(newItems)
            const skillRunBlock = serializeSkillRunItems(newItems)

            // 移除已有的 skill-run 块及其前面的所有内容（包括 reasoning）
            let existingContent = lastMessage.answer || ''
            existingContent = existingContent.replace(/[\s\S]*?```skill-run\n[\s\S]*?\n```\n?/g, '')

            lastMessage.answer = reasoningBlock + skillRunBlock + existingContent
          }
        } else {
          const content = data.choices?.[0]?.delta?.content
          const reasoning_content = data.choices?.[0]?.delta?.reasoning_content

          // 调试日志
          console.log('[useChatStream] parsed data:', {
            object: data.object,
            content: content?.substring(0, 50),
            reasoning_content: reasoning_content?.substring(0, 50),
          })

          if (content) {
            const failedTip =
              typeof window !== 'undefined' && (window as any).$t
                ? (window as any).$t('agent.failed_tip')
                : 'agent.failed_tip'
            if (content.startsWith('Upstream Error') || content.startsWith('Error: 当前应用模型余额不足')) {
              lastMessage.answer = failedTip
            } else if (lastMessage.answer === failedTip) {
              lastMessage.answer = content
            } else {
              // 清空 skillRunItems（已通过流式更新合并到 answer）
              if (lastMessage.skillRunItems?.length) {
                lastMessage.skillRunItems = []
              }
              // 直接追加 content（skill-run 块已通过流式更新添加）
              lastMessage.answer += content
            }
          }
          if (reasoning_content) {
            lastMessage.reasoning_content += reasoning_content
          }
          // 当开始输出答案内容且已有深度思考内容时，自动收起深度思考面板
          if (
            lastMessage.answer?.trim() &&
            lastMessage.reasoning_content?.trim() &&
            lastMessage.reasoning_expanded
          ) {
            lastMessage.reasoning_expanded = false
          }
        }
        if (message_id) {
          lastMessage.id = message_id
        }
      }

      try {
        // 处理SSE格式的数据
        const lines = newChunk
          .split('\n')
          .filter((line: string) => line.trim() !== '' && line.trim() !== 'data: [DONE]')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            // 如果有缓冲区数据，先清空（因为新的data:表示新的数据开始）
            if (jsonBufferRef.current) {
              console.warn(
                '检测到新的data:但缓冲区仍有数据，清空缓冲区:',
                jsonBufferRef.current.substring(0, 100),
              )
              jsonBufferRef.current = ''
            }

            const jsonStr = line.slice(6) // 去掉 'data: ' 前缀
            const data = parseJson(jsonStr)

            if (data) {
              handleParsedData(data)
              jsonBufferRef.current = ''
            } else {
              jsonBufferRef.current = jsonStr
              console.log('JSON不完整，保存到缓冲区:', jsonStr.substring(0, 100))
            }
          } else {
            // 不以 'data: ' 开头，可能是JSON的后续部分
            if (jsonBufferRef.current) {
              const combinedJson = jsonBufferRef.current + line
              const data = parseJson(combinedJson)

              if (data) {
                handleParsedData(data)
                jsonBufferRef.current = ''
              } else {
                jsonBufferRef.current = combinedJson
                console.log('JSON仍不完整，继续累积:', combinedJson.substring(0, 100))
              }
            } else {
              lastMessage.error = true
              lastMessage.answer = line
              console.warn('收到不以data:开头的行，且无缓冲区:', line.substring(0, 50))
            }
          }
        }
      } catch (err: unknown) {
        console.error('处理流数据失败:', err)
        jsonBufferRef.current = ''
        lastMessage.error = true
        lastMessage.answer = err instanceof Error ? err.message : String(err)
      }

      return newProcessedLength
    },
    [],
  )

  // 清空JSON缓冲区
  const clearBuffer = useCallback(() => {
    jsonBufferRef.current = ''
  }, [])

  return {
    applyProcessStep,
    processStreamData,
    clearBuffer,
  }
}

export default useChatStream
