import { useState, useCallback, useRef } from 'react'
import conversationApi from '@/api/modules/conversation/index'
import { formatFileInfo } from '@/api/modules/files/transform'
import { JSONParse } from '@km/shared-utils'
import { useRagStats } from './useRagStats'
import { useChatFeedback } from './useChatFeedback'
import { parseJson } from './useChatStream'

const createFeedbackUpdater = (feedback: any) => (msg: ProcessedMessage): ProcessedMessage => ({
  ...msg,
  ...feedback,
  feedbackVisible: msg.feedbackVisible ?? feedback.feedbackVisible,
  feedbackTypeOptions: msg.feedbackTypeOptions ?? feedback.feedbackTypeOptions,
  feedbackLoading: false
})

interface FileInfo {
  id: string
  file_name: string
  url: string
  mime_type?: string
  size?: number
  kind?: string
  message_id?: string | number
}

interface ProcessRecord {
  step_code: string
  status: string
  data: string | { files?: FileInfo[] }
}

interface Skill {
  skill_name: string
  display_name: string
}

interface UploadedFile {
  id: string
  name: string
  size?: number
  mime_type?: string
  preview_key?: string
}

interface SpecifiedFile {
  icon: string
  name: string
  isfolder?: boolean
}

interface FeedbackParams {
  feedbackId: number | null
  feedbackVisible: boolean
  feedbackTypeOptions: any[] | null
  submitBtnDisabled: boolean
  feedbackSuccessful: boolean
  feedback_type: string
  feedbackLoading: boolean
}

interface ProcessedMessage extends FeedbackParams {
  id: string | number
  question: string
  skill: Skill
  answer: string
  rag_stats?: any
  specified_files: SpecifiedFile[]
  uploaded_files: UploadedFile[]
  specified_content?: string
  outputFiles: FileInfo[]
  error: boolean
  reasoning_content?: string
  process_records?: ProcessRecord[]
  skillRunItems?: any[]
  rag_temp?: any
  rag_search_text?: string
  loading?: boolean
}

function processRecordsToOutputFiles(records: ProcessRecord[]): FileInfo[] {
  const outputFiles: FileInfo[] = []
  const indexByKey = new Map<string, number>()

  const appendFiles = (files: any[]) => {
    files.forEach((file: any) => {
      if (!file || typeof file !== 'object') return
      const fileName = file.file_name ?? file.fileName ?? file.filename ?? file.name
      const url = file.url ?? file.href ?? file.download_url ?? file.downloadUrl
      const id = file.id ?? file.file_id ?? file.fileId ?? url ?? fileName
      if (id == null && !url && !fileName) return
      const key = id != null ? String(id) : `${url || ''}|${fileName || ''}`
      const incoming = {
        id: String(id ?? key),
        file_name: fileName != null ? String(fileName) : '',
        url: url != null ? String(url) : '',
        download_url: typeof file.download_url === 'string' ? file.download_url : typeof file.downloadUrl === 'string' ? file.downloadUrl : undefined,
        signed_download_url: typeof file.signed_download_url === 'string' ? file.signed_download_url : typeof file.signedDownloadUrl === 'string' ? file.signedDownloadUrl : undefined,
        mime_type: file.mime_type ?? file.mimeType ?? file.mime,
        size: typeof file.size === 'number' ? file.size : Number.isFinite(Number(file.size)) ? Number(file.size) : undefined,
        kind: file.kind,
        message_id: file.message_id ?? file.messageId,
        source_kind: file.source_kind ?? file.sourceKind
      }
      if (key && indexByKey.has(key)) {
        const index = indexByKey.get(key)!
        const existing = outputFiles[index]
        outputFiles[index] = {
          ...incoming,
          ...existing,
          mime_type: existing.mime_type ?? incoming.mime_type,
          size: existing.size ?? incoming.size,
          kind: existing.kind ?? incoming.kind,
          message_id: existing.message_id ?? incoming.message_id,
          download_url: existing.download_url ?? incoming.download_url,
          signed_download_url: existing.signed_download_url ?? incoming.signed_download_url,
          source_kind: existing.source_kind ?? incoming.source_kind
        }
        return
      }
      if (key) indexByKey.set(key, outputFiles.length)
      outputFiles.push(incoming)
    })
  }

  for (const record of records) {
    if (record.step_code === 'output_files' && record.status === 'completed' && record.data) {
      const data = typeof record.data === 'string' ? parseJson(record.data) : record.data
      if (Array.isArray(data?.files)) appendFiles(data.files)
      if (Array.isArray(data?.media_attachments)) appendFiles(data.media_attachments)
    }
  }

  return outputFiles
}

interface UseChatMessagesOptions {
  limit?: number
  supportSpecifiedContent?: boolean
  skillList?: any[]
  mySkillList?: any[]
}

interface MessageState {
  messageList: any[]
  isLoadingMore: boolean
  hasMore: boolean
  offset: number
}

/**
 * Chat Messages Management Hook
 */
export function useChatMessages(options?: UseChatMessagesOptions) {
  const { formatRagStats } = useRagStats()
  const { loadMessageFeedback } = useChatFeedback()
  const skillList = options?.skillList || []
  const mySkillList = options?.mySkillList || []

  const limit = options?.limit || 10
  const supportSpecifiedContent = options?.supportSpecifiedContent || false

  const [state, setState] = useState<MessageState>({
    messageList: [],
    isLoadingMore: false,
    hasMore: true,
    offset: 0
  })

  const stateRef = useRef(state)
  stateRef.current = state

  // Load messages without blocking on feedback
  const loadMessages = useCallback(async (
    messages: any[],
    limit: number,
    skipFeedback: boolean = true,
    options?: { skillList?: any[]; mySkillList?: any[] }
  ) => {
    const validSkillList = options?.skillList || skillList
    const validMySkillList = options?.mySkillList || mySkillList

    try {
      const list = []

      for (const item of messages) {
        const message = JSONParse(
          item.message,
          typeof item.message === 'string' ? [{ role: 'user', content: item.message }] : []
        )
        const userMessage = message.find((item: any) => item.role === 'user') || { content: '' }
        const userInfoList = supportSpecifiedContent
          ? message.filter((item: any) => item.role === 'info')
          : [message.find((item: any) => item.role === 'info')].filter(Boolean)

        let specified_files: any[] = []
        let specified_content = ''
        let uploaded_files: any[] = []
        let questionText = ''

        // Parse user message content
        const userContent = JSONParse(userMessage.content, null)

        if (Array.isArray(userContent)) {
          // New format: contains text and files
          const textItem = userContent.find((item: any) => item?.type === 'text')
          questionText = textItem?.content || ''
          uploaded_files = userContent
            .filter((item: any) => item != null && item.type === 'file' && !item.library_id)
            .map((fileItem: any) => {
              const fileId = fileItem.content?.replace('file_id:', '') || ''
              return {
                id: fileId,
                name: fileItem.filename || `文件 ${fileId}`,
                size: fileItem.size,
                mime_type: fileItem.mime_type,
                preview_key: fileItem.preview_key
              }
            })
            specified_files = userContent
              .filter((item: any) => item != null && item.type === 'file' && item.library_id)
              .map((fileItem: any) => {
                const fileId = fileItem.content?.replace('file_id:', '') || ''
                const file = formatFileInfo(fileItem.filename || '', fileItem.isfolder)
                return {
                  icon: file.icon,
                  id: fileItem.file_id,
                  upload_file_id: fileId,
                  name: fileItem.filename,
                  file_id: fileItem.file_id,
                  library_id: fileItem.library_id,
                  mime_type: fileItem.mime_type,
                }
              })
        } else {
          // Old format: plain text or object
          const content = userMessage.content;
          questionText = typeof content === "string" ? content : (content?.text || content?.content || "");
        }

        // Parse skill name format "/skill_name question"
        let skill = {
          skill_name: '',
          display_name: ''
        }
        const skillMatch = questionText?.match(/^\/([^\s]+)\s+([\s\S]*)/)
        if (skillMatch) {
          const skillName = skillMatch[1]
          // Verify skill name exists in skill list
          const targetSkill = validSkillList.find((s: any) => s.skill_name === skillName) ||
            validMySkillList.find((s: any) => s.skill_name === skillName)
          if (targetSkill) {
            skill.display_name = targetSkill.display_name
            skill.skill_name = targetSkill.skill_name
            questionText = skillMatch[2]
          } else {
            skill.display_name = skillName
            skill.skill_name = skillName
            questionText = skillMatch[2]
          }
        }

        let answer = ''
        let processedOutputFiles: any[] = []
        // Process process_records to get output files
        if (item.process_records?.length > 0) {
          processedOutputFiles = processRecordsToOutputFiles(item.process_records)
        }
        answer += item.answer

        userInfoList.forEach((userInfo: any) => {
          if (!userInfo) return
          userInfo.content = JSONParse(userInfo.content, {})
          const infoType = userInfo.content?.type

          if (infoType === 'specified_files') {
            specified_files = [...specified_files, ...userInfo.content.list.map((fileItem: any) => {
              const file = formatFileInfo(fileItem.name, fileItem.isfolder)
              return {
                icon: file.icon,
                ...fileItem
              }
            })]
          } else if (infoType === 'specified_content' && supportSpecifiedContent) {
            specified_content = userInfo.content.content || ''
          }
        })

        // Initialize feedback params before background load
        const initialFeedbackParams = {
          feedbackId: null,
          feedbackVisible: false,
          feedbackTypeOptions: null,
          submitBtnDisabled: true,
          feedbackSuccessful: false,
          feedback_type: '',
          feedbackLoading: !skipFeedback
        }

        list.push({
          ...item,
          question: questionText,
          skill,
          answer: answer?.replaceAll('<decision>DONE</decision>', ''),
          rag_stats: formatRagStats(item.rag_stats, item.process_records),
          specified_files,
          uploaded_files,
          specified_content: supportSpecifiedContent ? specified_content : undefined,
          outputFiles: processedOutputFiles,
          ...initialFeedbackParams,
          error: answer?.includes('Access denied') || answer?.includes('InvalidApiKey') || false
        })
      }

      return {
        messages: list,
        hasMore: list.length === limit
      }
    } catch (err) {
      console.error('Failed to load messages:', err)
      return { messages: [], hasMore: false }
    }
  }, [formatRagStats, supportSpecifiedContent, skillList, mySkillList])

  // Batch load feedbacks in background
  const loadFeedbackBatch = useCallback(async (
    messageIds: (string | number)[],
    onUpdate: (id: string | number, feedback: any) => void
  ) => {
    const results = await Promise.all(
      messageIds.map(id => loadMessageFeedback(id as number).catch(() => null))
    )
    results.forEach((feedback, index) => {
      if (feedback) {
        onUpdate(messageIds[index], feedback)
      }
    })
  }, [loadMessageFeedback])

  // Load more messages
  const handleLoadListMore = useCallback(async (
    done: () => void,
    conversationId: string,
    options?: { skillList?: any[]; mySkillList?: any[] }
  ): Promise<void> => {
    const currentState = stateRef.current
    if (currentState.isLoadingMore || !currentState.hasMore) return done()

    if (!conversationId) return done()

    setState(prev => ({ ...prev, isLoadingMore: true }))

    const newOffset = currentState.offset + limit

    try {
      const res = await conversationApi.messasges(conversationId, { offset: newOffset, limit })
      const { messages, hasMore } = await loadMessages(res.data.messages, limit, true, options)
      setState(prev => ({
        ...prev,
        hasMore,
        offset: newOffset,
        messageList: [...messages, ...prev.messageList]
      }))

      // Background load feedbacks
      const ids = messages.map((m: any) => m.id)
      loadFeedbackBatch(ids, (id, feedback) => {
        setState(prev => ({
          ...prev,
          messageList: prev.messageList.map(msg =>
            msg.id === id ? createFeedbackUpdater(feedback)(msg) : msg
          )
        }))
      })
    } catch (err) {
      // 回滚 offset
      setState(prev => ({
        ...prev,
        offset: Math.max(0, prev.offset - limit)
      }))
    } finally {
      setState(prev => ({ ...prev, isLoadingMore: false }))
    }
    return done()
  }, [limit, loadMessages, loadFeedbackBatch])

  // Load message list
  const loadMessageList = useCallback(async (
    conversationId: string,
    options?: { skillList?: any[]; mySkillList?: any[]; isRunning?: boolean; runningMessageId?: string | number }
  ) => {
    setState(prev => ({ ...prev, isLoadingMore: true, offset: 0, hasMore: true }))

    try {
      const res = await conversationApi.messasges(conversationId, { offset: 0, limit })
      const { messages, hasMore } = await loadMessages(res.data.messages, limit, true, options)

      // 如果有运行中的 run，清空指定消息的运行时数据
      const isActiveRun = options?.isRunning
      const runningMessageId = options?.runningMessageId
      if (isActiveRun && runningMessageId && messages.length > 0) {
        const targetIndex = messages.findIndex((m: any) => m.id === runningMessageId)
        if (targetIndex !== -1) {
          messages[targetIndex] = {
            ...messages[targetIndex],
            // 清空需要由 replay/SSE 重新填充的字段
            reasoning_content: '',
            answer: '',
            process_records: [],
            skillRunItems: [],
            outputFiles: [],
            rag_temp: {},
            rag_stats: undefined,
            rag_search_text: '',
            loading: true
          }
        }
      }


      setState(prev => ({
        ...prev,
        hasMore,
        messageList: messages
      }))

      // Background load feedbacks
      const ids = messages.map((m: any) => m.id)
      loadFeedbackBatch(ids, (id, feedback) => {
        setState(prev => ({
          ...prev,
          messageList: prev.messageList.map(msg =>
            msg.id === id ? createFeedbackUpdater(feedback)(msg) : msg
          )
        }))
      })
    } finally {
      setState(prev => ({ ...prev, isLoadingMore: false }))
    }
  }, [limit, loadMessages, loadFeedbackBatch])

  // Regenerate answer
  const handleRegenerate = useCallback((message: any, onSend: (data: any) => void) => {
    onSend({
      textContent: message.question,
      atList: message.specified_files || [],
      files: message.uploaded_files || [],
      skill: message.skill || {},
      networkSearch: message.rag_stats?.type === 'web_search',
      knowledgeGraph: message.knowledge_graph,
      specifiedContent: message.specified_content,
    })
  }, [])

  // Render source
  const renderSource = useCallback((type: string, number: number, message: any) => {
    if (message.rag_stats?.type === 'web_search') {
      return number
    }
    return type + '-' + number
  }, [])

  // Handle source reference hover
  const handleSourceReferenceHover = useCallback((
    data: any,
    message: any,
    chunkRef: any,
    chunkSourceRef: any,
    graphRef?: any,
    graphSourceRef?: any
  ) => {
    const chunks = message.rag_stats?.chunks || []
    const key = `[Source:${data.sourceType}-${data.sourceNumber}]`
    const chunk = chunks.find((item: any) => item.source_key === key || item.source === key)
    if (chunk) {
      if (chunk.chunk_type === 'graph_result') {
        if (graphSourceRef) {
          graphSourceRef.current = data.element
        }
        graphRef?.current?.setLibraryInfo(chunk, message.rag_stats.type)
      } else {
        chunkSourceRef.current = data.element
        chunkRef.current?.setLibraryInfo(chunk, message.rag_stats.type)
      }
    } else {
      chunkSourceRef.current = null
      chunkRef.current?.setLibraryInfo(null, '')
    }
  }, [])

  // Open knowledge base
  const handleOpenKnow = useCallback((
    message: any,
    thinkknowledgeRef: any,
    setShowThinkKnowledge: (value: boolean) => void
  ) => {
    setShowThinkKnowledge(true)
    // Use setTimeout to ensure the component is mounted
    setTimeout(() => {
      thinkknowledgeRef.current?.updateResults(
        message.rag_stats?.files_search,
        message.rag_stats?.type
      )
    }, 0)
  }, [])

  // Clear message list
  const clearMessageList = useCallback(() => {
    setState(prev => ({
      ...prev,
      messageList: [],
      offset: 0,
      hasMore: true
    }))
  }, [])

  // Update message list (for React state management)
  const updateMessageList = useCallback((updater: (list: any[]) => any[]) => {
    setState(prev => {
      const newList = updater(prev.messageList)
      // Deduplicate by ID, keeping the last occurrence (Map preserves order, later entries win)
      const deduped = [...new Map(newList.map(m => [m.id, m])).values()]
      return {
        ...prev,
        messageList: deduped
      }
    })
  }, [])

  return {
    state,
    loadMessages,
    handleLoadListMore,
    loadMessageList,
    handleRegenerate,
    renderSource,
    handleSourceReferenceHover,
    handleOpenKnow,
    clearMessageList,
    updateMessageList
  }
}

export default useChatMessages
