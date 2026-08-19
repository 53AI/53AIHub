import { useEffect, useState } from 'react'
import { RESOURCE_TYPE } from '@/components/KMPermission/constant'
import { LibraryFav } from '@/views/library/components/fav'
import mySpaceApi from '@/api/modules/my-space'

interface WikiFavProps {
  /** 资源 ID（wiki_page 用 pageId，space 用 spaceId） */
  resource_id?: string
  /** 资源类型，默认 RESOURCE_TYPE.wiki_page；空间收藏请传 RESOURCE_TYPE.favorite_space */
  resource_type?: number
}

/**
 * Wiki 收藏按钮：复用 LibraryFav，默认收藏类型为 wiki_page (3)；
 * 传入 resource_type = RESOURCE_TYPE.favorite_space (4) 时切换为空间收藏。
 */
export function WikiFav({
  resource_id,
  resource_type = RESOURCE_TYPE.wiki_page,
}: WikiFavProps) {
  const [isFavorite, setIsFavorite] = useState(false)

  // 进入页面时拉取一次收藏态，恢复星标
  useEffect(() => {
    let cancelled = false
    if (!resource_id) {
      setIsFavorite(false)
      return
    }
    mySpaceApi
      .check({ resource_type, ids: [resource_id] })
      .then((res) => {
        if (cancelled) return
        setIsFavorite(res.favorited_ids?.includes(resource_id) ?? false)
      })
      .catch(() => {
        /* 静默失败 */
      })
    return () => {
      cancelled = true
    }
  }, [resource_id, resource_type])

  if (!resource_id) return null

  return (
    <LibraryFav
      is_favorite={isFavorite}
      resource_type={resource_type}
      resource_id={resource_id}
      onChange={setIsFavorite}
    />
  )
}

export default WikiFav
