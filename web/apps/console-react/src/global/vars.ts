import { isWorkEnvPure, isDevEnvPure, isRcEnvPure, isOpLocal, isPrivatePrem } from '@/hooks/useEnv'
import { includeKm } from '@/utils/config'

export const vars = {
  isWorkEnv: isWorkEnvPure(),
  isDevEnv: isDevEnvPure(),
  isRcEnv: isRcEnvPure(),
  isOpLocalEnv: isOpLocal(),
  /** 是否包含 KM 功能 */
  includeKm,
  isPrivatePremEnv: isPrivatePrem(),
} as const

export type GlobalVars = typeof vars

export function setupVars(): void {
  if (typeof window === 'undefined') return
  ;(window as any).$vars = vars
}

