export type AutoTooltipOptions = {
  maxWidth?: number
  maxHeight?: number
}

export function shouldShowTooltip(el: HTMLElement, options?: AutoTooltipOptions): boolean {
  const range = document.createRange()
  range.setStart(el, 0)
  if (el && el.childNodes.length) range.setEnd(el, el.childNodes.length)

  let rangeWidth = range.getBoundingClientRect().width
  let rangeHeight = range.getBoundingClientRect().height
  const offsetWidth = rangeWidth - Math.floor(rangeWidth)
  const offsetHeight = rangeHeight - Math.floor(rangeHeight)
  if (offsetWidth < 0.001) rangeWidth = Math.floor(rangeWidth)
  if (offsetHeight < 0.001) rangeHeight = Math.floor(rangeHeight)

  const style = window.getComputedStyle(el, null)
  const maxWidth =
    options?.maxWidth ??
    parseInt(style.maxWidth || '', 10) ||
    parseInt((style.width || style.width) as string, 10) ||
    0
  const maxHeight = options?.maxHeight ?? parseInt(style.height || '', 10)

  const pLeft = style['padding-left']
  const pRight = style['padding-right']
  const pTop = style['padding-top']
  const pBottom = style['padding-bottom']

  const finalWidth = rangeWidth + parseInt(pLeft, 10) + parseInt(pRight, 10)
  const finalHeight = rangeHeight + parseInt(pTop, 10) + parseInt(pBottom, 10)

  if (finalWidth > maxWidth || finalHeight > maxHeight) return true
  return false
}

