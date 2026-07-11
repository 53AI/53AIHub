import { useMemo, useRef } from 'react'
import { useSyncExternalStore } from 'react'

const MEDIA = {
  sm: '(max-width: 640px)',
  md: '(max-width: 768px)',
  lg: '(max-width: 1024px)',
  xl: '(max-width: 1280px)',
} as const

function subscribe(cb: () => void) {
  const mqlSm = window.matchMedia(MEDIA.sm)
  const mqlMd = window.matchMedia(MEDIA.md)
  const mqlLg = window.matchMedia(MEDIA.lg)
  const mqlXl = window.matchMedia(MEDIA.xl)
  const onChange = () => cb()
  mqlSm.addEventListener('change', onChange)
  mqlMd.addEventListener('change', onChange)
  mqlLg.addEventListener('change', onChange)
  mqlXl.addEventListener('change', onChange)
  return () => {
    mqlSm.removeEventListener('change', onChange)
    mqlMd.removeEventListener('change', onChange)
    mqlLg.removeEventListener('change', onChange)
    mqlXl.removeEventListener('change', onChange)
  }
}

// 缓存上次的结果，避免每次返回新对象导致无限循环
let cachedSnapshot: { isSm: boolean; isMiddle: boolean; isLarge: boolean; isXl: boolean } | null = null

function getSnapshot() {
  const current = {
    isSm: window.matchMedia(MEDIA.sm).matches,
    isMiddle: window.matchMedia(MEDIA.md).matches,
    isLarge: window.matchMedia(MEDIA.lg).matches,
    isXl: window.matchMedia(MEDIA.xl).matches,
  }
  // 只有值真正变化时才返回新对象
  if (
    cachedSnapshot &&
    cachedSnapshot.isSm === current.isSm &&
    cachedSnapshot.isMiddle === current.isMiddle &&
    cachedSnapshot.isLarge === current.isLarge &&
    cachedSnapshot.isXl === current.isXl
  ) {
    return cachedSnapshot
  }
  cachedSnapshot = current
  return current
}

function getServerSnapshot() {
  return { isSm: false, isMiddle: false, isLarge: false, isXl: false }
}

export function useBasicLayout() {
  const breakpoints = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const isInMobile = useMemo(
    () => /Android|iPhone|SymbianOS|Windows Phone|iPad|iPod/gi.test(navigator.userAgent),
    [],
  )
  const isInDingTalk = useMemo(
    () => /dingtalk/img.test(navigator.userAgent),
    [],
  )

  return {
    isInMobile,
    isInDingTalk,
    isSm: breakpoints.isSm,
    isMiddle: breakpoints.isMiddle,
    isLarge: breakpoints.isLarge,
    isXl: breakpoints.isXl,
  }
}
