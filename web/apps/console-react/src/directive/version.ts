import type { VersionOptions } from '@/utils/version'
import { checkVersionPermission } from '@/utils/version'

export type VersionGuardMode = 'dialog' | 'tooltip' | 'remove'

export function createVersionClickGuard(options: VersionOptions) {
  return (event: MouseEvent) => {
    const passed = checkVersionPermission(options)
    if (!passed) {
      event.stopPropagation()
      event.preventDefault()
      event.stopImmediatePropagation()
      return false
    }
    if (options.onClick) {
      options.onClick()
    }
    return true
  }
}

