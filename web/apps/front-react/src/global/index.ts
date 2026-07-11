import { setupGlobal } from './methods'
import { setupVars } from './vars'

export function setupGlobalConfig(): void {
  setupGlobal()
  setupVars()
}

export * from './methods'
export * from './vars'
export * from './filters'