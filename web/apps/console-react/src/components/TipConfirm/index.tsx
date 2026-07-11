import { Modal, Button } from 'antd'
import { useState, useImperativeHandle, forwardRef } from 'react'

export interface TipConfirmProps {
  title?: string
  content?: string
  confirmButtonText?: string
  cancelButtonText?: string
  showConfirmButton?: boolean
  showCancelButton?: boolean
  onConfirm?: () => void
  onCancel?: () => void
}

export interface TipConfirmRef {
  open: () => void
  close: () => void
}

const t = (key: string) => (typeof window !== 'undefined' && (window as any).$t ? (window as any).$t(key) : key)

export const TipConfirm = forwardRef<TipConfirmRef, TipConfirmProps>(
  (
    {
      title = '',
      content = '',
      confirmButtonText,
      cancelButtonText,
      showConfirmButton = true,
      showCancelButton = true,
      onConfirm,
      onCancel,
    },
    ref
  ) => {
    const [visible, setVisible] = useState(false)

    // 使用与 Vue 相同的默认值逻辑
    const _confirmButtonText = confirmButtonText ?? t('action_confirm')
    const _cancelButtonText = cancelButtonText ?? t('action_cancel')

    const open = () => {
      setVisible(true)
    }

    const close = () => {
      setVisible(false)
    }

    const handleConfirm = () => {
      close()
      onConfirm?.()
    }

    const handleCancel = () => {
      close()
      onCancel?.()
    }

    useImperativeHandle(ref, () => ({
      open,
      close,
    }))

    return (
      <Modal
        open={visible}
        title={title}
        onCancel={handleCancel}
        footer={
          <div className="flex justify-end gap-2">
            {showCancelButton && (
              <Button onClick={handleCancel}>{_cancelButtonText}</Button>
            )}
            {showConfirmButton && (
              <Button type="primary" onClick={handleConfirm}>
                {_confirmButtonText}
              </Button>
            )}
          </div>
        }
        width={520}
        centered
        closable={false}
        destroyOnHidden
        mask={{ closable: false }}
        styles={{
          content: { borderRadius: 16 },
        }}
      >
        <section className="text-base text-secondary">{content}</section>
      </Modal>
    )
  }
)

TipConfirm.displayName = 'TipConfirm'

export default TipConfirm
