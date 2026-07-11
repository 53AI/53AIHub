/**
 * 将静态图标转换为 File（Canvas 绘制圆形/圆角矩形 + 图标）
 */

export const iconConfig = {
  circleBorderWidth: 0,
  bgColor: 'transparent',
  size: 50,
  iconPadding: 12,
} as const

export type IconConfig = typeof iconConfig

export type CreateIconFileConfig = {
  size?: number
  bgColor?: string
  circleBorderWidth?: number
  iconPadding?: number
  radius?: number
}

const drawRoundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) => {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + width - radius, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius)
  ctx.lineTo(x + width, y + height - radius)
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  ctx.lineTo(x + radius, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

/**
 * 将带有颜色的图标转换为 File
 * @param localIconPath 图标 URL
 * @param circleColor 背景/形状颜色
 * @param iconColor 图标着色
 * @param config 可选：size、bgColor、circleBorderWidth、iconPadding、radius（圆角，不传则圆形）
 */
export const createIconFileFromStatic = async (
  localIconPath: string,
  circleColor: string,
  iconColor: string,
  config?: CreateIconFileConfig
): Promise<File> => {
  const merged = { ...iconConfig, ...(config || {}) }
  const { size, bgColor, circleBorderWidth, iconPadding, radius } = merged as IconConfig & {
    radius?: number
  }

  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return reject(new Error('Canvas 上下文获取失败'))

    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, size, size)

    const maxRadius = size / 2 - circleBorderWidth
    const cornerRadius = radius !== undefined ? Math.min(Math.max(0, radius), maxRadius) : maxRadius
    const isCircle = radius === undefined || cornerRadius >= maxRadius

    if (isCircle) {
      ctx.beginPath()
      ctx.arc(size / 2, size / 2, maxRadius, 0, Math.PI * 2)
    } else {
      const x = circleBorderWidth
      const y = circleBorderWidth
      const width = size - circleBorderWidth * 2
      const height = size - circleBorderWidth * 2
      drawRoundedRect(ctx, x, y, width, height, cornerRadius)
    }
    ctx.fillStyle = circleColor
    ctx.fill()

    ctx.save()
    ctx.clip()

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const offscreenCanvas = document.createElement('canvas')
      const offscreenCtx = offscreenCanvas.getContext('2d')
      if (!offscreenCtx) return reject(new Error('离屏Canvas创建失败'))

      const availableWidth = isCircle
        ? (maxRadius - iconPadding) * 2
        : size - circleBorderWidth * 2 - iconPadding * 2
      const availableHeight = isCircle
        ? (maxRadius - iconPadding) * 2
        : size - circleBorderWidth * 2 - iconPadding * 2

      const iconScale = Math.min(availableWidth / img.width, availableHeight / img.height)
      const safeScale = Math.max(0.1, iconScale)
      const iconWidth = img.width * safeScale
      const iconHeight = img.height * safeScale
      offscreenCanvas.width = iconWidth
      offscreenCanvas.height = iconHeight

      offscreenCtx.fillStyle = iconColor
      offscreenCtx.fillRect(0, 0, iconWidth, iconHeight)
      offscreenCtx.globalCompositeOperation = 'destination-in'
      offscreenCtx.drawImage(img, 0, 0, iconWidth, iconHeight)
      offscreenCtx.globalCompositeOperation = 'source-over'

      const x = (size - iconWidth) / 2
      const y = (size - iconHeight) / 2
      ctx.drawImage(offscreenCanvas, x, y)

      ctx.restore()
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('Canvas 转 Blob 失败'))
          const fileName = `custom-icon-${Date.now()}.png`
          const file = new File([blob], fileName, { type: 'image/png' })
          resolve(file)
        },
        'image/png',
        1
      )
    }

    img.onerror = (err) => reject(new Error(`加载图标失败：${err}`))
    img.src = localIconPath
  })
}
