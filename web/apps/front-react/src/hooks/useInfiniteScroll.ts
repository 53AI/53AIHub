import { useRef, useEffect, useCallback } from 'react'

interface UseInfiniteScrollOptions {
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => Promise<void> | void
  threshold?: number
}

interface UseInfiniteScrollReturn {
  sentinelRef: (node: HTMLElement | null) => void
}

export function useInfiniteScroll({
  hasMore,
  loadingMore,
  onLoadMore,
  threshold = 100,
}: UseInfiniteScrollOptions): UseInfiniteScrollReturn {
  const observerRef = useRef<IntersectionObserver | null>(null)
  const nodeRef = useRef<HTMLElement | null>(null)

  // Cleanup observer on unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = null
      }
    }
  }, [])

  // Update observer when dependencies change
  useEffect(() => {
    if (observerRef.current && nodeRef.current) {
      observerRef.current.disconnect()
      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasMore && !loadingMore) {
            onLoadMore()
          }
        },
        { rootMargin: `${threshold}px` }
      )
      observerRef.current.observe(nodeRef.current)
    }
  }, [hasMore, loadingMore, onLoadMore, threshold])

  const sentinelRef = useCallback((node: HTMLElement | null) => {
    // Cleanup previous observer
    if (observerRef.current) {
      observerRef.current.disconnect()
    }

    nodeRef.current = node

    if (!node) {
      observerRef.current = null
      return
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          onLoadMore()
        }
      },
      { rootMargin: `${threshold}px` }
    )

    observerRef.current.observe(node)
  }, [hasMore, loadingMore, onLoadMore, threshold])

  return { sentinelRef }
}

export default useInfiniteScroll
