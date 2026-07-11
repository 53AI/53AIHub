/**
 * Path utilities for public asset paths
 */

/**
 * Get public path for static assets
 * Uses global $getPublicPath if available (set by Vite config)
 */
export function getPublicPath(path: string): string {
  if (typeof window !== 'undefined' && (window as any).$getPublicPath) {
    return (window as any).$getPublicPath(path)
  }
  return path
}

/**
 * Get real path for assets (alias for getPublicPath)
 */
export function getRealPath(path: string): string {
  return getPublicPath(path)
}

/**
 * Join path segments
 */
export function joinPath(...segments: string[]): string {
  return segments
    .map((segment, index) => {
      if (index === 0) {
        return segment.replace(/\/+$/, '')
      }
      return segment.replace(/^\/+|\/+$/g, '')
    })
    .filter(Boolean)
    .join('/')
}

/**
 * Get basename from path
 */
export function getBasename(path: string): string {
  return path.split('/').pop() || ''
}

/**
 * Get dirname from path
 */
export function getDirname(path: string): string {
  const parts = path.split('/')
  parts.pop()
  return parts.join('/')
}

/**
 * Get file extension from path
 */
export function getExtension(path: string): string {
  const basename = getBasename(path)
  const dotIndex = basename.lastIndexOf('.')
  if (dotIndex === -1) return ''
  return basename.slice(dotIndex + 1).toLowerCase()
}