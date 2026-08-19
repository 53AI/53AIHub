import { useState, useCallback, useRef } from 'react'
import { message } from 'antd'
import { recordingApi } from '@/api/modules/recording'
import filesApi from '@/api/modules/files'
import { useBatchProgress } from '@/hooks/useBatchProgress'
import { t } from '@/locales'

const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'aac']

/** 音频导入默认单文件大小上限：200MB。调用方可通过 maxSize 覆盖。 */
const DEFAULT_MAX_AUDIO_SIZE = 200 * 1024 * 1024

export interface AudioImportConfig {
  ensureLibraryId: () => Promise<string>
  currentPath: string
  onSuccess: () => void
  groupId?: number
  /** 单文件大小上限（字节）。默认 200MB。 */
  maxSize?: number
}

export interface UseAudioImportReturn {
  importing: boolean
  fileInputRef: React.RefObject<HTMLInputElement | null>
  handleImportFile: () => void
  handleFileChange: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>
}

/**
 * 音频导入 Hook
 * 封装音频文件导入逻辑
 */
export function useAudioImport(config: AudioImportConfig): UseAudioImportReturn {
  const { ensureLibraryId, currentPath, onSuccess, groupId, maxSize = DEFAULT_MAX_AUDIO_SIZE } = config
  const maxSizeMB = Math.floor(maxSize / 1024 / 1024)

  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const { waitForComplete } = useBatchProgress({
    maxAttempts: 60,
    pollInterval: 1000
  })

  const handleImportFile = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files
      if (!files || files.length === 0) return

      setImporting(true)

      try {
        const libraryId = await ensureLibraryId()

        // Build file structure for import
        const fileStructure: {
          relative_path: string
          size: number
          is_directory?: boolean
          parent_path?: string
          depth?: number
        }[] = []
        const validFiles: File[] = []
        let totalSize = 0

        for (const file of Array.from(files)) {
          const ext = file.name.split('.').pop()?.toLowerCase()
          if (!ext || !AUDIO_EXTENSIONS.includes(ext)) {
            message.warning(`文件 ${file.name} 格式不支持，已跳过`)
            continue
          }
          if (file.size >= maxSize) {
            message.warning(t('file.file_exceed', { size: maxSizeMB, name: file.name }))
            continue
          }

          fileStructure.push({
            relative_path: file.name,
            size: file.size,
            is_directory: false,
            parent_path: '',
            depth: 0,
          })
          validFiles.push(file)
          totalSize += file.size
        }

        if (fileStructure.length === 0) {
          message.error('没有有效的音频文件可导入')
          setImporting(false)
          return
        }

        // Call import API to initialize batch
        const importResponse = await recordingApi.importAudio({
          library_id: libraryId,
          base_path: currentPath === '/' ? undefined : currentPath,
          total_files: fileStructure.length,
          total_size: totalSize,
          file_structure: fileStructure,
          origin_type: 'recording_imported',
          origin_source: 'recording_import',
          group_id: groupId,
        })

        // Upload files using batch upload API
        const { batch_id, upload_token, file_mappings } = importResponse
        const fileUploadIds: string[] = []

        for (const file of validFiles) {
          const fileUploadId = file_mappings[`/${file.name}`] || file_mappings[file.name]
          if (!fileUploadId) {
            console.warn(`No upload ID for file: ${file.name}`)
            continue
          }

          fileUploadIds.push(fileUploadId)
          await filesApi.batchUploadFile(batch_id, {
            file,
            upload_token,
            file_upload_id: fileUploadId,
          })
        }

        // 等待批量上传完成（使用公共 hook）
        await waitForComplete(batch_id, fileUploadIds)

        message.success('已导入')
        onSuccess()
      } catch (error: any) {
        const errorMsg =
          error?.response?.data?.message || error?.message || '导入失败'
        message.error(errorMsg)
      } finally {
        setImporting(false)
        // Reset input so same file can be selected again
        event.target.value = ''
      }
    },
    [ensureLibraryId, currentPath, onSuccess, waitForComplete, maxSize, maxSizeMB]
  )

  return {
    importing,
    fileInputRef,
    handleImportFile,
    handleFileChange,
  }
}
