import { useCallback } from 'react'
import { filesApi } from '@/api/modules/files'

export interface UseBatchProgressConfig {
  /** 最大轮询次数，默认 60 次（约 1 分钟） */
  maxAttempts?: number
  /** 轮询间隔（毫秒），默认 1000 */
  pollInterval?: number
  /** 进度回调 */
  onProgress?: (completed: number, total: number) => void
}

export interface BatchProgressResult {
  /** 是否全部完成 */
  completed: boolean
  /** 失败的文件 ID 列表 */
  failedIds: string[]
}

/**
 * 批量上传进度轮询 Hook
 * 用于等待批量上传完成
 */
export function useBatchProgress(config: UseBatchProgressConfig = {}) {
  const { maxAttempts = 60, pollInterval = 1000, onProgress } = config

  /**
   * 检查批量上传进度
   */
  const checkProgress = useCallback(
    async (batchId: string, fileUploadIds: string[]): Promise<BatchProgressResult> => {
      try {
        const res = await filesApi.batchUploadProgress(batchId, { detail: true })
        const { files } = res

        const completedIds: string[] = []
        const failedIds: string[] = []

        fileUploadIds.forEach(id => {
          const file = files[id]
          if (file?.status === 'completed') {
            completedIds.push(id)
          } else if (file?.status === 'failed') {
            failedIds.push(id)
          }
        })

        const totalCompleted = completedIds.length + failedIds.length

        onProgress?.(totalCompleted, fileUploadIds.length)

        return {
          completed: totalCompleted === fileUploadIds.length,
          failedIds
        }
      } catch (error) {
        console.error('检查批量进度失败:', error)
        return { completed: false, failedIds: [] }
      }
    },
    [onProgress]
  )

  /**
   * 等待批量上传完成
   */
  const waitForComplete = useCallback(
    async (batchId: string, fileUploadIds: string[]): Promise<void> => {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const result = await checkProgress(batchId, fileUploadIds)

        if (result.completed) {
          if (result.failedIds.length > 0) {
            console.warn('部分文件上传失败:', result.failedIds)
          }
          return
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval))
      }

      throw new Error('上传超时，请稍后刷新查看')
    },
    [checkProgress, maxAttempts, pollInterval]
  )

  return {
    checkProgress,
    waitForComplete
  }
}
