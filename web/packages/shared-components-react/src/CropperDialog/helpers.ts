import type { Area } from 'react-easy-crop'

/** 可被 canvas 解码并重编码的位图 MIME（ico/heic 等不走压缩） */
const COMPRESSIBLE_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png'])

export function isCompressibleImage(file: File): boolean {
  return COMPRESSIBLE_MIME_TYPES.has((file.type || '').toLowerCase())
}

/** MIME -> 扩展名反查，移动端相册文件可能没有扩展名（如微信 webview 的 "image"） */
const MIME_EXT_MAP: Record<string, string> = {
  "image/jpg": "jpg",
  "image/jpeg": "jpeg",
  "image/pjpeg": "jpeg",
  "image/png": "png",
  "image/x-icon": "ico",
  "image/ico": "ico",
}

/** 取文件扩展名：优先文件名，缺失时用 MIME 兑底 */
export function getFileExt(file: { name: string; type?: string }): string {
  const ext = file.name.includes(".")
    ? (file.name.split(".").pop() || "").toLowerCase()
    : ""
  if (ext) return ext
  return MIME_EXT_MAP[(file.type || "").toLowerCase()] || ""
}

/**
 * 移动端相册照片普遍 2~10MB，会直接触发 limitSize 大小校验失败。
 * 用 canvas 缩放 + JPEG 重编码把图片压到 maxBytes 以内：
 * 先降质量（0.9 → 0.7 → 0.5），仍超限再缩尺寸，最多 4 轮。
 * 浏览器无法解码的格式（如部分 webview 的 HEIC）会抛错，由调用方回退到大小校验报错。
 */
export async function compressImageFile(
  file: File,
  maxBytes: number,
  maxDimension = 2048,
): Promise<File> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await createImage(objectUrl)
    let quality = 0.9
    let dimension = maxDimension

    for (let attempt = 0; attempt < 4; attempt++) {
      const scale = Math.min(1, dimension / Math.max(image.width, image.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Failed to get canvas context')

      // JPEG 不支持透明通道，铺白底避免 PNG 透明区域变黑
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

      const blob = await canvasToBlob(canvas, 'image/jpeg', quality)
      if (!blob) throw new Error('Failed to compress image')

      if (blob.size <= maxBytes) {
        const baseName = file.name.replace(/\.[^./\\]+$/, '') || 'image'
        return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' })
      }

      if (quality > 0.5) {
        quality -= 0.2
      } else {
        dimension = Math.round(dimension * 0.7)
      }
    }

    throw new Error('Image is too large to compress')
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise(resolve => {
    canvas.toBlob(resolve, mimeType, quality)
  })
}

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

export { createImage }
