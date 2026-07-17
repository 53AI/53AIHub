import { forwardRef, useImperativeHandle, useRef, useState, useEffect } from 'react'
import { Button, Empty, message } from 'antd'
import { t } from '@/locales'
import { useAgentFormStore } from '../store'
import { useConversationStore } from '@/stores'
import { copyToClip } from '@km/shared-utils'
import { api_host } from '@/utils/config'
import { AGENT_TYPES } from '@/constants/platform/config'
import uploadApi from '@/api/modules/upload'
import { XBubbleList, XBubbleUser, XBubbleAssistant, XIcon, XSender } from '@km/hub-ui-x-react'

interface ChatMessage {
  question: {
    role: string
    content: string
    user_files: any[]
  }
  answer: {
    loading: boolean
    role: string
    content: string
    reasoning_expanded: boolean
    reasoning_content: string
  }
}

const ConversationType = {
  FORMAL: 0, // 正式会话
  TEST: 1,   // 调试会话
} as const

interface ChatProps {
  className?: string
  onSave?: (options?: { restart?: boolean }) => void
}

export interface ChatRef {
  restart: (options?: { saveAction?: boolean }) => void
  getIsConfigChanged: () => boolean
}

export const Chat = forwardRef<ChatRef, ChatProps>(({ className, onSave }, ref) => {
  const agentFormStore = useAgentFormStore()
  const conversationStore = useConversationStore()

  const scrollRef = useRef<any>(null)
  const [chatList, setChatList] = useState<ChatMessage[]>([])
  const [conversationCreating, setConversationCreating] = useState(false)
  const [isConfigChanged, setIsConfigChanged] = useState(false)

  const abortControllerRef = useRef<AbortController | null>(null)
  const conversationIdRef = useRef(0)
  const activeChatIndexRef = useRef(-1)
  const renderTimerRef = useRef<NodeJS.Timeout | null>(null)
  const activeChatDataRef = useRef<ChatMessage>({
    question: {
      role: 'user',
      content: '',
      user_files: [],
    },
    answer: {
      loading: false,
      role: '',
      content: '',
      reasoning_expanded: false,
      reasoning_content: '',
    },
  })

  const chatLoading = conversationCreating || chatList.some(item => item.answer.loading)

  const enableUpload = Boolean(
    agentFormStore.form_data.settings?.file_parse?.enable ||
    agentFormStore.form_data.settings?.image_parse?.enable
  )

  const uploadAccept = (() => {
    let accept = ''
    if (agentFormStore.form_data.settings?.file_parse?.enable) {
      accept += '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.html,.json,.xml,.md'
    }
    if (agentFormStore.form_data.settings?.image_parse?.enable) {
      accept += ',image/*'
    }
    return accept
  })()

  const allowSendWithFiles = [AGENT_TYPES['53AI_AGENT'], AGENT_TYPES.FASTGPT_AGENT].includes(
    agentFormStore.agent_type as any
  )

  const showWelcome = (() => {
    const { settings } = agentFormStore.form_data
    if (settings.opening_statement.replace(/\s/g, '')) return true
    if (settings.suggested_questions.length && settings.suggested_questions.some(item => item.content?.replace?.(/\s/g, ''))) {
      return true
    }
    return false
  })()

  const showChatListEmpty = !chatList.length && !showWelcome

  const httpRequest = async (dataFile: File) => {
    try {
      const res = await uploadApi.upload(dataFile)
      return {
        id: res.data.id,
        url: `${api_host}/api/preview/${res.data.preview_key || ''}`,
        size: res.data.size,
        name: res.data.file_name,
        mime_type: res.data.mime_type,
      }
    } catch (error) {
      return {}
    }
  }

  const onSendConfirm = async (question: string, userFiles?: any[], type = '') => {
    if (chatLoading) return
    userFiles = userFiles || []
    if (!agentFormStore.agent_data.agent_id) {
      message.warning(t('agent_not_found'))
      return
    }
    if (!agentFormStore.agent_data.channel_type) {
      await agentFormStore.saveAgentData({ hideToast: true })
    }

    if (!conversationIdRef.current) {
      setConversationCreating(true)
      const { data = {} }: any = await conversationStore
        .save({ data: { agent_id: agentFormStore.agent_data.agent_id, title: question, conversation_type: ConversationType.TEST } })
        .finally(() => {
          setConversationCreating(false)
        })
      conversationIdRef.current = data.conversation_id
    }

    if (type !== 'regenerate') {
      userFiles = userFiles?.map(item => ({
        type: 'image',
        content: `file_id:${item.id}`,
        filename: item.name,
        size: item.size,
        mime_type: item.mime_type,
        url: item.url,
      })) || []
    }

    const newChat: ChatMessage = {
      question: {
        role: 'user',
        content: question,
        user_files: userFiles as any[],
      },
      answer: {
        loading: true,
        role: 'assistant',
        content: '',
        reasoning_expanded: true,
        reasoning_content: '',
      },
    }

    setChatList(prev => {
      const newList = [...prev, newChat]
      activeChatIndexRef.current = newList.length - 1
      activeChatDataRef.current = newList[activeChatIndexRef.current] || {}
      return newList
    })

    let messages = [{ role: 'user', content: question }]
    if (userFiles && userFiles.length) {
      messages = [
        {
          role: 'user',
          content: JSON.stringify([
            {
              type: 'text',
              content: question,
            },
            ...userFiles,
          ]),
        },
      ]
    }

    let receivedContent = ''
    abortControllerRef.current = new AbortController()

    conversationStore
      .chat({
        data: {
          conversation_id: conversationIdRef.current,
          messages,
          agent_id: agentFormStore.agent_data.agent_id,
          agent_configs: agentFormStore.agent_data.configs,
        },
        hideError: true,
        onDownloadProgress: async ({ chunks = [], intact_content, intact_reasoning_content }: any = {}) => {
          receivedContent = intact_content || ''
          // 直接修改 ref 引用的对象（与 Vue 一致）
          if (activeChatDataRef.current && activeChatDataRef.current.answer) {
            activeChatDataRef.current.answer.content = intact_content || activeChatDataRef.current.answer.content || ''
            activeChatDataRef.current.answer.reasoning_content =
              intact_reasoning_content || activeChatDataRef.current.answer.reasoning_content || ''
            if (chunks[0] && chunks[0].role) {
              activeChatDataRef.current.answer.role = chunks[0].role || activeChatDataRef.current.answer.role || ''
            }
            // 当开始输出答案内容且已有深度思考内容时，自动收起深度思考面板
            if (
              activeChatDataRef.current.answer.content?.trim() &&
              activeChatDataRef.current.answer.reasoning_content?.trim() &&
              activeChatDataRef.current.answer.reasoning_expanded
            ) {
              activeChatDataRef.current.answer.reasoning_expanded = false
            }
          }
          // 防抖渲染：取消前一个定时器，只保留最后一个
          if (renderTimerRef.current) {
            clearTimeout(renderTimerRef.current)
          }
          renderTimerRef.current = setTimeout(() => {
            setChatList(prev => [...prev])
            renderTimerRef.current = null
          }, 200)
        },
        signal: abortControllerRef.current.signal,
      })
      .catch(() => {})
      .finally(() => {
        // 清理防抖定时器
        if (renderTimerRef.current) {
          clearTimeout(renderTimerRef.current)
          renderTimerRef.current = null
        }
        const lastIntactContent = receivedContent || activeChatDataRef.current?.answer?.content || ''
        if (
          lastIntactContent?.startsWith('Upstream Error') ||
          lastIntactContent?.startsWith('Error: 当前应用模型余额不足') ||
          !lastIntactContent
        ) {
          if (activeChatDataRef.current?.answer) {
            activeChatDataRef.current.answer.content = t('agent_app.failed_tip')
          }
          message.warning(t('agent_app.failed_tip'))
        }
        if (activeChatDataRef.current?.answer?.loading) {
          activeChatDataRef.current.answer.loading = false
        }
        setChatList(prev => [...prev])
        abortControllerRef.current = null
      })

    // 滚动到底部 (类似 nextTick)
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollToBottom?.()
      }
    }, 0)
  }

  const onStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    if (activeChatDataRef.current && activeChatDataRef.current.answer) {
      activeChatDataRef.current.answer.loading = false
      setChatList(prev => [...prev])
    }
  }

  const onRestartGeneration = (data: ChatMessage) => {
    onSendConfirm(data.question.content, data.question.user_files, 'regenerate')
  }

  const onRestart = ({ saveAction = false } = {}) => {
    conversationIdRef.current = 0
    setChatList([])
    setIsConfigChanged(false)
  }

  const onCopy = async (text = '') => {
    await copyToClip(text)
    message.success(t('action_copy_success'))
  }

  const handleSuggestion = (question: string) => {
    onSendConfirm(question)
  }

  // 监听 custom_config 变化，设置 isConfigChanged
  useEffect(() => {
    setIsConfigChanged(false)
    if (conversationIdRef.current) {
      setIsConfigChanged(true)
    }
  }, [agentFormStore.form_data.custom_config])

  useImperativeHandle(ref, () => ({
    restart: onRestart,
    getIsConfigChanged: () => isConfigChanged,
  }))

  return (
    <div className={`h-full flex flex-col relative ${className || ''}`}>
      {/* 配置变更遮罩 */}
      {isConfigChanged && (
        <div className="absolute top-0 left-0 w-full h-full bg-black/70 z-10">
          <div className="flex flex-col items-center justify-center gap-6 w-full h-full box-border">
            <div className="text-base text-[#fff] text-center mx-8">
              {t('debugger_config_change_confirm')}
            </div>
            <Button type="primary" onClick={() => onRestart({ saveAction: true })}>
              {t('save_and_restart')}
            </Button>
          </div>
        </div>
      )}

      {/* 气泡列表区域 */}
      <XBubbleList
        ref={scrollRef}
        messages={chatList}
        className="flex-1 px-4 relative py-4"
        mainClass="mx-5"
      >
        {/* Header slot - 空状态和欢迎消息 */}
        {showChatListEmpty && (
          <Empty className="mt-10" description={t('chat.empty_desc')} />
        )}
        {showWelcome && (
          <XBubbleAssistant
            type="welcome"
            content={agentFormStore.form_data.settings.opening_statement}
            suggestions={agentFormStore.form_data.settings.suggested_questions}
            onSuggestion={handleSuggestion}
          />
        )}

        {/* Item slot - 消息列表 */}
        {chatList.map((message, messageIndex) => (
          <div key={messageIndex}>
            <XBubbleUser content={message.question.content} files={message.question.user_files}>
              {!message.answer.loading && (
                <span slot="menu">
                  <XIcon size={16} className="cursor-pointer" name="copy" onClick={() => onCopy(message.question.content)} />
                </span>
              )}
            </XBubbleUser>
            <XBubbleAssistant
              content={message.answer.content}
              reasoning={message.answer.reasoning_content}
              reasoningExpanded={message.answer.reasoning_expanded}
              streaming={message.answer.loading}
              alwaysShowMenu={messageIndex === chatList.length - 1}
            >
              {!message.answer.loading && (
                <>
                  <span slot="menu">
                    <XIcon size={16} className="cursor-pointer" name="copy" onClick={() => onCopy(message.answer.content)} />
                  </span>
                  <span slot="menu">
                    <XIcon size={16} className="cursor-pointer" name="refresh" onClick={() => onRestartGeneration(message)} />
                  </span>
                </>
              )}
            </XBubbleAssistant>
          </div>
        ))}
      </XBubbleList>

      {/* 发送区域 */}
      <div className="px-6 py-3">
        <XSender
          loading={chatLoading}
          onSend={onSendConfirm}
          onStop={onStopGeneration}
          fileUpload={{
            enabled: enableUpload,
            acceptTypes: uploadAccept,
            request: httpRequest,
            allowMultiple: true,
            enableDrag: true,
            allowSendWithFiles,
          }}
        />
      </div>
    </div>
  )
})

Chat.displayName = 'Chat'

export default Chat
