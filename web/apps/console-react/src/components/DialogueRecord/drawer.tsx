import { Drawer } from 'antd'
import { forwardRef, useImperativeHandle, useState } from 'react'
import DialogueRecordView from './index'

export interface DialogueRecordDrawerRef {
  open: (params: { type: 'user' | 'agent'; relatedId: string | number }) => void
  close: () => void
}

interface DialogueRecordDrawerProps {
  className?: string
}

function DialogueRecordDrawerInner(
  props: DialogueRecordDrawerProps,
  ref: React.ForwardedRef<DialogueRecordDrawerRef>
) {
  const { className } = props
  const t = (window as any).$t || ((key: string) => key)

  const [visible, setVisible] = useState(false)
  const [type, setType] = useState<'user' | 'agent'>('user')
  const [relatedId, setRelatedId] = useState<string | number>('')

  const open = (params: { type: 'user' | 'agent'; relatedId: string | number }) => {
    setType(params.type)
    setRelatedId(params.relatedId)
    setVisible(true)
  }

  const close = () => {
    setVisible(false)
  }

  useImperativeHandle(ref, () => ({
    open,
    close,
  }))

  return (
    <Drawer
      title={t('dialogue_record')}
      open={visible}
      onClose={close}
      destroyOnHidden
      styles={{ wrapper: { width: 880 } }}
    >
      <DialogueRecordView className={className || '!px-2 !py-2'} type={type} relatedId={relatedId} />
    </Drawer>
  )
}

export const DialogueRecordDrawer = forwardRef<DialogueRecordDrawerRef, DialogueRecordDrawerProps>(
  DialogueRecordDrawerInner
)

export default DialogueRecordDrawer