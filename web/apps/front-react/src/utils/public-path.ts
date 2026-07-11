/**
 * Public path utilities for dynamic asset loading
 */

/**
 * Get public URL for a given path
 */
export function getPublicUrl(path: string): string {
  const basePath = import.meta.env.BASE_URL || '/'
  const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path
  return `${normalizedBase}${normalizedPath}`
}

/**
 * Get asset URL with proper base path handling
 */
export function getAssetUrl(path: string): string {
  // Use Vite's base URL for assets
  if (typeof window !== 'undefined' && (window as any).$getPublicPath) {
    return (window as any).$getPublicPath(path)
  }
  return getPublicUrl(path)
}

/**
 * Resolve URL relative to current location
 */
export function resolveUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/')) {
    return url
  }
  
  const base = window.location.origin
  const currentPath = window.location.pathname
  const dir = currentPath.substring(0, currentPath.lastIndexOf('/'))
  
  return `${base}${dir}/${url}`
}

export default {
  getPublicUrl,
  getAssetUrl,
  resolveUrl
}