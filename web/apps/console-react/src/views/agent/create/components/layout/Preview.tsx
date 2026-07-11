import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { Drawer } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { t } from '@/locales'
import { useAgentForm } from '../../hooks'
import { Chat } from '../../response/Chat'
import { Completion } from '../../response/Completion'

export interface AgentPreviewRef {
  open: () => void
}

export const AgentPreview = forwardRef<AgentPreviewRef>((_, ref) => {
  const { getAgentOptionData } = useAgentForm()

  const [visible, setVisible] = useState(false)
  const chatRef = useRef<any>(null)
  const completionRef = useRef<any>(null)

  const open = () => {
    setVisible(true)
  }

  const onRestart = () => {
    if (chatRef.current?.restart) {
      chatRef.current.restart()
    }
    if (completionRef.current?.restart) {
      completionRef.current.restart()
    }
  }

  const onSave = (options?: { restart?: boolean }) => {
    // 保存逻辑 - 与 Vue 版本保持一致
    // Vue 版本中 emit('save', { restart: true }) 会触发父组件保存
    // 这里暂时留空，等待父组件实现
  }

  useImperativeHandle(ref, () => ({
    open,
  }))

  const mode = getAgentOptionData()?.mode || 'chat'

  return (
    <Drawer
      open={visible}
      title={
        <div className="flex justify-between items-center">
          <span className="text-2xl">{t('debug_preview')}</span>
          <div
            className="flex-center gap-1 cursor-pointer mr-2"
            onClick={onRestart}
          >
            <ReloadOutlined />
            <span className="text-sm text-primary">
              {t('restart')}
            </span>
          </div>
        </div>
      }
      onClose={() => setVisible(false)}
      destroyOnHidden
      mask={{ closable: false }}
      styles={{
        wrapper: { width: 674 },
        body: { display: 'flex', flexDirection: 'column', overflow: 'hidden' },
      }}
    >
      {mode === 'chat' ? (
        <Chat ref={chatRef} className="flex-1 overflow-hidden" onSave={onSave} />
      ) : mode === 'completion' ? (
        <Completion
          ref={completionRef}
          className="flex-1 overflow-hidden"
        />
      ) : null}
    </Drawer>
  )
})

AgentPreview.displayName = 'AgentPreview'

export default AgentPreview
