import { forwardRef, useImperativeHandle, useRef, useState, useEffect } from 'react'
import { Button, message } from 'antd'
import { useAgentCreateAdapter } from '../../adapters'
import { useAgentFormStore } from '../../store'
import { useAgentPreviewSender } from '../../hooks/useAgentPreviewSender'
import { PreviewModelSelector } from './PreviewModelSelector'
import { PreviewKnowledgeSourceSelector } from './PreviewKnowledgeSourceSelector'
import { copyToClip } from '@km/shared-utils'
// 通过相对路径引用 shared-business/chat 内的 hooks，避免 tsup 自引用 dist 子路径未构建的问题
import { useChatStream, useRagStats } from '../../../chat/hooks'
import { ProcessFlowHeader } from '../../../chat/components/process-flow'

/** 条件字段展开：只包含有值（非 undefined/null/false）的字段 */
function buildOptionalFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined && v !== null && v !== false)
  )
}

/**
 * 简化的本地消息形态，对齐 useChatSend.ts 的 Message 语义：
 * - `answer` 是字符串（useChatStream.processStreamData/processStreamDataItem 直接写入这里）
 * - `loading` / `reasoning_content` 等与 Message 同名
 * - UI 渲染字段（content={message.answer}, streaming={message.loading}）保持 Message 直读习惯
 */
interface ChatMessage {
  question: {
    role: string
    content: string
    user_files: any[]
  }
  /** 助手消息字段（Message 语义） */
  answer: string
  loading: boolean
  role: string
  reasoning_expanded: boolean
  reasoning_content: string
  process_records?: any[]
  rag_stats?: any
  rag_temp?: any
  skill?: { skill_name: string; display_name: string }
  knowledge_graph?: boolean
}

const ConversationType = {
  FORMAL: 0,
  TEST: 1,
} as const

interface ChatProps {
  className?: string
  onSave?: (options?: { restart?: boolean }) => void
  /** 是否隐藏标题（用于 CreatePageLayout 等已有外部标题的场景） */
  hideTitle?: boolean
}

export interface ChatRef {
  restart: (options?: { saveAction?: boolean }) => void
  getIsConfigChanged: () => boolean
}

export const Chat = forwardRef<ChatRef, ChatProps>(({ className, onSave: _onSave, hideTitle = false }, ref) => {
  const adapter = useAgentCreateAdapter()
  const t = adapter.t || ((key: string) => key)

  const agentFormStore = useAgentFormStore()

  const previewSender = useAgentPreviewSender({
    agent_id: agentFormStore.agent_id,
    agent_type: agentFormStore.agent_type,
    agent_data: agentFormStore.agent_data,
    form_data: agentFormStore.form_data,
  })

  // 流式解析：复用 shared-business/chat 的标准实现，自动累积 process_records / rag_stats
  // 注：useChatStream 内部依赖 useChatAdapters()（无 ChatConfigProvider 时返回 undefined），
  // 主流程 processStreamData 不依赖 adapters，可安全使用。
  const { processStreamData, processStreamDataItem, clearBuffer } = useChatStream()
  const { formatRagStats } = useRagStats()

  const scrollRef = useRef<any>(null)
  const [chatList, setChatList] = useState<ChatMessage[]>([])
  const [conversationCreating, setConversationCreating] = useState(false)
  const [isConfigChanged, setIsConfigChanged] = useState(false)

  const abortControllerRef = useRef<AbortController | null>(null)
  const conversationIdRef = useRef<string | number>(0)
  const activeChatIndexRef = useRef(-1)
  const renderTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeChatDataRef = useRef<ChatMessage>({
    question: {
      role: 'user',
      content: '',
      user_files: [],
    },
    answer: '',
    loading: false,
    role: '',
    reasoning_expanded: false,
    reasoning_content: '',
    // useChatStream.processStreamData 写入的字段，初值给空，避免首次写入 undefined 报错
    process_records: [],
    rag_stats: null,
    rag_temp: { type: 'rag_search' },
    skill: { skill_name: '', display_name: '' },
    knowledge_graph: false,
  })

  const chatLoading = conversationCreating || chatList.some(item => item.loading)

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

  const AGENT_TYPES = adapter.AGENT_TYPES || {}
  const allowSendWithFiles = [AGENT_TYPES['53AI_AGENT'], AGENT_TYPES.FASTGPT_AGENT].includes(
    agentFormStore.agent_type as any
  )

  const showWelcome = (() => {
    const { settings } = agentFormStore.form_data
    if (settings.opening_statement?.replace(/\s/g, '')) return true
    if (settings.suggested_questions?.length && settings.suggested_questions?.some(item => item.content?.replace?.(/\s/g, ''))) {
      return true
    }
    return false
  })()

  const showChatListEmpty = !chatList.length

  const Bubble = adapter.BubbleComponents

  const httpRequest = async (dataFile: File) => {
    if (!adapter.uploadFile) return {}
    try {
      const res = await adapter.uploadFile(dataFile)
      return {
        id: res.id,
        url: res.url,
        size: res.size,
        name: res.name,
        mime_type: res.mime_type,
      }
    } catch (error) {
      return {}
    }
  }

  // Sender 的 onSend 回调入参（hub-ui-x-react Sender.tsx 行 384-394）
  interface SenderSendData {
    textContent: string
    pureTextContent: string
    atList: any[]
    skillList: string[]
    selectedSkills: Array<{ display_name: string; skill_name?: string }>
    files: any[]
  }

  const onSendConfirm = async (data: SenderSendData, options?: { isRegenerate?: boolean }) => {
    if (chatLoading) return
    const textContent = data.textContent || ''
    let userFiles: any[] = data.files || []
    const selectedSkills = data.selectedSkills || []
    const isRegenerate = !!options?.isRegenerate

    const agentId = agentFormStore.agent_id
    if (!agentId) {
      message.warning(t('agent.preview_publish_first'))
      return
    }

    if (!agentFormStore.agent_data.channel_type) {
      if (adapter.save) {
        await adapter.save(agentFormStore.form_data)
      }
    }

    if (!conversationIdRef.current) {
      if (!adapter.createConversation) {
        message.warning('createConversation not configured')
        return
      }
      setConversationCreating(true)
      try {
        const data = await adapter.createConversation({
          agent_id: agentId,
          // title 用纯文本（去掉 mention 富文本与技能前缀），避免 "[object Object]"
          title: textContent,
          conversation_type: ConversationType.TEST,
        })
        conversationIdRef.current = data.conversation_id
      } finally {
        setConversationCreating(false)
      }
    }

    if (!isRegenerate) {
      userFiles = userFiles?.map(item => ({
        type: 'image',
        content: `file_id:${item.id}`,
        filename: item.name,
        size: item.size,
        mime_type: item.mime_type,
        url: item.url,
      })) || []
    }

    // ============ 按 agentKind 派生发送参数（三个场景规整）============
    // 三种场景的最终 payload 差异（参考同目录 *.json）：
    //   workbench 工作台 AI：type='work-ai' + skill + selected_skills + agentInfo
    //                      messages.content 形如 "/<skill_name> <question>"
    //   knowledge AI 搜问：  modelId（拼到 model 后缀）+ networkSearch/knowledgeGraph
    //                      + agentInfo + library.value=[-1]
    //                      启用 enable_process_steps / knowledge_base_ids / file_ids /
    //                      space_ids / search_config / web_search_config / enable_graph_search
    //   agent 普通智能体：   minimal 模式，只传通用字段，不加 enable_process_steps /
    //                      knowledge_base_ids / 等知识库相关字段
    const isWorkbench = previewSender.agentKind === 'workbench'
    const isKnowledge = previewSender.agentKind === 'knowledge'
    const isAgent = previewSender.agentKind === 'none'

    let sendType: 'work-ai' | '' = ''
    let sendSkill: { display_name?: string; skill_name?: string } | undefined
    let sendModelId: string | undefined
    let sendAgentInfo: any
    let sendLibrary: { value: string[] | number[] } | undefined
    let sendKnowledgeSource: typeof previewSender.knowledgeSource | undefined

    if (isWorkbench) {
      sendType = 'work-ai'
      // 仅取 Sender 实际选中的技能，不兜底 previewSender.skill.list[0]，
      // 否则未交互状态下 list 是全部技能，会被当作默认选中第一个。
      // 与 apps/front-react/src/views/index/IndexChat.tsx 行 527 对齐。
      const s = selectedSkills[0]
      sendSkill = s
        ? { display_name: s.display_name, skill_name: s.skill_name }
        : undefined
      sendAgentInfo = agentFormStore.agent_data
    } else if (isKnowledge) {
      // modelId 取 API 真实 id（对齐 apps/front-react/src/views/knowledge/chat.tsx 行 435
      // `modelId = currentModel?.id`）。useAgentPreviewSender 通过 adapter.getAgentModels
      // 拉取后按 value 匹配，已知后端独立分配的 id。未加载完成时为 undefined。
      sendModelId = previewSender.model?.modelId?.toString()
      sendKnowledgeSource = previewSender.knowledgeSource
      sendAgentInfo = agentFormStore.agent_data
      // knowledge 场景无 library 配置入口时，默认回退为 ['all']，
      // 与 useChatSend.ts 行 370 `library?.value || ['all']` 对齐
    } else {
      // isAgent (普通智能体)：走 minimal 模式，对应后端 agent.json payload 形态。
      // adapter 收到 type='agent' 后不发 enable_process_steps / knowledge_base_ids 等知识库字段。
      sendType = 'agent'
    }
    void isAgent // 占位，明确三种场景都被覆盖
    const newChat: ChatMessage = {
      question: {
        role: 'user',
        content: textContent,
        user_files: userFiles as any[],
      },
      answer: '',
      loading: true,
      role: 'assistant',
      reasoning_expanded: true,
      reasoning_content: '',
      process_records: [],
      rag_stats: null,
      rag_temp: { type: 'rag_search' },
      skill: sendSkill
        ? { skill_name: sendSkill.skill_name || '', display_name: sendSkill.display_name || '' }
        : { skill_name: '', display_name: '' },
      knowledge_graph: sendKnowledgeSource?.state?.knowledgeGraph ?? false,
    }

    setChatList(prev => {
      const newList = [...prev, newChat]
      activeChatIndexRef.current = newList.length - 1
      activeChatDataRef.current = newList[activeChatIndexRef.current] || {}
      return newList
    })

    let messages: any[] = [{ role: 'user', content: textContent }]
    if (userFiles && userFiles.length) {
      // work-ai: 参考 useChatSend.ts 行 235-249，files 序列化为 file_id 加入 user 消息
      if (previewSender.agentKind === 'workbench') {
        // Sender 已经把 mention 渲染成 `/skill_name ` 文本注入 textContent，
        // 避免重复追加前缀（只有 textContent 不含前缀时才补）
        const hasSkillPrefix = sendSkill?.skill_name
          ? textContent.startsWith(`/${sendSkill.skill_name} `)
          : false
        const formattedQuestion = !hasSkillPrefix && sendSkill?.skill_name
          ? `/${sendSkill.skill_name} ${textContent}`
          : textContent
        messages = [
          {
            role: 'user',
            content: JSON.stringify([
              { type: 'text', content: formattedQuestion },
              ...userFiles,
            ]),
          },
        ]
      } else {
        messages = [
          {
            role: 'user',
            content: JSON.stringify([
              { type: 'text', content: textContent },
              ...userFiles,
            ]),
          },
        ]
      }
    } else if (previewSender.agentKind === 'workbench' && sendSkill?.skill_name) {
      // 同上：避免与 Sender mention 渲染的前缀重复
      const hasSkillPrefix = textContent.startsWith(`/${sendSkill.skill_name} `)
      messages = [
        {
          role: 'user',
          content: hasSkillPrefix ? textContent : `/${sendSkill.skill_name} ${textContent}`,
        },
      ]
    }

    abortControllerRef.current = new AbortController()

    if (!adapter.sendChatMessage) {
      message.warning('sendChatMessage not configured')
      return
    }

    // 流式处理进度：复用 shared-business/chat 的 processStreamData
    // 自动累积 process_records / rag_stats / reasoning_content / content
    let processedLength = 0

    await adapter.sendChatMessage({
      // ============ 通用字段（三个场景都传）============
      conversation_id: conversationIdRef.current,
      messages,
      agent_id: agentId,
      agent_configs: agentFormStore.agent_data.configs,
      signal: abortControllerRef.current.signal,
      // preview 无 @ 文件/知识库/空间选择器，但接口契约里有 links 字段，
      // 显式传空数组让 adapter 能消费（apps/front-react/src/useChatSend.ts 行 244-249 对齐）
      links: [],
      // files 单独传递（同时保留在 messages 中以便老 adapter 仍能解析内容），
      // 新 adapter 可基于此字段构建 file_ids / 上传语义
      files: userFiles || [],

      // ============ 场景特定字段（按 agentKind 透传）============
      // workbench: type + skill; knowledge: modelId + network/graph/wiki + library;
      // agent: 全部省略（minimal 模式）
      ...buildOptionalFields({
        type: sendType,
        skill: sendSkill,
        modelId: sendModelId,
        knowledgeSource: sendKnowledgeSource,
        agentInfo: sendAgentInfo,
        library: sendLibrary,
      }),

      onDownloadProgress: (e: any) => {
        // 双路径兼容：
        //   1. console-react 路径：axios service 拦截器（apps/console-react/src/api/config.ts）
        //      会包装 onDownloadProgress，回调参数是
        //      `{ progressEvent, chunks, intact_content, intact_reasoning_content }`。
        //      chunks 已经是解析好的 JSON 数组，遍历调 processStreamDataItem 即可。
        //   2. front-react / 原始 progressEvent 路径：回调参数是 AxiosProgressEvent
        //      （e.event.target.response），委托 processStreamData 自行解析。
        if (!activeChatDataRef.current) return

        const message = activeChatDataRef.current as any
        const chunks = Array.isArray(e?.chunks) ? e.chunks : null

        if (chunks) {
          // console-react 路径：chunks 是已解析的 SSE data 数组
          // 关键：parseStreamResponse 每次回调都会基于累积的 responseText 重新解析，
          // 所以 chunks 数组每次都包含所有历史 chunks。如果直接 for-of 处理会重复累加 content。
          // 解决：用 __chunksProcessedLen 跟踪已处理数量，只处理增量。
          const prevProcessed = message.__chunksProcessedLen || 0
          for (let i = prevProcessed; i < chunks.length; i++) {
            processStreamDataItem(chunks[i], message, formatRagStats)
          }
          message.__chunksProcessedLen = chunks.length
        } else {
          // front-react / 原始 progressEvent 路径：按 SSE 文本流解析
          processedLength = processStreamData(
            e,
            processedLength,
            message,
            sendKnowledgeSource?.state?.networkSearch ?? false,
            formatRagStats,
          )
        }

        // 节流触发 React 重渲染（参考 front-react/src/useChatSend.ts 行 408-413）
        if (renderTimerRef.current) {
          clearTimeout(renderTimerRef.current)
        }
        renderTimerRef.current = setTimeout(() => {
          setChatList(prev => [...prev])
          renderTimerRef.current = null
        }, 200)
      },
    }).catch(() => {}).finally(() => {
      if (renderTimerRef.current) {
        clearTimeout(renderTimerRef.current)
        renderTimerRef.current = null
      }
      const lastContent = activeChatDataRef.current?.answer || ''
      if (
        lastContent?.startsWith('Upstream Error') ||
        lastContent?.startsWith('Error: 当前应用模型余额不足') ||
        !lastContent
      ) {
        if (activeChatDataRef.current) {
          activeChatDataRef.current.answer = t('app.failed_tip')
        }
        message.warning(t('app.failed_tip'))
      }
      if (activeChatDataRef.current?.loading) {
        activeChatDataRef.current.loading = false
      }
      setChatList(prev => [...prev])
      abortControllerRef.current = null
      // 清理 useChatStream 内部的 jsonBuffer（与 useChatSend.ts 行 698 一致）
      clearBuffer()
    })

    // Reset preview sender selections: workbench skills clear, knowledge model preserved.
    previewSender.reset()

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
    // 中断时也清理 stream buffer，避免下一轮请求残留
    clearBuffer()
    if (activeChatDataRef.current) {
      activeChatDataRef.current.loading = false
      setChatList(prev => [...prev])
    }
  }

  const onRestartGeneration = (data: ChatMessage) => {
    onSendConfirm(
      {
        textContent: data.question.content,
        pureTextContent: data.question.content,
        atList: [],
        skillList: [],
        selectedSkills: [],
        files: data.question.user_files || [],
      },
      { isRegenerate: true },
    )
  }

  const onRestart = ({ saveAction: _saveAction = false } = {}) => {
    conversationIdRef.current = 0
    setChatList([])
    setIsConfigChanged(false)
  }

  const onCopy = async (text = '') => {
    await copyToClip(text)
    message.success(t('action.copy_success'))
  }

  const handleSuggestion = (question: string) => {
    onSendConfirm({
      textContent: question,
      pureTextContent: question,
      atList: [],
      skillList: [],
      selectedSkills: [],
      files: [],
    })
  }

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

  // 如果没有配置 BubbleComponents，显示占位符
  if (!Bubble) {
    return (
      <div className={`h-full flex items-center justify-center text-gray-400 ${className || ''}`}>
        {t('agent.preview_not_configured')}
      </div>
    )
  }

  const { XBubbleList, XBubbleUser, XBubbleAssistant, XIcon, XSender } = Bubble

  return (
    <div className={`h-full flex flex-col bg-white rounded-lg relative ${className || ''}`}>
      {/* 标题 - 仅在 Openclaw 等独立场景显示 */}
      {!hideTitle && (
        <div className="px-6 py-[14px]">
          <span className="text-base font-medium text-[#333]">
            {t('agent.preview_debug')}
          </span>
        </div>
      )}

      {/* 配置变更遮罩 */}
      {isConfigChanged && (
        <div className="absolute top-0 left-0 w-full h-full bg-black/70 z-10 rounded-lg">
          <div className="flex flex-col items-center justify-center gap-6 w-full h-full box-border">
            <div className="text-base text-[#fff] text-center mx-8">
              {t('app.config_change_confirm')}
            </div>
            <Button type="primary" onClick={() => onRestart({ saveAction: true })}>
              {t('app.save_and_restart')}
            </Button>
          </div>
        </div>
      )}

      {/* 气泡列表区域 */}
      <XBubbleList
        ref={scrollRef}
        messages={chatList}
        className="flex-1 px-4 relative py-4"
        mainClass={`mx-5 ${ showChatListEmpty ? 'min-h-full' : '' }`}
      >
        {showChatListEmpty ? (
          <div className="min-h-full flex flex-col items-center justify-center gap-3">
            {agentFormStore.form_data.logo && (
              <img
                src={agentFormStore.form_data.logo}
                alt={agentFormStore.form_data.name || 'Agent'}
                className="w-14 h-14 rounded-xl object-cover"
              />
            )}
            {agentFormStore.form_data.name && (
              <span className="text-lg text-primary">
                {agentFormStore.form_data.name}
              </span>
            )}
            <div className="h-8"></div>
            {showWelcome && (
              <div className='w-full'>
                <XBubbleAssistant
                  type="welcome"
                  content={agentFormStore.form_data.settings.opening_statement}
                  suggestions={agentFormStore.form_data.settings.suggested_questions}
                  onSuggestion={handleSuggestion}
                />
              </div>
            )}
          </div>
        ) : null}

        {chatList.map((message, messageIndex) => (
          <div key={messageIndex}>
            <XBubbleUser 
              content={message.question.content} 
              files={message.question.user_files}
                contentBefore={
                  message.skill?.display_name ? (
                    <span className="bg-[#e6e9f2] rounded py-1 px-2 text-sm mr-2">
                      {message.skill.display_name}
                    </span>
                  ) : null
                }>
              {!message.loading && (
                <span slot="menu">
                  <XIcon size={16} className="cursor-pointer" name="copy" onClick={() => onCopy(message.question.content)} />
                </span>
              )}
            </XBubbleUser>
            <XBubbleAssistant
              content={message.answer}
              reasoning={message.reasoning_content}
              reasoningExpanded={message.reasoning_expanded}
              streaming={message.loading}
              alwaysShowMenu={messageIndex === chatList.length - 1}
              header={
                message.process_records && message.process_records.length > 0
                  ? (
                    <ProcessFlowHeader
                      processRecords={message.process_records}
                      streaming={message.loading}
                      hasContent={Boolean(message.answer)}
                      t={t}
                    />
                  )
                  : undefined
              }
            >
              {!message.loading && (
                <>
                  <span slot="menu">
                    <XIcon size={16} className="cursor-pointer" name="copy" onClick={() => onCopy(message.answer)} />
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
        {/* workbench: actionPosition=extras puts default skill button on the left; knowledge suppresses it via extrasLeft */}
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
          {...(previewSender.skill ? { skill: previewSender.skill } : {})}
          {...(previewSender.skill && !previewSender.model ? { ui: { actionPosition: 'extras' as const } } : {})}
          slots={{
            extrasLeft: (previewSender.model || previewSender.source)
              ? (
                  <div className="flex items-center gap-2">
                    {previewSender.model && (
                      <PreviewModelSelector
                        options={previewSender.model.options}
                        selectedId={previewSender.model.selectedId}
                        onChange={previewSender.model.onChange}
                        t={t}
                      />
                    )}
                    {previewSender.knowledgeSource && (
                      <PreviewKnowledgeSourceSelector
                        knowledgeSource={previewSender.knowledgeSource}
                        onKnowledgeSourceChange={previewSender.onKnowledgeSourceChange}
                        t={t}
                      />
                    )}
                  </div>
                )
              : undefined,
          }}
        />
        {/* AI generated tip */}
        <div className="text-center mt-2">
          <span className="text-xs text-[#999]">
            {t('agent.ai_generated_tip')}
          </span>
        </div>
      </div>
    </div>
  )
})

Chat.displayName = 'Chat'

export default Chat
