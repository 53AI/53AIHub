/**
 * 上传相关工具函数
 */

import { sha256 } from 'js-sha256'

import type { FileStructureItem } from '@/api/modules/files/types'

/**
 * 是否支持 Web Crypto API 的 SHA-256 digest。
 * 浏览器在 HTTPS / localhost 安全上下文中可用；HTTP 站点或极旧浏览器返回 false。
 */
const hasWebCryptoDigest = (): boolean =>
  typeof crypto !== 'undefined' &&
  !!crypto.subtle &&
  typeof crypto.subtle.digest === 'function'

/**
 * 文件大小格式化
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B'

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}

/**
 * 计算上传速度
 */
export const calculateUploadSpeed = (
  uploadedBytes: number,
  totalBytes: number,
  startTime: number
): number => {
  const elapsed = Date.now() - startTime
  if (elapsed === 0) return 0

  return (uploadedBytes / elapsed) * 1000 // bytes per second
}

/**
 * 格式化上传速度
 */
export const formatUploadSpeed = (bytesPerSecond: number): string => {
  if (bytesPerSecond < 1024) {
    return `${bytesPerSecond.toFixed(1)} B/s`
  }
  if (bytesPerSecond < 1024 * 1024) {
    return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`
  }
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`
}

/**
 * 计算剩余时间
 */
export const calculateRemainingTime = (
  uploadedBytes: number,
  totalBytes: number,
  speed: number
): string => {
  if (speed === 0) return '计算中...'

  const remainingBytes = totalBytes - uploadedBytes
  const remainingSeconds = remainingBytes / speed

  if (remainingSeconds < 60) {
    return `${Math.ceil(remainingSeconds)}秒`
  }
  if (remainingSeconds < 3600) {
    return `${Math.ceil(remainingSeconds / 60)}分钟`
  }
  return `${Math.ceil(remainingSeconds / 3600)}小时`
}

/**
 * 生成文件唯一标识
 */
export const generateFileId = (file: File): string => {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2)
  return `${timestamp}_${random}_${file.name}`
}

/**
 * 验证文件类型
 */
export const validateFileType = (file: File, allowedTypes: string[]): boolean => {
  if (allowedTypes.length === 0) return true

  const fileExtension = file.name.split('.').pop()?.toLowerCase()
  const mimeType = file.type.toLowerCase()

  return allowedTypes.some((type) => {
    if (type.startsWith('.')) {
      return fileExtension === type.substring(1)
    }
    return mimeType.includes(type) || mimeType === type
  })
}

/**
 * 验证文件大小
 */
export const validateFileSize = (file: File, maxSize: number): boolean => {
  return file.size <= maxSize
}

/**
 * 创建文件分片
 */
export const createFileChunks = (file: File, chunkSize: number): Blob[] => {
  const chunks: Blob[] = []
  const totalChunks = Math.ceil(file.size / chunkSize)

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize
    const end = Math.min(start + chunkSize, file.size)
    chunks.push(file.slice(start, end))
  }

  return chunks
}

/**
 * 计算文件分片数量
 */
export const calculateChunkCount = (fileSize: number, chunkSize: number): number => {
  return Math.ceil(fileSize / chunkSize)
}

/**
 * 把 ArrayBuffer 算成 SHA-256 hex 字符串。
 * 优先走 Web Crypto（性能更好），不可用时回退到 js-sha256 纯 JS 实现。
 */
export const sha256Hex = async (data: ArrayBuffer): Promise<string> => {
  if (hasWebCryptoDigest()) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  return sha256(new Uint8Array(data))
}

/**
 * 生成分片哈希
 */
export const generateChunkHash = async (chunk: Blob): Promise<string> => {
  const arrayBuffer = await chunk.arrayBuffer()
  return sha256Hex(arrayBuffer)
}

/**
 * 计算文件 SHA-256（十六进制小写）。
 * 用于秒传预检：选完文件后前端先算 hash，调用 /api/upload/check 命中后跳过文件传输。
 *
 * 优先 Web Crypto API；不可用（HTTP 非安全上下文 / 旧浏览器）时降级到 js-sha256 纯 JS 实现。
 * 仅在极端环境下（两者皆不可用）抛出错误，调用方负责降级到无 hash 的原上传链路。
 */
export const calculateFileHash = async (file: File): Promise<string> => {
  if (!hasWebCryptoDigest() && typeof sha256 !== 'function') {
    throw new Error('当前环境不支持 SHA-256（缺少 Web Crypto 与 js-sha256）')
  }

  const arrayBuffer = await file.arrayBuffer()
  return sha256Hex(arrayBuffer)
}

/**
 * 扫描文件夹结构
 */
export const scanDirectoryStructure = (files: File[]): FileStructureItem[] => {
  const structure: FileStructureItem[] = []
  const fileMap = new Map<string, File>()
  const addedPaths = new Set<string>() // 用于跟踪已添加的路径

  // 处理 webkitdirectory 选择的文件
  for (const file of Array.from(files)) {
    const relativePath = (file as any).webkitRelativePath || file.name
    fileMap.set(relativePath, file)

    // 分析路径结构
    const pathParts = relativePath.split('/')
    const depth = pathParts.length - 1

    // 添加目录项
    for (let i = 0; i < pathParts.length - 1; i++) {
      const dirPath = pathParts.slice(0, i + 1).join('/')
      const normalizedDirPath = dirPath ? `/${dirPath}` : ''

      // 使用 Set 来避免重复添加
      if (!addedPaths.has(normalizedDirPath)) {
        const parentPath = i === 0 ? '' : pathParts.slice(0, i).join('/')
        structure.push({
          relative_path: normalizedDirPath,
          size: 0,
          is_directory: true,
          parent_path: parentPath ? `/${parentPath}` : '',
          depth: i
        })
        addedPaths.add(normalizedDirPath)
      }
    }

    // 添加文件项
    const filePath = (file as any).webkitRelativePath ? `/${(file as any).webkitRelativePath}` : file.name
    structure.push({
      relative_path: filePath,
      size: file.size,
      is_directory: false,
      parent_path: pathParts.slice(0, -1).join('/') ? `/${pathParts.slice(0, -1).join('/')}` : '',
      depth
    })
  }
  return structure.sort((a, b) => a.depth - b.depth)
}

/**
 * 计算文件夹总大小
 */
export const calculateFolderSize = (structure: FileStructureItem[]): number => {
  return structure.filter((item) => !item.is_directory).reduce((sum, item) => sum + item.size, 0)
}

/**
 * 计算文件夹总文件数
 */
export const calculateFolderFileCount = (structure: FileStructureItem[]): number => {
  return structure.filter((item) => !item.is_directory).length
}

/**
 * 防抖函数
 */
export const debounce = <T extends (...args: any[]) => any>(
  func: T,
  wait: number
): ((...args: Parameters<T>) => void) => {
  let timeout: NodeJS.Timeout | null = null

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

/**
 * 节流函数
 * @param func 函数
 * @param limit 限制时间
 * @returns 节流函数
 */
export const throttle = <T extends (...args: any[]) => any>(
  func: T,
  limit: number
): ((...args: Parameters<T>) => void) => {
  let inThrottle: boolean = false

  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args)
      inThrottle = true
      setTimeout(() => (inThrottle = false), limit)
    }
  }
}

/**
 * 重试函数
 */
export const retry = async <T>(
  fn: () => Promise<T>,
  retries: number,
  delay: number = 1000
): Promise<T> => {
  try {
    return await fn()
  } catch (error) {
    if (retries <= 0) throw error

    await new Promise((resolve) => setTimeout(resolve, delay))
    return retry(fn, retries - 1, delay * 2)
  }
}

/**
 * 生成进度条样式
 */
export const generateProgressStyle = (progress: number): string => {
  return `linear-gradient(to right, #1890ff ${progress}%, #f0f0f0 ${progress}%)`
}

/**
 * 检查网络状态
 */
export const checkNetworkStatus = (): boolean => {
  return navigator.onLine
}

/**
 * 监听网络状态变化
 */
export const onNetworkStatusChange = (callback: (isOnline: boolean) => void): (() => void) => {
  const handleOnline = () => callback(true)
  const handleOffline = () => callback(false)

  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)

  return () => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
  }
}
