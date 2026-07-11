import { useState, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react'
import { Avatar, Skeleton } from 'antd'
import { UserOutlined, TeamOutlined } from '@ant-design/icons'
import { useEntityInfo } from '@/hooks/useEntityInfo'
import { ENTITY_TYPE, type EntityType, type EntityInfo } from '@/types/entity'
import './EntityDisplay.css'

type DisplayMode = 'avatar' | 'name' | 'full'
type AvatarShape = 'circle' | 'square'

interface EntityDisplayProps {
  type: EntityType
  id: number | string
  mode?: DisplayMode
  avatarSize?: number
  avatarShape?: AvatarShape
  showLoading?: boolean
  defaultAvatar?: string
  className?: string
}

export interface EntityDisplayRef {
  entityInfo: EntityInfo | null
  loading: boolean
  refresh: () => void
}

export const EntityDisplay = forwardRef<EntityDisplayRef, EntityDisplayProps>(({
  type,
  id,
  mode = 'avatar',
  avatarSize = 20,
  avatarShape = 'circle',
  showLoading = true,
  defaultAvatar = '',
  className = '',
}, ref) => {
  const { loading, getEntityInfo } = useEntityInfo()
  const [entity, setEntity] = useState<EntityInfo | null>(null)
  const [localLoading, setLocalLoading] = useState(true)

  const fetchEntityInfo = async () => {
    if (!id) {
      setLocalLoading(false)
      return
    }

    setLocalLoading(true)
    try {
      const data = await getEntityInfo(type, id)
      setEntity(data)
    } catch (error) {
      console.error(`获取${type}信息失败:`, error)
      setEntity(null)
    }
    setLocalLoading(false)
  }

  useEffect(() => {
    fetchEntityInfo()
  }, [type, id])

  useImperativeHandle(ref, () => ({
    entityInfo: entity,
    loading: loading || localLoading,
    refresh: fetchEntityInfo
  }))

  const isLoading = showLoading && (loading || localLoading)

  const defaultAvatarUrl = useMemo(() => {
    if (defaultAvatar) {
      return defaultAvatar
    }

    const defaultAvatars = {
      [ENTITY_TYPE.USER]: '/images/space/people.png',
      [ENTITY_TYPE.GROUP]: '/images/space/group.png'
    }

    const avatarPath = defaultAvatars[type] || '/images/space/people.png'

    if (typeof window !== 'undefined' && (window as any).$getRealPath) {
      return (window as any).$getRealPath({ url: avatarPath })
    }

    return avatarPath
  }, [type, defaultAvatar])

  const getAvatarSrc = () => {
    if (!entity) return defaultAvatarUrl

    if (type === ENTITY_TYPE.USER) {
      return (entity as any).avatar || defaultAvatarUrl
    }
    if (type === ENTITY_TYPE.GROUP) {
      return (entity as any).avatar || defaultAvatarUrl
    }
    return defaultAvatarUrl
  }

  const getDisplayName = () => {
    if (!entity) {
      return type === ENTITY_TYPE.USER ? '未知用户' : '未知群组'
    }

    if (type === ENTITY_TYPE.USER) {
      const user = entity as any
      return user.nickname || user.name || '未知用户'
    }
    if (type === ENTITY_TYPE.GROUP) {
      return (entity as any).group_name || '未知群组'
    }
    return '-'
  }

  // 名称模式：直接返回 span 文本（与 Vue 版本一致）
  if (mode === 'name') {
    if (isLoading) {
      return (
        <span className={className}>
          <Skeleton.Input active size="small" style={{ width: 20, height: 20 }} />
        </span>
      )
    }
    return <span className={className}>{getDisplayName()}</span>
  }

  const renderAvatar = () => {
    if (isLoading) {
      return (
        <Skeleton.Avatar
          active
          size={avatarSize}
          shape={avatarShape}
        />
      )
    }

    return (
      <Avatar
        size={avatarSize}
        shape={avatarShape}
        src={getAvatarSrc()}
        icon={type === ENTITY_TYPE.USER ? <UserOutlined /> : <TeamOutlined />}
        className="entity-avatar"
      />
    )
  }

  // 头像模式
  if (mode === 'avatar') {
    if (isLoading) {
      return (
        <div className={`entity-display ${className}`}>
          {renderAvatar()}
        </div>
      )
    }
    return (
      <div className={`entity-display ${className}`}>
        <Avatar
          size={avatarSize}
          shape={avatarShape}
          src={getAvatarSrc()}
          icon={type === ENTITY_TYPE.USER ? <UserOutlined /> : <TeamOutlined />}
        />
      </div>
    )
  }

  // 完整模式（头像 + 名称）
  return (
    <div className={`entity-display ${className}`}>
      {renderAvatar()}
      <span className="entity-name-wrapper with-avatar">
        {isLoading ? <Skeleton.Input active size="small" style={{ width: 20 }} /> : getDisplayName()}
      </span>
    </div>
  )
})

EntityDisplay.displayName = 'EntityDisplay'

export default EntityDisplay