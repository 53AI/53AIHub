import { Avatar, Skeleton } from 'antd'
import { useEffect, useState, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react'
import { useEntityInfo } from '@/hooks/useEntityInfo'
import type { EntityType, EntityInfo } from '@/types/entity'
import { ENTITY_TYPE } from '@/types/entity'

export interface EntityDisplayRef {
  entityInfo: EntityInfo | null
  loading: boolean
  refresh: () => void
}

export interface EntityDisplayProps {
  /** 实体类型：user | group */
  type?: EntityType
  /** 实体ID */
  id: number | string
  /** 显示模式：avatar | name | full */
  mode?: 'avatar' | 'name' | 'full'
  /** 头像大小 */
  avatarSize?: number | string
  /** 头像形状 */
  avatarShape?: 'circle' | 'square'
  /** 是否显示加载状态 */
  showLoading?: boolean
  /** 自定义默认头像路径 */
  defaultAvatar?: string
}

function EntityDisplayInner(
  props: EntityDisplayProps,
  ref: React.ForwardedRef<EntityDisplayRef>
) {
  const {
    type = ENTITY_TYPE.USER,
    id,
    mode = 'avatar',
    avatarSize = 20,
    avatarShape = 'circle',
    showLoading = true,
    defaultAvatar = '',
  } = props

  const { getEntityInfo, loading } = useEntityInfo()
  const [entityInfo, setEntityInfo] = useState<EntityInfo | null>(null)

  // Default avatar URL
  const defaultAvatarUrl = useMemo(() => {
    if (defaultAvatar) return defaultAvatar

    const defaultAvatars: Record<string, string> = {
      [ENTITY_TYPE.USER]: '/images/space/people.png',
      [ENTITY_TYPE.GROUP]: '/images/space/group.png',
    }

    const avatarPath = defaultAvatars[type] || '/images/space/people.png'

    // Use global method to get real path
    if (typeof window !== 'undefined' && (window as any).$getRealPath) {
      return (window as any).$getRealPath({ url: avatarPath })
    }

    return avatarPath
  }, [type, defaultAvatar])

  // Display name
  const displayName = useMemo(() => {
    if (!entityInfo) {
      return type === ENTITY_TYPE.USER ? '未知用户' : '未知群组'
    }

    if (type === ENTITY_TYPE.USER) {
      const userInfo = entityInfo as any
      return userInfo.nickname || userInfo.name || '未知用户'
    } else {
      const groupInfo = entityInfo as any
      return groupInfo.group_name || '未知群组'
    }
  }, [entityInfo, type])

  // Fetch entity info
  const fetchEntityInfo = useCallback(async () => {
    if (!id) return

    try {
      const info = await getEntityInfo(type, Number(id))
      setEntityInfo(info)
    } catch (error) {
      console.error(`获取${type}信息失败:`, error)
      setEntityInfo(null)
    }
  }, [type, id, getEntityInfo])

  // Fetch on mount and when dependencies change
  useEffect(() => {
    fetchEntityInfo()
  }, [fetchEntityInfo])

  // Expose ref methods
  useImperativeHandle(ref, () => ({
    entityInfo,
    loading,
    refresh: fetchEntityInfo,
  }), [entityInfo, loading, fetchEntityInfo])

  // Parse avatar size
  const parsedAvatarSize = useMemo(() => {
    return typeof avatarSize === 'string' ? parseInt(avatarSize, 10) : avatarSize
  }, [avatarSize])

  // Loading state
  if (loading && showLoading) {
    if (mode === 'avatar') {
      return <Skeleton.Avatar active size={parsedAvatarSize} shape={avatarShape === 'circle' ? 'circle' : 'square'} />
    }
    return <Skeleton.Input active size="small" style={{ width: 80 }} />
  }

  // Avatar mode
  if (mode === 'avatar') {
    return (
      <div className="inline-flex items-center">
        <Avatar
          src={entityInfo?.avatar || defaultAvatarUrl}
          size={parsedAvatarSize}
          shape={avatarShape === 'circle' ? 'circle' : 'square'}
          style={{ backgroundColor: 'transparent' }}
        />
      </div>
    )
  }

  // Name mode
  if (mode === 'name') {
    return <span className="text-sm text-gray-600">{displayName}</span>
  }

  // Full mode (avatar + name)
  return (
    <div className="inline-flex items-center gap-2">
      <Avatar
        src={entityInfo?.avatar || defaultAvatarUrl}
        size={parsedAvatarSize}
        shape={avatarShape === 'circle' ? 'circle' : 'square'}
        style={{ backgroundColor: 'transparent' }}
      />
      <span className="text-sm text-gray-600">{displayName}</span>
    </div>
  )
}

export const EntityDisplay = forwardRef<EntityDisplayRef, EntityDisplayProps>(EntityDisplayInner)

export default EntityDisplay
