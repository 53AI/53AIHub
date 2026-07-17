import { Modal, Input } from 'antd'
import { t } from '@/locales'

const INVALID_CHARS_REGEX = /[\/\\]/

export interface CreateFolderModalProps {
  open: boolean
  value: string
  onChange: (value: string) => void
  onConfirm: () => Promise<void>
  onCancel: () => void
  title?: string
}

/**
 * 新建文件夹模态框组件
 */
export function CreateFolderModal({
  open,
  value,
  onChange,
  onConfirm,
  onCancel,
  title,
}: CreateFolderModalProps) {
  const actualTitle = title || t('library.create_folder')
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    if (!INVALID_CHARS_REGEX.test(newValue)) {
      onChange(newValue)
    }
  }

  return (
    <Modal
      open={open}
      title={actualTitle}
      onOk={onConfirm}
      onCancel={onCancel}
      okText={t('action.confirm')}
      cancelText={t('action.cancel')}
    >
      <div className="py-4">
        <Input
          value={value}
          onChange={handleChange}
          placeholder={t('mine.folder_name_placeholder')}
          autoFocus
          onPressEnter={onConfirm}
        />
      </div>
    </Modal>
  )
}

export default CreateFolderModal