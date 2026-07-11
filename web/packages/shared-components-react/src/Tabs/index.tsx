import React, { useRef, useState, useEffect, useCallback, useLayoutEffect } from 'react'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'

export interface TabItem {
  key: string
  label: string
  disabled?: boolean
}

export interface TabsProps {
  items?: TabItem[]
  activeKey?: string
  defaultActiveKey?: string
  className?: string
  onChange?: (key: string) => void
}

export const Tabs: React.FC<TabsProps> = ({
  items = [],
  activeKey,
  defaultActiveKey,
  className,
  onChange
}) => {
  const [internalActiveKey, setInternalActiveKey] = useState(defaultActiveKey || items[0]?.key)
  const [showLeftArrow, setShowLeftArrow] = useState(false)
  const [showRightArrow, setShowRightArrow] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)

  // 受控模式：使用外部传入的 activeKey
  // 非受控模式：使用内部状态
  const currentActiveKey = activeKey ?? internalActiveKey

  // 检查是否需要显示滚动按钮
  const checkOverflow = useCallback(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) return

    const { scrollLeft, clientWidth } = container
    const { scrollWidth } = content

    setShowLeftArrow(scrollLeft > 0)
    setShowRightArrow(scrollLeft + clientWidth < scrollWidth - 1)
  }, [])

  // 使用 useLayoutEffect 确保 DOM 更新后立即检查
  useLayoutEffect(() => {
    checkOverflow()
  }, [items, checkOverflow])

  useEffect(() => {
    const container = containerRef.current
    const content = contentRef.current

    // 监听 window resize
    window.addEventListener('resize', checkOverflow)

    // 使用 ResizeObserver 监听容器和内容尺寸变化
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

  // 滚动处理
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

  return (
    <div className={`relative flex items-center ${className || ''}`}>
      {/* 左按钮 */}
      {showLeftArrow && (
        <div
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 flex items-center justify-center cursor-pointer hover:bg-[#EBEFFD] hover:text-[#2563EB] text-[#999] rounded-md transition-all duration-200 bg-white shadow-sm"
          onClick={() => handleScroll('left')}
        >
          <LeftOutlined className="text-xs" />
        </div>
      )}

      {/* 主体 */}
      <div
        ref={containerRef}
        className="flex-1 overflow-x-hidden overflow-y-hidden scroll-smooth"
        onScroll={checkOverflow}
      >
        <div ref={contentRef} className="flex">
          {items.map((item) => {
            const isActive = item.key === currentActiveKey
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
          })}
        </div>
      </div>

      {/* 右按钮 */}
      {showRightArrow && (
        <div
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 flex items-center justify-center cursor-pointer hover:bg-[#EBEFFD] hover:text-[#2563EB] text-[#999] rounded-md transition-all duration-200 bg-white shadow-sm"
          onClick={() => handleScroll('right')}
        >
          <RightOutlined className="text-xs" />
        </div>
      )}
    </div>
  )
}

export default Tabs
