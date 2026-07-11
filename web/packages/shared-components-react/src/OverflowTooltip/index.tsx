import { Tooltip } from 'antd'
import { useRef, useState, useEffect, Children, type ReactElement } from 'react'

export interface OverflowTooltipProps {
  /** 需要省略的元素，必须设置 truncate 或 line-clamp 类 */
  children: ReactElement
  /** Tooltip 位置 */
  placement?: 'top' | 'bottom' | 'left' | 'right'
  /** 是否为多行省略，默认 false（单行）。多行时检测 scrollHeight > clientHeight */
  multiline?: boolean
}

/**
 * 溢出提示组件 - 自动检测子元素是否溢出，只在溢出时显示 Tooltip
 *
 * @example
 * // 单行省略
 * <OverflowTooltip><span className="truncate">{text}</span></OverflowTooltip>
 * // 多行省略（如 line-clamp-2）
 * <OverflowTooltip multiline><span className="line-clamp-2">{text}</span></OverflowTooltip>
 */
export function OverflowTooltip({
  children,
  placement = 'top',
  multiline = false,
}: OverflowTooltipProps) {
  const ref = useRef<HTMLElement>(null)
  const [isOverflow, setIsOverflow] = useState(false)
  const [text, setText] = useState('')

  useEffect(() => {
    const el = ref.current
    if (el) {
      // 多行：检测高度溢出；单行：检测宽度溢出
      const overflowed = multiline
        ? el.scrollHeight > el.clientHeight
        : el.scrollWidth > el.clientWidth
      setIsOverflow(overflowed)
      setText(el.textContent || '')
    }
  })

  const child = Children.only(children)
  const clone = { ...child, ref }

  return isOverflow ? <Tooltip title={text} placement={placement}>{clone}</Tooltip> : clone
}

export default OverflowTooltip
