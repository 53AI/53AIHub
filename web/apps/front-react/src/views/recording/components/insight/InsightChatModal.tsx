import { useCallback, useEffect, useState } from 'react'
import { Modal, Spin, message } from 'antd'
import recordingApi from '@/api/modules/recording'
import type {
  InsightBackground,
  InsightConversationMessage,
} from '@/api/modules/recording/types'
import {
  InsightChatPanel,
  starterMessage,
} from './InsightChatPanel'
import { EMPTY_INSIGHT_BACKGROUND } from './InsightBackgroundWorkshop'

interface InsightChatModalProps {
  fileId: string
  open: boolean
  onClose: () => void
}

/**
 * 右上角「参谋洞察」聊天入口打开的独立弹窗。
 *
 * 纯聊天：加载已保存的背景快照作为对话上下文，与洞察助手多轮对话，
 * 不包含背景卡片编辑、也不触发重新生成洞察。
 */
export function InsightChatModal({
  fileId,
  open,
  onClose,
}: InsightChatModalProps) {
  const [background, setBackground] = useState<InsightBackground>(EMPTY_INSIGHT_BACKGROUND)
  const [messages, setMessages] = useState<InsightConversationMessage[]>([starterMessage])
  const [loading, setLoading] = useState(false)

  const loadBackground = useCallback(async () => {
    setLoading(true)
    try {
      const result = await recordingApi.getInsightBackground(fileId)
      setBackground({ ...EMPTY_INSIGHT_BACKGROUND, ...result })
      const savedMessages = result.conversation || []
      setMessages(savedMessages.length > 0 ? savedMessages : [starterMessage])
    } catch (error: any) {
      message.error(error?.message || '读取洞察背景失败')
    } finally {
      setLoading(false)
    }
  }, [fileId])

  useEffect(() => {
    if (open) loadBackground()
  }, [open, loadBackground])

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={null}
      footer={null}
      width={760}
      centered
      destroyOnClose={false}
      styles={{ container: { padding: 0 } }}
    >
      <div className="flex h-[80vh] flex-col overflow-hidden rounded-xl bg-[#F8FAFC] text-[#1F2937]">
        {loading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center"><Spin /></div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <InsightChatPanel
              fileId={fileId}
              background={background}
              messages={messages}
              setMessages={setMessages}
            />
          </div>
        )}
      </div>
    </Modal>
  )
}
