import { useRef, useState, useEffect, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react'
import './index.css'

interface VirtualListProps<T> {
  items: T[]
  itemHeight: number
  itemKey?: string
  buffer?: number
  displayCount?: number
  wrapperClass?: string
  enableHeightMonitor?: boolean
  visibleDelay?: number
  sequential?: boolean
  resetKey?: number | string
  renderItem: (item: T, index: number, isVisible: boolean) => React.ReactNode
  onItemVisible?: (index: number, item: T, done: () => void) => void
  onItemHidden?: (index: number, item: T) => void
}

export interface VirtualListRef {
  scrollToIndex: (index: number, behavior?: ScrollBehavior, finder?: () => Element | null) => Promise<void>
  getItemPosition: (index: number) => { offset: number; height: number }
  checkAllVisibleHeights: () => void
}

interface VirtualItem<T> {
  index: number
  data: T
  isVisible: boolean
}

interface ItemHeight {
  [key: number]: number
}

// Throttle function
function throttle<T extends (...args: unknown[]) => void>(func: T, delay: number) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let lastExecTime = 0

  return function (this: unknown, ...args: Parameters<T>) {
    const currentTime = Date.now()

    if (currentTime - lastExecTime > delay) {
      func.apply(this, args)
      lastExecTime = currentTime
    } else {
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(
        () => {
          func.apply(this, args)
          lastExecTime = Date.now()
        },
        delay - (currentTime - lastExecTime)
      )
    }
  }
}

function VirtualListInner<T>(
  {
    items,
    itemHeight,
    itemKey = 'id',
    buffer = 5,
    displayCount = 6,
    wrapperClass = '',
    enableHeightMonitor = true,
    visibleDelay = 300,
    sequential = true,
    resetKey,
    renderItem,
    onItemVisible,
    onItemHidden,
  }: VirtualListProps<T>,
  ref: React.ForwardedRef<VirtualListRef>
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)
  const [itemHeights, setItemHeights] = useState<ItemHeight>({})
  const [isScrolling, setIsScrolling] = useState(false)
  const isUserScrollingRef = useRef(false)
  const userScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const itemRefs = useRef<Map<number, HTMLElement>>(new Map())

  // Observer refs
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const mutationObserverRef = useRef<MutationObserver | null>(null)
  const observedElementsRef = useRef<Set<HTMLElement>>(new Set())

  // Timeout refs
  const resizeTimeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const renderTimeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // State refs for processing
  const processingItemsRef = useRef<Set<number>>(new Set())
  const executionQueueRef = useRef<Array<{ index: number; item: T; done: () => void }>>([])
  const isExecutingRef = useRef(false)
  const targetIndexRef = useRef<number | null>(null)
  const loadedIndexesRef = useRef<Set<number>>(new Set())

  // Track previous visible items
  const prevVisibleIndexesRef = useRef<Set<number>>(new Set())

  // Calculate total height
  const totalHeight = useMemo(() => {
    let height = 0
    for (let i = 0; i < items.length; i++) {
      height += itemHeights[i] || itemHeight
    }
    return height
  }, [items, itemHeights, itemHeight])

  // Calculate visible range
  const visibleRange = useMemo(() => {
    const totalItems = items.length

    if (totalItems <= displayCount + buffer) {
      return { start: 0, end: totalItems - 1 }
    }

    let start = 0
    let accumulatedHeight = 0
    const scrollBottom = containerHeight > 0
      ? scrollTop + containerHeight
      : scrollTop + itemHeight * displayCount

    // Find start index
    for (let i = 0; i < totalItems; i++) {
      const h = itemHeights[i] || itemHeight
      const itemTop = accumulatedHeight
      const itemBottom = accumulatedHeight + h

      if (scrollTop >= itemTop && scrollTop < itemBottom) {
        start = Math.max(0, i - buffer)
        break
      }

      if (scrollTop === itemBottom) {
        if (i < totalItems - 1) {
          start = Math.max(0, i + 1 - buffer)
        } else {
          start = Math.max(0, i - buffer)
        }
        break
      }

      accumulatedHeight = itemBottom
    }

    // Find end index
    let end = totalItems - 1
    accumulatedHeight = 0

    for (let i = 0; i < totalItems; i++) {
      const h = itemHeights[i] || itemHeight
      const itemBottom = accumulatedHeight + h

      if (scrollBottom <= itemBottom) {
        end = Math.min(totalItems - 1, i + buffer)
        break
      }
      accumulatedHeight = itemBottom
    }

    // Ensure start <= end
    start = Math.max(0, Math.min(start, end))

    // Boundary check
    if (start < 0 || end < 0 || start >= totalItems || end >= totalItems) {
      start = Math.max(0, Math.min(start, totalItems - 1))
      end = Math.max(start, Math.min(end, totalItems - 1))
    }

    return { start, end }
  }, [items.length, displayCount, buffer, scrollTop, containerHeight, itemHeights, itemHeight])

  // Calculate offset Y
  const offsetY = useMemo(() => {
    let offset = 0
    const { start } = visibleRange

    if (start < 0 || start >= items.length) {
      return 0
    }

    for (let i = 0; i < start; i++) {
      offset += itemHeights[i] || itemHeight
    }

    return offset
  }, [visibleRange, itemHeights, itemHeight, items.length])

  // Visible items
  const visibleItems = useMemo((): VirtualItem<T>[] => {
    const result: VirtualItem<T>[] = []
    const { start, end } = visibleRange

    if (start < 0 || end < 0 || start >= items.length || end >= items.length || start > end) {
      return result
    }

    for (let i = start; i <= end; i++) {
      if (items[i]) {
        result.push({
          index: i,
          data: items[i],
          isVisible: true,
        })
      }
    }

    return result
  }, [items, visibleRange])

  // Update height with debounce
  const updateHeight = useCallback((index: number, newHeight: number) => {
    const existingTimeout = resizeTimeoutsRef.current.get(index)
    if (existingTimeout) clearTimeout(existingTimeout)

    const timeout = setTimeout(() => {
      setItemHeights((prev) => {
        const oldHeight = prev[index] || itemHeight
        if (oldHeight !== newHeight && newHeight > 0) {
          // 创建新对象以确保 React 能检测到变化
          const newHeights = { ...prev, [index]: newHeight }

          // Compensate scroll position only when user stopped scrolling
          const { start } = visibleRange
          if (index < start && containerRef.current && !isUserScrollingRef.current) {
            const delta = newHeight - (oldHeight || itemHeight)
            if (Math.abs(delta) > 10) {
              containerRef.current.scrollTop += delta
              setScrollTop(containerRef.current.scrollTop)
            }
          }

          return newHeights
        }
        return prev
      })
      resizeTimeoutsRef.current.delete(index)
    }, 200)

    resizeTimeoutsRef.current.set(index, timeout)
  }, [itemHeight, visibleRange])

  // Initialize observers
  const initObservers = useCallback(() => {
    if (!enableHeightMonitor) return

    if (!resizeObserverRef.current) {
      resizeObserverRef.current = new ResizeObserver((entries) => {
        entries.forEach((entry) => {
          const target = entry.target as HTMLElement
          const index = parseInt(target.dataset.index || '0', 10)
          const height = entry.contentRect.height
          if (height > 0) updateHeight(index, height)
        })
      })
    }

    if (!mutationObserverRef.current) {
      mutationObserverRef.current = new MutationObserver((mutations) => {
        const heightUpdates = new Map<number, number>()
        mutations.forEach((mutation) => {
          if (mutation.type === 'childList') {
            const target = mutation.target as HTMLElement
            // Find the nearest virtual-list-item container
            const itemEl = (target as HTMLElement).closest?.('[data-index]') as HTMLElement | null
            if (itemEl) {
              const index = parseInt(itemEl.dataset.index || '0', 10)
              const height = itemEl.clientHeight
              if (height > 0 && !heightUpdates.has(index)) {
                heightUpdates.set(index, height)
              }
            }
          }
        })
        heightUpdates.forEach((height, index) => {
          updateHeight(index, height)
        })
      })
    }
  }, [enableHeightMonitor, updateHeight])

  // Set item ref
  const setItemRef = useCallback((el: HTMLElement | null, index: number) => {
    if (el) {
      itemRefs.current.set(index, el)

      if (enableHeightMonitor && !observedElementsRef.current.has(el)) {
        initObservers()
        resizeObserverRef.current?.observe(el)
        mutationObserverRef.current?.observe(el, {
          childList: true,
          subtree: true,
        })
        observedElementsRef.current.add(el)

        const height = el.clientHeight
        if (height > 0) updateHeight(index, height)
      }
    } else {
      const element = itemRefs.current.get(index)
      if (element && observedElementsRef.current.has(element)) {
        resizeObserverRef.current?.unobserve(element)
        observedElementsRef.current.delete(element)
      }

      const timeout = resizeTimeoutsRef.current.get(index)
      if (timeout) {
        clearTimeout(timeout)
        resizeTimeoutsRef.current.delete(index)
      }
      itemRefs.current.delete(index)
    }
  }, [enableHeightMonitor, initObservers, updateHeight])

  // Process execution queue (sequential mode)
  const processExecutionQueue = useCallback(async () => {
    if (isExecutingRef.current || executionQueueRef.current.length === 0) return

    isExecutingRef.current = true

    while (executionQueueRef.current.length > 0) {
      const task = executionQueueRef.current.shift()
      if (!task) continue

      const { index, item, done } = task

      // 入队时已由 useEffect 确认可见，直接处理，避免闭包导致 item 丢失
      let isDone = false

      await new Promise<void>((resolve) => {
        const wrappedDone = () => {
          if (!isDone) {
            isDone = true
            done()
            processingItemsRef.current.delete(index)
            resolve()
          }
        }

        // Timeout fallback
        const timeout = setTimeout(() => {
          if (!isDone) {
            console.warn(`VirtualList: item ${index} timeout, forcing done`)
            wrappedDone()
          }
        }, 30000) // 30 seconds timeout

        // Call onItemVisible - the callback should call wrappedDone when done
        onItemVisible?.(index, item, wrappedDone)

        // Poll for isDone status
        const checkInterval = setInterval(() => {
          if (isDone) {
            clearTimeout(timeout)
            clearInterval(checkInterval)
          }
        }, 50)
      })
    }

    isExecutingRef.current = false

    // 修复：快速滚动时，旧闭包可能跳过可见项；队列剩余任务需重新处理
    if (executionQueueRef.current.length > 0) {
      processExecutionQueue()
    }
  }, [onItemVisible])

  // Handle item visible
  const handleItemVisible = useCallback((index: number, item: T, done: () => void) => {
    const existingTimeout = renderTimeoutsRef.current.get(index)
    if (existingTimeout) clearTimeout(existingTimeout)

    processingItemsRef.current.add(index)

    if (sequential) {
      executionQueueRef.current.push({ index, item, done })
      processExecutionQueue()
    } else {
      const timeoutId = setTimeout(() => {
        const isStillVisible = visibleItems.some((v) => v.index === index)
        if (isStillVisible) {
          onItemVisible?.(index, item, done)
        } else {
          processingItemsRef.current.delete(index)
        }
        renderTimeoutsRef.current.delete(index)
      }, visibleDelay)

      renderTimeoutsRef.current.set(index, timeoutId)
    }
  }, [sequential, visibleItems, onItemVisible, visibleDelay, processExecutionQueue])

  // Handle item hidden
  const handleItemHidden = useCallback((index: number, item: T) => {
    const timeout = renderTimeoutsRef.current.get(index)
    if (timeout) {
      clearTimeout(timeout)
      renderTimeoutsRef.current.delete(index)
    }
    processingItemsRef.current.delete(index)
    onItemHidden?.(index, item)
  }, [onItemHidden])

  // Handle scroll with throttle
  const handleScroll = useMemo(
    () =>
      throttle(() => {
        if (containerRef.current) {
          const newScrollTop = containerRef.current.scrollTop
          const oldScrollTop = scrollTop
          const newContainerHeight = containerRef.current.clientHeight

          // Detect user scrolling (non-programmatic)
          if (!isScrolling && Math.abs(newScrollTop - oldScrollTop) > 5) {
            isUserScrollingRef.current = true
            if (userScrollTimeoutRef.current) {
              clearTimeout(userScrollTimeoutRef.current)
            }
            userScrollTimeoutRef.current = setTimeout(() => {
              isUserScrollingRef.current = false
            }, 300)
          }

          if (Math.abs(newScrollTop - oldScrollTop) > 5) {
            setScrollTop(newScrollTop)
          }
          if (containerHeight !== newContainerHeight) {
            setContainerHeight(newContainerHeight)
          }
        }
      }, 32),
    [scrollTop, containerHeight, isScrolling]
  )

  // Wait for range loaded
  const waitForRangeLoaded = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      const checkLoaded = () => {
        const requiredIndexes = new Set<number>()

        for (let i = visibleRange.start; i <= visibleRange.end; i++) {
          requiredIndexes.add(i)
        }

        const allLoaded = Array.from(requiredIndexes).every(
          (idx) => loadedIndexesRef.current.has(idx) || itemHeights[idx]
        )

        if (allLoaded) {
          setTimeout(resolve, 100)
        } else {
          setTimeout(checkLoaded, 50)
        }
      }

      checkLoaded()
    })
  }, [visibleRange, itemHeights])

  // Scroll to index with loading state
  const scrollToIndex = useCallback(
    async (index: number, behavior: ScrollBehavior = 'smooth', finder?: () => Element | null) => {
      if (!containerRef.current || index < 0 || index >= items.length) return

      setIsScrolling(true)
      targetIndexRef.current = index
      loadedIndexesRef.current.clear()

      try {
        let offset = 0
        for (let i = 0; i < index; i++) {
          offset += itemHeights[i] || itemHeight
        }

        // Scroll to target position (under loading mask)
        containerRef.current.scrollTo({ top: offset, behavior })

        // Wait for visible items to load
        await waitForRangeLoaded()

        // Use finder function to locate target element and scroll
        if (finder) {
          const targetElement = finder()
          if (targetElement) {
            targetElement.scrollIntoView({ behavior: 'auto', block: 'start' })
          }
        }
      } finally {
        setIsScrolling(false)
        targetIndexRef.current = null
        loadedIndexesRef.current.clear()
      }
    },
    [items.length, itemHeights, itemHeight, waitForRangeLoaded]
  )

  // Get item position
  const getItemPosition = useCallback(
    (index: number) => {
      let offset = 0
      for (let i = 0; i < index; i++) {
        offset += itemHeights[i] || itemHeight
      }

      return {
        offset,
        height: itemHeights[index] || itemHeight,
      }
    },
    [itemHeights, itemHeight]
  )

  // Check all visible items heights
  const checkAllVisibleHeights = useCallback(() => {
    visibleItems.forEach((item) => {
      const element = itemRefs.current.get(item.index)
      const height = element?.clientHeight
      if (height && height > 0) {
        updateHeight(item.index, height)
      }
    })
  }, [visibleItems, updateHeight])

  // Expose methods
  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex,
      getItemPosition,
      checkAllVisibleHeights,
    }),
    [scrollToIndex, getItemPosition, checkAllVisibleHeights]
  )

  // Initialize container height first
  useEffect(() => {
    if (containerRef.current) {
      setContainerHeight(containerRef.current.clientHeight)
    }
  }, [])

  // Reset tracking state when resetKey changes
  useEffect(() => {
    prevVisibleIndexesRef.current = new Set()
    processingItemsRef.current.clear()
    executionQueueRef.current = []
    isExecutingRef.current = false
  }, [resetKey])

  // Handle visible items change
  useEffect(() => {
    // Skip if containerHeight is not initialized
    if (containerHeight === 0) return

    const newIndexes = new Set(visibleItems.map((item) => item.index))
    const oldIndexes = prevVisibleIndexesRef.current

    // Handle new visible items
    visibleItems.forEach((item) => {
      if (!oldIndexes.has(item.index)) {
        handleItemVisible(item.index, item.data, () => {
          if (isScrolling) {
            loadedIndexesRef.current.add(item.index)
          }
        })
      }
    })

    // Handle hidden items
    oldIndexes.forEach((index) => {
      if (!newIndexes.has(index)) {
        const item = items[index]
        if (item) {
          handleItemHidden(index, item)
        }
      }
    })

    prevVisibleIndexesRef.current = newIndexes
  }, [containerHeight, visibleItems, items, isScrolling, handleItemVisible, handleItemHidden, resetKey])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current)
        userScrollTimeoutRef.current = null
      }

      resizeTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout))
      resizeTimeoutsRef.current.clear()
      renderTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout))
      renderTimeoutsRef.current.clear()
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)

      resizeObserverRef.current?.disconnect()
      mutationObserverRef.current?.disconnect()

      observedElementsRef.current.clear()
      processingItemsRef.current.clear()
      executionQueueRef.current = []
      isExecutingRef.current = false
      itemRefs.current.clear()
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="virtual-list-container"
      onScroll={handleScroll}
    >
      {/* Loading overlay */}
      {isScrolling && (
        <div className="virtual-list-loading">
          <div className="loading-spinner" />
          <span className="loading-text">定位中...</span>
        </div>
      )}

      <div
        className={`virtual-list-wrapper ${wrapperClass}`}
        style={{ height: `${totalHeight + 160}px` }}
      >
        <div className="virtual-list-main">
          <div
            className="virtual-list-phantom"
            style={{ height: `${totalHeight}px` }}
          />
          <div
            className="virtual-list-content"
            style={{ transform: `translateY(${offsetY}px)` }}
          >
            {visibleItems.map((item) => (
              <div
                key={itemKey ? (item.data as any)[itemKey] || item.index : item.index}
                ref={(el) => setItemRef(el, item.index)}
                className="virtual-list-item"
                data-index={item.index}
              >
                {renderItem(item.data, item.index, item.isVisible)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export const VirtualList = forwardRef(VirtualListInner) as <T>(
  props: VirtualListProps<T> & { ref?: React.ForwardedRef<VirtualListRef> }
) => React.ReactElement

export default VirtualList
