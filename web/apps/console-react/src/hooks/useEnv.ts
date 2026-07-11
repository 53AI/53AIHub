import { useMemo, useCallback } from 'react'
import { useEnterpriseStore } from '@/stores'
// 纯函数版本，用于非 React 组件场景
// isOpLocal / isPrivatePrem 来自 config，是常量，包装成函数保持接口一致
import { isOpLocal as _isOpLocal, isPrivatePrem as _isPrivatePrem } from '@/utils/config'

export function isOpLocal(): boolean {
  return _isOpLocal
}

export function isPrivatePrem(): boolean {
  return _isPrivatePrem
}

function getHost(): string {
  return typeof window !== 'undefined' ? window.location.host : ''
}

export function isWorkEnvPure(): boolean {
  if (typeof window !== 'undefined' && (window as any).isWorkEnv) return true
  return ['hub.53ai.com', 'km.53ai.com'].includes(getHost())
}

export function isRcEnvPure(): boolean {
  if (typeof window !== 'undefined' && (window as any).isRcEnv) return true
  return ['kmmix.53ai.com'].includes(getHost())
}

export function isDevEnvPure(): boolean {
  if (typeof window !== 'undefined' && (window as any).isDevEnv) return true
  return !isWorkEnvPure() && !isRcEnvPure()
}

export function useEnv() {
  const { host, origin } = typeof window !== 'undefined' ? window.location : { host: '', origin: '' }
  const enterpriseStore = useEnterpriseStore()

  const isWorkEnv = useMemo(
    () => (typeof window !== 'undefined' && (window as any).isWorkEnv) || ['hub.53ai.com', 'km.53ai.com'].includes(host),
    [host],
  )

  const isRcEnv = useMemo(
    () => (typeof window !== 'undefined' && (window as any).isRcEnv) || ['kmmix.53ai.com'].includes(host),
    [host],
  )

  const isDevEnv = useMemo(
    () => (typeof window !== 'undefined' && (window as any).isDevEnv) || (!isWorkEnv && !isRcEnv),
    [isWorkEnv, isRcEnv],
  )

  const isOpLocalEnv = useMemo(() => _isOpLocal, [])

  const isPrivatePremEnv = useMemo(() => _isPrivatePrem, [])

  const getFrontBaseUrl = useCallback(() => {
    if (isOpLocalEnv || isPrivatePremEnv) {
      return origin
    }
    const domain = enterpriseStore.info.domain
    if (isDevEnv) return domain?.replace('.km.53ai.com', '.kmtest.53ai.com')
    return domain
  }, [isOpLocalEnv, isPrivatePremEnv, isDevEnv, origin, enterpriseStore.info.domain])

  const getFrontHomeUrl = useCallback(() => {
    const baseUrl = getFrontBaseUrl()
    return isOpLocalEnv || isPrivatePremEnv ? `${baseUrl}/#/index` : baseUrl
  }, [getFrontBaseUrl, isOpLocalEnv, isPrivatePremEnv])

  const buildFrontLibraryFileUrl = useCallback((libraryId: string, fileId: string) => {
    const baseUrl = getFrontBaseUrl()
    const path = `/library/${libraryId}/file/${fileId}`
    return isOpLocalEnv || isPrivatePremEnv ? `${baseUrl}/#${path}` : `${baseUrl}${path}`
  }, [getFrontBaseUrl, isOpLocalEnv, isPrivatePremEnv])

  const buildFrontLibraryUrl = useCallback((libraryId: string) => {
    const baseUrl = getFrontBaseUrl()
    const path = `/library/${libraryId}`
    return isOpLocalEnv || isPrivatePremEnv ? `${baseUrl}/#${path}` : `${baseUrl}${path}`
  }, [getFrontBaseUrl, isOpLocalEnv, isPrivatePremEnv])

  return {
    isWorkEnv,
    isRcEnv,
    isDevEnv,
    isOpLocalEnv,
    isPrivatePremEnv,
    getFrontBaseUrl,
    getFrontHomeUrl,
    buildFrontLibraryFileUrl,
    buildFrontLibraryUrl,
  }
}

export default useEnv
