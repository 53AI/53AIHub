import { useRef, useCallback } from 'react'
import { conversationApi } from '@/api'
import { useChatStream } from './useChatStream'
import { useRagStats } from './useRagStats'

/**
 * 聊天消息发送 Hook
 */
export const useChatSend = () => {
  const { processStreamData, clearBuffer } = useChatStream()
  const { formatRagStats } = useRagStats()

  const abortControllerRef = useRef<AbortController | null>(null)

  // 发送消息
  const sendMessage = useCallback(
    async (options: {
      question: string
      agent_id: number
      conversation_id: number
      modelId?: string
      completion_params?: any
      messageList: any[]
      /** 消息列表的 ref，用于获取最新的消息列表引用 */
      messageListRef?: React.MutableRefObject<any[]>
      links?: any[]
      networkSearch?: boolean
      library?: { value: string[] | number[] }
      agentInfo?: any
      // 上传的文件列表
      files?: Array<{ id: string; name: string; size: number; mime_type: string; preview_key?: string }>
      // 文件聊天特有
      fileInfo?: any
      slideContent?: string
      // 选项
      sendOptions?: {
        prompt?: string
        text?: string
      }
      /** 为 true 时仅传 conversation_id / model / messages / frequency_penalty / presence_penalty / stream / temperature / top_p / completion_params，不传知识库、文件等扩展参数 */
      minimalParams?: boolean
      /** 技能标识 */
      skill?: {
        skill_name: string
        display_name: string
      }
      /** 类型标识，用于区分不同的聊天场景 */
      type?: string
      /** 添加消息回调，用于触发 React 重新渲染 */
      onAddMessage?: (message: any) => void
      /** 更新消息回调，用于触发 React 重新渲染 */
      onUpdateMessage?: () => void
    }) => {
      const {
        question,
        agent_id,
        conversation_id,
        modelId = '',
        completion_params = {},
        messageList: _messageList,
        messageListRef,
        links = [],
        networkSearch = false,
        library,
        agentInfo,
        files = [],
        fileInfo,
        sendOptions = {},
        minimalParams = false,
        skill = {
          skill_name: '',
          display_name: '',
        },
        type = '',
        onAddMessage,
        onUpdateMessage,
      } = options

      // 使用 ref 获取最新的消息列表，如果没有 ref 则使用传入的 messageList
      const getMessageList = () => messageListRef?.current || _messageList

      // 清空JSON缓冲区，开始新的请求
      clearBuffer()

      const newMessage = {
        id: Date.now().toString(),
        question: question,
        answer: '',
        loading: true,
        agent_id: String(agent_id),
        conversation_id,
        reasoning_content: '',
        reasoning_expanded: true,
        specified_files: links.map((item: any) => ({
          id: item.id,
          name: item.name,
          icon: item.icon,
          library_id: item.library_id
        })),
        uploaded_files: [],
        specified_content: sendOptions.text || '',
        skill,
        parsed_message: [],
        process_records: [],
        rag_stats: null,
        rag_search_text: '',
        rag_temp: {
          type: 'rag_search'
        },
        feedbackId: null,
        feedbackVisible: false,
        feedbackTypeOptions: null,
        submitBtnDisabled: true,
        feedbackSuccessful: false
      }
      // 使用回调添加消息，不再直接 push（避免重复添加）
      if (onAddMessage) {
        onAddMessage(newMessage)
      } else {
        getMessageList().push(newMessage)
      }

      let processedLength = 0
      let messages: any[] = []

      const userMessageContent: any[] = []

      // 如果有技能名，将问题格式化为 "/技能名 问题"
      const formattedQuestion = skill && skill.skill_name && skill.display_name ? `/${skill.skill_name} ${question}` : question
      userMessageContent.push({
        type: 'text',
        content: formattedQuestion
      })

      if (files.length > 0 || (type === 'work-ai' && links.length > 0)) {
        files.forEach((file) => {
          userMessageContent.push({
            type: 'file',
            content: `file_id:${file.id}`,
            filename: file.name,
            size: file.size,
            mime_type: file.mime_type,
            preview_key: file.preview_key
          })
        })

        links.forEach((file: any) => {
          if (!file.upload_file_id) return
          userMessageContent.push({
            type: 'file',
            content: `file_id:${file.upload_file_id}`,
            filename: file.name,
            size: file.file_size,
            mime_type: file.file_mime,
          })
        })

        messages.push({
          role: 'user',
          content: JSON.stringify(userMessageContent)
        })

        if (files.length > 0) {
          newMessage.uploaded_files = [
            ...files
          ]
        }

        if(links.length > 0) {
          newMessage.specified_files = links.map((item: any) => ({
            id: item.id,
            name: item.name,
            icon: item.icon,
            library_id: item.library_id,
            file_size: item.file_size,
            file_mime: item.file_mime,
          }))
        }
      } else {
        const formattedQuestion = skill && skill.skill_name && skill.display_name ? `/${skill.skill_name} ${question}` : question
        messages.push({ content: formattedQuestion, role: 'user' })
      }

      // 添加系统提示词
      if (sendOptions.prompt) {
        messages.unshift({ content: sendOptions.prompt, role: 'system' })
      }

      // 添加指定内容
      if (sendOptions.text) {
        messages.unshift({
          content: JSON.stringify({
            type: 'specified_content',
            content: sendOptions.text,
          }),
          role: 'info',
        })
        newMessage.specified_content = sendOptions.text
      }

      // 添加指定文件
      if (type !== 'work-ai' && links.length > 0) {
        const specified_files = links.map((item) => ({
          id: item.id,
          name: item.name,
          library_id: item.library_id,
          ...(item.isfolder !== undefined && { isfolder: item.isfolder }),
        }))
        messages.unshift({
          content: JSON.stringify({
            type: 'specified_files',
            list: specified_files,
          }),
          role: 'info',
        })
        newMessage.specified_files = links.map((item: any) => ({
          id: item.id,
          name: item.name,
          icon: item.icon,
          library_id: item.library_id
        }))
      }

      abortControllerRef.current = new AbortController()
      const rerankConfig = agentInfo?.settings?.rerank_config || {}
      const webSearchConfig = agentInfo?.settings?.web_search_setting || {}

      const completionsPayload = minimalParams
        ? {
            conversation_id,
            model: 'agent-' + agent_id + (modelId ? '-' + modelId : ''),
            messages,
            frequency_penalty: 0,
            presence_penalty: 0,
            stream: true,
            temperature: 0,
            top_p: 0,
            ...completion_params,
          }
        : {
            conversation_id,
            model: 'agent-' + agent_id + (modelId ? '-' + modelId : ''),
            messages,
            enable_process_steps: true,
            frequency_penalty: 0,
            temperature: 0.5,
            top_p: 1,
            presence_penalty: 0,
            stream: true,
            knowledge_base_ids:
              networkSearch || links.length > 0
                ? []
                : library?.value || (fileInfo ? [] : [-1]),
            file_ids: links.length > 0 ? links.map((item: any) => item.id) : [],
            message_file_id: fileInfo?.id,
            solo_file_mode: !!fileInfo,
            search_config: {
              ...rerankConfig,
              top_k: networkSearch
                ? webSearchConfig.top_k || rerankConfig.top_k
                : rerankConfig.top_k,
            },
            web_search_config: networkSearch ? webSearchConfig : {},
            ...completion_params,
          }

      try {
        await conversationApi.completions(completionsPayload, {
          responseType: 'stream',
          onDownloadProgress: (e) => {
            const currentList = getMessageList()
            processedLength = processStreamData(
              e,
              processedLength,
              currentList,
              networkSearch,
              formatRagStats,
            )
            // 触发 React 重新渲染
            onUpdateMessage?.()
          },
          signal: abortControllerRef.current.signal,
        } as any)
      } catch (err: any) {
        const currentList = getMessageList()
        if (err.message !== 'canceled') {
          const lastMessage = currentList[currentList.length - 1]
          if (lastMessage && !lastMessage.answer) {
            lastMessage.answer =
              err.response?.data ||
              (typeof window !== 'undefined' && (window as any).$t
                ? (window as any).$t('response_code.network_error')
                : '网络错误')
          }
        }
        throw err
      } finally {
        const currentList = getMessageList()
        const lastMessage = currentList[currentList.length - 1]
        if (lastMessage) {
          lastMessage.loading = false
        }
        abortControllerRef.current = null
        clearBuffer()
        // 触发 React 重新渲染
        onUpdateMessage?.()
      }
    },
    [processStreamData, clearBuffer, formatRagStats],
  )

  // 停止生成
  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    clearBuffer()
  }, [clearBuffer])

  // 获取 AbortController
  const getAbortController = useCallback(() => abortControllerRef.current, [])

  return {
    sendMessage,
    handleStop,
    getAbortController,
  }
}

export default useChatSend
