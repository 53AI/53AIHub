import { SvgIcon } from '@km/shared-components-react'
import { IconButton } from '@/components/IconButton'
import { t } from '@/locales'

export interface FullscreenToggleProps {
  /** 当前是否全屏 */
  fullscreen?: boolean
  /** 点击切换 */
  onToggle?: () => void
  /** 图标尺寸，默认 16 */
  iconSize?: number
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
}: FullscreenToggleProps) {
  return (
    <IconButton
      title={fullscreen ? t('action.exit_fullscreen') : t('action.fullscreen')}
      size="medium"
      onClick={onToggle}
    >
      <SvgIcon
        name={fullscreen ? 'right-bar-bottom-collapse' : 'right-bar-bottom-expand'}
        size={iconSize}
      />
    </IconButton>
  )
}

export default FullscreenToggle
