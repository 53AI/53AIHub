import { useState } from 'react'
import { message } from 'antd'
import { useNavigate } from 'react-router-dom'
import { FavoriteToggle } from '@/components/FavoriteToggle'
import favoritesApi from '@/api/modules/favorites'
import './fav.css'

interface LibraryFavProps {
  is_favorite: boolean
  resource_type: number
  resource_id: string
  onChange?: (value: boolean) => void
}

export function LibraryFav({ is_favorite, resource_type, resource_id, onChange }: LibraryFavProps) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)

  const handleFavorite = async () => {
    if (loading) return
    setLoading(true)
    try {
      await favoritesApi.toggle({
        resource_type,
        resource_id
      })
      if (!is_favorite) {
        message.success(
          <span>
            收藏成功！前往{' '}
            <a
              className="cursor-pointer text-[#007AFF]"
              onClick={() => navigate('/mine?tab=fav')}
            >
              我的
            </a>{' '}
            查看
          </span>
        )
      } else {
        message.success('已取消收藏')
      }
      onChange?.(!is_favorite)
    } finally {
      setLoading(false)
    }
  }

  return (
    <FavoriteToggle favorite={is_favorite} onToggle={handleFavorite} />
  )
}

export default LibraryFav
