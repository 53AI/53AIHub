import { useEffect, useState } from 'react'
import {
  PERMISSION_TYPE,
  RESOURCE_TYPE,
  type PermissionType,
} from '@/components/KMPermission/constant'
import permissionsApi from '@/api/modules/permissions'

/**
 * 获取当前用户对指定 wiki 页面的最大权限。
 * pageId 为空时返回 loading。
 */
export function useWikiPagePermission(pageId?: string): PermissionType {
  const [permission, setPermission] = useState<PermissionType>(PERMISSION_TYPE.loading)

  useEffect(() => {
    if (!pageId) {
      setPermission(PERMISSION_TYPE.loading)
      return
    }
    let cancelled = false
    permissionsApi
      .my({
        resource_type: RESOURCE_TYPE.wiki_page,
        resource_id: pageId,
      })
      .then((res) => {
        if (!cancelled) setPermission(res.max_permission)
      })
      .catch(() => {
        if (!cancelled) setPermission(PERMISSION_TYPE.none)
      })
    return () => {
      cancelled = true
    }
  }, [pageId])

  return permission
}

export default useWikiPagePermission
