import { useState, useRef, useEffect, forwardRef, useImperativeHandle, ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface FullscreenRef {
  toggle: () => void
  open: () => void
  close: () => void
  isOpen: () => boolean
}

interface FullscreenProps {
  target?: string
  flex?: boolean
  zIndex?: number
  className?: string
  children?: (props: { isOpen: boolean; toggle: () => void }) => ReactNode
  onZoom?: (isOpen: boolean) => void
}

export const Fullscreen = forwardRef<FullscreenRef, FullscreenProps>(
  (
    {
      target = 'body',
      flex = false,
      zIndex,
      className = '',
      children,
      onZoom,
    },
    ref
  ) => {
    const contentRef = useRef<HTMLDivElement>(null)
    const [isOpen, setIsOpen] = useState(false)
    const [nodeHeight, setNodeHeight] = useState(0)

    useEffect(() => {
      if (contentRef.current) {
        const resizeObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            setNodeHeight(entry.target.scrollHeight)
          }
        })
        resizeObserver.observe(contentRef.current)
        return () => resizeObserver.disconnect()
      }
    }, [])

    const toggle = () => {
      setIsOpen(!isOpen)
      onZoom?.(!isOpen)
    }

    const open = () => {
      setIsOpen(true)
      onZoom?.(true)
    }

    const close = () => {
      setIsOpen(false)
      onZoom?.(false)
    }

    useImperativeHandle(ref, () => ({
      toggle,
      open,
      close,
      isOpen: () => isOpen,
    }))

    const containerStyle: React.CSSProperties = {
      zIndex: zIndex || 1000,
    }

    const containerClasses = `
      ${isOpen ? 'fullscreen-container' : ''}
      ${flex ? 'fullscreen-flex' : ''}
      ${className}
    `.trim()

    const content = (
      <div ref={contentRef} className={containerClasses} style={containerStyle}>
        {children?.({ isOpen, toggle })}
      </div>
    )

    const placeholder = isOpen ? <div style={{ height: `${nodeHeight}px` }} /> : null

    if (isOpen && target) {
      const targetElement = document.querySelector(target)
      if (targetElement) {
        return (
          <>
            {createPortal(content, targetElement)}
            {placeholder}
          </>
        )
      }
    }

    return (
      <>
        {content}
        {placeholder}
      </>
    )
  }
)

export default Fullscreen
