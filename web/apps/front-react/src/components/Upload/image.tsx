import { useRef, forwardRef, useImperativeHandle, ReactNode } from 'react'
import { Button, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import CropperDialog, { CropperDialogRef } from '@/components/CropperDialog'
import './image.css'

interface UploadImageRef {
  trigger: () => void
}

interface UploadImageProps {
  value?: string
  text?: string
  showText?: boolean
  cropperDisabled?: boolean
  allowTypeList?: string[]
  disabled?: boolean
  onChange?: (value: string) => void
  onConfirm?: (result: { url: string }) => void
  children?: ReactNode
  maskText?: ReactNode
  className?: string
}

export const UploadImage = forwardRef<UploadImageRef, UploadImageProps>(
  (
    {
      value = '',
      text = '上传icon',
      showText = false,
      cropperDisabled = false,
      allowTypeList,
      disabled = false,
      onChange,
      onConfirm,
      children,
      maskText,
      className = '',
    },
    ref
  ) => {
    const cropperRef = useRef<CropperDialogRef>(null)

    const handleSelectFile = (e?: React.MouseEvent) => {
      e?.stopPropagation()
      if (disabled) return
      cropperRef.current?.uploadFile()
    }

    const handleConfirm = (data: { url: string } = { url: '' }) => {
      onChange?.(data.url)
      onConfirm?.({ url: data.url })
    }

    useImperativeHandle(ref, () => ({
      trigger: handleSelectFile,
    }))

    return (
      <>
        <div
          className={`upload-image-container ${disabled ? 'cursor-not-allowed' : ''} ${className}`}
          onClick={handleSelectFile}
        >
          {children ? (
            children
          ) : showText ? (
            <Button type="link">{text}</Button>
          ) : (
            <>
              {value ? (
                <img className="upload-image-preview" src={value} alt="logo" />
              ) : (
                <div className="upload-image-placeholder">
                  <PlusOutlined style={{ fontSize: 16, color: '#9A9A9A' }} />
                </div>
              )}
              <div className="upload-image-mask">
                {maskText || text}
              </div>
            </>
          )}
        </div>

        <CropperDialog
          ref={cropperRef}
          action="python"
          cropperDisabled={cropperDisabled}
          allowTypeList={allowTypeList}
          onConfirm={handleConfirm}
        />
      </>
    )
  }
)

export default UploadImage
