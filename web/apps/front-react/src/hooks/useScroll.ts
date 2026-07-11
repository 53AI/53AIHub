import { useRef, useCallback, useLayoutEffect } from 'react'

type ScrollElement = HTMLDivElement | null

interface ScrollReturn {
  scrollRef: React.RefObject<ScrollElement>
  scrollToBottom: () => Promise<void>
  scrollToTop: () => Promise<void>
  scrollTo: (selector: string, diff?: number) => Promise<void>
  scrollToBottomIfAtBottom: () => Promise<void>
  scrollToVal: (value: number) => Promise<void>
}

export function useScroll(): ScrollReturn {
  const scrollRef = useRef<ScrollElement>(null)

  const scrollToBottom = useCallback(async () => {
    // 等待 DOM 更新
    await new Promise(resolve => setTimeout(resolve, 0))
    if (scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [])

  const scrollToTop = useCallback(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
    if (scrollRef.current)
      scrollRef.current.scrollTop = 0
  }, [])

  const scrollToBottomIfAtBottom = useCallback(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
    if (scrollRef.current) {
      const threshold = 100 // 阈值，表示滚动条到底部的距离阈值
      const distanceToBottom = scrollRef.current.scrollHeight - scrollRef.current.scrollTop - scrollRef.current.clientHeight
      if (distanceToBottom <= threshold)
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [])

  const scrollTo = useCallback(async (selector: string, diff = 0) => {
    await new Promise(resolve => setTimeout(resolve, 0))
    const node = document.querySelector(selector)
    if (scrollRef.current && node)
      scrollRef.current.scrollTop = node.offsetTop + diff
    await new Promise(resolve => setTimeout(resolve, 0))
  }, [])

  const scrollToVal = useCallback(async (value: number) => {
    await new Promise(resolve => setTimeout(resolve, 0))
    if (scrollRef.current)
      scrollRef.current.scrollTop = value
  }, [])

  return {
    scrollRef,
    scrollToBottom,
    scrollToTop,
    scrollTo,
    scrollToVal,
    scrollToBottomIfAtBottom,
  }
}