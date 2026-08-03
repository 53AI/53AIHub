import { Tooltip } from 'antd'
import { StarFilled, StarOutlined } from '@ant-design/icons'
import { t } from '@/locales'

export interface FavoriteToggleProps {
  /** 当前是否已收藏 */
  favorite?: boolean
  /** 点击切换 */
  onToggle?: () => void
  /**
   * 按钮尺寸预设。
   * - `default`：34px 方块 + #F0F0F0 悬浮底色（右栏预览头部）
   * - `compact`：28px 方块 + #F5F5F7 悬浮底色（抽屉头部）
   */
  size?: 'default' | 'compact'
}

const SIZE_CLASS: Record<NonNullable<FavoriteToggleProps['size']>, string> = {
  default: 'size-[34px] hover:bg-[#F0F0F0]',
  compact: 'size-7 hover:bg-[#F5F5F7]',
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
  size = 'default',
}: FavoriteToggleProps) {
  return (
    <Tooltip title={favorite ? t('action.unfavorite') : t('action.favorite')}>
      <div
        className={`${SIZE_CLASS[size]} rounded flex items-center justify-center cursor-pointer`}
        onClick={() => onToggle?.()}
      >
        {favorite ? (
          <StarFilled className="text-[#FFB300] text-base" />
        ) : (
          <StarOutlined className="text-[#1D1E1F] text-base" />
        )}
      </div>
    </Tooltip>
  )
}

export default FavoriteToggle
