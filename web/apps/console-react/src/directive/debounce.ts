export function debounce<T extends (...args: any[]) => unknown>(
  fn: T,
  delay = 1000,
  immediate = true,
): (...args: Parameters<T>) => void {
  let timer: number | null = null
  let hasExecuted = false

  return function debounced(this: unknown, ...args: Parameters<T>) {
    if (timer) window.clearTimeout(timer)

    if (immediate && !hasExecuted) {
      fn.apply(this, args)
      hasExecuted = true
    }

    timer = window.setTimeout(() => {
      if (!immediate) {
        fn.apply(this, args)
      }
      timer = null
      hasExecuted = false
    }, delay)
  }
}

export function withDisabledDuringCall<T extends (...args: any[]) => Promise<unknown> | unknown>(
  fn: T,
  setDisabled: (disabled: boolean) => void,
  delay = 1000,
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  const wrapped = debounce(
    async (...args: Parameters<T>) => {
      setDisabled(true)
      try {
        return await Promise.resolve(fn(...args))
      } finally {
        setTimeout(() => setDisabled(false), delay)
      }
    },
    delay,
    true,
  )

  return (async (...args: Parameters<T>) => wrapped(...args)) as any
}

