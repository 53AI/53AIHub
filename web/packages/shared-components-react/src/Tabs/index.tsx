import React, { useRef, useState, useEffect, useCallback, useLayoutEffect, ReactNode } from 'react'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import './index.css'

export interface TabItem {
  key: string
  label: ReactNode
  disabled?: boolean
}

export interface TabsProps {
  items?: TabItem[]
  /**
   * 固定在滚动区域之前的 tab，不参与横向滚动。
   * 适用于"默认 tab"放在最前面、动态 tab 在右侧可滚动的场景。
   */
  prefixItems?: TabItem[]
  activeKey?: string
  defaultActiveKey?: string
  className?: string
  /**
   * 透传到每个 tab 项的额外类名（追加在变体样式之后，同名 Tailwind 类后写覆盖先写）。
   * 用于覆盖默认 text-xl / h-[52px] 等尺寸，例如 `tabClassName="text-base"`。
   */
  tabClassName?: string
  onChange?: (key: string) => void
  /**
   * 视觉变体：
   * - 'default'（默认）：胶囊样式，激活时浅蓝底
   * - 'underline'：大字号 + 底部下划线指示器，无背景填充
   * - 'segmented'：分段控制器样式，灰底容器 + 白色浮起激活项，适合列表状态筛选；
   *   超出宽度时横向滚动并显示左右箭头（滚动条隐藏，箭头是唯一的溢出提示）
   */
  variant?: 'default' | 'underline' | 'segmented'
  /** items 与 extra 之间的分隔内容（例如竖线） */
  divider?: ReactNode
  /** 末尾额外内容（例如加号按钮） */
  extra?: ReactNode
}

type TabsVariant = NonNullable<TabsProps['variant']>

/**
 * 各变体的 tab 样式（base 布局 + active / inactive 状态色）。
 * 拼接顺序固定为 base → disabled → active/inactive → tabClassName，保证 tabClassName 能覆盖默认样式。
 */
const TAB_STYLES: Record<TabsVariant, { base: string; active: string; inactive: string }> = {
  default: {
    base: 'h-8 flex items-center leading-8 px-4 rounded-md transition-colors whitespace-nowrap text-sm',
    active: 'bg-[#EBEFFD] text-[#2563EB]',
    inactive: 'text-[#333] hover:bg-[#F5F5F5]',
  },
  underline: {
    base: 'relative px-4 h-[52px] flex items-center text-xl whitespace-nowrap',
    active: 'text-[#2563EB] font-medium',
    inactive: 'text-[#4F5052] hover:text-[#2563EB]',
  },
  segmented: {
    base: 'flex-none h-8 px-4 rounded flex items-center whitespace-nowrap text-base transition-all max-md:px-3 max-md:text-sm',
    active: 'bg-white text-[#2563EB] shadow-sm',
    inactive: 'text-[#999999] hover:text-[#1e293b]',
  },
}

/**
 * 通用 Tabs 组件
 *
 * - 支持 default / underline / segmented 三种视觉
 * - items 的 label 支持 ReactNode
 * - divider / extra 与 items 一起参与横向滚动
 */
export const Tabs: React.FC<TabsProps> = ({
  items = [],
  prefixItems = [],
  activeKey,
  defaultActiveKey,
  className,
  tabClassName,
  onChange,
  variant = 'default',
  divider,
  extra,
}) => {
  const [internalActiveKey, setInternalActiveKey] = useState(defaultActiveKey || items[0]?.key)
  const [showLeftArrow, setShowLeftArrow] = useState(false)
  const [showRightArrow, setShowRightArrow] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)

  const currentActiveKey = activeKey ?? internalActiveKey

  const checkOverflow = useCallback(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) return

    const { scrollLeft, clientWidth } = container
    const { scrollWidth } = content

    setShowLeftArrow(scrollLeft > 0)
    setShowRightArrow(scrollLeft + clientWidth < scrollWidth - 1)
  }, [])

  useLayoutEffect(() => {
    checkOverflow()
  }, [items, checkOverflow])

  useEffect(() => {
    const container = containerRef.current
    const content = contentRef.current

    window.addEventListener('resize', checkOverflow)

    if (container && typeof ResizeObserver !== 'undefined') {
      resizeObserverRef.current = new ResizeObserver(() => {
        checkOverflow()
      })
      resizeObserverRef.current.observe(container)
      if (content) {
        resizeObserverRef.current.observe(content)
      }
    }

    return () => {
      window.removeEventListener('resize', checkOverflow)
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect()
      }
    }
  }, [checkOverflow])

  const handleScroll = (direction: 'left' | 'right') => {
    const container = containerRef.current
    if (!container) return

    const scrollAmount = container.clientWidth * 0.5
    const newScrollLeft = direction === 'left'
      ? container.scrollLeft - scrollAmount
      : container.scrollLeft + scrollAmount

    container.scrollTo({
      left: newScrollLeft,
      behavior: 'smooth'
    })
  }

  const handleTabClick = (key: string, disabled?: boolean) => {
    if (disabled) return
    setInternalActiveKey(key)
    onChange?.(key)
  }

  const isUnderline = variant === 'underline'
  const isSegmented = variant === 'segmented'
  const tabStyle = TAB_STYLES[variant] || TAB_STYLES.default

  const renderTab = (item: TabItem) => {
    const isActive = item.key === currentActiveKey
    return (
      <div
        key={item.key}
        className={`
          ${tabStyle.base}
          ${item.disabled ? 'cursor-not-allowed text-[#999]' : 'cursor-pointer'}
          ${isActive ? tabStyle.active : tabStyle.inactive}
          ${tabClassName || ''}
        `}
        onClick={() => handleTabClick(item.key, item.disabled)}
      >
        {item.label}
        {isUnderline && isActive && (
          <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-[#2563EB] rounded-full" />
        )}
      </div>
    )
  }

  // 滚动箭头：分段控制器用小一号的白色圆片（与激活项的白色浮起风格呼应），其余变体用大箭头
  const arrowClass = isSegmented
    ? 'w-6 h-6 rounded bg-white shadow-sm text-[#999] hover:text-[#2563EB] transition-colors'
    : 'w-7 h-7 rounded-md hover:bg-[#EBEFFD] hover:text-[#2563EB] text-[#999] transition-all duration-200 bg-white shadow-sm'

  const renderArrow = (direction: 'left' | 'right') => {
    const visible = direction === 'left' ? showLeftArrow : showRightArrow
    if (!visible) return null
    return (
      <div
        className={`absolute top-1/2 -translate-y-1/2 z-10 flex items-center justify-center cursor-pointer ${arrowClass} ${
          direction === 'left' ? 'left-0' : 'right-0'
        }`}
        onClick={() => handleScroll(direction)}
      >
        {direction === 'left' ? (
          <LeftOutlined className="text-xs" />
        ) : (
          <RightOutlined className="text-xs" />
        )}
      </div>
    )
  }

  return (
    <div
      className={
        isSegmented
          ? `flex items-center bg-[#F5F5F5] p-1 rounded-lg ${className || ''}`
          : `relative flex items-center ${className || ''}`
      }
    >
      {/* 固定在前面的 tab，不参与横向滚动（例如默认的"洞察/纪要/转写"） */}
      {prefixItems.length > 0 && (
        <div className="flex items-center flex-none">
          {prefixItems.map((item) => renderTab(item))}
        </div>
      )}

      {/* 可滚动区域（items + divider + extra），左右箭头只覆盖该区域，不会盖住 prefixItems */}
      <div className="relative flex-1 min-w-0">
        {renderArrow('left')}

        <div
          ref={containerRef}
          className="overflow-x-auto overflow-y-hidden tabs-scroll-hide scroll-smooth"
          onScroll={checkOverflow}
        >
          <div ref={contentRef} className="flex items-center">
            {items.map((item) => renderTab(item))}
            {/* items 与 extra 之间的分隔（例如竖线），与 tab 一同参与横向滚动 */}
            {divider}
            {/* 末尾额外内容（与 tab 一同参与横向滚动） */}
            {extra}
          </div>
        </div>

        {renderArrow('right')}
      </div>
    </div>
  )
}

export default Tabs
