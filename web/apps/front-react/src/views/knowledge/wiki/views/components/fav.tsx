import { useEffect, useState } from 'react'
import { RESOURCE_TYPE } from '@/components/KMPermission/constant'
import { LibraryFav } from '@/views/library/components/fav'
import mySpaceApi from '@/api/modules/my-space'

interface WikiFavProps {
  pageId?: string
}

/**
 * Wiki 页面收藏按钮：复用 LibraryFav，把 resource_type 固定为 wiki_page (3)。
 */
export function WikiFav({ pageId }: WikiFavProps) {
  const [isFavorite, setIsFavorite] = useState(false)

  // 进入页面时拉取一次收藏态，恢复星标
  useEffect(() => {
    let cancelled = false
    if (!pageId) {
      setIsFavorite(false)
      return
    }
    mySpaceApi
      .check({ resource_type: RESOURCE_TYPE.wiki_page, ids: [pageId] })
      .then((res) => {
        if (cancelled) return
        setIsFavorite(res.favorited_ids?.includes(pageId) ?? false)
      })
      .catch(() => {
        /* 静默失败 */
      })
    return () => {
      cancelled = true
    }
  }, [pageId])

  if (!pageId) return null

  return (
    <LibraryFav
      is_favorite={isFavorite}
      resource_type={RESOURCE_TYPE.wiki_page}
      resource_id={pageId}
      onChange={setIsFavorite}
    />
  )
}

export default WikiFav
