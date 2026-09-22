/**
 * 上传相关工具函数
 */

import { sha256 } from 'js-sha256'

import type { FileStructureItem } from '@/api/modules/files/types'

import { FILE_SIZE_EXCEEDED_MESSAGE } from './constants'

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
 * 取文件适用的单文件大小上限：按扩展名覆盖优先，否则用默认上限
 */
export const resolveMaxSizeBytes = (
  fileName: string,
  options: Pick<ValidateUploadFileOptions, 'maxSizeBytes' | 'maxSizeBytesByExtension'>
): number => {
  const extension = fileName.split('.').pop()?.toLowerCase() || ''
  return options.maxSizeBytesByExtension?.[extension] ?? options.maxSizeBytes
}

/**
 * 临时文件 / 系统文件判定。
 * 这类文件由调用方静默过滤，不打扰用户。
 */
export const isTempFile = (file: File): boolean => {
  const fileName = file.name.toLowerCase()
  const baseName = file.name

  const tempFilePatterns = [
    '.ds_store',
    'thumbs.db',
    'desktop.ini',
    '.tmp',
    '.temp',
    '.swp',
    '.swo',
    '.bak',
    '~'
  ]

  for (const pattern of tempFilePatterns) {
    if (fileName === pattern || fileName.endsWith(pattern)) {
      return true
    }
  }

  if (baseName.startsWith('~$')) {
    return true
  }

  if (
    fileName.startsWith('.') &&
    !fileName.includes('.md') &&
    !fileName.includes('.txt') &&
    !fileName.includes('.html')
  ) {
    const parts = fileName.split('.')
    if (parts.length === 2) {
      return true
    }
  }

  return false
}

/**
 * 文件校验失败原因：
 * - temp：临时/系统文件，静默过滤
 * - type / size：需要显式告知用户
 */
export type FileValidationErrorCode = 'temp' | 'type' | 'size'

export type FileValidationResult =
  | { valid: true }
  | { valid: false; code: FileValidationErrorCode; message: string }

export interface ValidateUploadFileOptions {
  /** 允许的扩展名（可带点）或 mime 片段 */
  allowedTypes: string[]
  /** 默认单文件大小上限（字节） */
  maxSizeBytes: number
  /** 按扩展名覆盖的单文件大小上限（字节），key 为不带点的小写扩展名 */
  maxSizeBytesByExtension?: Record<string, number>
}

/**
 * 单文件校验：临时文件 → 类型 → 大小。
 * 返回结构化 code，调用方据此决定「静默过滤」还是「提示用户」。
 */
export const validateUploadFile = (
  file: File,
  options: ValidateUploadFileOptions
): FileValidationResult => {
  if (isTempFile(file)) {
    return { valid: false, code: 'temp', message: '临时文件或系统文件，已自动过滤' }
  }

  if (!validateFileType(file, options.allowedTypes)) {
    const supported = options.allowedTypes.map((type) => type.replace(/^\./, '')).join('、')
    return { valid: false, code: 'type', message: `不支持的文件类型，仅支持：${supported}` }
  }

  if (!validateFileSize(file, resolveMaxSizeBytes(file.name, options))) {
    return { valid: false, code: 'size', message: FILE_SIZE_EXCEEDED_MESSAGE }
  }

  return { valid: true }
}

/** 未通过校验、需要提示用户的文件（临时文件不在其中） */
export interface InvalidUploadFile {
  name: string
  message: string
}

/** 提示文案里最多列出的文件名个数 */
const INVALID_FILE_NAMES_PREVIEW = 5

/**
 * 组装「未通过校验」提示文案，返回 null 表示无需提示。
 * 只要有不合格文件就要提示：混选场景下不提示等于把文件静默丢弃。
 */
export const buildInvalidFilesMessage = (
  invalid: readonly InvalidUploadFile[],
  validCount: number
): string | null => {
  if (invalid.length === 0) return null
  if (invalid.length === 1) return `${invalid[0].name}：${invalid[0].message}`

  const preview = invalid
    .slice(0, INVALID_FILE_NAMES_PREVIEW)
    .map((item) => item.name)
    .join('、')
  const names =
    invalid.length > INVALID_FILE_NAMES_PREVIEW ? `${preview} 等 ${invalid.length} 个` : preview
  const suffix = validCount > 0 ? `，其余 ${validCount} 个文件继续上传` : ''

  return `${invalid.length} 个文件未通过校验，已跳过：${names}${suffix}`
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
