/**
 * 复制文本到剪贴板
 * 优先使用现代 Clipboard API，失败时降级为 execCommand
 *
 * @param text - 要复制的文本内容
 * @param container - 可选的容器元素，用于在 Modal 等焦点陷阱场景下执行复制
 * @returns {Promise<boolean>} 返回复制是否成功的Promise
 */
export function copyToClip(text: string, container?: HTMLElement): Promise<boolean> {
  return new Promise((resolve) => {
    // 检查是否为安全上下文（HTTPS 或 localhost）
    const isSecureContext = window.isSecureContext

    const fallback = (fallbackContainer?: HTMLElement): boolean => {
      const textarea = document.createElement('textarea')
      textarea.value = text

      // 防止页面滚动和可见
      textarea.style.position = 'fixed'
      textarea.style.top = '0'
      textarea.style.left = '0'
      textarea.style.width = '2em'
      textarea.style.height = '2em'
      textarea.style.padding = '0'
      textarea.style.border = 'none'
      textarea.style.outline = 'none'
      textarea.style.boxShadow = 'none'
      textarea.style.background = 'transparent'
      textarea.style.opacity = '0'
      // 确保元素可交互
      textarea.setAttribute('readonly', '')
      textarea.style.userSelect = 'text'

      // 使用传入的容器或 document.body
      const targetContainer = fallbackContainer || document.body
      targetContainer.appendChild(textarea)

      // 保存当前焦点元素
      const activeElement = document.activeElement

      // 使用 setSelectionRange 进行更可靠的选择
      textarea.focus()
      textarea.setSelectionRange(0, textarea.value.length)

      let success = false
      try {
        success = document.execCommand('copy')
      } catch {
        success = false
      }

      targetContainer.removeChild(textarea)

      // 恢复焦点
      try {
        if (activeElement instanceof HTMLElement) {
          activeElement.focus()
        }
      } catch {
        // 忽略焦点恢复错误
      }

      return success
    }

    // 非安全上下文直接使用降级方案
    if (!isSecureContext) {
      resolve(fallback(container))
      return
    }

    try {
      // 安全上下文优先使用 Clipboard API
      if (navigator.clipboard?.writeText) {
        navigator.clipboard
          .writeText(text)
          .then(() => resolve(true))
          .catch(() => resolve(fallback(container)))
      } else {
        resolve(fallback(container))
      }
    } catch {
      resolve(fallback(container))
    }
  })
}

/**
 * 复制图片到剪贴板
 * 使用 Canvas 将图片转换为 Blob 后写入剪贴板
 *
 * @param url - 图片的URL地址
 * @returns {Promise<void>} 复制操作完成的Promise
 */
export function copyImageToClip(url: string): Promise<void> {
  return new Promise((resolve) => {
    // 非安全上下文无法复制图片
    if (!window.isSecureContext) {
      console.warn('copyImageToClip requires secure context (HTTPS)')
      resolve()
      return
    }

    const img = new Image()
    img.src = url
    img.crossOrigin = 'Anonymous'

    img.onload = () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!
      canvas.width = img.width
      canvas.height = img.height

      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
      ctx.drawImage(img, 0, 0)
      canvas.toBlob(
        async (blob) => {
          try {
            const clipboardItem = new ClipboardItem({ 'image/png': blob! })
            await navigator.clipboard.write([clipboardItem])
            resolve()
          } catch {
            // 图片复制失败，尝试复制 URL 文本
            await copyToClip(url)
            resolve()
          }
        },
        'image/png',
      )
    }
  })
}
