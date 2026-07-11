import { useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import { debounce } from '@km/shared-utils'

export interface ScrollerProps {
  children?: React.ReactNode
  disableTop?: boolean
  disableBottom?: boolean
  threshold?: number
  debounceTime?: number
  className?: string
  onLoadTop?: (done: () => void) => void
  onLoadBottom?: (done: () => void) => void
  topLoadingSlot?: (loading: boolean) => React.ReactNode
  bottomLoadingSlot?: (loading: boolean) => React.ReactNode
}

export interface ScrollerRef {
  scrollToTop: (behavior?: ScrollBehavior) => void
  scrollToBottom: (behavior?: ScrollBehavior) => void
  prepareTopLoad: () => void
  adjustScrollPosition: () => void
}

export const Scroller = forwardRef<ScrollerRef, ScrollerProps>(
  (
    {
      children,
      disableTop = false,
      disableBottom = false,
      threshold = 50,
      debounceTime = 200,
      className,
      onLoadTop,
      onLoadBottom,
      topLoadingSlot,
      bottomLoadingSlot,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)
    const [topLoading, setTopLoading] = useState(false)
    const [bottomLoading, setBottomLoading] = useState(false)
    const lastScrollTop = useRef(0)
    const previousScrollHeight = useRef(0)

    const checkPosition = useCallback(
      debounce(() => {
        if (!containerRef.current) return

        const { scrollTop, scrollHeight, clientHeight } = containerRef.current
        const currentScroll = scrollTop

        // Determine scroll direction
        const isScrollingDown = currentScroll > lastScrollTop.current
        lastScrollTop.current = currentScroll

        // Check positions
        const isAtTop = currentScroll <= threshold
        const isAtBottom = currentScroll + clientHeight >= scrollHeight - threshold

        if (!isScrollingDown && isAtTop && !disableTop && onLoadTop) {
          setTopLoading(true)
          onLoadTop(() => {
            setTopLoading(false)
          })
        }

        if (isScrollingDown && isAtBottom && !disableBottom && onLoadBottom) {
          setBottomLoading(true)
          onLoadBottom(() => {
            setBottomLoading(false)
          })
        }
      }, debounceTime),
      [disableTop, disableBottom, threshold, debounceTime, onLoadTop, onLoadBottom]
    )

    const handleScroll = useCallback(() => {
      checkPosition()
    }, [checkPosition])

    const scrollToTop = useCallback((behavior: ScrollBehavior = 'smooth') => {
      containerRef.current?.scrollTo({
        top: 0,
        behavior,
      })
    }, [])

    const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
      if (!containerRef.current) return
      const { scrollHeight, clientHeight } = containerRef.current
      containerRef.current.scrollTo({
        top: scrollHeight - clientHeight,
        behavior,
      })
    }, [])

    const prepareTopLoad = useCallback(() => {
      if (containerRef.current) {
        previousScrollHeight.current = containerRef.current.scrollHeight
      }
    }, [])

    const adjustScrollPosition = useCallback(() => {
      // Use setTimeout instead of nextTick
      setTimeout(() => {
        if (!containerRef.current) return
        const newScrollHeight = containerRef.current.scrollHeight
        const diff = newScrollHeight - previousScrollHeight.current
        if (diff > 0) {
          containerRef.current.scrollTop += diff
        }
      }, 0)
    }, [])

    useImperativeHandle(ref, () => ({
      scrollToTop,
      scrollToBottom,
      prepareTopLoad,
      adjustScrollPosition,
    }))

    return (
      <div
        ref={containerRef}
        className={`scroll-container ${className || ''}`}
        onScroll={handleScroll}
        style={{
          height: '100%',
          overflowY: 'auto',
          position: 'relative',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <div ref={contentRef} className="scroll-content" style={{ minHeight: '100%', position: 'relative' }}>
          {/* Top loading indicator */}
          {!disableTop && (
            <div
              className="load-indicator top-indicator"
              data-visible={topLoading}
              style={{
                height: 0,
                transition: 'opacity 0.3s ease',
                opacity: topLoading ? 1 : 0,
                pointerEvents: 'none',
                background: 'rgba(255, 255, 255, 0.9)',
                position: 'sticky',
                top: 20,
                zIndex: 1,
              }}
            >
              {topLoadingSlot ? (
                topLoadingSlot(topLoading)
              ) : (
                <div className="loader" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                  <div
                    className="loader-spinner"
                    style={{
                      width: 24,
                      height: 24,
                      border: '3px solid rgba(0, 0, 0, 0.1)',
                      borderTopColor: '#007aff',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite',
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Main content */}
          {children}

          {/* Bottom loading indicator */}
          {!disableBottom && (
            <div
              className="load-indicator bottom-indicator"
              data-visible={bottomLoading}
              style={{
                height: 0,
                transition: 'opacity 0.3s ease',
                opacity: bottomLoading ? 1 : 0,
                pointerEvents: 'none',
                background: 'rgba(255, 255, 255, 0.9)',
                position: 'sticky',
                bottom: 20,
              }}
            >
              {bottomLoadingSlot ? (
                bottomLoadingSlot(bottomLoading)
              ) : (
                <div className="loader" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                  <div
                    className="loader-spinner"
                    style={{
                      width: 24,
                      height: 24,
                      border: '3px solid rgba(0, 0, 0, 0.1)',
                      borderTopColor: '#007aff',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite',
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    )
  }
)

Scroller.displayName = 'Scroller'

export default Scroller
