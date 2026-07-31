import {
  PERMISSION_TYPE,
  RESOURCE_TYPE,
  type PermissionType,
} from '@/components/KMPermission/constant'
import PermissionTooltip from '@/components/KMPermission/tooltip'

interface PermissionWikiProps {
  /** 当前用户对该 wiki 页面的最大权限 */
  permission?: PermissionType
  required: PermissionType
  /** 申请弹窗展示的资源信息 */
  resource?: {
    id: string
    icon?: string
    name: string
    [key: string]: any
  }
  placement?: 'top' | 'bottom' | 'left' | 'right'
  inline?: boolean
  getPopupContainer?: () => HTMLElement
  children: React.ReactNode
}

/**
 * wiki 页面维度的权限校验壳，行为对齐 library 的 FilePermission，
 * 内部走 PermissionTooltip，并以 RESOURCE_TYPE.wiki_page 触发申请弹窗。
 */
export default function PermissionWiki({
  permission = PERMISSION_TYPE.loading,
  required,
  resource,
  placement = "left",
  inline,
  getPopupContainer,
  children,
}: PermissionWikiProps) {
  return (
    <PermissionTooltip
      permission={permission}
      required={required}
      resourceType={RESOURCE_TYPE.wiki_page}
      resource={resource}
      placement={placement}
      inline={inline}
      getPopupContainer={getPopupContainer}
    >
      {children}
    </PermissionTooltip>
  )
}
