import { StarFilled, StarOutlined } from '@ant-design/icons'
import { IconButton } from '@/components/IconButton'
import { t } from '@/locales'

export interface FavoriteToggleProps {
  /** 当前是否已收藏 */
  favorite?: boolean
  /** 点击切换 */
  onToggle?: () => void
}

/**
 * 收藏星标按钮（纯展示）。
 *
 * 只负责「星标外观 + 文案 + 点击」，不发请求、不持有状态。收藏态与写接口
 * 由调用方决定，因为两种用法的归属不同：
 * - 自持型：`LibraryFav` 内部调 favorites/toggle 接口并维护本地状态
 * - 受控型：列表页父组件已持有 `file.isFavorite`，按钮只上抛命令
 */
export function FavoriteToggle({
  favorite = false,
  onToggle,
}: FavoriteToggleProps) {
  return (
    <IconButton
      title={favorite ? t('action.unfavorite') : t('action.favorite')}
      size="medium"
      onClick={onToggle}
    >
      {favorite ? (
        <StarFilled className="text-[#FFB300] text-base" />
      ) : (
        <StarOutlined className="text-[#1D1E1F] text-base" />
      )}
    </IconButton>
  )
}

export default FavoriteToggle