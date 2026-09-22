import { useState } from 'react'
import { Button, Input, Spin, message } from 'antd'
import { RobotOutlined, SendOutlined } from '@ant-design/icons'
import recordingApi from '@/api/modules/recording'
import type {
  InsightBackground,
  InsightConversationMessage,
} from '@/api/modules/recording/types'
import { stripMarkdownCodeFence } from '../insightRenderer/markdownParser'
import { renderMarkdownText } from '../insightRenderer/richText'

export const starterMessage: InsightConversationMessage = {
  role: 'assistant',
  content: '我会先对齐这次洞察真正需要的背景。您可以直接修改左侧卡片，也可以告诉我：哪些事实被遗漏了、您更关心什么结果，或希望我重点检验哪一个判断。',
}

export const quickPrompts = [
  '补充老板当前最关心的经营目标',
  '指出纪要里被忽略的风险',
  '结合公司现状重新校准判断',
]

export function withoutStarterMessage(messages: InsightConversationMessage[]) {
  return messages.filter((item) => item.content !== starterMessage.content)
}

interface InsightChatPanelProps {
  fileId: string
  /** 发送对话时携带的洞察背景快照；由父级传入（独立弹窗为只读态） */
  background: InsightBackground
  /** 受控对话列表，父级持有以便再生成等后续动作复用 */
  messages: InsightConversationMessage[]
  setMessages: React.Dispatch<React.SetStateAction<InsightConversationMessage[]>>
  /** 外部禁用输入与发送（例如再生成进行中） */
  disabled?: boolean
}

/**
 * 洞察背景协同研讨的对话区：消息列表 + 快捷提示 + 输入框 + 发送。
 *
 * 与 BackgroundCard 背景编辑解耦，纯负责「聊天」这一件事，宿主为：
 *  - InsightChatModal：右上角入口打开的独立聊天弹窗
 */
export function InsightChatPanel({
  fileId,
  background,
  messages,
  setMessages,
  disabled = false,
}: InsightChatPanelProps) {
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  const sendMessage = async (content = input) => {
    const text = content.trim()
    if (!text || sending || disabled) return
    const nextMessages = [...messages, { role: 'user' as const, content: text }]
    setMessages(nextMessages)
    setInput('')
    setSending(true)
    try {
      const result = await recordingApi.chatInsightWorkshop(fileId, {
        message: text,
        background,
        conversation: withoutStarterMessage(messages),
      })
      if (result.reply?.trim()) {
        setMessages([...nextMessages, { role: 'assistant', content: result.reply.trim() }])
      }
    } catch (error: any) {
      setMessages(messages)
      setInput(text)
      message.error(error?.message || '协同对话失败，请稍后重试')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="h-full flex min-h-0 flex-col bg-white">
      <div className="flex shrink-0 items-center gap-2 border-b border-[#E8ECF2] px-5 py-4">
        <RobotOutlined className="text-[#5B7CFF]" />
        <div>
          <div className="text-sm font-semibold">研讨对话</div>
          <div className="mt-0.5 text-[11px] text-[#98A2B3]">对话仅用于当前研讨，不会直接保存为会议事实</div>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {messages.map((item, index) => (
          <div key={`${item.role}-${index}`} className={`flex gap-2 ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {item.role === 'assistant' && <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-[#EEF2FF] text-[#5B7CFF]"><RobotOutlined /></div>}
            <div className={`max-w-[86%] rounded-2xl px-3 py-2.5 text-xs leading-5 ${item.role === 'user' ? 'rounded-tr-md bg-[#EEF2FF] text-[#3949AB]' : 'rounded-tl-md bg-[#F5F7FA] text-[#475467] insight-richtext !text-xs !leading-5'}`}>
              {item.role === 'assistant'
                ? renderMarkdownText(stripMarkdownCodeFence(item.content))
                : item.content}
            </div>
          </div>
        ))}
        {sending && <div className="flex items-center gap-2 text-xs text-[#98A2B3]"><Spin size="small" /> 正在对齐背景...</div>}
      </div>
      <div className="shrink-0 border-t border-[#E8ECF2] px-5 py-3">
        <div className="mb-2 flex flex-wrap gap-2">
          {quickPrompts.map((prompt) => <button key={prompt} type="button" onClick={() => sendMessage(prompt)} disabled={disabled} className="rounded-full border border-[#DCE3F0] bg-white px-2.5 py-1 text-[11px] text-[#667085] hover:border-[#9AAFFF] hover:text-[#526DDE] disabled:opacity-50">{prompt}</button>)}
        </div>
        <div className="flex items-end gap-2 rounded-xl border border-[#DCE3F0] bg-[#FAFBFD] p-2 focus-within:border-[#8EA5FF]">
          <Input.TextArea value={input} onChange={(event) => setInput(event.target.value)} onPressEnter={(event) => { if (!event.shiftKey) { event.preventDefault(); sendMessage() } }} autoSize={{ minRows: 1, maxRows: 4 }} bordered={false} placeholder="告诉二号位您希望补充或质疑什么..." className="!resize-none !bg-transparent !text-xs" />
          <Button type="primary" shape="circle" icon={<SendOutlined />} loading={sending} disabled={disabled} onClick={() => sendMessage()} />
        </div>
      </div>
    </div>
  )
}
