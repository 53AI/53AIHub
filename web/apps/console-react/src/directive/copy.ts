import { message } from 'antd'
import { copyToClip } from '@km/shared-utils'

export async function copyText(text: string) {
  await copyToClip(text)
  const t = (window as any).$t || ((key: string) => key)
  message.success(t('action.copy_success'))
}

export function attachCopy(el: HTMLElement, getText: () => string) {
  const handler = () => {
    void copyText(getText())
  }
  ;(el as any)._copyHandler && el.removeEventListener('click', (el as any)._copyHandler)
  ;(el as any)._copyHandler = handler
  el.addEventListener('click', handler)
}

export function detachCopy(el: HTMLElement) {
  const handler = (el as any)._copyHandler as ((e: MouseEvent) => void) | undefined
  if (handler) {
    el.removeEventListener('click', handler)
    delete (el as any)._copyHandler
  }
}

