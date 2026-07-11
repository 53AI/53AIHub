import { useRef, useState, forwardRef, useImperativeHandle, ReactNode } from 'react'
import { Upload, message } from 'antd'
import type { UploadFile, UploadProps } from 'antd'
import { API_HOST } from '@/api/host'
import uploadApi from '@/api/modules/upload'
import { checkPermission } from '@/utils/permission'
import './upload.css'

interface UploadComponentRef {
  abort: (file?: UploadFile) => void
  submit: () => void
  clearFiles: () => void
  trigger: () => void
  handleStart: (file: File) => void
  handleRemove: (file: UploadFile) => void
}

interface UploadComponentProps {
  accept?: string
  name?: string
  size?: number
  hide?: boolean
  full?: boolean
  drag?: boolean
  multiple?: boolean
  limit?: number
  disabled?: boolean
  autoUpload?: boolean
  extraData?: Record<string, any>
  action?: string
  children?: ReactNode
  onError?: (data: { error_msg: string }) => void
  onSuccess?: (data: { id: string; size: string; icon: string; name: string }) => void
  onBefore?: (file: File) => void
  onProgress?: (file: any, percent: number) => void
  onChange?: (args?: { file: any; fileList: any[] }) => void
}

const generateId = () => `upload_${Math.random().toString(36).substr(2, 9)}`

export const UploadComponent = forwardRef<UploadComponentRef, UploadComponentProps>(
  (
    {
      accept = '',
      name = 'file',
      size = 15,
      hide = false,
      full = false,
      drag = false,
      multiple = false,
      limit = 1,
      disabled = false,
      autoUpload = true,
      extraData = {},
      action,
      children,
      onError,
      onSuccess,
      onBefore,
      onProgress,
      onChange,
    },
    ref
  ) => {
    const uploadRef = useRef<any>(null)
    const [fileList, setFileList] = useState<UploadFile[]>([])
    const [uploadingCount, setUploadingCount] = useState(0)
    const firstTypeRef = useRef('')

    const isOverLimit = (data: File) => {
      if (!firstTypeRef.current) firstTypeRef.current = data.type

      const { name: fileName } = data
      if (!new RegExp(`(${accept.split(',').join('|')})$`).test(fileName)) {
        message.warning(
          `仅支持 ${accept
            .replace(/\./g, '')
            .split(',')
            .map((item) => item.toUpperCase())
            .join('、')} 格式文件`
        )
        return true
      }
      if (data.size === 0) {
        message.warning('文件内容为空')
        return true
      }
      if (size && data.size / 1024 / 1024 > size) {
        message.warning(`文件 ${fileName} 超过 ${size}MB 限制`)
        return true
      }

      setUploadingCount((prev) => prev + 1)
      return false
    }

    const handleBeforeUpload = async (file: File) => {
      if (isOverLimit(file)) return false
      const isLogin = checkPermission()
      if (!isLogin) {
        message.warning('您没有权限上传文件')
        return false
      }
      onBefore?.(file)
      return true
    }

    const customRequest: UploadProps['customRequest'] = async (options) => {
      const { file, onSuccess: customOnSuccess, onError: customOnError } = options as any

      try {
        const res = await uploadApi.upload(file)
        customOnSuccess?.({
          id: res.data.id,
          url: `${API_HOST}/api/preview/${res.data.preview_key || ''}`,
          size: res.data.size,
          name: res.data.file_name,
          mime_type: res.data.mime_type,
        })
      } catch (error) {
        customOnError?.(error)
      }
    }

    const handleSuccess = (response: any, file: UploadFile) => {
      setUploadingCount((prev) => {
        const newCount = prev - 1
        if (newCount === 0) firstTypeRef.current = ''
        return newCount
      })

      onSuccess?.({
        id: response.id,
        size: response.size,
        icon: '',
        name: response.name,
      })
    }

    const handleError = () => {
      setUploadingCount((prev) => {
        const newCount = prev - 1
        if (newCount === 0) firstTypeRef.current = ''
        return newCount
      })

      onError?.({ error_msg: '上传失败' })
    }

    const handleProgress = (event: any) => {
      onProgress?.(event.file, event.percent)
    }

    const handleExceed = () => {
      message.warning(`最多上传 ${limit} 个文件`)
    }

    const triggerUpload = () => {
      const input = document.querySelector(`#${generateId()} .ant-upload input`) as HTMLInputElement
      input?.click()
    }

    useImperativeHandle(ref, () => ({
      abort: (file) => uploadRef.current?.abort(file),
      submit: () => uploadRef.current?.submit(),
      clearFiles: () => setFileList([]),
      trigger: triggerUpload,
      handleStart: (file) => {
        file.uid = generateId()
        setFileList((prev) => [...prev, file as unknown as UploadFile])
      },
      handleRemove: (file) => {
        setFileList((prev) => prev.filter((f) => f.uid !== file.uid))
      },
    }))

    const uploadProps: UploadProps = {
      id: generateId(),
      accept,
      name,
      multiple,
      disabled,
      drag,
      fileList,
      customRequest,
      beforeUpload: handleBeforeUpload,
      onChange: (info) => {
        setFileList(info.fileList)
        onChange?.({ file: info.file, fileList: info.fileList })
      },
      onSuccess: handleSuccess,
      onError: handleError,
      onProgress: handleProgress,
      showUploadList: false,
    }

    return (
      <Upload
        ref={uploadRef}
        className={`upload-component ${hide ? 'upload-hide' : ''} ${full ? 'upload-full' : ''}`}
        {...uploadProps}
      >
        {children}
      </Upload>
    )
  }
)

export default UploadComponent
