import { useMemo } from 'react'
import { useLibraryStore } from '@/stores/modules/library'
import { PERMISSION_TYPE, RESOURCE_TYPE, type PermissionType } from '@/components/KMPermission/constant'
import PermissionTooltip from '@/components/KMPermission/tooltip'

interface LibraryPermissionProps {
  required: PermissionType
  placement?: string
  inline?: boolean
  getPopupContainer?: () => HTMLElement
  children: React.ReactNode
}

export default function LibraryPermission({
  required = PERMISSION_TYPE.viewer,
  placement,
  inline,
  getPopupContainer,
  children
}: LibraryPermissionProps) {
  const libraryStore = useLibraryStore()

  const permissionResource = useMemo(() => {
    return {
      id: libraryStore.library?.id,
      icon: libraryStore.library?.icon,
      name: libraryStore.library?.name
    }
  }, [libraryStore.library])

  return (
    <PermissionTooltip
      permission={libraryStore.library?.permission}
      required={required}
      resourceType={RESOURCE_TYPE.library}
      resource={permissionResource}
      placement={placement as any}
      inline={inline}
      getPopupContainer={getPopupContainer}
    >
      {children}
    </PermissionTooltip>
  )
}
