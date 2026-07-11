import { useState, useEffect, useMemo } from 'react'
import { useParams, Outlet } from 'react-router-dom'
import { Spin } from 'antd'
import { SettingSider } from './sider'
import { PermissionEmpty } from '@/components/KMPermission/empty'
import { useLibraryStore } from '@/stores/modules/library'
import { checkHasKMPermission } from '@/utils/km-permission'
import { PERMISSION_TYPE } from '@/components/KMPermission/constant'

export function LibrarySettingLayout() {
  const [loading, setLoading] = useState(true)
  const params = useParams()
  const libraryStore = useLibraryStore()

  const hasManagePermission = useMemo(() => {
    return checkHasKMPermission(libraryStore.library?.permission, PERMISSION_TYPE.manage)
  }, [libraryStore.library?.permission])

  useEffect(() => {
    setLoading(true)
    libraryStore.setLibraryId(params.id as string).finally(() => {
      setLoading(false)
    })
  }, [params.id])

  return (
    <div className="h-screen flex overflow-hidden">
      <SettingSider className="flex-none" />
      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <Spin />
        </div>
      )}
      {!loading && !hasManagePermission && (
        <PermissionEmpty className="flex-1" />
      )}
      {!loading && hasManagePermission && libraryStore.library?.id && (
        <div className="flex-1">
          <Outlet />
        </div>
      )}
    </div>
  )
}

export default LibrarySettingLayout
