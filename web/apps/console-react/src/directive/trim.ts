type TrimOptions = {
  immediate?: boolean
}

export function attachTrim(el: HTMLElement, options?: TrimOptions) {
  const element = (el.querySelector('input') || el.querySelector('textarea')) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null
  if (!element) return

  const trimValue = () => {
    if (element.value) {
      element.value = element.value.trim()
      element.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }

  const handlers = {
    blur: trimValue,
    change: trimValue,
    input: () => {
      if (options?.immediate) {
        trimValue()
      }
    },
  }

  Object.entries(handlers).forEach(([event, handler]) => {
    element.addEventListener(event, handler as any)
  })

  ;(el as any)._trimHandlers = { element, handlers }
}

export function detachTrim(el: HTMLElement) {
  const stored = (el as any)._trimHandlers as
    | { element: HTMLInputElement | HTMLTextAreaElement; handlers: Record<string, (e: Event) => void> }
    | undefined
  if (!stored) return
  const { element, handlers } = stored
  Object.entries(handlers).forEach(([event, handler]) => {
    element.removeEventListener(event, handler)
  })
  delete (el as any)._trimHandlers
}

