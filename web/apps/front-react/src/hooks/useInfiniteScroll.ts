import { useRef, useEffect, useCallback, type RefObject } from 'react'

interface UseInfiniteScrollOptions {
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => Promise<void> | void
  threshold?: number
  /**
   * 滚动容器 ref。默认监听视口（root=null）；当目标处于自身 overflow 的容器内、
   * 容器内滚动不会改变相对视口的相交状态时，必须传入该容器，观察器才能正确触发。
   */
  rootRef?: RefObject<Element | null>
}

interface UseInfiniteScrollReturn {
  sentinelRef: (node: HTMLElement | null) => void
}

export function useInfiniteScroll({
  hasMore,
  loadingMore,
  onLoadMore,
  threshold = 100,
  rootRef,
}: UseInfiniteScrollOptions): UseInfiniteScrollReturn {
  const observerRef = useRef<IntersectionObserver | null>(null)
  const nodeRef = useRef<HTMLElement | null>(null)

  // 观察器在每次建立时实时读取 rootRef.current（ref 变更不触发渲染，不能在 render 期取值）
  const buildObserver = useCallback(() => {
    return new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          onLoadMore()
        }
      },
      { root: rootRef?.current ?? null, rootMargin: `${threshold}px` },
    )
  }, [hasMore, loadingMore, onLoadMore, rootRef, threshold])

  const attach = useCallback((node: HTMLElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect()
      observerRef.current = null
    }
    nodeRef.current = node
    if (node) {
      observerRef.current = buildObserver()
      observerRef.current.observe(node)
    }
  }, [buildObserver])

  // Cleanup observer on unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = null
      }
    }
  }, [])

  // 依赖变化（加载状态/追加后/容器挂载）时重新观察
  useEffect(() => {
    if (nodeRef.current) attach(nodeRef.current)
  }, [attach])

  return { sentinelRef: attach }
}

export default useInfiniteScroll