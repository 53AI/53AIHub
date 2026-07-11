import { useState, useCallback, useRef } from 'react'
import { conversationApi } from '@/api'
import { formatFileInfo } from '@/api/modules/files/transform'
import { JSONParse } from '@/utils'
import { useRagStats } from './useRagStats'
import {
  type SkillRunItem,
  type ProcessStep,
  parseJson,
  serializeSkillRunItems,
  extractReasoningFromItems,
  applyProcessStep
} from './useChatStream'

function processRecordsToSkillRunItems(records: any[]) {
  let skillRunItems: SkillRunItem[] = []
  const outputFiles = []

  for (const record of records || []) {
    const step: ProcessStep = {
      step_code: String(record.step_code ?? ''),
      status: record.status as 'start' | 'completed' | 'success',
      message: String(record.message ?? ''),
      data: record.data ? parseJson(record.data) : undefined
    }

    const { items, hasUpdate } = applyProcessStep(step, skillRunItems)
    if (hasUpdate) {
      skillRunItems = items
    }

    if (record.step_code === 'output_files' && record.status === 'completed' && record.data) {
      const data = typeof record.data === 'string' ? parseJson(record.data) : record.data
      const files = data?.files
      if (Array.isArray(files) && files.length > 0) {
        outputFiles.push(
          ...files.map((file: any) => ({
            id: file.id,
            file_name: file.file_name,
            url: file.url
          }))
        )
      }
    }
  }

  return { skillRunItems, outputFiles }
}

interface MessageState {
  messageList: any[]
  isLoadingMore: boolean
  hasMore: boolean
  offset: number
}

/**
 * 聊天消息管理 Hook
 */
export const useChatMessages = (options?: {
  limit?: number
  supportSpecifiedContent?: boolean
  skillList?: any[]
  mySkillList?: any[]
}) => {
  const { formatRagStats } = useRagStats()

  const limit = options?.limit || 10
  const supportSpecifiedContent = options?.supportSpecifiedContent || false
  const skillList = options?.skillList || []
  const mySkillList = options?.mySkillList || []

  const [state, setState] = useState<MessageState>({
    messageList: [],
    isLoadingMore: false,
    hasMore: true,
    offset: 0,
  })

  // 使用 ref 存储消息列表的可变引用，确保 useChatSend 始终访问最新数组
  const messageListRef = useRef<any[]>(state.messageList)

  // 同步 ref 与 state
  const syncToRef = useCallback((list: any[]) => {
    messageListRef.current = list
  }, [])

  // 加载消息列表
  const loadMessages = useCallback(
    async (
      messages: any[],
      limit: number,
      showFeedback: boolean = true,
      options?: { skillList?: any[]; mySkillList?: any[] }
    ) => {
      const validSkillList = options?.skillList || skillList
      const validMySkillList = options?.mySkillList || mySkillList

      try {
        const list = []

        for (const item of messages) {
          const message = JSONParse(
            item.message,
            typeof item.message === 'string' ? [{ role: 'user', content: item.message }] : [],
          )
          const userMessage = message.find((item: any) => item.role === 'user') || { content: '' }
          const userInfoList = supportSpecifiedContent
            ? message.filter((item: any) => item.role === 'info')
            : [message.find((item: any) => item.role === 'info')].filter(Boolean)

          let specified_files: any[] = []
          let specified_content = ''
          let uploaded_files: any[] = []
          let questionText = ''

          // 解析用户消息内容
          const userContent = JSONParse(userMessage.content, null)

          if (Array.isArray(userContent)) {
            // 新格式：包含文本和文件
            const textItem = userContent.find((item: any) => item?.type === 'text')
            questionText = textItem?.content || ''
            uploaded_files = userContent
              .filter((item: any) => item != null && item.type === 'file')
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
          } else {
            // 旧格式：纯文本或对象
            const content = userMessage.content;
            questionText = typeof content === "string" ? content : (content?.text || content?.content || "");
          }

          // 解析技能名格式 "/技能名 问题"
          let skill = {
            skill_name: '',
            display_name: ''
          }
          const skillMatch = questionText?.match(/^\/([^\s]+)\s+([\s\S]*)/)
          if (skillMatch) {
            const skillName = skillMatch[1]
            // 验证技能名是否存在于技能列表中
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

          // 处理 process_records 生成 skillRunItems 和渲染内容
          if (item.process_records?.length > 0) {
            // 处理技能运行步骤
            const { skillRunItems, outputFiles } = processRecordsToSkillRunItems(item.process_records)
            if (skillRunItems.length > 0) {
              const reasoningBlock = extractReasoningFromItems(skillRunItems)
              const skillRunBlock = serializeSkillRunItems(skillRunItems)
              // 如果 answer 中已包含 skill-run 块，先移除
              const cleanAnswer = answer.replace(/[\s\S]*?```skill-run\n[\s\S]*?\n```\n?/g, '')
              answer = reasoningBlock + skillRunBlock + cleanAnswer
            }

            // 输出文件
            processedOutputFiles = outputFiles
          }
          answer += item.answer

          userInfoList.forEach((userInfo: any) => {
            if (!userInfo) return
            userInfo.content = JSONParse(userInfo.content, {})
            const infoType = userInfo.content?.type

            if (infoType === 'specified_files') {
              specified_files = userInfo.content.list.map((fileItem: any) => {
                const file = formatFileInfo(fileItem.name, fileItem.isfolder)
                return {
                  icon: file.icon,
                  ...fileItem,
                }
              })
            } else if (infoType === 'specified_content' && supportSpecifiedContent) {
              specified_content = userInfo.content.content || ''
            }
          })

          let feedbackParams = null
          // if(showFeedback) {
          //   feedbackParams = await loadMessageFeedback(item.id)
          // }

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
            ...feedbackParams,
            error:
              answer?.includes('Access denied') ||
              answer?.includes('InvalidApiKey') ||
              false,
          })
        }

        return {
          messages: list,
          hasMore: list.length === limit,
        }
      } catch (err) {
        console.error('加载消息失败:', err)
        return { messages: [], hasMore: false }
      }
    },
    [formatRagStats, supportSpecifiedContent, skillList, mySkillList],
  )

  // 加载更多消息
  const handleLoadListMore = useCallback(
    async (
      conversationId: string,
      skillOptions?: { skillList?: any[]; mySkillList?: any[] }
    ): Promise<void> => {
      if (state.isLoadingMore || !state.hasMore || !conversationId) return

      const newOffset = state.offset + limit

      setState((prev) => ({ ...prev, isLoadingMore: true, offset: newOffset }))

      try {
        const res = await conversationApi.messages(conversationId, { offset: newOffset, limit })
        const { messages, hasMore } = await loadMessages(
          (res as any).data?.messages || [],
          limit,
          true,
          skillOptions
        )

        setState((prev) => {
          const newList = [...messages, ...prev.messageList]
          messageListRef.current = newList
          return {
            ...prev,
            hasMore,
            messageList: newList,
            isLoadingMore: false,
          }
        })
      } catch (err) {
        setState((prev) => ({
          ...prev,
          offset: Math.max(0, prev.offset - limit),
          isLoadingMore: false,
        }))
      }
    },
    [state.isLoadingMore, state.hasMore, state.offset, limit, loadMessages],
  )

  // 加载消息列表
  const loadMessageList = useCallback(
    async (
      conversationId: string,
      skillOptions?: { skillList?: any[]; mySkillList?: any[] }
    ) => {
      setState((prev) => ({
        ...prev,
        isLoadingMore: true,
        offset: 0,
        hasMore: true,
      }))

      try {
        const res = await conversationApi.messages(conversationId, { offset: 0, limit })
        const { messages, hasMore } = await loadMessages(
          (res as any).data?.messages || [],
          limit,
          true,
          skillOptions
        )

        setState((prev) => {
          messageListRef.current = messages
          return {
            ...prev,
            hasMore,
            messageList: messages,
            isLoadingMore: false,
          }
        })
      } finally {
        setState((prev) => ({ ...prev, isLoadingMore: false }))
      }
    },
    [limit, loadMessages],
  )

  // 重置状态
  const resetState = useCallback(() => {
    setState({
      messageList: [],
      isLoadingMore: false,
      hasMore: true,
      offset: 0,
    })
    messageListRef.current = []
  }, [])

  // 添加消息
  const addMessage = useCallback((message: any) => {
    setState((prev) => {
      const newList = [...prev.messageList, message]
      messageListRef.current = newList
      return { ...prev, messageList: newList }
    })
  }, [])

  // 更新最后一条消息
  const updateLastMessage = useCallback((updater: (msg: any) => any) => {
    setState((prev) => {
      if (prev.messageList.length === 0) return prev
      const newMessages = [...prev.messageList]
      newMessages[newMessages.length - 1] = updater(newMessages[newMessages.length - 1])
      messageListRef.current = newMessages
      return { ...prev, messageList: newMessages }
    })
  }, [])

  // 重新生成回答
  const handleRegenerate = useCallback(
    (message: any, onSend: (data: any) => void) => {
      onSend({
        textContent: message.original_question || message.question,
        atList: message.specified_files || [],
      })
    },
    [],
  )

  // 渲染来源
  const renderSource = useCallback((type: string, number: number, message: any) => {
    if (message.rag_stats?.type === 'web_search') {
      return number
    }
    return type + '-' + number
  }, [])

  // 处理来源引用悬停
  const handleSourceReferenceHover = useCallback(
    (data: any, message: any, chunkRef: any, chunkSourceRef: any) => {
      const chunks = message.rag_stats?.chunks || []
      const key = `[Source:${data.sourceType}-${data.sourceNumber}]`
      const chunk = chunks.find(
        (item: any) => item.source_key === key || item.source === key,
      )
      if (chunk) {
        chunkSourceRef.current = data.element
        chunkRef.current?.setLibraryInfo(chunk, message.rag_stats.type)
      } else {
        chunkSourceRef.current = null
        chunkRef.current?.setLibraryInfo(null, '')
      }
    },
    [],
  )

  // 强制更新消息列表（用于流式数据更新后触发重新渲染）
  const forceUpdate = useCallback(() => {
    setState((prev) => {
      // 同步 ref 到最新状态
      messageListRef.current = [...prev.messageList]
      return { ...prev, messageList: messageListRef.current }
    })
  }, [])

  return {
    state,
    messageListRef,
    loadMessages,
    handleLoadListMore,
    loadMessageList,
    resetState,
    addMessage,
    updateLastMessage,
    forceUpdate,
    handleRegenerate,
    renderSource,
    handleSourceReferenceHover,
  }
}

export default useChatMessages
