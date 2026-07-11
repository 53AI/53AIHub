import { Modal, Input } from 'antd'
import { t } from '@/locales'

const INVALID_CHARS_REGEX = /[\/\\]/

export interface RenameModalProps {
  open: boolean
  value: string
  onChange: (value: string) => void
  onConfirm: () => Promise<void>
  onCancel: () => void
}

/**
 * 重命名模态框组件
 */
export function RenameModal({ open, value, onChange, onConfirm, onCancel }: RenameModalProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    if (!INVALID_CHARS_REGEX.test(newValue)) {
      onChange(newValue)
    }
  }

  return (
    <Modal
      open={open}
      title={t('action.rename')}
      onOk={onConfirm}
      onCancel={onCancel}
      okText={t('action.confirm')}
      cancelText={t('action.cancel')}
    >
      <div className="py-4">
        <Input
          value={value}
          onChange={handleChange}
          placeholder={t('common.file_name')}
          onPressEnter={onConfirm}
        />
      </div>
    </Modal>
  )
}

export default RenameModal