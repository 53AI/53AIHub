import { Button, Tooltip } from 'antd'
import { forwardRef, type MouseEvent, type ReactNode } from 'react'

export type IconActionVariant = 'toolbar' | 'row'

export interface IconActionProps {
  /** Tooltip 文案；同时作为默认 aria-label */
  title?: string
  /** 覆盖默认 aria-label；用于比 title 更具体的描述 */
  ariaLabel?: string
  /** 危险按钮（红色），用于删除类操作 */
  danger?: boolean
  disabled?: boolean
  /** 加载态（转圈并等同禁用），透传给内部 Button */
  loading?: boolean
  /**
   * 点击回调
   *
   * 接收 MouseEvent 是为了兼容被 antd Trigger（Popover/Tooltip/Dropdown 的
   * trigger="click"）包裹的场景。antd Trigger 会通过 cloneElement 给子节点
   * 注入 cloneProps.onClick，里面会读取 event.clientX 来定位浮层；如果
   * IconAction 在包裹时把 event 丢掉，cloneProps.onClick 拿到 undefined
   * 会抛 "Cannot read properties of undefined (reading 'clientX')"。
   * 调用方传 () => void / () => x 之类的无参箭头函数依然可用。
   */
  onClick?: (e: MouseEvent<HTMLElement>) => void
  /**
   * 使用场景：
   * - `toolbar`（默认）：持久显示的工具栏图标按钮，hover 有浅色底
   * - `row`：表格行操作按钮，仅行 hover 时显示（配合祖先 `group`），并自动阻止冒泡
   */
  variant?: IconActionVariant
  /** 尺寸预设（仅 `toolbar` 生效；`row` 固定 28px）。hover 底色统一 #F2F6FE */
  size?: 'default' | 'medium' | 'compact'
  /** 激活态 class（如选中态背景色），拼到根节点 */
  activeClassName?: string
  /** 额外 className */
  className?: string
  /** 图标节点 */
  children: ReactNode
}

const TOOLBAR_SIZE_CLASS: Record<NonNullable<IconActionProps['size']>, string> = {
  default: '!size-[34px] !p-0 hover:!bg-[#F2F6FE]',
  medium: '!size-8 !p-0 hover:!bg-[#F2F6FE]',
  compact: '!size-7 !p-0 hover:!bg-[#F2F6FE]',
}

/**
 * 通用图标动作按钮：图标 + tooltip + 点击，基于 antd `Button type="text"`。
 *
 * - `toolbar`：头部工具栏中带 tooltip 的 icon-only 操作
 * - `row`：表格操作列的行操作按钮（悬停显示、自动阻止冒泡）
 *
 * `title` 同时作为默认 aria-label；需要更具体的无障碍描述时单独传 `ariaLabel`。
 *
 * 对于「切换型」按钮（tooltip 文案随状态变化的，如收藏 / 全屏），
 * 仍优先用专用组件 `FavoriteToggle` / `FullscreenToggle`。
 *
 * @example
 * <IconAction title={t('action.download')} size="compact" onClick={handleDownload}>
 *   <DownloadOutlined style={{ fontSize: '16px' }} />
 * </IconAction>
 *
 * @example
 * // 表格操作列
 * <IconAction variant="row" title={t('action.edit')} onClick={handleEdit}>
 *   <SvgIcon name="edit" />
 * </IconAction>
 */
export const IconAction = forwardRef<HTMLButtonElement, IconActionProps>(function IconAction(
  {
    ariaLabel,
    title,
    danger,
    disabled,
    loading,
    onClick,
    variant = 'toolbar',
    size = 'default',
    activeClassName,
    className,
    children,
  },
  ref,
) {
  const isRow = variant === 'row'
  const cls = isRow
    ? `invisible !size-7 !p-0 group-hover:visible ${className ?? ''}`
    : `${TOOLBAR_SIZE_CLASS[size]} ${activeClassName ?? ''} ${className ?? ''}`

  const button = (
    <Button
      ref={ref}
      type="text"
      danger={danger}
      disabled={disabled}
      loading={loading}
      aria-label={ariaLabel ?? (title ? title : undefined)}
      className={cls}
      onClick={(e) => {
        // 行操作按钮要避免触发行点击（通常行绑定了跳转 / 选中）
        if (isRow) e.stopPropagation()
        onClick?.(e)
      }}
    >
      {children}
    </Button>
  )

  // 禁用按钮自带 pointer-events: none，Tooltip 无法触发；
  // 用 span 包裹以保留 tooltip（antd 官方推荐做法）。
  const wrapped = disabled && title ? <span className="inline-flex">{button}</span> : button

  return title ? <Tooltip title={title}>{wrapped}</Tooltip> : wrapped
})

export default IconAction
