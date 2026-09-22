import { useState, useRef, useCallback, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react'
import { Button, Tree, message, Modal, Tooltip } from 'antd'
import {
  CloseOutlined,
  DownOutlined,
  CheckCircleFilled,
  ExclamationCircleOutlined,
  WarningFilled,
  LoadingOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useLibraryStore, type UploadItem } from '@/stores/modules/library'
import { t } from '@/locales'
import { filesApi } from '@/api/modules/files'
import type { DuplicateFile, BatchUploadInitResponse, BatchUploadFileParams } from '@/api/modules/files/types'
import { formatFileInfo } from '@/api/modules/files/transform'
import { getPublicPath } from '@/utils/config'
import { SvgIcon } from '@km/shared-components-react'
import { enableBeforeUnloadProtection } from '@/utils/before-unload-guard'
import type { UploadStatus } from './constants'
import {
  FILE_SIZE_EXCEEDED_MESSAGE,
  FILE_SIZE_LIMITS,
  MAX_UPLOAD_FILES,
  UPLOAD_CONFIG,
  UPLOAD_STATUS
} from './constants'
import {
  buildInvalidFilesMessage,
  calculateFileHash,
  formatFileSize,
  generateFileId,
  resolveMaxSizeBytes,
  scanDirectoryStructure,
  throttle,
  validateFileSize,
  validateUploadFile,
  type InvalidUploadFile,
  type ValidateUploadFileOptions
} from './util'
import './file-upload.css'

// ==================== 浏览器兼容性检测 ====================
interface BrowserSupport {
  supportsDirectorySelection: boolean
  supportsAbortController: boolean
  supportsRelativePath: boolean
}

// ==================== Props 定义 ====================
interface FileUploadProps {
  accept?: string[] | string
  maxSize?: Record<string, number>
  chunkSize?: number
  maxConcurrent?: number
  /** 选择文件后是否自动开始上传；默认 false，文件入队后需点击“开始上传”按钮才开始上传 */
  autoUpload?: boolean
  maxFileCount?: number
  maxDepth?: number
  libraryId?: string
  basePath?: string
  onSuccess?: (file: File, result: { url: string; batchId?: string; fileId?: string }) => void
  onError?: (file: File, error: Error | string) => void
  onProgress?: (file: File, progress: number) => void
  onComplete?: (results: { url: string; batchId?: string; fileId?: string }[]) => void
  onView?: (file: UploadItem) => void
}

export interface FileUploadRef {
  selectFiles: (basePath?: string) => void
  selectFolder: (basePath?: string) => void
  cancelAll: () => void
  startUpload: () => void
}

// 文件结构项类型（简化版）
interface FileStructureItem {
  name: string
  type: 'directory' | 'file'
  icon: string
  children?: FileStructureItem[]
  // 文件特有属性
  file?: File
  status?: UploadStatus
  progress?: number
  error?: string
  fileId?: string
  id?: string
}

/** 超出大小限制的文件记录：不进上传队列、不在待上传列表展示，单独记录供状态栏查看 */
interface OversizeUploadFile {
  file: File
  icon: string
}

/** 队列条目的公共字段（列表展示 / 定位用），与上传链路（batch / 秒传）无关 */
const createQueueItemBase = (file: File) => ({
  id: generateFileId(file),
  file,
  progress: 0,
  icon: formatFileInfo(file.name).icon,
  folder: (file as any).webkitRelativePath?.split('/')[0]
})

export const FileUpload = forwardRef<FileUploadRef, FileUploadProps>(({
  accept,
  maxSize = {},
  chunkSize = FILE_SIZE_LIMITS.MIN_CHUNK_SIZE,
  maxConcurrent = UPLOAD_CONFIG.DEFAULT_MAX_CONCURRENT,
  autoUpload = false,
  maxFileCount = MAX_UPLOAD_FILES,
  maxDepth = 10,
  libraryId,
  basePath,
  onSuccess,
  onError,
  onProgress,
  onComplete,
  onView
}, ref) => {
  const navigate = useNavigate()
  const libraryStore = useLibraryStore()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const progressTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map())
  const emittedBatchSetRef = useRef<Set<string>>(new Set())
  const cancelledIdsRef = useRef<Set<string>>(new Set())
  // 使用 ref 存储 basePath，避免 React state 异步更新导致的问题
  const basePathRef = useRef(basePath)
  // 同步 props.basePath 到 ref
  useEffect(() => {
    basePathRef.current = basePath
  }, [basePath])

  const [activeUploads, setActiveUploads] = useState(0)
  // 使用 ref 跟踪 activeUploads，避免闭包问题
  const activeUploadsRef = useRef(0)
  useEffect(() => {
    activeUploadsRef.current = activeUploads
  }, [activeUploads])

  const [isCollapsed, setIsCollapsed] = useState(false)
  // 是否已点击“开始上传”：false 时新入队文件仅在右下角展示，不自动上传
  const [uploadStarted, setUploadStarted] = useState(false)
  const [showDuplicateModal, setShowDuplicateModal] = useState(false)
  // 超出大小限制的文件：不进上传队列，单独记录并在状态栏汇总展示
  const [oversizeFiles, setOversizeFiles] = useState<OversizeUploadFile[]>([])
  const [showOversizeModal, setShowOversizeModal] = useState(false)
  const [duplicateFiles, setDuplicateFiles] = useState<(DuplicateFile & { icon: string })[]>([])
  const [pendingBatchData, setPendingBatchData] = useState<{
    files: File[]
    batchResponse: BatchUploadInitResponse
  } | null>(null)

  // ==================== 浏览器兼容性检测 ====================
  const browserSupport = useMemo<BrowserSupport>(() => {
    if (typeof window === 'undefined') {
      return {
        supportsDirectorySelection: false,
        supportsAbortController: false,
        supportsRelativePath: false
      }
    }

    // 检测 webkitdirectory 支持
    const input = document.createElement('input')
    input.type = 'file'
    const supportsDirectory = 'webkitdirectory' in input

    // 检测 AbortController 支持
    const supportsAbort = typeof AbortController !== 'undefined'

    return {
      supportsDirectorySelection: supportsDirectory,
      supportsAbortController: supportsAbort,
      supportsRelativePath: supportsDirectory
    }
  }, [])

  // AbortController polyfill
  const createAbortController = useCallback(():
    | AbortController
    | { signal: { aborted: boolean }; abort: () => void } => {
    if (browserSupport.supportsAbortController) {
      return new AbortController()
    }

    // 降级方案：创建一个模拟的 AbortController
    return {
      signal: { aborted: false },
      abort: () => {
        console.warn('当前浏览器不支持 AbortController，无法取消上传请求')
      }
    }
  }, [browserSupport.supportsAbortController])

  // ==================== 响应式数据 ====================
  const uploadQueue = libraryStore.uploadQueue

  // ==================== 计算属性 ====================
  const defaultAccept = useMemo(() => {
    return ['md', 'txt', 'html', 'htm', 'pdf', 'ppt', 'pptx', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'xml', 'epub', 'mp3', 'wav', 'm4a', 'wma', 'aac', 'ogg', 'amr', 'flac', 'aiff']
  }, [])

  const acceptTypes = useMemo(() => {
    const acceptValue = accept || defaultAccept
    if (Array.isArray(acceptValue)) {
      return acceptValue
    }
    if (typeof acceptValue === 'string') {
      return acceptValue.split(',').map(type => type.trim().replace(/^\./, ''))
    }
    return []
  }, [accept, defaultAccept])

  const acceptString = useMemo(() => {
    return acceptTypes.map(type => `.${type}`).join(',')
  }, [acceptTypes])

  const hasActiveUploads = useMemo(() => {
    return uploadQueue.some(item => item.status === UPLOAD_STATUS.UPLOADING)
  }, [uploadQueue])

  const waitingUploads = useMemo(() => {
    return uploadQueue.filter(item => item.status === UPLOAD_STATUS.WAITING)
  }, [uploadQueue])

  const hasWaitingUploads = waitingUploads.length > 0

  // 待开始上传：有等待文件且当前没有正在上传的文件（此时展示“开始上传”按钮）
  const isPendingStart = hasWaitingUploads && !hasActiveUploads

  // 队列中是否还有未完成项（等待 / 上传中 / 暂停）
  const hasPendingUploads = useMemo(() => {
    return uploadQueue.some(
      item =>
        item.status === UPLOAD_STATUS.WAITING ||
        item.status === UPLOAD_STATUS.UPLOADING ||
        item.status === UPLOAD_STATUS.PAUSED
    )
  }, [uploadQueue])

  const hasFailedUploads = useMemo(() => {
    return uploadQueue.some(item => item.status === UPLOAD_STATUS.ERROR)
  }, [uploadQueue])

  const everyUploadsCompleted = useMemo(() => {
    // 队列为空（仅剩超限文件记录）时不视为“全部上传成功”
    return (
      uploadQueue.length > 0 && uploadQueue.every(item => item.status === UPLOAD_STATUS.COMPLETED)
    )
  }, [uploadQueue])

  const uploadingUploads = useMemo(() => {
    return libraryStore.uploadingUploads()
  }, [libraryStore, uploadQueue])

  const completedUploads = useMemo(() => {
    return libraryStore.completedUploads()
  }, [libraryStore, uploadQueue])

  const failedUploads = useMemo(() => {
    return libraryStore.failedUploads()
  }, [libraryStore, uploadQueue])

  // 构建上传树形数据
  const uploadTreeData = useMemo((): FileStructureItem[] => {
    const tree: FileStructureItem[] = []
    const folderMap = new Map<string, FileStructureItem>()

    uploadQueue.forEach(item => {
      const data: FileStructureItem = {
        name: item.file.name,
        type: 'file',
        icon: item.icon || '',
        file: item.file,
        status: item.status as UploadStatus,
        progress: item.progress,
        error: item.error,
        fileId: item.fileId,
        id: item.id  // 使用原始 UploadItem 的 id
      }

      if (item.folder) {
        const { folder } = item
        if (!folderMap.has(folder)) {
          folderMap.set(folder, {
            name: folder,
            type: 'directory',
            icon: getPublicPath('/images/file/folder.png'),
            children: [],
            id: `folder-${folder}`
          })
          tree.push(folderMap.get(folder)!)
        }
        folderMap.get(folder)?.children?.push(data)
      } else {
        tree.push(data)
      }
    })

    return tree
  }, [uploadQueue])

  // ==================== 工具函数 ====================
  const getFolderStatus = useCallback((list: FileStructureItem[]): UploadStatus => {
    const hasFailedFile = list.some(item => item.status === UPLOAD_STATUS.ERROR)
    const everyFileCompleted = list.every(
      item => item.status === UPLOAD_STATUS.COMPLETED || item.status === UPLOAD_STATUS.ERROR
    )

    if (everyFileCompleted) {
      return hasFailedFile ? UPLOAD_STATUS.ERROR : UPLOAD_STATUS.COMPLETED
    }
    return UPLOAD_STATUS.WAITING
  }, [])

  const clearProgressTimer = useCallback((itemId: string) => {
    const timer = progressTimersRef.current.get(itemId)
    if (timer) {
      clearTimeout(timer)
      progressTimersRef.current.delete(itemId)
    }
  }, [])

  const cleanupUploadItem = useCallback((item: UploadItem) => {
    // 清理定时器
    if (item.progressTimer) {
      clearTimeout(item.progressTimer)
    }

    // 清理 AbortController
    if (item.abortController) {
      item.abortController.abort()
    }

    // 清理进度定时器
    clearProgressTimer(item.id)
  }, [clearProgressTimer])

  const cleanupCompletedItems = useCallback(() => {
    const completedItems = uploadQueue.filter(
      item => item.status === UPLOAD_STATUS.COMPLETED || item.status === UPLOAD_STATUS.ERROR
    )

    completedItems.forEach(item => {
      cleanupUploadItem(item)
    })

    // 从队列中移除已完成项
    const newQueue = uploadQueue.filter(
      item => item.status !== UPLOAD_STATUS.COMPLETED && item.status !== UPLOAD_STATUS.ERROR
    )
    libraryStore.setUploadQueue(newQueue)
  }, [uploadQueue, libraryStore, cleanupUploadItem])

  // ==================== 文件验证 ====================
  // maxSize prop 以 MB 为单位（对外契约），校验内部统一用字节
  const validationOptions = useMemo<ValidateUploadFileOptions>(() => {
    const maxSizeBytesByExtension: Record<string, number> = {}
    for (const [extension, maxSizeMB] of Object.entries(maxSize)) {
      maxSizeBytesByExtension[extension.toLowerCase()] = maxSizeMB * 1024 * 1024
    }

    return {
      allowedTypes: acceptTypes.map(type => `.${type}`),
      maxSizeBytes: FILE_SIZE_LIMITS.MAX_SINGLE_FILE_SIZE,
      maxSizeBytesByExtension
    }
  }, [acceptTypes, maxSize])

  /** 文件是否超过当前配置的单文件上限（含按扩展名的覆盖） */
  const isOversizeFile = useCallback(
    (file: File) => !validateFileSize(file, resolveMaxSizeBytes(file.name, validationOptions)),
    [validationOptions]
  )

  const validateFolder = useCallback((files: FileList): boolean => {
    if (files.length > maxFileCount) {
      return false
    }

    let maxDepthFound = 0
    for (const file of Array.from(files)) {
      const depth = ((file as any).webkitRelativePath || '').split('/').length - 1
      maxDepthFound = Math.max(maxDepthFound, depth)
    }

    if (maxDepthFound > maxDepth) {
      return false
    }

    return true
  }, [maxFileCount, maxDepth])

  // ==================== 批量上传管理 ====================
  const createBatchTask = useCallback(
    async (
      files: File[]
    ): Promise<{
      batchId: string
      uploadToken: string
      fileMappings: Record<string, string>
    } | { hasDuplicates: true; files: File[]; batchResponse: BatchUploadInitResponse }> => {
      if (!libraryId) {
        throw new Error('请先设置知识库ID')
      }

      const totalSize = files.reduce((sum, file) => sum + file.size, 0)
      const fileStructure = scanDirectoryStructure(files)
      const batchData = {
        library_id: libraryId,
        base_path: basePathRef.current,
        total_files: files.length,
        total_size: totalSize,
        file_structure: fileStructure
      }

      const batchResponse = await filesApi.batchUploadInit(batchData)

      // Check for duplicates (files with existing_id !== 0)
      const hasDuplicates = batchResponse.duplicate_files?.some(f => f.existing_id !== 0)

      if (hasDuplicates) {
        return {
          hasDuplicates: true,
          files,
          batchResponse
        }
      }

      return {
        batchId: batchResponse.batch_id,
        uploadToken: batchResponse.upload_token,
        fileMappings: batchResponse.file_mappings
      }
    },
    [libraryId, basePath]
  )

  const checkBatchComplete = useCallback(
    (batchId: string) => {
      if (emittedBatchSetRef.current.has(batchId)) return

      const batchItems = uploadQueue.filter(item => item.batchId === batchId)
      if (batchItems.length === 0) return

      const allFinished = batchItems.every(
        item => item.status === UPLOAD_STATUS.COMPLETED || item.status === UPLOAD_STATUS.ERROR
      )

      if (allFinished) {
        emittedBatchSetRef.current.add(batchId)
        const results = batchItems.map(item => ({
          url: item.status === UPLOAD_STATUS.COMPLETED ? 'uploaded' : '',
          batchId: item.batchId,
          fileId: item.fileId || ''
        }))
        onComplete?.(results)
      }
    },
    [uploadQueue, onComplete]
  )

  // ==================== 上传进度管理 ====================
  /**
   * 批量更新进度 - 触发 React 重新渲染
   */
  /**
   * 批量更新进度 - 触发 React 重新渲染
   */
  const batchUpdateProgress = useCallback(() => {
    const currentQueue = libraryStore.uploadQueue
    let hasChanges = false

    currentQueue.forEach(item => {
      if (item.pendingProgress !== undefined) {
        item.progress = item.pendingProgress
        item.pendingProgress = undefined
        hasChanges = true
      }
    })

    // 触发 React 重新渲染
    if (hasChanges) {
      libraryStore.setUploadQueue([...currentQueue])
    }
  }, [libraryStore])

  /**
   * 加载文件上传进度（优化版本）
   * 关键：需要触发 React 状态更新才能重新渲染
   */
  const loadFileProgress = useCallback(
    (itemId: string) => {
      // 检查是否已取消
      if (cancelledIdsRef.current.has(itemId)) return

      clearProgressTimer(itemId)

      // 从最新的队列中获取 item
      const currentQueue = libraryStore.uploadQueue
      const item = currentQueue.find(i => i.id === itemId)
      if (!item) return

      filesApi
        .batchUploadProgress(item.batchId, {
          detail: true,
          file_upload_id: item.fileUploadId
        })
        .then(res => {
          // Promise 回调中再次检查是否已取消
          if (cancelledIdsRef.current.has(itemId)) return

          const { files } = res
          const file = files[item.fileUploadId]

          // 获取最新队列并更新
          const latestQueue = libraryStore.uploadQueue
          const latestItem = latestQueue.find(i => i.id === itemId)
          if (!latestItem) return

          if (file.status === 'completed') {
            latestItem.status = UPLOAD_STATUS.COMPLETED
            latestItem.fileId = file.file_id.toString()
            latestItem.progress = 100
            // 触发状态更新
            libraryStore.setUploadQueue([...latestQueue])
          } else if (file.status === 'failed') {
            latestItem.status = UPLOAD_STATUS.ERROR
            latestItem.error = file.error
            // 触发状态更新
            libraryStore.setUploadQueue([...latestQueue])
          } else {
            latestItem.status = UPLOAD_STATUS.UPLOADING
            latestItem.progress = file.progress
            // 触发状态更新
            libraryStore.setUploadQueue([...latestQueue])

            // 设置下次检查
            const timer = setTimeout(() => {
              loadFileProgress(itemId)
            }, 1000)

            progressTimersRef.current.set(itemId, timer)
          }
        })
        .catch(error => {
          // 检查是否已取消
          if (cancelledIdsRef.current.has(itemId)) return

          console.error('获取上传进度失败:', error)
          clearProgressTimer(itemId)

          const latestQueue = libraryStore.uploadQueue
          const latestItem = latestQueue.find(i => i.id === itemId)
          if (latestItem) {
            latestItem.status = UPLOAD_STATUS.ERROR
            latestItem.error = error.message
            libraryStore.setUploadQueue([...latestQueue])
          }
        })
        .finally(() => {
          const latestQueue = libraryStore.uploadQueue
          const latestItem = latestQueue.find(i => i.id === itemId)
          if (latestItem) {
            checkBatchComplete(latestItem.batchId)
          }
        })
    },
    [clearProgressTimer, libraryStore, checkBatchComplete]
  )

  // ==================== 文件上传核心逻辑 ====================
  /**
   * 普通上传
   */
  const uploadFileNormally = useCallback(
    async (itemId: string) => {
      const currentQueue = libraryStore.uploadQueue
      const item = currentQueue.find(i => i.id === itemId)
      if (!item) return

      try {
        const params: BatchUploadFileParams = {
          upload_token: item.uploadToken,
          file_upload_id: item.fileUploadId
        }
        // 秒传命中：不传 file 二进制，仅传 hash 让后端复用已有 UploadFile
        if (item.instantUploaded && item.hash) {
          params.hash = item.hash
        } else {
          params.file = item.file
        }
        // Add duplicate_mode if specified
        if (item.duplicateMode) {
          params.duplicate_mode = item.duplicateMode
        }

        await filesApi.batchUploadFile(item.batchId, params)
        loadFileProgress(itemId)
      } catch (error) {
        throw new Error(`上传失败: ${error instanceof Error ? error.message : '未知错误'}`)
      }
    },
    [libraryStore, loadFileProgress]
  )

  /**
   * 上传文件（优化版本）
   */
  const uploadFile = useCallback(
    async (itemId: string) => {
      const currentQueue = libraryStore.uploadQueue
      const item = currentQueue.find(i => i.id === itemId)
      if (!item) return

      // 更新状态
      item.status = UPLOAD_STATUS.UPLOADING
      item.abortController = createAbortController()
      item.startTime = Date.now()

      // 触发 React 重新渲染
      libraryStore.setUploadQueue([...currentQueue])

      // 同时更新 state 和 ref
      activeUploadsRef.current++
      setActiveUploads(prev => prev + 1)

      try {
        await uploadFileNormally(itemId)
      } catch (error) {
        // 获取最新队列并更新
        const latestQueue = libraryStore.uploadQueue
        const latestItem = latestQueue.find(i => i.id === itemId)
        if (latestItem) {
          latestItem.status = UPLOAD_STATUS.ERROR
          const errorMessage = error instanceof Error ? error.message : '上传失败'
          latestItem.error = errorMessage
          libraryStore.setUploadQueue([...latestQueue])
          onError?.(latestItem.file, errorMessage)
          checkBatchComplete(latestItem.batchId)
        }
      } finally {
        // 先减少活跃上传数 - 同步更新 ref
        activeUploadsRef.current--
        setActiveUploads(prev => prev - 1)

        // 检查是否有等待文件并触发下一个上传
        setTimeout(() => {
          const hasWaitingFiles = libraryStore.uploadQueue.some(
            queueItem => queueItem.status === UPLOAD_STATUS.WAITING
          )
          if (hasWaitingFiles) {
            startNextUploadRef.current()
          }
        }, 0)
      }
    },
    [libraryStore, createAbortController, uploadFileNormally, onError, checkBatchComplete]
  )

  /**
   * 开始下一个上传 - 使用 ref 避免闭包问题
   */
  const startNextUpload = useCallback(() => {
    // 使用 ref 获取最新的 activeUploads 值
    const currentActiveUploads = activeUploadsRef.current
    // 使用最新的 queue 状态
    const currentQueue = libraryStore.uploadQueue

    if (currentActiveUploads >= maxConcurrent) {
      return
    }

    const nextItem = currentQueue.find(item => item.status === UPLOAD_STATUS.WAITING)
    if (nextItem) {
      uploadFile(nextItem.id)
    }
  }, [libraryStore, maxConcurrent, uploadFile])

  // 使用 ref 存储最新的 startNextUpload 函数
  const startNextUploadRef = useRef(startNextUpload)
  useEffect(() => {
    startNextUploadRef.current = startNextUpload
  }, [startNextUpload])

  // 使用 useEffect 监听队列变化，自动触发上传
  // autoUpload 为 true 时保持自动上传；默认 false，需点击“开始上传”（uploadStarted）后才开始
  useEffect(() => {
    if (
      (autoUpload || uploadStarted) &&
      uploadQueue.some(item => item.status === UPLOAD_STATUS.WAITING)
    ) {
      startNextUploadRef.current()
    }
  }, [uploadQueue, autoUpload, uploadStarted])

  // 一轮上传全部结束（无等待 / 上传中 / 暂停）后重置标记，之后新选的文件需重新点击“开始上传”
  useEffect(() => {
    if (!hasPendingUploads) {
      setUploadStarted(false)
    }
  }, [hasPendingUploads])

  // ==================== 队列管理 ====================
  /**
   * 队列余量检查：不足时先清掉已结束项再判定，返回 false 表示放不下
   */
  const hasQueueCapacity = useCallback(
    (incoming: number): boolean => {
      if (uploadQueue.length + incoming <= maxFileCount) return true

      cleanupCompletedItems()
      if (uploadQueue.length + incoming <= maxFileCount) return true

      message.warning(`上传队列已满，最多支持 ${maxFileCount} 个文件同时上传`)
      return false
    },
    [uploadQueue, maxFileCount, cleanupCompletedItems]
  )

  /**
   * 添加到上传队列（优化版本）
   * @param fileHashes 秒传预检结果：key = file 对象引用，value = { hash, existingFileId? }
   *                   existingFileId 存在时视为秒传命中，fileUploadId 直接复用，不再走 multipart 传 file
   *                   注意：不能用 generateFileId 作为 key，因为它基于 Date.now + random，
   *                   每次调用返回值不同，跨函数查 Map 会查不到。这里改用 file 对象引用做 key。
   */
  const addFilesToQueue = useCallback(
    (
      files: File[],
      batchResponse: BatchUploadInitResponse,
      fileHashes?: Map<File, { hash: string; existingFileId?: string }>,
      duplicateMode?: 'replace' | 'sequence'
    ) => {
      const newItems: UploadItem[] = files.map(file => {
        const base = createQueueItemBase(file)
        // 新文件入队时清理取消标记，防止 id 复用导致误拦
        cancelledIdsRef.current.delete(base.id)
        const hashInfo = fileHashes?.get(file)
        const relativePath = (file as any).webkitRelativePath
          ? `/${(file as any).webkitRelativePath}`
          : file.name
        return {
          ...base,
          status: UPLOAD_STATUS.WAITING,
          batchId: batchResponse.batch_id,
          uploadToken: batchResponse.upload_token,
          fileUploadId: batchResponse.file_mappings[relativePath],
          // 秒传命中时复用已有 UploadFile id 作为 fileUploadId；未命中走 batch/init 返回的 mapping
          fileId: "",
          hash: hashInfo?.hash,
          instantUploaded: Boolean(hashInfo?.existingFileId),
          duplicateMode
        }
      })

      // 读最新队列再合并：本函数在 batch/init 等异步之后调用，闭包里的 uploadQueue 可能已过期
      libraryStore.setUploadQueue([...useLibraryStore.getState().uploadQueue, ...newItems])
      // 上传触发由 useEffect 监听队列变化处理：autoUpload 或用户点击“开始上传”后才会开始
    },
    [libraryStore]
  )

  /**
   * 添加到上传队列（异步版本）
   * 秒传预检策略：
   * 1. 先调用 batch/init 创建 batch 并获取 file_mappings
   * 2. 再对每个文件计算 SHA-256 并调用 /api/upload/check 预检（仅产出元数据，不阻断）
   * 3. 所有文件仍然走 batch/upload 完整链路；命中项在 batchUploadFile 时不传 file 二进制，
   *    仅传 hash + upload_token + file_upload_id，由后端按 hash 复用已有 UploadFile
   * - 大文件 / hash 失败 / check 失败：走原 multipart 上传链路
   */
  const addToQueue = useCallback(
    async (files: File[]) => {
      if (!hasQueueCapacity(files.length)) return

      // 1) 先 init：创建 batch 并获取 file_mappings（命中项后续用 check 返回的 file.id 覆盖）
      const batchTask = await createBatchTask(files)

      // Check if duplicates were found
      if ('hasDuplicates' in batchTask && batchTask.hasDuplicates) {
        // Filter to show only files with existing_id !== 0
        setDuplicateFiles(
          batchTask.batchResponse.duplicate_files
            .filter(f => f.existing_id !== 0)
            .map(f => ({
              ...f,
              icon: formatFileInfo(f.relative_path).icon
            }))
        )
        setPendingBatchData({ files, batchResponse: batchTask.batchResponse })
        setShowDuplicateModal(true)
        return
      }

      // 2) 再 check：init 之后对每个文件做秒传预检，命中仅记录元数据，不影响 init 已创建的 batch
      // 用 file 对象引用作为 key（不能用 generateFileId，它是 Date.now + random 生成的不稳定 id）
      const fileHashes = new Map<File, { hash: string; existingFileId?: string }>()

      for (const file of files) {
        try {
          const hash = await calculateFileHash(file)
          const checkResult = await filesApi.checkUpload(hash)
          fileHashes.set(file, {
            hash,
            existingFileId: checkResult.exists ? checkResult.file.id : undefined
          })
        } catch (error) {
          // 降级到原 multipart 上传链路（Web Crypto 不可用 / 接口异常等场景）
          console.warn('秒传预检失败，降级到原上传链路:', error)
        }
      }

      // 3) 所有文件都进 batch 链路；命中项在 batchUploadFile 处不传 file，仅传 hash
      addFilesToQueue(
        files,
        {
          batch_id: batchTask.batchId,
          upload_token: batchTask.uploadToken,
          file_mappings: batchTask.fileMappings,
          duplicate_files: []
        },
        fileHashes
      )
    },
    [createBatchTask, addFilesToQueue, hasQueueCapacity]
  )

  /**
   * Handle Replace action - upload with duplicate_mode = 'replace'
   */
  const handleDuplicateReplace = useCallback(async () => {
    if (!pendingBatchData) return

    const { files, batchResponse } = pendingBatchData
    setShowDuplicateModal(false)

    addFilesToQueue(files, batchResponse, undefined, 'replace')
    setPendingBatchData(null)
  }, [pendingBatchData, addFilesToQueue])

  /**
   * Handle Keep Both action - upload with duplicate_mode = 'sequence'
   */
  const handleDuplicateKeepBoth = useCallback(async () => {
    if (!pendingBatchData) return

    const { files, batchResponse } = pendingBatchData
    setShowDuplicateModal(false)

    addFilesToQueue(files, batchResponse, undefined, 'sequence')
    setPendingBatchData(null)
  }, [pendingBatchData, addFilesToQueue])

  /**
   * Handle Cancel action - remove only duplicate files, continue with non-duplicates
   */
  const handleDuplicateCancel = useCallback(async () => {
    if (!pendingBatchData) return

    const { files, batchResponse } = pendingBatchData
    setShowDuplicateModal(false)

    // Get paths of duplicate files to cancel
    const duplicatePaths = new Set(
      batchResponse.duplicate_files
        .filter(f => f.existing_id !== 0)
        .map(f => f.relative_path)
    )

    // Filter out duplicate files, keep non-duplicate ones
    const nonDuplicateFiles = files.filter(file => {
      const relativePath = (file as any).webkitRelativePath || file.name
      return !duplicatePaths.has(relativePath) && !duplicatePaths.has(`/${relativePath}`)
    })

    if (nonDuplicateFiles.length > 0) {
      // Continue with non-duplicate files (no duplicate_mode)
      addFilesToQueue(nonDuplicateFiles, batchResponse)
    }

    setPendingBatchData(null)
  }, [pendingBatchData, addFilesToQueue])

  // ==================== 上传控制操作 ====================
  /**
   * 继续上传
   */
  const resumeUpload = useCallback(
    async (id: string) => {
      const queueItem = uploadQueue.find(item => item.id === id)
      if (queueItem && queueItem.status === UPLOAD_STATUS.PAUSED) {
        queueItem.status = UPLOAD_STATUS.WAITING
        setUploadStarted(true)
        // 触发状态更新
        libraryStore.setUploadQueue([...uploadQueue])
      }
    },
    [uploadQueue, libraryStore]
  )

  /**
   * 暂停上传
   */
  const pauseUpload = useCallback(
    (id: string) => {
      const queueItem = uploadQueue.find(item => item.id === id)
      if (queueItem && queueItem.status === UPLOAD_STATUS.UPLOADING) {
        queueItem.status = UPLOAD_STATUS.PAUSED
        queueItem.abortController?.abort()

        // 同步更新 ref 和 state
        activeUploadsRef.current--
        setActiveUploads(prev => prev - 1)
        // 触发状态更新
        libraryStore.setUploadQueue([...uploadQueue])
      }
    },
    [uploadQueue, libraryStore]
  )

  /**
   * 取消上传请求（节流处理）
   */
  const cancelRequest = useMemo(
    () =>
      throttle((item: UploadItem) => {
        filesApi.batchUploadCancel(item.batchId)
      }, 600),
    []
  )

  /**
   * 取消上传
   */
  const cancelUpload = useCallback(
    (item: UploadItem) => {
      const itemIndex = uploadQueue.findIndex(queueItem => queueItem.id === item.id)
      if (itemIndex !== -1) {
        const queueItem = uploadQueue[itemIndex]
        const wasUploading = queueItem.status === UPLOAD_STATUS.UPLOADING

        if (queueItem.status === UPLOAD_STATUS.UPLOADING || queueItem.status === UPLOAD_STATUS.WAITING) {
          if (queueItem.status === UPLOAD_STATUS.UPLOADING) {
            cancelRequest(queueItem)
          }
          // 标记为已取消，阻止异步回调继续轮询
          cancelledIdsRef.current.add(item.id)
          // 清理进度定时器和中止请求
          clearProgressTimer(item.id)
          if (queueItem.abortController) {
            queueItem.abortController.abort()
          }
          const newQueue = [...uploadQueue]
          newQueue.splice(itemIndex, 1)
          libraryStore.setUploadQueue(newQueue)
        }
        if (wasUploading) {
          activeUploadsRef.current--
          setActiveUploads(prev => prev - 1)
        }
      }
    },
    [uploadQueue, libraryStore, cancelRequest, clearProgressTimer]
  )

  /**
   * 重试上传
   */
  const retryUpload = useCallback(
    (id: string) => {
      const queueItem = uploadQueue.find(item => item.id === id)
      if (!queueItem || queueItem.status !== UPLOAD_STATUS.ERROR) return

      // 超限文件重传必然再次失败，直接提示原因，不走上传链路
      if (isOversizeFile(queueItem.file)) {
        message.error(FILE_SIZE_EXCEEDED_MESSAGE)
        return
      }

      queueItem.status = UPLOAD_STATUS.WAITING
      queueItem.progress = 0
      queueItem.error = undefined
      setUploadStarted(true)
      // 触发状态更新
      libraryStore.setUploadQueue([...uploadQueue])
    },
    [uploadQueue, libraryStore, isOversizeFile]
  )

  // ==================== 批量操作 ====================
  /** 暂停所有正在上传的文件 */
  const pauseAll = useCallback(() => {
    uploadQueue.forEach(uploadItem => {
      if (uploadItem.status === UPLOAD_STATUS.UPLOADING) {
        pauseUpload(uploadItem.id)
      }
    })
  }, [uploadQueue, pauseUpload])

  /** 继续所有暂停的文件上传 */
  const resumeAll = useCallback(() => {
    let updated = false
    uploadQueue.forEach(uploadItem => {
      if (uploadItem.status === UPLOAD_STATUS.PAUSED) {
        uploadItem.status = UPLOAD_STATUS.WAITING
        updated = true
      }
    })
    if (updated) {
      setUploadStarted(true)
      libraryStore.setUploadQueue([...uploadQueue])
    }
  }, [uploadQueue, libraryStore])

  /**
   * 取消所有未完成的文件上传
   */
  const cancelAll = useCallback(() => {
    const itemsToCancel = uploadQueue.filter(item =>
      [UPLOAD_STATUS.WAITING, UPLOAD_STATUS.UPLOADING, UPLOAD_STATUS.PAUSED].includes(
        item.status as any
      )
    )

    let activeCount = 0
    itemsToCancel.forEach(item => {
      // 标记为已取消，阻止异步回调继续轮询
      cancelledIdsRef.current.add(item.id)
      if (item.status === UPLOAD_STATUS.UPLOADING) {
        cancelRequest(item)
        activeCount++
      }
      clearProgressTimer(item.id)
      if (item.abortController) {
        item.abortController.abort()
      }
    })

    // 一次性从队列中移除所有未完成项，避免闭包陈旧问题
    const newQueue = uploadQueue.filter(
      item => ![UPLOAD_STATUS.WAITING, UPLOAD_STATUS.UPLOADING, UPLOAD_STATUS.PAUSED].includes(
        item.status as any
      )
    )
    libraryStore.setUploadQueue(newQueue)

    if (activeCount > 0) {
      activeUploadsRef.current -= activeCount
      setActiveUploads(prev => prev - activeCount)
    }
  }, [uploadQueue, libraryStore, cancelRequest, clearProgressTimer])

  // ==================== 文件查看 ====================
  /**
   * 查看文件
   */
  const viewFile = useCallback(
    (item: UploadItem) => {
      if (item.status === UPLOAD_STATUS.COMPLETED) {
        onView?.(item)
      }
    },
    [onView]
  )

  // ==================== 文件选择处理 ====================
  /**
   * 选择文件
   */
  const selectFiles = useCallback((newBasePath?: string) => {
    if (newBasePath !== undefined) {
      basePathRef.current = newBasePath
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    fileInputRef.current?.click()
  }, [])

  /**
   * 选择文件夹
   */
  const selectFolder = useCallback((newBasePath?: string) => {
    if (newBasePath !== undefined) {
      basePathRef.current = newBasePath
    }
    if (!browserSupport.supportsDirectorySelection) {
      message.warning('当前浏览器不支持文件夹上传功能，请使用 Chrome、Safari 或 Edge 浏览器')
      return
    }

    if (folderInputRef.current) {
      folderInputRef.current.value = ''
    }
    folderInputRef.current?.click()
  }, [browserSupport.supportsDirectorySelection])

  /**
   * 处理文件选择
   */
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const target = e.target
      if (target.files) {
        handleFiles(target.files)
      }
      target.value = ''
    },
    []
  )

  /**
   * 处理文件夹选择
   */
  const handleFolderSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const target = e.target
      if (target.files) {
        const isValidation = validateFolder(target.files)
        if (!isValidation) {
          Modal.confirm({
            title: '文件夹上传超出限制',
            content: `
您选择的文件夹包含过多内容，已超出系统支持的范围:

·单层最多支持上传${maxFileCount}个文件
·文件夹嵌套最多支持${maxDepth}层

请调整后重新选择文件夹上传，或将内容拆分为多个文件夹上传。
            `,
            okText: '我知道了',
            cancelButtonProps: { style: { display: 'none' } }
          })
          return
        }
        handleFiles(target.files)
      }
      target.value = ''
    },
    [maxFileCount, maxDepth, validateFolder]
  )

  /**
   * 处理文件（优化版本）
   */
  const handleFiles = useCallback(
    (files: FileList) => {
      const validFiles: File[] = []
      const newOversizeFiles: OversizeUploadFile[] = []
      const invalidFiles: InvalidUploadFile[] = []
      let tempFilesCount = 0

      for (const file of Array.from(files)) {
        const result = validateUploadFile(file, validationOptions)
        if (result.valid) {
          validFiles.push(file)
          continue
        }

        if (result.code === 'temp') {
          tempFilesCount++
        } else if (result.code === 'size') {
          // 超限文件不进上传队列、不在待上传列表展示，单独记录供状态栏汇总查看
          newOversizeFiles.push({ file, icon: formatFileInfo(file.name).icon })
        } else {
          invalidFiles.push({ name: file.name, message: result.message })
        }
      }

      if (tempFilesCount > 0) {
        console.log(`已自动过滤 ${tempFilesCount} 个临时文件或系统文件`)
      }

      // 仅有效文件占用上传队列余量（超限文件不进队列）
      if (validFiles.length > 0 && !hasQueueCapacity(validFiles.length)) return

      // 类型不符的文件只能提示：混选场景下不提示等于静默丢弃
      const invalidMessage = buildInvalidFilesMessage(invalidFiles, validFiles.length)
      if (invalidMessage) {
        message.error(invalidMessage)
      }

      if (newOversizeFiles.length > 0) {
        setOversizeFiles(prev => [...prev, ...newOversizeFiles])
      }

      if (validFiles.length > 0) {
        addToQueue(validFiles)
      }
    },
    [validationOptions, hasQueueCapacity, addToQueue]
  )

  // ==================== UI 控制 ====================
  /**
   * 折叠/展开队列
   */
  const handleCollapsed = useCallback(() => {
    setIsCollapsed(prev => !prev)
  }, [])

  /**
   * 开始上传：手动触发队列中等待文件的上传
   */
  const handleStartUpload = useCallback(() => {
    if (!uploadQueue.some(item => item.status === UPLOAD_STATUS.WAITING)) return
    setUploadStarted(true)
    // 立即触发一次，不必依赖 state 更新后的 effect 时序
    startNextUploadRef.current()
  }, [uploadQueue])

  /**
   * 关闭上传队列
   */
  const handleClose = useCallback(() => {
    const unfinishedCount = uploadQueue.filter(
      item =>
        item.status === UPLOAD_STATUS.WAITING ||
        item.status === UPLOAD_STATUS.UPLOADING ||
        item.status === UPLOAD_STATUS.PAUSED
    ).length
    if (unfinishedCount > 0) {
      Modal.confirm({
        title: '取消上传',
        content: `还有 ${unfinishedCount} 个文件未上传完成，是否取消这些文件的上传？`,
        okText: '取消上传',
        cancelText: '暂不取消',
        onOk: () => {
          cancelAll()
          libraryStore.setUploadQueue([])
          setOversizeFiles([])
        }
      })
    } else {
      libraryStore.setUploadQueue([])
      setOversizeFiles([])
    }
  }, [uploadQueue, cancelAll, libraryStore])

  // ==================== 生命周期管理 ====================
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (uploadingUploads.length > 0 || hasWaitingUploads) {
        const message = t('common.unsaved_changes')
        event.preventDefault()
        event.returnValue = message
        return message
      }
      return undefined
    }

    // 启用 beforeunload 保护标记
    const disableProtection = enableBeforeUnloadProtection()

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      disableProtection()
    }
  }, [uploadingUploads.length, hasWaitingUploads, t])

  useEffect(() => {
    return () => {
      progressTimersRef.current.forEach(timer => clearTimeout(timer))
      progressTimersRef.current.clear()

      uploadQueue.forEach(item => {
        if (item.abortController) {
          item.abortController.abort()
        }
      })

      uploadQueue.forEach(cleanupUploadItem)
      libraryStore.setUploadQueue([])
    }
  }, [])

  // ==================== 暴露方法 ====================
  useImperativeHandle(ref, () => ({
    selectFiles,
    selectFolder,
    cancelAll,
    startUpload: handleStartUpload
  }), [selectFiles, selectFolder, cancelAll, handleStartUpload])

  // Tree node render
  const renderTreeNode = (node: FileStructureItem) => {
    if (node.type === 'directory') {
      const children = node.children || []
      const folderStatus = getFolderStatus(children)
      const hasUploadingChild = children.some(item => item.status === UPLOAD_STATUS.UPLOADING)
      return (
        <div className="flex-1 h-[50px] pr-2.5 flex items-center gap-2 overflow-hidden">
          <div className="flex-none size-6">
            <img className="size-6" src={node.icon} alt="" />
          </div>
          <div className="flex-1 overflow-hidden">
            <div className="text-sm font-medium text-[#1D1E1F] truncate" title={node.name}>
              {node.name}
            </div>
            <div className="text-xs text-[#4F5052]"></div>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-sm text-[#999999]">
              {folderStatus === UPLOAD_STATUS.ERROR
                ? '部分文件上传失败'
                : folderStatus === UPLOAD_STATUS.COMPLETED
                  ? '全部上传成功'
                  : hasUploadingChild
                    ? '上传中'
                    : '待上传'}
            </span>
            {folderStatus === UPLOAD_STATUS.WAITING && hasUploadingChild && (
              <LoadingOutlined />
            )}
          </div>
        </div>
      )
    }

    return (
      <div className="flex-1 h-[50px] pr-2.5 flex items-center gap-2 overflow-hidden">
        <div className="flex-none size-6">
          <img className="size-6" src={node.icon} alt="" />
        </div>
        <div className="flex-1 overflow-hidden">
          <div className="text-sm font-medium text-[#1D1E1F] truncate" title={node.file?.name}>
            {node.file?.name}
          </div>
          <div className="text-xs text-[#4F5052]">
            {node.file &&
              (isOversizeFile(node.file)
                ? FILE_SIZE_EXCEEDED_MESSAGE
                : formatFileSize(node.file.size))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {node.status === 'completed' && (
            <>
              <CheckCircleFilled style={{ color: '#07C160' }} title={node.error} />
              <p className="text-sm text-[#939499]">上传成功</p>
              <Button type="link" size="small" onClick={() => {
                const item = uploadQueue.find(i => i.id === node.id)
                if (item) viewFile(item)
              }}>
                查看
              </Button>
            </>
          )}
          {node.status === 'paused' && (
            <button
              className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors duration-200"
              title="继续"
              onClick={() => resumeUpload(node.id!)}
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                  clipRule="evenodd"
                ></path>
              </svg>
            </button>
          )}
          {node.status === 'waiting' && (
            <Button type="link" size="small" onClick={() => {
              const item = uploadQueue.find(i => i.id === node.id)
              if (item) cancelUpload(item)
            }}>
              取消
            </Button>
          )}
          {node.status === 'error' && (
            <>
              <Tooltip title={node.error}>
                <div className="flex items-center gap-1">
                  <WarningFilled style={{ color: '#FA5151' }} />
                  <p className="text-sm text-[#939499]">上传失败</p>
                </div>
              </Tooltip>
              <Button type="link" size="small" onClick={() => retryUpload(node.id!)}>
                重试
              </Button>
            </>
          )}
          {node.status === 'uploading' && (
            <>
              <span className="text-sm text-[#999999]">{Math.round(node.progress || 0)}%</span>
              <LoadingOutlined />
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* 上传队列 */}
      {(uploadQueue.length > 0 || oversizeFiles.length > 0) && (
        <div className="w-[450px] border shadow-lg rounded-md z-[99] fixed bottom-5 right-5 bg-white">
          {/* 队列头部 */}
          <div className="h-14 px-4 flex items-center gap-2">
            {hasFailedUploads ? (
              <>
                <div className="flex-none size-5 flex items-center justify-center text-[#F0A105]">
                  <WarningFilled />
                </div>
                <h2 className="flex-1 text-base text-[#1D1E1F]">部分文件上传失败</h2>
              </>
            ) : everyUploadsCompleted ? (
              <>
                <div className="flex-none size-5 flex items-center justify-center">
                  <CheckCircleFilled style={{ color: '#07C160' }} />
                </div>
                <h2 className="flex-1 text-base text-[#1D1E1F]">全部上传成功</h2>
              </>
            ) : isPendingStart || uploadQueue.length === 0 ? (
              <>
                <h2 className="flex-1 text-base text-[#1D1E1F]">上传文件</h2>
              </>
            ) : (
              <>
                <div className="flex-none size-5 flex items-center justify-center text-[#2563EB]">
                  <SvgIcon name="upload" size={22} />
                </div>
                <h2 className="flex-1 text-base text-[#1D1E1F]">文件上传中</h2>
              </>
            )}

            {/* 折叠/展开按钮 */}
            <div
              className="flex-none size-5 rounded flex items-center justify-center cursor-pointer hover:bg-gray-200"
              onClick={handleCollapsed}
            >
              <DownOutlined style={{ fontSize: 10, color: '#4F5052' }} />
            </div>
            {/* 关闭按钮 */}
            <div
              className="flex-none size-5 rounded flex items-center justify-center cursor-pointer ml-2 hover:bg-gray-200"
              onClick={handleClose}
            >
              <CloseOutlined style={{ fontSize: 10, color: '#4F5052' }} />
            </div>
          </div>

          {/* 队列状态栏 */}
          {!isCollapsed && (
            <div className="h-10 px-4 flex items-center justify-between bg-[#FAFAFA]">
              <h3 className="text-sm text-[#4F5052]">
                {uploadQueue.length > 0 && (
                  <>
                    {uploadingUploads.length > 0
                      ? `正在上传${uploadingUploads.length}个文件`
                      : isPendingStart
                        ? `待上传${waitingUploads.length}个文件`
                        : `共有${uploadQueue.length}个文件`}
                    {completedUploads.length > 0 && `，已成功${completedUploads.length}个`}
                    {failedUploads.length > 0 && `，失败${failedUploads.length}个`}
                  </>
                )}
                {oversizeFiles.length > 0 && (isPendingStart || uploadQueue.length === 0) && (
                  <>
                    {uploadQueue.length > 0 && '，'}
                    <a
                      className="text-[#2563EB] cursor-pointer hover:underline"
                      onClick={() => setShowOversizeModal(true)}
                    >
                      {oversizeFiles.length}个文件超出大小限制
                      <ExclamationCircleOutlined className="ml-0.5 text-[#F0A105]" />
                    </a>
                  </>
                )}
              </h3>
              <div className="flex">
                {(hasActiveUploads || isPendingStart) && (
                  <Button type="link" size="small" onClick={cancelAll}>
                    全部取消
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* 上传列表 */}
          {!isCollapsed && uploadTreeData.length > 0 && (
            <div className="space-y-1 px-1 py-1 max-h-[300px] overflow-y-auto">
              <Tree
                treeData={uploadTreeData}
                fieldNames={{ title: 'name', key: 'id', children: 'children' }}
                showLine={false}
                blockNode
                titleRender={renderTreeNode}
              />
            </div>
          )}

          {/* 开始上传按钮：有等待文件且当前无上传任务时展示在列表下方 */}
          {!isCollapsed && isPendingStart && (
            <div className="p-3 border-t border-[#F0F0F0]">
              <Button type="primary" block onClick={handleStartUpload}>
                开始上传
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Duplicate files modal */}
      <Modal
        open={showDuplicateModal}
        title="同名文件"
        width={520}
        onCancel={handleDuplicateCancel}
        footer={
          <>
            <Button type="primary" onClick={handleDuplicateReplace}>
              替换
            </Button>
            <Button onClick={handleDuplicateKeepBoth}>保留两者</Button>
            <Button onClick={handleDuplicateCancel}>取消</Button>
          </>
        }
      >
        <div className="mb-4 text-sm text-[#1D1E1F] font-semibold">
          当前位置存在以下同名文件，是否替换为新的文件？
        </div>
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {duplicateFiles.map(item => (
            <div key={item.existing_id} className="flex items-center gap-2">
              <img className="size-5" src={item.icon} alt="" />
              <Tooltip title={item.relative_path}>
                <div className="flex-1 text-sm text-[#1D1E1F] truncate">{item.relative_path}</div>
              </Tooltip>
            </div>
          ))}
        </div>
      </Modal>

      {/* 超出大小限制文件列表 */}
      <Modal
        open={showOversizeModal}
        title={`${oversizeFiles.length}个文件超出大小`}
        width={520}
        onCancel={() => setShowOversizeModal(false)}
        footer={
          <Button type="primary" onClick={() => setShowOversizeModal(false)}>
            我知道了
          </Button>
        }
      >
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {oversizeFiles.map((item, index) => {
            const displayName = (item.file as any).webkitRelativePath || item.file.name
            return (
              <div key={`${displayName}-${index}`} className="flex items-center gap-2">
                <img className="size-5" src={item.icon} alt="" />
                <Tooltip title={displayName}>
                  <div className="flex-1 text-sm text-[#1D1E1F] truncate">{displayName}</div>
                </Tooltip>
                <div className="text-sm text-[#999999]">
                  {formatFileSize(item.file.size)} / 上限
                  {formatFileSize(resolveMaxSizeBytes(item.file.name, validationOptions))}
                </div>
              </div>
            )
          })}
        </div>
      </Modal>

      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={acceptString}
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* 文件夹选择输入 - 仅在支持的浏览器中显示 */}
      {browserSupport.supportsDirectorySelection && (
        <input
          ref={folderInputRef}
          type="file"
          // @ts-ignore - webkitdirectory is not in types
          webkitdirectory=""
          multiple
          className="hidden"
          onChange={handleFolderSelect}
        />
      )}
    </div>
  )
})

FileUpload.displayName = 'FileUpload'

export default FileUpload
