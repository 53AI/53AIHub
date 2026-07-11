export function shouldEnableOverflowTooltip(el: HTMLElement): boolean {
  const range = document.createRange()
  range.setStart(el, 0)
  if (el && el.childNodes.length) range.setEnd(el, el.childNodes.length)
  const rangeWidth = Math.round(range.getBoundingClientRect().width)

  const style = window.getComputedStyle(el, null)
  const paddingLeft = parseInt(style.paddingLeft || '0', 10) || 0
  const paddingRight = parseInt(style.paddingRight || '0', 10) || 0
  const padding = paddingLeft + paddingRight

  if (rangeWidth + padding > el.offsetWidth) return true
  if (el.scrollWidth > el.offsetWidth) return true
  return false
}

