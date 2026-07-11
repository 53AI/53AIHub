export const vars = {
  isDev: import.meta.env.DEV,
  isProd: import.meta.env.PROD,
} as const

export type GlobalVars = typeof vars

export function setupVars(): void {
  if (typeof window === 'undefined') return
  ;(window as any).$vars = vars
}
