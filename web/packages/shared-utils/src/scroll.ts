/**
 * 滚动相关 DOM 工具
 */

/**
 * 查找最近的滚动容器（overflow-y: auto/scroll）
 */
export const findScrollContainer = (element: Element): Element | null => {
  let parent = element.parentElement
  while (parent) {
    const style = window.getComputedStyle(parent)
    if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
      return parent
    }
    parent = parent.parentElement
  }
  return document.documentElement
}

/**
 * 将滚动容器滚动到目标元素（带偏移与行为）
 */
export const scrollToElement = (
  elementId: string,
  offset = 150,
  behavior: ScrollBehavior = 'smooth'
): void => {
  const targetElement = document.querySelector(elementId)
  if (!targetElement) return
  const scrollContainer = findScrollContainer(targetElement)
  if (!scrollContainer) return
  const containerRect = scrollContainer.getBoundingClientRect()
  const targetRect = targetElement.getBoundingClientRect()
  const scrollTop =
    scrollContainer.scrollTop + targetRect.top - containerRect.top - offset
  scrollContainer.scrollTo({
    top: Math.max(0, scrollTop),
    behavior,
  })
}

/**
 * 滚动到目标元素，返回在滚动结束或超时后 resolve 的 Promise
 */
export const scrollToElementAsync = (
  elementId: string,
  offset = 150,
  behavior: ScrollBehavior = 'smooth'
): Promise<void> => {
  return new Promise((resolve) => {
    scrollToElement(elementId, offset, behavior)
    const targetElement = document.querySelector(elementId)
    const scrollContainer = targetElement
      ? findScrollContainer(targetElement)
      : null
    if (scrollContainer) {
      const handleScrollEnd = () => {
        scrollContainer.removeEventListener('scroll', handleScrollEnd)
        resolve()
      }
      scrollContainer.addEventListener('scroll', handleScrollEnd)
      setTimeout(resolve, 500)
    } else {
      resolve()
    }
  })
}
