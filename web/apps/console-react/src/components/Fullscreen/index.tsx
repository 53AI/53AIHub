import React, { useCallback, useEffect, useRef, useState, ReactElement, cloneElement } from 'react'
import { createPortal } from 'react-dom'

interface FullscreenProps {
  target?: string
  zIndex?: number
  /** 全屏时内容区宽度，默认 100% */
  contentWidth?: string
  /** 全屏时内容区高度，默认 100% */
  contentHeight?: string
  /** 非全屏时容器的 className */
  className?: string
  /** 全屏时遮罩层的 className（用于覆盖背景色等） */
  maskClassName?: string
  children: (props: { isFullscreen: boolean; toggleFullscreen: () => void }) => ReactElement
}

const Fullscreen: React.FC<FullscreenProps> = (props) => {
  const {
    target = 'body',
    zIndex = 9,
    contentWidth = '100%',
    contentHeight = '100%',
    className = '',
    maskClassName = '',
    children,
  } = props

  const contentRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [nodeHeight, setNodeHeight] = useState(0)
  const [dynamicZIndex, setDynamicZIndex] = useState(zIndex)
  const isSelectingRef = useRef(false)  // 是否正在选择文字

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => {
      if (!prev) {
        setDynamicZIndex(zIndex || 1000)
      }
      return !prev
    })
  }, [zIndex])

  // 处理遮罩层点击：如果正在选择文字则不关闭
  const handleMaskClick = useCallback(() => {
    // 检查是否有文字选中
    const selection = window.getSelection()
    if (selection && selection.toString().trim().length > 0) {
      // 有文字选中，不关闭
      return
    }
    toggleFullscreen()
  }, [toggleFullscreen])

  // ESC key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        toggleFullscreen()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isFullscreen, toggleFullscreen])

  // ResizeObserver for height tracking
  useEffect(() => {
    if (!contentRef.current || isFullscreen) return

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setNodeHeight(entry.target.scrollHeight)
      }
    })

    resizeObserver.observe(contentRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [isFullscreen])

  // Get portal target
  const getPortalTarget = useCallback(() => {
    if (target === 'body') {
      return document.body
    }
    return document.querySelector(target) || document.body
  }, [target])

  const childElement = children({ isFullscreen, toggleFullscreen })

  // Non-fullscreen: just render children with className
  if (!isFullscreen) {
    return (
      <div ref={contentRef} className={className}>
        {childElement}
      </div>
    )
  }

  // Fullscreen: clone child element and add default styles
  // Similar to Vue's :deep(> *) behavior
  // Child can override with !important (e.g., !bg-[#FAFBFC])
  const needCenter = contentWidth !== '100%' || contentHeight !== '100%'
  const defaultClasses = 'w-full h-full bg-white rounded-lg shadow-2xl'

  // Merge classes - default first, child classes second
  const existingClasses = childElement.props.className || ''
  const mergedClasses = existingClasses
    ? `${defaultClasses} ${existingClasses}`
    : defaultClasses

  const styledChild = cloneElement(childElement, {
    className: mergedClasses,
    style: {
      ...childElement.props.style,
      ...(needCenter && {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: contentWidth,
        height: contentHeight,
      }),
    },
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation()
      childElement.props.onClick?.(e)
    },
  })

  return (
    <>
      {createPortal(
        <div
          className={`fixed inset-0 p-4 bg-black/25 overflow-y-auto ${maskClassName}`}
          style={{ zIndex: dynamicZIndex, backdropFilter: 'blur(2px)' }}
          onClick={handleMaskClick}
        >
          {styledChild}
        </div>,
        getPortalTarget()
      )}
      <div style={{ height: `${nodeHeight}px` }} />
    </>
  )
}

export default Fullscreen