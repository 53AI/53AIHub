import { useMemo } from 'react'

export function useEnv() {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : ''

  const isOpLocalEnv = useMemo(() => {
    return true
  }, [])

  const isPrivatePremEnv = useMemo(() => {
    return import.meta.env.VITE_PRIVATE_PREM === 'true'
  }, [])

  // Check for RC environment (ends with km.53ai.com)
  const isRcEnvValue = hostname.endsWith('.km.53ai.com')
  const isDevEnvValue = hostname.endsWith('.kmtest.53ai.com')

  // Work environment (ends with 53ai.com or 53ai.net, excluding dev/rc)
  const isWorkEnv = useMemo(() => {
    return (
      (typeof window !== 'undefined' && (window as any).isWorkEnv) ||
      (!isDevEnvValue && (hostname.endsWith('53ai.com') || hostname.endsWith('53ai.net')))
    )
  }, [hostname, isDevEnvValue])

  const isDevEnv = useMemo(() => {
    return (
      (typeof window !== 'undefined' && (window as any).isDevEnv) ||
      isDevEnvValue
    )
  }, [isDevEnvValue])

  const isRcEnv = useMemo(() => {
    return (
      (typeof window !== 'undefined' && (window as any).isRcEnv) ||
      isRcEnvValue ||
      isDevEnv
    )
  }, [isRcEnvValue, isDevEnv])

  return {
    isWorkEnv,
    isRcEnv,
    isDevEnv,
    isOpLocalEnv,
    isPrivatePremEnv
  }
}

export default useEnv
