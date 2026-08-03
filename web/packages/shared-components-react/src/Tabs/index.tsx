import React, { useRef, useState, useEffect, useCallback, useLayoutEffect, ReactNode } from 'react'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'

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
  onChange?: (key: string) => void
  /**
   * 视觉变体：
   * - 'default'（默认）：胶囊样式，激活时浅蓝底
   * - 'underline'：大字号 + 底部下划线指示器，无背景填充
   */
  variant?: 'default' | 'underline'
  /** items 与 extra 之间的分隔内容（例如竖线） */
  divider?: ReactNode
  /** 末尾额外内容（例如加号按钮） */
  extra?: ReactNode
}

/**
 * 通用 Tabs 组件
 *
 * - 支持 default / underline 两种视觉
 * - items 的 label 支持 ReactNode
 * - divider / extra 与 items 一起参与横向滚动
 */
export const Tabs: React.FC<TabsProps> = ({
  items = [],
  prefixItems = [],
  activeKey,
  defaultActiveKey,
  className,
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

  const renderTab = (item: TabItem) => {
    const isActive = item.key === currentActiveKey
    if (isUnderline) {
      return (
        <div
          key={item.key}
          className={`
            relative px-4 h-[52px] flex items-center text-xl whitespace-nowrap
            ${item.disabled ? 'cursor-not-allowed text-[#999]' : 'cursor-pointer'}
            ${isActive ? 'text-[#2563EB] font-medium' : 'text-[#4F5052] hover:text-[#2563EB]'}
          `}
          onClick={() => handleTabClick(item.key, item.disabled)}
        >
          {item.label}
          {isActive && (
            <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-[#2563EB] rounded-full" />
          )}
        </div>
      )
    }
    return (
      <div
        key={item.key}
        className={`
          h-8 flex items-center leading-8 px-4 rounded-md transition-colors whitespace-nowrap text-sm
          ${item.disabled ? 'cursor-not-allowed text-[#999]' : 'cursor-pointer'}
          ${isActive ? 'bg-[#EBEFFD] text-[#2563EB]' : 'text-[#333] hover:bg-[#F5F5F5]'}
        `}
        onClick={() => handleTabClick(item.key, item.disabled)}
      >
        {item.label}
      </div>
    )
  }

  return (
    <div className={`relative flex items-center ${className || ''}`}>
      {/* 固定在前面的 tab，不参与横向滚动（例如默认的"洞察/纪要/转写"） */}
      {prefixItems.length > 0 && (
        <div className="flex items-center flex-none">
          {prefixItems.map((item) => renderTab(item))}
        </div>
      )}

      {/* 可滚动区域（items + divider + extra），左右箭头只覆盖该区域，不会盖住 prefixItems */}
      <div className="relative flex-1 min-w-0">
        {showLeftArrow && (
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 flex items-center justify-center cursor-pointer hover:bg-[#EBEFFD] hover:text-[#2563EB] text-[#999] rounded-md transition-all duration-200 bg-white shadow-sm"
            onClick={() => handleScroll('left')}
          >
            <LeftOutlined className="text-xs" />
          </div>
        )}

        <div
          ref={containerRef}
          className="overflow-x-hidden overflow-y-hidden scroll-smooth"
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

        {showRightArrow && (
          <div
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 flex items-center justify-center cursor-pointer hover:bg-[#EBEFFD] hover:text-[#2563EB] text-[#999] rounded-md transition-all duration-200 bg-white shadow-sm"
            onClick={() => handleScroll('right')}
          >
            <RightOutlined className="text-xs" />
          </div>
        )}
      </div>
    </div>
  )
}

export default Tabs
