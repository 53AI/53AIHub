/**
 * 聊天消息发送 Hook
 *
 * ## 使用场景
 * 本 Hook 被 4 个页面引用，通过 `type` 参数区分场景：
 *
 * | 场景 | 页面 | type | 特点 |
 * |------|------|------|------|
 * | 知识库搜索 | knowledge/chat.tsx | (空) | 完整参数，支持网络搜索/知识图谱/@文件 |
 * | 工作台AI | work-ai-chat.tsx | 'work-ai' | 支持技能选择、文件上传、links用upload_file_id |
 * | 文件助手 | library/file/assistant/Chat.tsx | (空) | 单文件聊天模式(fileInfo)、划词内容(options) |
 * | 智能体对话 | chat/chat/index.tsx | 'agent' | 精简参数(minimalParams)、文件直接序列化 |
 *
 * ## 核心流程
 * 1. 清空流式缓冲区，创建新消息对象
 * 2. 根据 type 和文件情况构建 API messages
 * 3. 发送 completions 请求（流式）
 * 4. 流式处理响应数据，更新消息对象
 * 5. 请求结束或出错时更新 UI 状态
 *
 * ## 流式数据处理（useChatStream）
 * processStreamData 负责解析 SSE 格式的流式数据：
 * - 格式: `data: {...}`
 * - 支持不完整 JSON 的缓冲处理（网络分片）
 * - 两种数据类型：
 *   1. `process.step`: 流程步骤（知识库搜索、技能执行、输出文件等）
 *   2. `choices[0].delta`: 消息内容（content、reasoning_content）
 *
 * ## RAG 统计格式化（useRagStats）
 * formatRagStats 负责整理 RAG 检索结果：
 * - 从 process_records 提取 knowledge_search 数据
 * - 格式化 document_search.chunks（包含文件信息、来源信息）
 * - 生成 document_quotations、file_quotations 用于引用展示
 */
import { useRef, useCallback } from 'react'
import chatApi from '@/api/modules/chat/index'
import recentUsedApi from '@/api/modules/recent-used'
import type { RecentUsedSaveItem } from '@/api/modules/recent-used/types'
import { useChatStream } from './useChatStream'
import { useRagStats } from './useRagStats'
import { t } from '@/locales'

/**
 * 发送消息参数
 */
interface SendMessageOptions {
  /** 用户输入的问题文本 */
  question: string
  /** 智能体 ID，拼接为 model: `agent-{agent_id}[-{modelId}]` */
  agent_id: string
  /** 会话标识，后端用于关联历史消息 */
  conversation_id: string | number
  /** 模型版本标识，拼接在 agent_id 后面 */
  modelId?: string
  /** 覆盖默认 LLM 参数，优先级最高 */
  completion_params?: any
  /**
   * 知识库文件链接（@文件选择）
   * - 非 work-ai: 作为 specified_files（info 消息）
   * - work-ai: 用 upload_file_id 字段加入 user 消息
   */
  links?: any[]
  /** 启用网络搜索，影响 web_search_config 和 knowledge_base_ids */
  networkSearch?: boolean
  /** 启用知识图谱搜索，设置 enable_graph_search=true */
  knowledgeGraph?: boolean
  /** 知识库 ID 列表，有 links/networkSearch 时清空 */
  library?: { value: string[] | number[] }
  /** 智能体配置，提取 rerank_config 和 web_search_setting */
  agentInfo?: any
  /**
   * 上传的文件列表
   * - agent 场景：直接序列化到 user 消息
   * - 其他场景：转为 file_id 格式
   */
  files?: Array<{ id: string; name: string; size: number; mime_type: string; preview_key: string }>
  /**
   * 单文件聊天模式
   * 设置 solo_file_mode=true，message_file_id=fileInfo.id
   */
  fileInfo?: any
  /** 消息增强选项 */
  options?: {
    /** System Prompt，插入到 messages 开头（role: 'system'） */
    prompt?: string
    /** 指定内容，作为上下文注入（role: 'info'，type: 'specified_content'） */
    text?: string
  }
  /**
   * 精简模式，只传核心参数
   * 用于 agent 场景，跳过知识库、文件、搜索配置
   */
  minimalParams?: boolean
  /**
   * 技能标签，将问题格式化为 `/技能名 问题`
   * 用于 work-ai 场景
   */
  skill?: {
    skill_name: string
    display_name: string
  }
  /**
   * 场景标识，影响文件处理逻辑：
   * - 'agent': 文件直接序列化，minimalParams 默认为 true
   * - 'work-ai': links 用 upload_file_id，不添加 specified_files info 消息
   * - 其他: links 作为 specified_files，files 用 file_id 格式
   */
  type?: string
  /**
   * React 状态更新回调
   * 替代直接 push messageList，触发 React 重渲染
   * @param updater 状态更新函数
   * @param newMessage 新消息对象（用于额外逻辑，如 work-ai 的 latest_run 请求）
   */
  onMessageListChange?: (updater: (list: any[]) => any[], newMessage?: any) => void
}

/**
 * 格式化问题：添加技能前缀
 */
function formatQuestionWithSkill(question: string, skill?: { skill_name: string; display_name: string }) {
  return skill?.skill_name && skill?.display_name ? `/${skill.skill_name} ${question}` : question
}

/**
 * 构建文件内容项（用于 user 消息中的文件）
 */
function buildFileContent(file: any, useUploadId: boolean = false) {
  const fileId = useUploadId ? file.upload_file_id : file.id
  if (!fileId) return null
  return {
    type: 'file',
    content: `file_id:${fileId}`,
    filename: file.name,
    size: file.file_size ?? file.size,
    mime_type: file.file_mime ?? file.mime_type,
    preview_key: file.preview_key,
    file_id: file.id ?? '',
    library_id: file.library_id ?? '',
  }
}

/**
 * 构建 specified_files（用于 info 消息）
 * 包含文件、知识库和空间
 */
function buildSpecifiedFilesInfo(links: any[]) {
  return {
    content: JSON.stringify({
      type: 'specified_files',
      list: links.map(item => ({
        id: item.id,
        name: item.name,
        icon: item.icon,
        library_id: item.library_id,
        ...(item.isfolder !== undefined && { isfolder: item.isfolder }),
        ...(item.islibrary && { islibrary: item.islibrary }),
        ...(item.isspace && { isspace: item.isspace })
      }))
    }),
    role: 'info'
  }
}

/**
 * 构建 specified_content（用于 info 消息）
 */
function buildSpecifiedContentInfo(text: string) {
  return {
    content: JSON.stringify({ type: 'specified_content', content: text }),
    role: 'info'
  }
}

export function useChatSend() {
  const { processStreamData, clearBuffer } = useChatStream()
  const { formatRagStats } = useRagStats()

  /** 用于取消请求的 AbortController */
  const abortControllerRef = useRef<AbortController | null>(null)
  /** 当前正在处理的消息引用 */
  const currentMessageRef = useRef<any>(null)
  /** 请求锁：防止并发请求覆盖 currentMessageRef */
  const requestIdRef = useRef(0)

  const sendMessage = useCallback(async (options: SendMessageOptions) => {
    const {
      question,
      agent_id,
      conversation_id,
      modelId = '',
      completion_params = {},
      links = [],
      networkSearch = false,
      knowledgeGraph = false,
      library,
      agentInfo,
      files = [],
      fileInfo,
      options: sendOptions = {},
      minimalParams = false,
      skill,
      type = '',
      onMessageListChange,
    } = options

    // ========== 场景标识 ==========
    const isFromWorkAI = type === 'work-ai'
    const isAgentType = type === 'agent'
    const hasFiles = files.length > 0


    // 从 links 中区分文件、知识库和空间
    const linkFiles = links.filter(link => !link.islibrary && !link.isspace)
    const linkLibraries = links.filter(link => link.islibrary)
    const linkSpaces = links.filter(link => link.isspace)
    const hasLinkFiles = linkFiles.length > 0
    const hasLinkLibraries = linkLibraries.length > 0
    const hasLinkSpaces = linkSpaces.length > 0

    // ========== 清理上一次请求状态 ==========
    clearBuffer()
    const requestId = ++requestIdRef.current

    // ========== 1. 构建用户消息内容 ==========
    const formattedQuestion = formatQuestionWithSkill(question, skill)
    const userMessageContent: any[] = [{ type: 'text', content: formattedQuestion }]
    const uploadedFiles: any[] = []
    const specifiedFiles: any[] = []

    if (isAgentType && hasFiles) {
      // agent 场景：文件直接序列化
      userMessageContent.push(...files)
      uploadedFiles.push(...files)
    } else if (hasFiles || hasLinkFiles) {
      // 其他场景：文件转为 file_id 格式
      // work-ai 场景：links 也用 upload_file_id 加入 user 消息
      files.forEach(file => {
        const item = buildFileContent(file)
        if (item) userMessageContent.push(item)
      })
      uploadedFiles.push(...files)

      // 只处理非知识库的 links
      linkFiles.forEach(file => {
        const item = buildFileContent(file, isFromWorkAI ? true : false)
        if (item) userMessageContent.push(item)
      })
    }

    // UI 展示用的 specified_files（包含文件、知识库和空间）
    if (hasLinkFiles) {
      specifiedFiles.push(...linkFiles.map(item => ({
        id: item.id,
        name: item.name,
        icon: item.icon,
        library_id: item.library_id,
        ...(item.file_size && { file_size: item.file_size }),
        ...(item.file_mime && { file_mime: item.file_mime }),
        islibrary: false,
        isspace: false
      })))
    }
    if (hasLinkLibraries) {
      specifiedFiles.push(...linkLibraries.map(item => ({
        id: item.id,
        name: item.name,
        icon: item.icon,
        islibrary: true,
        isspace: false
      })))
    }
    if (hasLinkSpaces) {
      specifiedFiles.push(...linkSpaces.map(item => ({
        id: item.id,
        name: item.name,
        icon: item.icon,
        isspace: true,
        islibrary: false
      })))
    }

    // ========== 2. 构建 API messages ==========
    const messages: any[] = []

    // system prompt
    if (sendOptions.prompt) {
      messages.push({ content: sendOptions.prompt, role: 'system' })
    }

    // specified_content
    if (sendOptions.text) {
      messages.push(buildSpecifiedContentInfo(sendOptions.text))
    }

    // specified_files（包含文件、知识库和空间）
    if (hasLinkFiles || hasLinkLibraries || hasLinkSpaces) {
      messages.push(buildSpecifiedFilesInfo([...linkFiles, ...linkLibraries, ...linkSpaces]))
    }

    // user 消息
    const userContent = hasFiles || hasLinkFiles
      ? JSON.stringify(userMessageContent)
      : formattedQuestion
    messages.push({ role: 'user', content: userContent })

    // ========== 3. 创建 UI 消息对象 ==========
    const newMessage = {
      id: Date.now().toString(),
      question,
      answer: '',
      loading: true,
      agent_id: String(agent_id),
      conversation_id: String(conversation_id),
      reasoning_content: '',
      reasoning_expanded: true,
      specified_files: specifiedFiles,
      uploaded_files: uploadedFiles,
      specified_content: sendOptions.text || '',
      skill: skill || { skill_name: '', display_name: '' },
      parsed_message: [],
      process_records: [],
      rag_stats: null,
      rag_search_text: '',
      rag_temp: { type: 'rag_search' },
      feedbackId: null,
      feedbackVisible: false,
      feedbackTypeOptions: null,
      submitBtnDisabled: true,
      feedbackSuccessful: false,
      knowledge_graph: knowledgeGraph,
    }

    currentMessageRef.current = newMessage

    // 添加消息到列表（必须通过 onMessageListChange 传递）
    onMessageListChange?.(list => [...list, newMessage], newMessage)

    // ========== 4. 构建请求参数 ==========
    const model = `agent-${agent_id}${modelId ? `-${modelId}` : ''}`
    const rerankConfig = agentInfo?.settings?.rerank_config || {}
    const webSearchConfig = agentInfo?.settings?.web_search_setting || {}

    const completionsPayload = minimalParams
      ? {
          conversation_id,
          model,
          messages,
          frequency_penalty: 0,
          presence_penalty: 0,
          stream: true,
          temperature: 0,
          top_p: 0,
          ...completion_params
        }
      : {
          conversation_id,
          model,
          messages,
          enable_process_steps: true,
          frequency_penalty: 0,
          temperature: 0.5,
          top_p: 1,
          presence_penalty: 0,
          stream: true,
          knowledge_base_ids: networkSearch
            ? []
            : hasLinkLibraries
              ? linkLibraries.map(lib => String(lib.id))
              : (library?.value || (fileInfo ? [] : [-1])),
          file_ids: hasLinkFiles ? linkFiles.map(item => item.id) : [],
          space_ids: hasLinkSpaces ? linkSpaces.map(item => String(item.id)) : [],
          message_file_id: fileInfo?.id,
          solo_file_mode: !!fileInfo,
          search_config: {
            ...rerankConfig,
            top_k: networkSearch ? (webSearchConfig.top_k || rerankConfig.top_k) : rerankConfig.top_k
          },
          web_search_config: networkSearch ? webSearchConfig : {},
          enable_graph_search: knowledgeGraph,
          ...completion_params
        }
  
    // ========== 5. 发送请求 ==========
    abortControllerRef.current = new AbortController()
    let processedLength = 0
    let lastUpdateTime = 0
    const UPDATE_INTERVAL = 100 // 每 100ms 最多更新一次 UI
    try {
      // 保存最近使用记录
      if (!isAgentType && links.length > 0) {
        const recentItems: RecentUsedSaveItem[] = links.map(link => ({
          resource_type: (link as any).isspace ? 0 : (link.islibrary ? 1 : 2),
          resource_id: link.id || ''
        }))
        if (recentItems.length > 0) {
          recentUsedApi.save(recentItems)
        }
      }

      await chatApi.completions(completionsPayload, {
        responseType: 'stream',
        onDownloadProgress: (e: any) => {
          // 检查请求是否已被新请求覆盖
          if (requestId !== requestIdRef.current) return
          processedLength = processStreamData(e, processedLength, currentMessageRef.current, networkSearch, formatRagStats)

          // 节流触发 React 重渲染
          const now = Date.now()
          if (now - lastUpdateTime >= UPDATE_INTERVAL && onMessageListChange) {
            lastUpdateTime = now
            onMessageListChange(list => [...list], newMessage)
          }
        },
        signal: abortControllerRef.current.signal
      })
    } catch (err: any) {
      // 旧请求被覆盖时静默忽略错误（新请求会处理自己的错误）
      if (requestId !== requestIdRef.current) return

      if (err.message !== 'canceled') {
        const currentMessage = currentMessageRef.current
        if (currentMessage && !currentMessage.answer) {
          currentMessage.answer = err.response?.data || t('response_code.network_error')
          currentMessage.error = true
        }
      }
      throw err
    } finally {
      // 只有当前请求才更新状态
      if (requestId === requestIdRef.current) {
        const currentMessage = currentMessageRef.current
        if (currentMessage) currentMessage.loading = false
        abortControllerRef.current = null
        clearBuffer()
        if (onMessageListChange) onMessageListChange(list => [...list], newMessage)
      }
    }
  }, [processStreamData, clearBuffer, formatRagStats])

  /** 停止生成 */
  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    clearBuffer()
  }, [clearBuffer])

  /** 获取当前 AbortController */
  const getAbortController = useCallback(() => abortControllerRef.current, [])

  return {
    sendMessage,
    handleStop,
    getAbortController
  }
}

export default useChatSend
