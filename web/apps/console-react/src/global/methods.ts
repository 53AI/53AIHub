import { base_path } from '@/utils/config'

const ALLOWED_KEYS = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '0',
  '.',
  'Backspace',
  'Delete',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
] as const

type Key = (typeof ALLOWED_KEYS)[number]

export const methods = {
  $noop: () => {},
  $getRealPath: ({ url = '' }: { url: string }): string => {
    return base_path + (url || '')
  },
  $getPublicPath: (url = '') => base_path + (url || ''),
  $numberInputKeydownHandler: (e: KeyboardEvent) => {
    if (!ALLOWED_KEYS.includes(e.key as Key)) {
      e.preventDefault()
      e.stopPropagation()
    }
  },
} as const

export type GlobalMethods = typeof methods

export function setupGlobal(): void {
  if (typeof window === 'undefined') return
  Object.assign(window, methods)
}

