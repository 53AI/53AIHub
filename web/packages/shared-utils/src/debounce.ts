type CallbackFunc<T extends unknown[]> = (...args: T) => void

export function debounce<T extends unknown[]>(
  func: CallbackFunc<T>,
  wait: number,
  immediate = false
): ((...args: T) => void) & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const debounced = (...args: T) => {
    const later = () => {
      func(...args)
    }

    clearTimeout(timeoutId)
    if (immediate) {
      const callNow = !timeoutId
      timeoutId = setTimeout(() => {
        timeoutId = undefined
      }, wait)
      if (callNow) later()
    } else {
      timeoutId = setTimeout(later, wait)
    }
  }
  debounced.cancel = () => {
    clearTimeout(timeoutId)
    timeoutId = undefined
  }
  return debounced
}
