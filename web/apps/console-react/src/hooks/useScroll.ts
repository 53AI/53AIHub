import { useCallback, useRef } from 'react'

type ScrollElement = HTMLDivElement | null

const nextTick = () => new Promise<void>(resolve => queueMicrotask(resolve))

export interface UseScrollReturn {
  scrollRef: React.RefObject<ScrollElement>
  scrollToBottom: () => Promise<void>
  scrollToTop: () => Promise<void>
  scrollTo: (selector: string, diff?: number) => Promise<void>
  scrollToVal: (value: number) => Promise<void>
  scrollToBottomIfAtBottom: () => Promise<void>
}

export function useScroll(): UseScrollReturn {
  const scrollRef = useRef<ScrollElement>(null)

  const scrollToBottom = useCallback(async () => {
    await nextTick()
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [])

  const scrollToTop = useCallback(async () => {
    await nextTick()
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [])

  const scrollToBottomIfAtBottom = useCallback(async () => {
    await nextTick()
    const el = scrollRef.current
    if (el) {
      const threshold = 100
      const distanceToBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight
      if (distanceToBottom <= threshold) {
        el.scrollTop = el.scrollHeight
      }
    }
  }, [])

  const scrollTo = useCallback(async (selector: string, diff = 0) => {
    await nextTick()
    const node = document.querySelector(selector)
    if (scrollRef.current && node) {
      scrollRef.current.scrollTop = (node as HTMLElement).offsetTop + diff
    }
    await nextTick()
  }, [])

  const scrollToVal = useCallback(async (value: number) => {
    await nextTick()
    if (scrollRef.current) {
      scrollRef.current.scrollTop = value
    }
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
