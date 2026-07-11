import { useState, useRef, forwardRef, useImperativeHandle, useEffect } from 'react'
import { getPublicPath } from '@/utils/config'
import './virtual-logo.css'

interface VirtualLogoRef {
  generateImage: () => Promise<string>
  generateImageBlob: () => Promise<Blob>
  generateAndUploadImage: (
    filename?: string,
    options?: {
      onProgress?: (progress: number) => void
      onSuccess?: (result: any) => void
      onError?: (error: Error) => void
    }
  ) => Promise<any>
}

interface VirtualLogoProps {
  size?: number | string
  realSize?: number | string
  text?: string
  round?: number | string
  realRound?: number | string
  border?: boolean
  borderColor?: string
  borderWidth?: number
  realBorderWidth?: number
  backgroundColor?: string
  src?: string
}

export const VirtualLogo = forwardRef<VirtualLogoRef, VirtualLogoProps>(
  (
    {
      size = 40,
      realSize = 40,
      text = '',
      round = 4,
      realRound = 4,
      border = true,
      borderColor = '#07C160',
      borderWidth = 1,
      realBorderWidth = 1,
      backgroundColor = '#FCFFFE',
      src = '',
    },
    ref
  ) => {
    const [imageLoadError, setImageLoadError] = useState(false)
    const logoRef = useRef<HTMLDivElement>(null)

    const trimmedText = text.trim()
    const displayChar = trimmedText
      ? /[a-zA-Z]/.test(Array.from(trimmedText)[0])
        ? Array.from(trimmedText)[0].toUpperCase()
        : Array.from(trimmedText)[0]
      : '-'

    const textColor = '#07C160'

    const sizeCss = typeof size === 'number' ? `${size}px` : size
    const fontSizeCss =
      typeof size === 'number' ? `${Math.round(Number(size) * 0.5)}px` : `calc(${sizeCss} * 0.5)`
    const borderRadiusCss = typeof round === 'number' ? `${round}px` : round

    const containerStyle: React.CSSProperties = {
      width: sizeCss,
      height: sizeCss,
      backgroundColor,
      color: textColor,
      borderRadius: borderRadiusCss,
      fontSize: fontSizeCss,
      borderWidth: `${borderWidth}px`,
      borderStyle: 'solid',
      borderColor: border && !src ? borderColor : 'transparent',
      overflow: 'hidden',
    }

    const imageStyle: React.CSSProperties = {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      borderRadius: borderRadiusCss,
    }

    const handleImageError = () => {
      setImageLoadError(true)
    }

    const generateImage = async (): Promise<string> => {
      if (!logoRef.current) {
        throw new Error('Logo element not found')
      }

      return new Promise((resolve, reject) => {
        setTimeout(() => {
          try {
            const canvas = document.createElement('canvas')
            const ctx = canvas.getContext('2d')

            if (!ctx) {
              reject(new Error('Failed to get canvas context'))
              return
            }

            const sizeValue =
              typeof realSize === 'number' ? realSize : parseInt(String(realSize), 10)
            canvas.width = sizeValue
            canvas.height = sizeValue

            ctx.fillStyle = backgroundColor
            ctx.fillRect(0, 0, sizeValue, sizeValue)

            const radiusValue =
              typeof realRound === 'number' ? realRound : parseInt(String(realRound), 10)

            if (radiusValue > 0) {
              ctx.beginPath()
              ctx.moveTo(radiusValue, 0)
              ctx.lineTo(sizeValue - radiusValue, 0)
              ctx.quadraticCurveTo(sizeValue, 0, sizeValue, radiusValue)
              ctx.lineTo(sizeValue, sizeValue - radiusValue)
              ctx.quadraticCurveTo(sizeValue, sizeValue, sizeValue - radiusValue, sizeValue)
              ctx.lineTo(radiusValue, sizeValue)
              ctx.quadraticCurveTo(0, sizeValue, 0, sizeValue - radiusValue)
              ctx.lineTo(0, radiusValue)
              ctx.quadraticCurveTo(0, 0, radiusValue, 0)
              ctx.closePath()

              ctx.fillStyle = backgroundColor
              ctx.fill()

              if (border) {
                ctx.strokeStyle = borderColor
                ctx.lineWidth = realBorderWidth / 2
                ctx.stroke()
              }
            } else if (border) {
              ctx.strokeStyle = borderColor
              ctx.lineWidth = realBorderWidth
              ctx.strokeRect(
                realBorderWidth / 2,
                realBorderWidth / 2,
                sizeValue - realBorderWidth,
                sizeValue - realBorderWidth
              )
            }

            ctx.fillStyle = textColor
            ctx.font = `${Number(realSize) * 0.5}px Arial, sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(displayChar, sizeValue / 2, sizeValue / 2)

            const base64 = canvas.toDataURL('image/png')
            resolve(base64)
          } catch (error) {
            reject(error)
          }
        }, 0)
      })
    }

    const generateImageBlob = async (): Promise<Blob> => {
      const base64 = await generateImage()

      const byteString = atob(base64.split(',')[1])
      const mimeString = base64.split(',')[0].split(':')[1].split(';')[0]
      const ab = new ArrayBuffer(byteString.length)
      const ia = new Uint8Array(ab)

      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i)
      }

      return new Blob([ab], { type: mimeString })
    }

    const generateAndUploadImage = async (
      filename: string = 'logo.png',
      options: {
        onProgress?: (progress: number) => void
        onSuccess?: (result: any) => void
        onError?: (error: Error) => void
      } = {}
    ): Promise<any> => {
      try {
        const blob = await generateImageBlob()
        // UploadService.uploadBlob would be implemented elsewhere
        // const result = await UploadService.uploadBlob(blob, filename, options)
        // return result
        options.onSuccess?.({ url: URL.createObjectURL(blob) })
        return { url: URL.createObjectURL(blob) }
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error))
        options.onError?.(errorObj)
        throw errorObj
      }
    }

    useImperativeHandle(ref, () => ({
      generateImage,
      generateImageBlob,
      generateAndUploadImage,
    }))

    const ariaLabel =
      src && !imageLoadError
        ? `Logo image for ${trimmedText || 'unknown'}`
        : trimmedText
        ? `Logo ${displayChar}`
        : 'Logo placeholder'

    return (
      <div
        ref={logoRef}
        className="virtual-logo"
        style={containerStyle}
        aria-label={ariaLabel}
        role="img"
      >
        {src && !imageLoadError ? (
          <img src={src} alt={ariaLabel} style={imageStyle} onError={handleImageError} />
        ) : (
          <span>{displayChar}</span>
        )}
      </div>
    )
  }
)

export default VirtualLogo
