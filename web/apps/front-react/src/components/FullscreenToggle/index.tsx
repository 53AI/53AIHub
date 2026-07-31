import { Tooltip } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import { t } from '@/locales'

export interface FullscreenToggleProps {
  /** 当前是否全屏 */
  fullscreen?: boolean
  /** 点击切换 */
  onToggle?: () => void
  /**
   * 按钮尺寸预设。
   * - `default`：34px 方块 + #F0F0F0 悬浮底色（右栏预览头部，如 Wiki 详情 / 安心录预览）
   * - `compact`：28px 方块 + #F5F5F7 悬浮底色（抽屉头部，如用户记忆详情）
   */
  size?: 'default' | 'compact'
  /** 图标尺寸，默认 16 */
  iconSize?: number
}

const SIZE_CLASS: Record<NonNullable<FullscreenToggleProps['size']>, string> = {
  default: 'size-[34px] hover:bg-[#F0F0F0]',
  compact: 'size-7 hover:bg-[#F5F5F7]',
}

/**
 * 全屏切换按钮（纯展示）。
 *
 * 只负责「图标 + 文案 + 点击」，全屏状态本身由调用方持有 —— 推荐搭配
 * `useFullscreen` 使用，因为全屏需要给外层容器加覆盖层 className，
 * 而按钮通常渲染在头部，拿不到那个容器。
 *
 * @example
 * const { fullscreen, toggle, composeClassName } = useFullscreen()
 * <div className={composeClassName('flex-1 overflow-hidden')}>
 *   <FullscreenToggle fullscreen={fullscreen} onToggle={toggle} />
 * </div>
 */
export function FullscreenToggle({
  fullscreen = false,
  onToggle,
  size = 'default',
  iconSize = 16,
}: FullscreenToggleProps) {
  return (
    <Tooltip title={fullscreen ? t('action.exit_fullscreen') : t('action.fullscreen')}>
      <div
        className={`${SIZE_CLASS[size]} rounded flex items-center justify-center cursor-pointer`}
        onClick={() => onToggle?.()}
      >
        <SvgIcon
          name={fullscreen ? 'right-bar-bottom-collapse' : 'right-bar-bottom-expand'}
          size={iconSize}
        />
      </div>
    </Tooltip>
  )
}

export default FullscreenToggle
