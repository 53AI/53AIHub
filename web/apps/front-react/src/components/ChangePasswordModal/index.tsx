import { useState, useEffect, useRef } from 'react'
import { Modal, Button, Alert } from 'antd'
import { LockOutlined } from '@ant-design/icons'
import { useUserStore } from '@/stores/modules/user'
import ResetPassword, { ResetPasswordRef } from '@/views/profile/components/reset-password'

export interface ChangePasswordModalOptions {
  mustChange?: boolean
  reason?: 'first_login' | 'expired' | 'weak' | 'expiring' | string
  onSuccess?: () => void
}

export function ChangePasswordModal() {
  const [visible, setVisible] = useState(false)
  const [mustChange, setMustChange] = useState(false)
  const [reason, setReason] = useState<string>('')
  const [successCallback, setSuccessCallback] = useState<(() => void) | null>(null)

  const userStore = useUserStore()
  const passwordRef = useRef<ResetPasswordRef>(null)
  const [submitting, setSubmitting] = useState(false)

  const open = (options: ChangePasswordModalOptions = {}) => {
    setMustChange(!!options.mustChange)
    setReason(options.reason || '')
    setSuccessCallback(() => options.onSuccess || null)
    setVisible(true)
  }

  const handleClose = () => {
    if (mustChange) {
      return
    }
    setVisible(false)
    passwordRef.current?.resetForm()
  }

  const handleLogout = async () => {
    try {
      await userStore.logout()
    } catch (e) {
      console.error(e)
    } finally {
      setVisible(false)
      passwordRef.current?.resetForm()
    }
  }

  const handleSubmit = () => {
    passwordRef.current?.submit()
  }

  const handleSuccess = () => {
    setVisible(false)
    passwordRef.current?.resetForm()
    if (successCallback) {
      successCallback()
    }
  }

  useEffect(() => {
    const handleOpenEvent = (e: CustomEvent<ChangePasswordModalOptions>) => {
      open(e.detail || {})
    }

    window.addEventListener('open-change-password-modal' as any, handleOpenEvent as any)
    return () => {
      window.removeEventListener('open-change-password-modal' as any, handleOpenEvent as any)
    }
  }, [])

  const getTitle = () => {
    if (reason === 'first_login') return '首次登录修改密码'
    if (reason === 'expired') return '密码已过期'
    if (reason === 'weak') return '修改密码提醒'
    if (reason === 'expiring') return '定期更新密码提醒'
    return '修改密码'
  }

  const getAlertDescription = () => {
    if (reason === 'first_login') {
      return '为了保障您的账号安全，根据企业安全策略要求，首次登录系统需要修改初始密码。'
    }
    if (reason === 'expired') {
      return '您的密码已超出有效使用期限，根据企业安全策略要求，请立即修改密码后继续使用。'
    }
    if (reason === 'weak') {
      return '检测到您的密码未达到企业当前密码强度安全标准，建议立即修改以提高账号安全性。'
    }
    if (reason === 'expiring') {
      return '系统提醒：您的密码已使用较长时间，建议定期更新密码以保障账号安全。'
    }
    return ''
  }

  const alertText = getAlertDescription()

  return (
    <Modal
      open={visible}
      title={
        <div className="flex items-center gap-2 text-base font-semibold text-gray-800">
          <LockOutlined className="text-primary" />
          <span>{getTitle()}</span>
        </div>
      }
      closable={!mustChange}
      maskClosable={false}
      keyboard={!mustChange}
      onCancel={handleClose}
      footer={
        <div className="flex justify-end gap-2">
          {mustChange ? (
            <Button onClick={handleLogout}>退出登录</Button>
          ) : (
            <Button onClick={handleClose}>稍后再说</Button>
          )}
          <Button type="primary" loading={submitting} onClick={handleSubmit}>
            确认修改
          </Button>
        </div>
      }
      destroyOnHidden
    >
      {alertText && (
        <Alert
          type={mustChange ? 'warning' : 'info'}
          message={alertText}
          showIcon
          className="mb-4 mt-2"
        />
      )}

      <ResetPassword
        ref={passwordRef}
        onSuccess={handleSuccess}
        showSubmitButton={false}
        onLoadingChange={setSubmitting}
      />
    </Modal>
  )
}

export const openChangePasswordModal = (options: ChangePasswordModalOptions = {}) => {
  const event = new CustomEvent('open-change-password-modal', { detail: options })
  window.dispatchEvent(event)
}