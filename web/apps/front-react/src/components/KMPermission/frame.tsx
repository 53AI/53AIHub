import { useEffect, useState, ReactNode } from 'react'
import { Button, message } from 'antd'
import { useLibraryStore } from '@/stores/modules/library'
import { PERMISSION_TYPE, RESOURCE_TYPE, type PermissionType } from './constant'
import { PermissionEmpty } from './empty'
import { usePermissionApply } from '@/contexts/PermissionApplyContext'
import approvalsApi from '@/api/modules/approvals'
import './frame.css'

interface PermissionFrameProps {
  required?: PermissionType
  children?: ReactNode
  onLoad?: () => void
}

export function PermissionFrame({
  required = PERMISSION_TYPE.viewer,
  children,
  onLoad
}: PermissionFrameProps) {
  const libraryStore = useLibraryStore()
  const { openApply } = usePermissionApply()

  const [isSubmitted, setIsSubmitted] = useState(false)
  const [isSended, setIsSended] = useState(false)

  // currentFile is a method in zustand store
  const currentFile = libraryStore.currentFile()
  const permission = typeof currentFile?.permission === 'number' ? currentFile.permission : PERMISSION_TYPE.loading

  useEffect(() => {
    if (permission > required) {
      onLoad?.()
    } else if (permission > PERMISSION_TYPE.loading && permission < required) {
      loadLatestPending()
    }
  }, [permission, required])

  const loadLatestPending = () => {
    const resource_id = currentFile?.id
    if (!resource_id) return

    approvalsApi.latest_pending({
      resource_type: RESOURCE_TYPE.file,
      resource_id
    }).then((res) => {
      setIsSubmitted(res.pending)
    })
  }

  const handleApply = () => {
    openApply({
      permission: PERMISSION_TYPE.viewer,
      resource: currentFile || { id: '', icon: '', name: '' },
      resourceType: RESOURCE_TYPE.file,
    })
  }

  const handleSend = () => {
    message.success('已提交到管理员，请耐心等待')
    setIsSended(true)
  }

  // Listen for apply-submit event
  useEffect(() => {
    const handleApplySubmit = () => {
      setIsSubmitted(true)
      setIsSended(true)
    }

    window.addEventListener('apply-submit', handleApplySubmit)
    return () => window.removeEventListener('apply-submit', handleApplySubmit)
  }, [])

  if (permission === PERMISSION_TYPE.loading) {
    return null
  }

  if (permission < required) {
    return (
      <PermissionEmpty className="h-full">
        {!isSubmitted && (
          <Button type="primary" onClick={handleApply}>
            申请文档权限
          </Button>
        )}
        {isSubmitted && !isSended && (
          <Button type="primary" onClick={handleSend}>
            催一催
          </Button>
        )}
        {isSubmitted && isSended && (
          <Button type="primary" disabled>
            已提交申请
          </Button>
        )}
      </PermissionEmpty>
    )
  }

  return <>{children}</>
}

export default PermissionFrame