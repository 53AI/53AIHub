import { useEffect, useState, ReactNode } from 'react'
import { Button, message } from 'antd'
import { PERMISSION_TYPE, RESOURCE_TYPE, type PermissionType } from './constant'
import { PermissionEmpty } from './empty'
import { usePermissionApply } from '@/contexts/PermissionApplyContext'
import approvalsApi from '@/api/modules/approvals'
import permissionsApi from '@/api/modules/permissions'
import { t } from '@/locales'
import './frame.css'

interface WikiPermissionFrameProps {
  /** wiki 页面 id；为空时直接放行（如索引/日志等非页面视图） */
  pageId?: string
  /** 用于申请弹窗展示的资源名 */
  pageTitle?: string
  required?: PermissionType
  children?: ReactNode
  onLoad?: () => void
}

export function WikiPermissionFrame({
  pageId,
  pageTitle = '',
  required = PERMISSION_TYPE.viewer,
  children,
  onLoad,
}: WikiPermissionFrameProps) {
  const { openApply } = usePermissionApply()

  const [permission, setPermission] = useState<PermissionType>(PERMISSION_TYPE.loading)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [isSended, setIsSended] = useState(false)

  useEffect(() => {
    if (!pageId) return
    let cancelled = false
    setPermission(PERMISSION_TYPE.loading)
    permissionsApi
      .my({
        resource_type: RESOURCE_TYPE.wiki_page,
        resource_id: pageId,
      })
      .then((res) => {
        if (cancelled) return
        setPermission(res.max_permission)
      })
      .catch(() => {
        if (!cancelled) setPermission(PERMISSION_TYPE.none)
      })
    return () => {
      cancelled = true
    }
  }, [pageId])

  useEffect(() => {
    if (permission === PERMISSION_TYPE.loading) return
    if (permission > required) {
      onLoad?.()
    } else if (permission < required) {
      loadLatestPending()
    }
  }, [permission, required])

  const loadLatestPending = () => {
    if (!pageId) return
    approvalsApi
      .latest_pending({
        resource_type: RESOURCE_TYPE.wiki_page,
        resource_id: pageId,
      })
      .then((res) => {
        setIsSubmitted(res.pending)
      })
  }

  const handleApply = () => {
    openApply({
      permission: PERMISSION_TYPE.viewer,
      resource: { id: pageId ?? '', icon: '', name: pageTitle },
      resourceType: RESOURCE_TYPE.wiki_page,
    })
  }

  const handleSend = () => {
    message.success(t("permission.request_sent_tip"))
    setIsSended(true)
  }

  useEffect(() => {
    const handleApplySubmit = () => {
      setIsSubmitted(true)
      setIsSended(true)
    }
    window.addEventListener('apply-submit', handleApplySubmit)
    return () => window.removeEventListener('apply-submit', handleApplySubmit)
  }, [])

  // 无 pageId 时（索引/日志等 tab）直接放行
  if (!pageId) {
    return <>{children}</>
  }

  if (permission === PERMISSION_TYPE.loading) {
    return null
  }

  if (permission < required) {
    return (
      <PermissionEmpty className="h-full">
        {!isSubmitted && (
          <Button type="primary" onClick={handleApply}>
            {t("wiki.apply_page_permission")}
          </Button>
        )}
        {isSubmitted && !isSended && (
          <Button type="primary" onClick={handleSend}>
            {t("permission.nudge_admin")}
          </Button>
        )}
        {isSubmitted && isSended && (
          <Button type="primary" disabled>
            {t("permission.request_submitted")}
          </Button>
        )}
      </PermissionEmpty>
    )
  }

  return <>{children}</>
}

export default WikiPermissionFrame
