import { Tooltip } from 'antd'
import { forwardRef, type MouseEvent, type ReactNode } from 'react'

export interface IconButtonProps {
  /** Tooltip 文本；同时作为默认 aria-label */
  title: string
  /** 覆盖默认 aria-label；用于比 title 更具体的描述（如 "关闭文件预览"） */
  ariaLabel?: string
  /**
   * 点击回调
   *
   * 接收 MouseEvent 是为了兼容被 antd Trigger（Popover/Tooltip/Dropdown 的
   * trigger="click"）包裹的场景。antd Trigger 会通过 cloneElement 给子节点
   * 注入 cloneProps.onClick，里面会读取 event.clientX 来定位浮层；如果
   * IconButton 在包裹时把 event 丢掉，cloneProps.onClick 拿到 undefined
   * 会抛 "Cannot read properties of undefined (reading 'clientX')"。
   * 调用方传 () => void / () => x 之类的无参箭头函数依然可用。
   */
  onClick?: (e: MouseEvent<HTMLDivElement>) => void
  /**
   * 按钮尺寸预设（hover 底色统一 #F2F6FE，按尺寸区分）。
   * - `default`：34px 方块（右栏预览头部，如 Wiki 详情）
   * - `medium`：32px 方块（页面顶部操作区，如 Wiki 索引页头）
   * - `compact`：28px 方块（抽屉头部，如用户记忆详情）
   */
  size?: 'default' | 'medium' | 'compact'
  /** 图标节点 */
  children: ReactNode
  /** 额外 className，会附加在尺寸 class 之后 */
  className?: string
  /** 激活态 class（如选中态背景色），会拼到根节点 */
  activeClassName?: string
}

const SIZE_CLASS: Record<NonNullable<IconButtonProps['size']>, string> = {
  default: 'size-[34px] hover:bg-[#F2F6FE]',
  medium: 'size-8 hover:bg-[#F2F6FE]',
  compact: 'size-7 hover:bg-[#F2F6FE]',
}

/**
 * 通用图标按钮：图标 + tooltip + 点击。
 *
 * 用于头部工具栏中带 tooltip 的 icon-only 操作。
 * `title` 同时作为默认 aria-label；当需要比 tooltip 更具体的
 * 无障碍描述时，单独传 `ariaLabel` 覆盖。
 *
 * 对于「切换型」按钮（tooltip 文案随状态变化的，如收藏 / 全屏），
 * 仍优先用专用组件 `FavoriteToggle` / `FullscreenToggle`，
 * 因为它们封装了「状态文案 + 图标切换」这一对耦合。
 *
 * @example
 * <IconButton title={t('action.download')} size="compact" onClick={handleDownload}>
 *   <DownloadOutlined style={{ fontSize: '16px' }} />
 * </IconButton>
 *
 * @example
 * // 当无障碍描述比 tooltip 更具体时：
 * <IconButton
 *   title={t('action.close')}
 *   ariaLabel="关闭文件预览"
 *   size="compact"
 *   onClick={handleClose}
 * />
 */
export const IconButton = forwardRef<HTMLDivElement, IconButtonProps>(function IconButton({
  ariaLabel,
  title,
  onClick,
  size = 'default',
  children,
  className,
  activeClassName,
}: IconButtonProps, ref) {
  // 把外层 ref（通常是 antd Popover/Tooltip 的 setTargetRef）透传到内部 div。
  // 不透传会导致 Popover 拿不到目标 DOM 元素、浮层定位失败。
  const button = (
    <div
      ref={ref}
      role="button"
      aria-label={ariaLabel}
      className={`${SIZE_CLASS[size]} rounded flex items-center justify-center cursor-pointer ${className ?? ''} ${activeClassName ?? ''}`}
      onClick={(e) => onClick?.(e)}
    >
      {children}
    </div>
  )

  return title ? <Tooltip title={title}>{button}</Tooltip> : button
})

export default IconButton
