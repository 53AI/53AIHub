import { useState } from 'react'
import { Modal, Button } from 'antd'
import { useUserStore } from '@/stores/modules/user'

interface ExpireModalProps {
  onRenew?: () => void
}

export function ExpireModal({ onRenew }: ExpireModalProps) {
  const [visible, setVisible] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [expireDay, setExpireDay] = useState(0)
  const [expireTime, setExpireTime] = useState('')

  const userStore = useUserStore()

  const open = (data: { group_name: string; day: number; expire_time: string }) => {
    setGroupName(data.group_name)
    setExpireDay(data.day)
    setExpireTime(data.expire_time)
    setVisible(true)
  }

  const handleClose = () => {
    setVisible(false)
  }

  const handleConfirm = () => {
    setVisible(false)
    onRenew?.()
  }

  // Expose open method via custom event
  const handleOpenEvent = (e: CustomEvent) => {
    open(e.detail)
  }

  // Listen for open event
  if (typeof window !== 'undefined') {
    window.addEventListener('open-expire-modal' as any, handleOpenEvent as any)
  }

  return (
    <Modal
      open={visible}
      title="提示"
      onCancel={handleClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button size="large" onClick={handleClose}>
            稍后再说
          </Button>
          <Button type="primary" size="large" onClick={handleConfirm}>
            立即续费
          </Button>
        </div>
      }
      width={520}
      mask={{ closable: false }}
      keyboard={false}
    >
      <div className="text-sm text-gray-600 pb-4">
        {expireDay > 0 ? (
          <span>
            您的 <strong>{groupName}</strong> 会员将于 <strong>{expireTime}</strong> 到期，
            还剩 <strong className="text-orange-500">{expireDay}</strong> 天，请及时续费以继续享受会员权益。
          </span>
        ) : (
          <span>
            您的 <strong>{groupName}</strong> 会员已于 <strong>{expireTime}</strong> 到期，
            请续费以继续享受会员权益。
          </span>
        )}
      </div>
    </Modal>
  )
}

// Export a function to open the modal
export const openExpireModal = (data: { group_name: string; day: number; expire_time: string }) => {
  const event = new CustomEvent('open-expire-modal', { detail: data })
  window.dispatchEvent(event)
}
