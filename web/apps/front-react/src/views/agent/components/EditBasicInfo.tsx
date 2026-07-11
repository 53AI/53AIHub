import { useState, useEffect } from 'react'
import { Modal, Button, message } from 'antd'
import BasicInfo from './BasicInfo'
import { t } from '@/locales'

interface EditBasicInfoProps {
  visible: boolean
  data: {
    name: string
    description: string
    logo: string
  }
  onClose: () => void
  onSave: (data: { name: string; description: string; logo: string }) => void
}

export function EditBasicInfo({ visible, data, onClose, onSave }: EditBasicInfoProps) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    logo: ''
  })

  // Sync props.data to form when dialog opens
  useEffect(() => {
    if (visible && data) {
      setFormData({
        name: data.name,
        description: data.description,
        logo: data.logo
      })
    }
  }, [visible, data])

  const handleClose = () => {
    onClose()
  }

  const handleSubmit = () => {
    if (formData.name.trim() === '') {
      message.error(t('agent.please_input_name'))
      return
    }
    if (formData.logo.trim() === '') {
      message.error(t('agent.please_upload_avatar'))
      return
    }
    onSave(formData)
    handleClose()
  }

  return (
    <Modal
      open={visible}
      title={t('agent.basic_info')}
      width="50%"
      onCancel={handleClose}
      footer={null}
      destroyOnHidden
    >
      <BasicInfo
        value={formData}
        onChange={setFormData}
      />

      <div className="flex justify-end gap-3 mt-6">
        <Button onClick={handleClose}>{t('action.cancel')}</Button>
        <Button type="primary" onClick={handleSubmit}>{t('action.save')}</Button>
      </div>
    </Modal>
  )
}

export default EditBasicInfo
