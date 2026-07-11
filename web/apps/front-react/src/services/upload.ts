import { message } from 'antd'
import uploadApi from '@/api/modules/upload'
import { api_host } from '@/utils/config'

export interface UploadResult {
  url: string
  preview_key?: string
  [key: string]: any
}

export interface UploadOptions {
  file: File
  onProgress?: (progress: number) => void
  onSuccess?: (result: UploadResult) => void
  onError?: (error: any) => void
}

/**
 * 文件上传服务
 */
export class UploadService {
  /**
   * 上传文件到服务器
   * @param options 上传选项
   * @returns Promise<UploadResult>
   */
  static async uploadFile(options: UploadOptions): Promise<UploadResult> {
    const { file, onProgress, onSuccess, onError } = options

    try {
      const res = await uploadApi.upload(file)
      const result = res.data

      // 构建完整的URL
      const url = `${api_host}/api/preview/${result.preview_key || ''}`
      const uploadResult: UploadResult = {
        ...result,
        url
      }

      onSuccess?.(uploadResult)
      return uploadResult
    } catch (error) {
      onError?.(error)
      throw error
    }
  }

  /**
   * 上传图片文件（带验证）
   * @param file 图片文件
   * @param options 验证选项
   * @returns Promise<UploadResult>
   */
  static async uploadImage(
    file: File,
    options: {
      allowTypes?: string[]
      maxSize?: number // MB
      onProgress?: (progress: number) => void
      onSuccess?: (result: UploadResult) => void
      onError?: (error: any) => void
    } = {}
  ): Promise<UploadResult> {
    const {
      allowTypes = ['jpg', 'png', 'jpeg'],
      maxSize = 10,
      onProgress,
      onSuccess,
      onError
    } = options

    // 验证文件类型
    const fileExtension = file.name.substring(file.name.lastIndexOf('.') + 1).toLowerCase()
    if (!allowTypes.includes(fileExtension)) {
      const error = new Error(`仅支持${allowTypes.join('、')}格式的图片`)
      message.error(error.message)
      onError?.(error)
      throw error
    }

    // 验证文件大小
    if (file.size > maxSize * 1024 * 1024) {
      const error = new Error(`图片上传大小不能超过${maxSize}MB`)
      message.warning(error.message)
      onError?.(error)
      throw error
    }

    return this.uploadFile({
      file,
      onProgress,
      onSuccess,
      onError
    })
  }

  /**
   * 上传Blob对象
   * @param blob Blob对象
   * @param filename 文件名
   * @param options 上传选项
   * @returns Promise<UploadResult>
   */
  static async uploadBlob(
    blob: Blob,
    filename: string,
    options: {
      onProgress?: (progress: number) => void
      onSuccess?: (result: UploadResult) => void
      onError?: (error: any) => void
    } = {}
  ): Promise<UploadResult> {
    const file = new File([blob], filename, { type: blob.type })
    return this.uploadFile({
      file,
      ...options
    })
  }

  /**
   * 上传Base64图片
   * @param base64 Base64字符串
   * @param filename 文件名
   * @param options 上传选项
   * @returns Promise<UploadResult>
   */
  static async uploadBase64(
    base64: string,
    filename: string,
    options: {
      onProgress?: (progress: number) => void
      onSuccess?: (result: UploadResult) => void
      onError?: (error: any) => void
    } = {}
  ): Promise<UploadResult> {
    const blob = this.base64ToBlob(base64)
    return this.uploadBlob(blob, filename, options)
  }

  /**
   * Base64转Blob
   * @param base64 Base64字符串
   * @returns Blob对象
   */
  static base64ToBlob(base64: string): Blob {
    const arr = base64.split(',')
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png'
    const bstr = atob(arr[1])
    const u8arr = new Uint8Array(bstr.length)

    for (let i = 0; i < bstr.length; i++) {
      u8arr[i] = bstr.charCodeAt(i)
    }

    return new Blob([u8arr], { type: mime })
  }

  /**
   * Base64转File
   * @param base64 Base64字符串
   * @param filename 文件名
   * @returns File对象
   */
  static base64ToFile(base64: string, filename: string): File {
    const blob = this.base64ToBlob(base64)
    return new File([blob], filename, { type: blob.type })
  }

  /**
   * 验证文件类型
   * @param file 文件对象
   * @param allowTypes 允许的文件类型
   * @returns boolean
   */
  static validateFileType(file: File, allowTypes: string[]): boolean {
    const fileExtension = file.name.substring(file.name.lastIndexOf('.') + 1).toLowerCase()
    return allowTypes.includes(fileExtension)
  }

  /**
   * 验证文件大小
   * @param file 文件对象
   * @param maxSize 最大大小（MB）
   * @returns boolean
   */
  static validateFileSize(file: File, maxSize: number): boolean {
    return file.size <= maxSize * 1024 * 1024
  }
}

export default UploadService
