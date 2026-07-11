// 分片信息接口
interface ChunkInfo {
  index: number
  hash: string
  size: number
  uploaded: boolean
}

// 上传任务接口
interface UploadTask {
  fileId: string
  fileName: string
  fileSize: number
  chunks: ChunkInfo[]
  uploadedChunks: Set<number>
  totalChunks: number
  status: 'waiting' | 'uploading' | 'paused' | 'completed' | 'error' | 'cancelled'
  progress: number
  abortController?: AbortController
}

// 上传选项接口
interface ChunkUploadOptions {
  onProgress?: (progress: number, speed?: number) => void
  onSuccess?: (result: any) => void
  onError?: (error: any) => void
  onChunkUploaded?: (chunkIndex: number) => void
  maxConcurrent?: number
  retryTimes?: number
}

// 分片上传响应接口
interface ChunkUploadResponse {
  success: boolean
  message?: string
  uploadedChunks?: number[]
  fileUrl?: string
  needMerge?: boolean
}

/**
 * 分片上传服务类
 * 支持大文件分片上传、断点续传、并发控制等功能
 */
export class ChunkUploadService {
  private static instance: ChunkUploadService

  private uploadTasks = new Map<string, UploadTask>()

  private activeUploads = new Map<string, Promise<void>>()

  private constructor() {}

  static getInstance(): ChunkUploadService {
    if (!ChunkUploadService.instance) {
      ChunkUploadService.instance = new ChunkUploadService()
    }
    return ChunkUploadService.instance
  }

  /**
   * 初始化上传任务
   */
  async initUploadTask(fileId: string, file: File, chunks: ChunkInfo[]): Promise<UploadTask> {
    // 检查服务器已上传的分片
    const uploadedChunks = await this.checkUploadedChunks(fileId, file.name)

    const task: UploadTask = {
      fileId,
      fileName: file.name,
      fileSize: file.size,
      chunks: chunks.map((chunk) => ({
        ...chunk,
        uploaded: uploadedChunks.includes(chunk.index)
      })),
      uploadedChunks: new Set(uploadedChunks),
      totalChunks: chunks.length,
      status: 'waiting',
      progress: (uploadedChunks.length / chunks.length) * 100
    }

    this.uploadTasks.set(fileId, task)
    return task
  }

  /**
   * 检查服务器已上传的分片
   */
  private async checkUploadedChunks(fileId: string, fileName: string): Promise<number[]> {
    try {
      // 这里应该调用实际的API检查已上传分片
      // const response = await api.checkUploadedChunks({ fileId, fileName })
      // return response.data.uploadedChunks || []

      // 模拟返回已上传的分片（用于断点续传测试）
      return []
    } catch (error) {
      console.warn('Failed to check uploaded chunks:', error)
      return []
    }
  }

  /**
   * 开始上传文件
   */
  async uploadFile(
    fileId: string,
    file: File,
    chunks: Blob[],
    options: ChunkUploadOptions = {}
  ): Promise<void> {
    const task = this.uploadTasks.get(fileId)
    if (!task) {
      throw new Error('Upload task not found')
    }

    if (this.activeUploads.has(fileId)) {
      throw new Error('Upload already in progress')
    }

    const {
      onProgress,
      onSuccess,
      onError,
      onChunkUploaded,
      maxConcurrent = 3,
      retryTimes = 3
    } = options

    task.status = 'uploading'
    task.abortController = new AbortController()

    const uploadPromise = this.performUpload(task, file, chunks, {
      maxConcurrent,
      retryTimes,
      onProgress,
      onChunkUploaded
    })

    this.activeUploads.set(fileId, uploadPromise)

    try {
      await uploadPromise

      if (task.status === 'uploading') {
        // 所有分片上传完成，请求合并文件
        const mergeResult = await this.mergeFile(fileId, task.fileName, task.totalChunks)
        task.status = 'completed'
        task.progress = 100
        onSuccess?.(mergeResult)
      }
    } catch (error) {
      if (task.status !== 'cancelled') {
        task.status = 'error'
        onError?.(error)
      }
    } finally {
      this.activeUploads.delete(fileId)
    }
  }

  /**
   * 执行分片上传
   */
  private async performUpload(
    task: UploadTask,
    file: File,
    chunks: Blob[],
    options: {
      maxConcurrent: number
      retryTimes: number
      onProgress?: (progress: number, speed?: number) => void
      onChunkUploaded?: (chunkIndex: number) => void
    }
  ): Promise<void> {
    const { maxConcurrent, retryTimes, onProgress, onChunkUploaded } = options
    const pendingChunks = task.chunks.filter((chunk) => !chunk.uploaded).map((chunk) => chunk.index)

    if (pendingChunks.length === 0) {
      return // 所有分片已上传
    }

    const startTime = Date.now()
    let lastProgressTime = startTime
    let lastUploadedBytes = task.uploadedChunks.size * (file.size / task.totalChunks)

    // 并发上传分片
    const uploadPromises: Promise<void>[] = []
    const semaphore = new Array(maxConcurrent).fill(null)

    for (const chunkIndex of pendingChunks) {
      if (task.status === 'paused' || task.status === 'cancelled') {
        break
      }

      const uploadPromise = this.waitForSlot(semaphore).then(async () => {
        await this.uploadChunkWithRetry(task, file, chunks[chunkIndex], chunkIndex, retryTimes)

        // 更新进度
        task.uploadedChunks.add(chunkIndex)
        task.progress = (task.uploadedChunks.size / task.totalChunks) * 100

        // 计算上传速度
        const now = Date.now()
        const timeDiff = now - lastProgressTime
        if (timeDiff > 1000) {
          // 每秒更新一次
          const uploadedBytes = task.uploadedChunks.size * (file.size / task.totalChunks)
          const bytesDiff = uploadedBytes - lastUploadedBytes
          const speed = (bytesDiff / timeDiff) * 1000 // bytes per second

          onProgress?.(task.progress, speed)
          lastProgressTime = now
          lastUploadedBytes = uploadedBytes
        } else {
          onProgress?.(task.progress)
        }

        onChunkUploaded?.(chunkIndex)
      })

      uploadPromises.push(uploadPromise)
    }

    await Promise.all(uploadPromises)
  }

  /**
   * 等待并发槽位
   */
  private async waitForSlot(semaphore: any[]): Promise<void> {
    return new Promise((resolve) => {
      const checkSlot = () => {
        const index = semaphore.findIndex((slot) => slot === null)
        if (index !== -1) {
          semaphore[index] = true
          resolve()
          // 释放槽位
          setTimeout(() => {
            semaphore[index] = null
          }, 0)
        } else {
          setTimeout(checkSlot, 10)
        }
      }
      checkSlot()
    })
  }

  /**
   * 带重试的分片上传
   */
  private async uploadChunkWithRetry(
    task: UploadTask,
    file: File,
    chunk: Blob,
    chunkIndex: number,
    retryTimes: number
  ): Promise<void> {
    let lastError: any

    for (let attempt = 0; attempt <= retryTimes; attempt++) {
      if (task.status === 'paused' || task.status === 'cancelled') {
        throw new Error('Upload cancelled or paused')
      }

      try {
        await this.uploadSingleChunk(task, file, chunk, chunkIndex)
        return // 上传成功
      } catch (error) {
        lastError = error

        if (attempt < retryTimes) {
          // 等待后重试
          await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000))
        }
      }
    }

    throw lastError
  }

  /**
   * 上传单个分片
   */
  private async uploadSingleChunk(
    task: UploadTask,
    file: File,
    chunk: Blob,
    chunkIndex: number
  ): Promise<void> {
    const formData = new FormData()
    formData.append('file', chunk)
    formData.append('filename', file.name)
    formData.append('fileId', task.fileId)
    formData.append('chunkIndex', chunkIndex.toString())
    formData.append('totalChunks', task.totalChunks.toString())
    formData.append('chunkHash', task.chunks[chunkIndex].hash)

    // 这里应该调用实际的分片上传API
    // const response = await api.uploadChunk(formData, {
    //   signal: task.abortController?.signal
    // })

    // 模拟上传延迟
    await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 200))

    // 检查是否被取消
    if (task.abortController?.signal.aborted) {
      throw new Error('Upload cancelled')
    }
  }

  /**
   * 合并文件
   */
  private async mergeFile(fileId: string, fileName: string, totalChunks: number): Promise<any> {
    try {
      // 这里应该调用实际的文件合并API
      // const response = await api.mergeFile({
      //   fileId,
      //   fileName,
      //   totalChunks
      // })
      // return response.data

      // 模拟合并延迟
      await new Promise((resolve) => setTimeout(resolve, 1000))

      return {
        url: `/api/files/${fileId}`,
        fileName,
        size: 0
      }
    } catch (error) {
      throw new Error(`文件合并失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  /**
   * 暂停上传
   */
  pauseUpload(fileId: string): void {
    const task = this.uploadTasks.get(fileId)
    if (task && task.status === 'uploading') {
      task.status = 'paused'
      task.abortController?.abort()
    }
  }

  /**
   * 继续上传
   */
  async resumeUpload(
    fileId: string,
    file: File,
    chunks: Blob[],
    options: ChunkUploadOptions = {}
  ): Promise<void> {
    const task = this.uploadTasks.get(fileId)
    if (task && task.status === 'paused') {
      task.status = 'waiting'
      await this.uploadFile(fileId, file, chunks, options)
    }
  }

  /**
   * 取消上传
   */
  cancelUpload(fileId: string): void {
    const task = this.uploadTasks.get(fileId)
    if (task) {
      task.status = 'cancelled'
      task.abortController?.abort()
      this.uploadTasks.delete(fileId)
      this.activeUploads.delete(fileId)
    }
  }

  /**
   * 获取上传任务
   */
  getUploadTask(fileId: string): UploadTask | undefined {
    return this.uploadTasks.get(fileId)
  }

  /**
   * 清理已完成的任务
   */
  cleanupCompletedTasks(): void {
    for (const [fileId, task] of this.uploadTasks.entries()) {
      if (task.status === 'completed' || task.status === 'cancelled') {
        this.uploadTasks.delete(fileId)
      }
    }
  }
}

export default ChunkUploadService.getInstance()
