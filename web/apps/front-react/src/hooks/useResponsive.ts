import { useState, useEffect, useCallback } from 'react'

export interface ResponsiveInfo {
  isMobile: boolean
  isTablet: boolean
  isDesktop: boolean
  screenWidth: number
  screenHeight: number
}

const BREAKPOINTS = {
  mobile: 768,
  tablet: 1024
}

export function useResponsive(): ResponsiveInfo {
  const getScreenInfo = useCallback(() => {
    const width = window.innerWidth
    const height = window.innerHeight
    return {
      isMobile: width < BREAKPOINTS.mobile,
      isTablet: width >= BREAKPOINTS.mobile && width < BREAKPOINTS.tablet,
      isDesktop: width >= BREAKPOINTS.tablet,
      screenWidth: width,
      screenHeight: height
    }
  }, [])

  const [responsive, setResponsive] = useState<ResponsiveInfo>(getScreenInfo)

  useEffect(() => {
    const handleResize = () => {
      setResponsive(getScreenInfo())
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [getScreenInfo])

  return responsive
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia(query).matches
    }
    return false
  })

  useEffect(() => {
    const mediaQuery = window.matchMedia(query)
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches)

    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [query])

  return matches
}

export default useResponsive
