import type { Area } from 'react-easy-crop'

export async function getCroppedImageBlob(
  imageSrc: string,
  pixelCrop: Area,
  rotation = 0,
  mimeType = 'image/jpeg',
  quality = 0.92,
): Promise<Blob> {
  const image = await createImage(imageSrc)

  // 临时 canvas 用于绘制旋转后的图像
  const tempCanvas = document.createElement('canvas')
  const tempCtx = tempCanvas.getContext('2d')

  if (!tempCtx) throw new Error('Failed to get canvas context')

  const maxSize = Math.max(image.width, image.height)
  const safeArea = 2 * ((maxSize / 2) * Math.sqrt(2))

  tempCanvas.width = safeArea
  tempCanvas.height = safeArea

  tempCtx.translate(safeArea / 2, safeArea / 2)
  tempCtx.rotate((rotation * Math.PI) / 180)
  tempCtx.translate(-safeArea / 2, -safeArea / 2)
  tempCtx.drawImage(image, safeArea / 2 - image.width / 2, safeArea / 2 - image.height / 2)

  // 最终 canvas 用于裁剪
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  if (!ctx) throw new Error('Failed to get canvas context')

  canvas.width = pixelCrop.width
  canvas.height = pixelCrop.height

  // 填充白色背景
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, pixelCrop.width, pixelCrop.height)

  // 从临时 canvas 绘制裁剪区域
  ctx.drawImage(
    tempCanvas,
    safeArea / 2 - image.width / 2 + pixelCrop.x,
    safeArea / 2 - image.height / 2 + pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height,
  )

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (!blob) {
          reject(new Error('Failed to create image blob'))
          return
        }
        resolve(blob)
      },
      mimeType,
      quality,
    )
  })
}

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', error => reject(error))
    image.setAttribute('crossOrigin', 'anonymous')
    image.src = url
  })
}
