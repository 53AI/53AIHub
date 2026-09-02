import { SvgIcon } from '@km/shared-components-react'
import { IconAction } from '@km/shared-components-react'
import { t } from '@/locales'

export interface FullscreenToggleProps {
  /** 当前是否全屏 */
  fullscreen?: boolean
  /** 点击切换 */
  onToggle?: () => void
  /** 图标尺寸，默认 16 */
  iconSize?: number
  /** 进入全屏（非全屏态）图标名，默认 right-bar-bottom-expand */
  expandIcon?: string
  /** 退出全屏（全屏态）图标名，默认 right-bar-bottom-collapse */
  collapseIcon?: string
  size?: 'default' | 'medium' | 'compact'
  /** 额外 className */
  className?: string
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
  iconSize = 16,
  expandIcon = 'right-bar-bottom-expand',
  collapseIcon = 'right-bar-bottom-collapse',
  size = 'medium',
  className
}: FullscreenToggleProps) {
  return (
    <IconAction
      title={fullscreen ? t('action.exit_fullscreen') : t('action.fullscreen')}
      size={size}
      onClick={onToggle}
      className={className}
    >
      <SvgIcon
        name={fullscreen ? collapseIcon : expandIcon}
        size={iconSize}
      />
    </IconAction>
  )
}

export default FullscreenToggle
