import { useRef, forwardRef, useImperativeHandle } from 'react'
import { PlusOutlined } from '@ant-design/icons'
import CropperDialog, { type CropperDialogRef } from '@/components/CropperDialog'
import './ImageUpload.css'

export interface ImageUploadRef {
  trigger: () => void
}

interface ImageUploadProps {
  value?: string
  onChange?: (url: string) => void
  onConfirm?: (result: { url: string }) => void
  text?: string
  showText?: boolean
  disabled?: boolean
  cropperDisabled?: boolean
  allowTypeList?: string[]
  size?: number
  className?: string
  fixedNumber?: number[]
  previewWidth?: number
}

export const ImageUpload = forwardRef<ImageUploadRef, ImageUploadProps>(
  function ImageUpload({
    value,
    onChange,
    onConfirm,
    text = '上传图片',
    showText = false,
    disabled = false,
    cropperDisabled = false,
    allowTypeList = ['jpg', 'png', 'jpeg'],
    size = 50,
    className = '',
    fixedNumber = [1, 1],
    previewWidth = 160,
  }, ref) {
    const cropperRef = useRef<CropperDialogRef>(null)

    const handleSelectFile = () => {
      if (disabled) return
      cropperRef.current?.uploadFile()
    }

    const handleConfirm = (result: { url: string }) => {
      onChange?.(result.url)
      onConfirm?.(result)
    }

    useImperativeHandle(ref, () => ({
      trigger: handleSelectFile,
    }))

    return (
      <>
        <div
          className={`image-upload ${disabled ? 'disabled' : ''} ${className}`}
          style={{ width: size, height: size }}
          onClick={handleSelectFile}
        >
          {showText ? (
            <span className="upload-text">{text}</span>
          ) : (
            <>
              {value ? (
                <img className="upload-image" src={value} alt="upload" />
              ) : (
                <div className="upload-placeholder">
                  <PlusOutlined style={{ color: '#9A9A9A', fontSize: 16 }} />
                </div>
              )}
              {!disabled && value && (
                <div className="upload-mask">
                  <span>{text}</span>
                </div>
              )}
            </>
          )}
        </div>

        <CropperDialog
          ref={cropperRef}
          cropperDisabled={cropperDisabled}
          allowTypeList={allowTypeList}
          fixedNumber={fixedNumber}
          previewWidth={previewWidth}
          onConfirm={handleConfirm}
        />
      </>
    )
  }
)

export default ImageUpload
