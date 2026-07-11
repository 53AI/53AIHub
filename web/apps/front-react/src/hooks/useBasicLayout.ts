import { useState, useEffect, useMemo } from 'react'

// Tailwind breakpoints
const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536
}

export function useBasicLayout() {
  const [windowWidth, setWindowWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1024
  )

  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const isLgScreen = useMemo(() => windowWidth < breakpoints.lg, [windowWidth])
  const isMdScreen = useMemo(() => windowWidth < breakpoints.md, [windowWidth])
  const isSmScreen = useMemo(() => windowWidth < breakpoints.sm, [windowWidth])

  const isInMobile = useMemo(() => {
    if (typeof navigator === 'undefined') return false
    const userAgent = navigator.userAgent
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent)
  }, [])

  return {
    isLgScreen,
    isMdScreen,
    isSmScreen,
    isInMobile,
    windowWidth
  }
}

export default useBasicLayout
