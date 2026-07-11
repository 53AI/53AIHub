/**
 * RecordingBridge - 录音桥接层
 * 在主线程处理 MediaRecorder，管理上传队列
 * 对接真实后端 API
 */

import { recordingApi } from '@/api/modules/recording'
import mySpaceApi from '@/api/modules/my-space'
import { recordingIdbService } from './recording-idb'
import { MAX_RECORDING_DURATION_SEC } from '@/constants/recording'

// ============= Type Definitions =============

export type EventType =
  | 'duration'
  | 'tick'
  | 'chunkReady'
  | 'stopped'
  | 'interrupted'
  | 'error'
  | 'deviceDisconnected'
  | 'memoryWarning'
  | 'heartbeatError'
  | 'maxDurationReached'

export type BridgeEventHandler =
  | ((duration: number) => void)
  | ((data: { duration: number; recordingId: string }) => void)
  | ((chunk: { index: number; mimeType: string }) => void)
  | ((info: { fileId: number; jobId: string }) => void)
  | ((info: { jobId: string }) => void)
  | ((message: string) => void)
  | ((trackLabel: string) => void)
  | ((info: { usage: number; usedMB: number }) => void)
  | ((failCount: number) => void)
  | (() => void)

export interface RecordingInfo {
  jobId: string
  title: string
  format: string
  startTime: number
  libraryId: string
}

// ============= Constants =============

const TIMESLICE = 3000 // 3 seconds in milliseconds
const MAX_RETRIES = 3
const HEARTBEAT_INTERVAL = 10000 // 10 seconds

// HTTP Status Codes
const HTTP_STATUS = {
  SERVICE_UNAVAILABLE: 503,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
  BAD_GATEWAY: 502,
} as const

// API Error Codes
const API_ERROR_CODE = {
  FFMPEG_UNAVAILABLE: 100407,
  SEGMENT_PROCESSING: 100401,
  MISSING_SEGMENT: 100406,
  SEGMENT_EXISTS: 14,
} as const

// ============= Internal Types =============

interface PendingSegment {
  index: number
  data: Blob
  mimeType: string
  durationMs: number
  startOffsetMs: number
  endOffsetMs: number
}

// ============= RecordingBridge Class =============

export class RecordingBridge {
  private mediaRecorder: MediaRecorder | null = null
  private mediaStream: MediaStream | null = null

  private recordingInfo: RecordingInfo | null = null
  private duration = 0
  private durationTimer: ReturnType<typeof setInterval> | null = null
  private currentSegmentIndex = 0
  private segmentStartTime = 0
  private baseOffsetMs = 0  // 已上传时长基准值（恢复时使用）
  private mimeType = ''
  private destroyed = false

  private uploadRetryCount = new Map<number, number>()
  private isUploading = false
  private uploadQueue: PendingSegment[] = []
  private isProcessingData = false

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatFailCount = 0
  private heartbeatActive = false
  private static readonly HEARTBEAT_FAIL_THRESHOLD = 3

  private eventHandlers = new Map<EventType, Set<BridgeEventHandler>>()

  // ============= Public API =============

  /**
   * Start recording
   * Requests microphone, creates API record, saves draft to IDB, starts MediaRecorder
   * @returns jobId
   */
  async start(): Promise<string> {
    if (this.recordingInfo) {
      throw new Error('Recording already in progress')
    }

    this.destroyed = false

    // 清理 IndexedDB 中所有旧草稿（非当前录音的数据）
    await recordingIdbService.clearAllDrafts().catch((err) => {
      console.warn('清理旧录音草稿失败:', err)
    })

    // Check FFmpeg availability before starting
    await this.checkFFmpegHealth()

    // Setup media stream and recorder
    const recorder = await this.setupMediaStream()

    // Generate title: 会议_YYYYMMDD_HHmmss
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const title = `会议_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`

    // Determine format from supported MIME types
    const format = this.mimeType.includes('mp4') ? 'm4a' : 'webm'

    // Get library_id from personal space context
    let context
    try {
      context = await mySpaceApi.getContext()
    } catch (err) {
      throw new Error('获取个人知识库失败，请确保已登录')
    }

    const libraryId = context.library_id

    if (!libraryId) {
      console.error('Invalid library_id from context:', context)
      throw new Error('个人知识库 ID 无效，请刷新页面后重试')
    }

    // Create recording via API
    let job
    try {
      job = await recordingApi.create({
        library_id: libraryId,
        title,
        target_format: 'm4a',
        source_mime_type: this.mimeType,
      })
    } catch (error: any) {
      const errorMsg = error?.response?.data?.message || error?.data?.message || error?.message || ''
      if (errorMsg === 'forbidden: recording feature is disabled') {
        throw new Error('功能已被停用，请刷新页面后重试')
      }
      throw error
    }

    // Initialize recording info
    this.recordingInfo = {
      jobId: job.id,
      title,
      format,
      startTime: Date.now(),
      libraryId,
    }
    this.segmentStartTime = this.recordingInfo.startTime
    this.currentSegmentIndex = 0
    this.baseOffsetMs = 0  // 新录音从 0 开始

    // Save draft to IDB
    await recordingIdbService.saveDraft({
      recordingId: job.id,
      chunks: [],
      startTime: this.recordingInfo.startTime,
      status: 'recording',
      format,
      name: title
    })

    // Start duration timer
    this.startDurationTimer()

    // Start heartbeat (every 10 seconds)
    this.startHeartbeat()

    // Start recording with timeslice for chunked output
    recorder.start(TIMESLICE)

    return job.id
  }

  /**
   * Pause recording
   * Note: MediaRecorder.pause() does NOT trigger ondataavailable, so we need to
   * call requestData() first to flush the current segment data to IDB.
   */
  pause(): void {
    if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') {
      return
    }

    // Force flush current segment data before pausing
    // requestData() triggers ondataavailable to save current data to IDB
    this.mediaRecorder.requestData()

    // Wait briefly for requestData to trigger ondataavailable
    // Note: ondataavailable is async but will complete shortly
    // The upload will continue in background after pause

    this.mediaRecorder.pause()
    this.stopDurationTimer()
    this.stopHeartbeat()

    if (this.recordingInfo) {
      // Update state via API
      recordingApi.updateState(this.recordingInfo.jobId, 'pause').catch(() => {
        // API call failure is non-critical, MediaRecorder already paused
      })
      recordingIdbService.updateStatus(this.recordingInfo.jobId, 'paused').catch(() => {
        // IDB update failure is non-critical
      })
    }
  }

  /**
   * Resume recording
   */
  resume(): void {
    if (!this.mediaRecorder || this.mediaRecorder.state !== 'paused') {
      return
    }

    this.mediaRecorder.resume()
    this.startDurationTimer()
    this.startHeartbeat()
    this.segmentStartTime = Date.now()

    if (this.recordingInfo) {
      // Update state via API
      recordingApi.updateState(this.recordingInfo.jobId, 'resume').catch(() => {
        // API call failure is non-critical, MediaRecorder already resumed
      })
      recordingIdbService.updateStatus(this.recordingInfo.jobId, 'recording').catch(() => {
        // IDB update failure is non-critical
      })
    }
  }

  /**
   * Recover from an interrupted recording
   * @param jobId The interrupted job ID to recover
   * @returns Promise<string> The jobId
   */
  async recover(jobId: string): Promise<string> {
    if (this.recordingInfo) {
      throw new Error('Recording already in progress')
    }

    this.destroyed = false  // Reset destroyed flag for recovery

    // 1. Get job details and validate status
    const job = await recordingApi.getById(jobId)

    // 1.1 Handle finalizing state - don't wait, just inform user
    if (job.status === 'finalizing') {
      throw new Error('录音正在处理中，请稍后在"我的录音"中查看')
    }

    if (job.status !== 'interrupted' && job.status !== 'paused') {
      throw new Error(`无法恢复状态为 ${job.status} 的录音任务`)
    }

    // 1.2 Check FFmpeg availability before recovery
    await this.checkFFmpegHealth()

    // 2. Check recovery state - must be ready to continue
    // 清单要求：recovery_state != ready 或 recovery_error 非空时暂停
    if (job.recovery_error) {
      throw new Error(job.recovery_error)
    }
    if (job.recovery_state && job.recovery_state !== 'ready') {
      throw new Error('录音任务恢复中，请稍后重试')
    }

    // 3. 先上传 IDB 中所有 chunks（只上传服务器已上传之后的）
    const draft = await recordingIdbService.getDraft(jobId)
    const uploadedCount = job.uploaded_segment_count || 0  // 已上传数量
    const uploadedRecordedMs = job.uploaded_recorded_ms || 0  // 已上传时长
    const uploadIntervalMs = job.upload_interval_ms || 3000

    console.log(`服务器状态: uploaded_segment_count=${uploadedCount}, uploaded_recorded_ms=${uploadedRecordedMs}`)
    if (draft) {
      console.log(`IDB 状态: ${draft.chunks.length} chunks, indices: ${draft.chunks.map(c => c.index).join(', ')}`)
    } else {
      console.log('IDB 状态: 无缓存数据')
    }

    // 只上传 >= uploadedCount 的 chunks（index 从 0 开始，uploadedCount=8 表示 0-7 已上传）
    if (draft && draft.chunks.length > 0) {
      const chunksToUpload = draft.chunks.filter(c => c.index >= uploadedCount)

      if (chunksToUpload.length > 0) {
        console.log(`准备上传 ${chunksToUpload.length} 个分段（index >= ${uploadedCount}）...`)
        const sortedChunks = [...chunksToUpload].sort((a, b) => a.index - b.index)

        for (const chunk of sortedChunks) {
          const blob = new Blob([chunk.data], { type: 'audio/webm' })
          // 使用 IDB 中保存的元数据，如果没有则使用服务器数据计算
          const durationMs = chunk.durationMs ?? uploadIntervalMs
          const startOffsetMs = chunk.startOffsetMs ?? (uploadedRecordedMs + (chunk.index - uploadedCount) * uploadIntervalMs)
          const endOffsetMs = chunk.endOffsetMs ?? startOffsetMs + durationMs

          try {
            await recordingApi.uploadSegment({
              job_id: jobId,
              segment: blob,
              segment_index: chunk.index,
              duration_ms: durationMs,
              start_offset_ms: startOffsetMs,
              end_offset_ms: endOffsetMs,
            })
            console.log(`分段 ${chunk.index} 上传成功`)
          } catch (err: any) {
            if (err?.response?.status === HTTP_STATUS.CONFLICT) {
              console.log(`分段 ${chunk.index} 已存在，跳过`)
              continue
            }
            throw new Error(`分段 ${chunk.index} 上传失败，无法恢复录音`)
          }
        }
      }

      // 清空 IDB（包括已上传的和已跳过的）
      await recordingIdbService.deleteDraft(jobId).catch((err) => {
        console.warn('清空 IDB 失败:', err)
      })
      console.log('IDB 已清空')
    }

    // 4. 上传后检查是否还有 missing segments
    const missing = await recordingApi.getMissingSegments(jobId)
    if (missing.missing_segments && missing.missing_segments.length > 0) {
      console.log(`服务器报告缺失分段: ${missing.missing_segments.join(', ')}`)
      throw new Error(`分段 ${missing.missing_segments.join(', ')} 数据丢失，无法恢复录音`)
    }

    // 5. 从服务器获取最新的 uploaded_segment_count，设置 currentSegmentIndex
    try {
      const updatedJob = await recordingApi.getById(jobId)
      this.currentSegmentIndex = updatedJob.uploaded_segment_count || 0
    } catch {
      // 使用服务器之前的状态
      this.currentSegmentIndex = uploadedCount
    }

    // 6. Setup media stream and recorder
    const recorder = await this.setupMediaStream()

    // 6. Initialize recording info from recovered job
    const format = job.target_format || 'm4a'
    this.recordingInfo = {
      jobId: job.id,
      title: job.title,
      format,
      startTime: job.started_at || Date.now(),
      libraryId: job.library_id || '',
    }
    this.segmentStartTime = Date.now()  // 当前时间作为新 segment 开始时间
    this.baseOffsetMs = uploadedRecordedMs  // 已上传时长作为 offset 基准

    // 7. Restore duration from interrupted job
    this.duration = Math.floor(job.total_recorded_ms / 1000)

    // 8. Resume via API
    await recordingApi.updateState(jobId, 'resume')

    // 9. Start duration timer
    this.startDurationTimer()

    // 10. Start heartbeat
    this.startHeartbeat()

    // 11. Start recording
    recorder.start(TIMESLICE)

    return job.id
  }

  /**
   * Finish recording (stop recording + upload segments + finalize to merge)
   */
  async finish(): Promise<void> {
    if (!this.mediaRecorder || !this.mediaStream) {
      return
    }

    this.stopDurationTimer()
    this.stopHeartbeat()

    const recorder = this.mediaRecorder
    const stream = this.mediaStream
    const jobId = this.recordingInfo?.jobId

    // Wait for final data - ondataavailable may still be processing async operations
    await new Promise<void>((resolve) => {
      recorder.onstop = () => {
        // onstop fires immediately, but ondataavailable async work may still be running
        resolve()
      }
      recorder.stop()
    })

    // Stop all tracks
    stream.getTracks().forEach(track => track.stop())

    // Wait for ondataavailable async operations to complete
    while (this.isProcessingData) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    // Wait for upload queue to complete (all segments uploaded)
    while (this.uploadQueue.length > 0 || this.isUploading) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    // Finalize recording via API
    if (jobId) {
      // Upload any missing segments before finalizing
      await this.uploadMissingSegments(jobId)

      // 调用一次 finalize，轮询由 store 处理
      await this.callFinalize(jobId)

      await recordingIdbService.deleteDraft(jobId).catch(() => {
        // IDB cleanup failure is non-critical
      })
    }

    // Reset state
    this.resetState()
  }

  /**
   * 调用一次 finalize API
   * 不处理轮询，轮询逻辑交给 store 处理
   */
  private async callFinalize(jobId: string): Promise<void> {
    try {
      await recordingApi.finalize(jobId)
    } catch (error: any) {
      const httpStatus = error?.response?.status
      const errorCode = error?.response?.data?.code
      const errorMsg = error?.response?.data?.message || ''

      if (this.isFFmpegUnavailableError(error)) {
        throw new Error('录音功能暂不可用，请稍后在"我的录音"中查看')
      }

      if (httpStatus === HTTP_STATUS.INTERNAL_ERROR && errorMsg.includes('聚合状态不支持收口')) {
        throw new Error('录音聚合失败，请稍后在"我的录音"中查看')
      }

      // 处理中错误（分段还在处理）不抛出，让 store 轮询
      if (httpStatus === HTTP_STATUS.CONFLICT ||
          errorCode === API_ERROR_CODE.SEGMENT_PROCESSING ||
          errorMsg.includes('处理中') ||
          errorMsg.includes('finalizing')) {
        return
      }

      throw error
    }
  }

  /**
   * Subscribe to an event
   * @returns unsubscribe function
   */
  on(event: 'duration', handler: (duration: number) => void): () => void
  on(event: 'tick', handler: (data: { duration: number; recordingId: string }) => void): () => void
  on(event: 'chunkReady', handler: (chunk: { index: number; mimeType: string }) => void): () => void
  on(event: 'stopped', handler: (info: { fileId: number; jobId: string }) => void): () => void
  on(event: 'error', handler: (message: string) => void): () => void
  on(event: 'deviceDisconnected', handler: (trackLabel: string) => void): () => void
  on(event: 'memoryWarning', handler: (info: { usage: number; usedMB: number }) => void): () => void
  on(event: 'heartbeatError', handler: (failCount: number) => void): () => void
  on(event: 'maxDurationReached', handler: () => void): () => void
  on(event: EventType, handler: BridgeEventHandler): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    this.eventHandlers.get(event)!.add(handler)

    return () => {
      this.eventHandlers.get(event)?.delete(handler)
    }
  }

  /**
   * Destroy the bridge: stop recording and clear all state
   * Note: This is a synchronous cleanup. For graceful shutdown with data save,
   * use finish() or interrupt() instead.
   */
  destroy(): void {
    // Mark as destroyed first to prevent new async operations
    this.destroyed = true
    this.stopDurationTimer()
    this.stopHeartbeat()

    // Stop media recorder if recording
    // Note: stop() triggers ondataavailable, but since destroyed=true,
    // the data won't be saved. This is intentional for immediate cleanup.
    // Use interrupt() or finish() for graceful shutdown with data save.
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop()
    }

    // Stop all tracks
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop())
    }

    this.eventHandlers.clear()
    this.recordingInfo = null
    this.uploadRetryCount.clear()
    this.uploadQueue = []
    this.isUploading = false
    this.mediaRecorder = null
    this.mediaStream = null
  }

  /**
   * Interrupt recording (called when device disconnects)
   * Will upload remaining segments and mark as interrupted
   */
  async interrupt(): Promise<void> {
    if (!this.mediaRecorder || !this.mediaStream) {
      return
    }

    this.stopDurationTimer()
    this.stopHeartbeat()

    const recorder = this.mediaRecorder
    const stream = this.mediaStream
    const jobId = this.recordingInfo?.jobId

    // Stop recorder and wait for final data
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
      recorder.stop()
    })

    // Stop all tracks
    stream.getTracks().forEach(track => track.stop())

    // Wait for ondataavailable async operations to complete
    while (this.isProcessingData) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    // Wait for upload queue to complete
    while (this.uploadQueue.length > 0 || this.isUploading) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    // Mark as interrupted via API
    if (jobId) {
      try {
        await recordingApi.updateState(jobId, 'interrupt')
        this.emit('interrupted', { jobId })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        this.emit('error', `Failed to interrupt recording: ${errorMessage}`)
      }
      // 不删除 IDB，保留上传失败的 chunks，恢复时可以重试
      // 上传成功的 chunks 已在 uploadSegment 中删除
    }

    this.resetState()
  }

  /**
   * Get current recording info
   */
  getRecordingInfo(): RecordingInfo | null {
    return this.recordingInfo
  }

  // ============= Private Methods =============

  /**
   * Check if error indicates FFmpeg is unavailable
   */
  private isFFmpegUnavailableError(error: any): boolean {
    return error?.response?.status === HTTP_STATUS.SERVICE_UNAVAILABLE ||
           error?.response?.data?.code === API_ERROR_CODE.FFMPEG_UNAVAILABLE
  }

  /**
   * Check FFmpeg health before recording
   */
  private async checkFFmpegHealth(): Promise<void> {
    try {
      const ffmpegHealth = await recordingApi.getFfmpegHealth()
      if (!ffmpegHealth.available) {
        throw new Error('录音功能暂不可用，请稍后重试')
      }
    } catch (error: any) {
      if (this.isFFmpegUnavailableError(error)) {
        throw new Error('录音功能暂不可用，请稍后重试')
      }
      throw new Error('录音服务状态检查失败，请稍后重试')
    }
  }

  /**
   * Upload missing segments from IDB to server
   * @returns true if all missing segments were uploaded, false if some data was missing
   */
  private async uploadMissingSegments(jobId: string): Promise<void> {
    const missing = await recordingApi.getMissingSegments(jobId)
    if (!missing.missing_segments?.length) return

    const draft = await recordingIdbService.getDraft(jobId)
    if (!draft?.chunks.length) {
      throw new Error(`分段 ${missing.missing_segments.join(', ')} 数据丢失，无法恢复录音`)
    }

    for (const missingIndex of missing.missing_segments) {
      const chunk = draft.chunks.find(c => c.index === missingIndex)
      if (!chunk) {
        throw new Error(`分段 ${missingIndex} 数据丢失，无法恢复录音`)
      }

      const blob = new Blob([chunk.data], { type: 'audio/webm' })
      await recordingApi.uploadSegment({
        job_id: jobId,
        segment: blob,
        segment_index: missingIndex,
      })
      await recordingIdbService.removeChunk(jobId, missingIndex)
    }
  }

  /**
   * Setup MediaRecorder event handlers
   */
  private setupMediaRecorderHandlers(recorder: MediaRecorder): void {
    recorder.ondataavailable = async (event) => {
      if (this.destroyed) return
      // 如果正在处理中，跳过（防止并发导致 durationMs 计算错误）
      if (this.isProcessingData) return

      if (event.data.size > 0) {
        this.isProcessingData = true
        try {
          const now = Date.now()
          const durationMs = now - this.segmentStartTime
          const segmentIndex = this.currentSegmentIndex
          const segmentData = event.data

          // 立即更新，防止并发问题
          this.segmentStartTime = now
          this.currentSegmentIndex++

          const arrayBuffer = await segmentData.arrayBuffer()

          if (this.destroyed) return

          // offset = 已上传时长基准 + 新录音时长
          const startOffsetMs = this.baseOffsetMs
          const endOffsetMs = startOffsetMs + durationMs

          if (this.recordingInfo) {
            await recordingIdbService.addChunk(this.recordingInfo.jobId, {
              index: segmentIndex,
              data: arrayBuffer,
              durationMs,
              startOffsetMs,
              endOffsetMs,
            }).catch((err) => {
              console.warn('Failed to save chunk to IDB:', err)
            })
          }

          this.uploadQueue.push({
            index: segmentIndex,
            data: segmentData,
            mimeType: this.mimeType,
            durationMs,
            startOffsetMs,
            endOffsetMs,
          })
          this.baseOffsetMs = endOffsetMs  // 更新基准值，下一个 segment 从这里开始
          this.processUploadQueue()
        } finally {
          this.isProcessingData = false
        }
      }
    }

    recorder.onerror = (event) => {
      this.emit('error', `MediaRecorder error: ${(event as ErrorEvent).message}`)
    }
  }

  /**
   * Setup media stream and media recorder
   * Handles HTTPS check, microphone permission, device disconnect listener, and MediaRecorder creation
   * @returns The created MediaRecorder instance
   */
  private async setupMediaStream(): Promise<MediaRecorder> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('录音需要 HTTPS 环境。请使用 https:// 访问或在 localhost 下开发。')
    }

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true
      }
    })

    const audioTrack = this.mediaStream.getAudioTracks()[0]
    if (audioTrack) {
      audioTrack.onended = () => {
        this.emit('deviceDisconnected', audioTrack.label)
        this.interrupt().catch((error) => {
          this.emit('error', `Failed to interrupt after device disconnect: ${error}`)
        })
      }
    }

    this.mimeType = this.getSupportedMimeType()

    const recorder = new MediaRecorder(this.mediaStream, {
      mimeType: this.mimeType,
      audioBitsPerSecond: 128000
    })
    this.mediaRecorder = recorder
    this.setupMediaRecorderHandlers(recorder)
    return recorder
  }

  /**
   * Get the best supported MIME type for audio recording
   */
  private getSupportedMimeType(): string {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4;codecs=mp4a.40.2',
      'audio/mp4',
      'audio/ogg;codecs=opus'
    ]

    for (const candidate of candidates) {
      if (MediaRecorder.isTypeSupported(candidate)) {
        return candidate
      }
    }

    // Fallback to first candidate even if not officially supported
    return candidates[0]
  }

  /**
   * Start the duration timer
   */
  private startDurationTimer(): void {
    if (this.durationTimer) {
      clearInterval(this.durationTimer)
    }

    this.durationTimer = setInterval(() => {
      this.duration += 1
      this.emit('duration', this.duration)

      // Broadcast tick to other tabs via store (store handles channel broadcast)
      if (this.recordingInfo) {
        this.emit('tick', { duration: this.duration, recordingId: this.recordingInfo.jobId })
      }

      // Check memory periodically
      if (this.duration % 30 === 0) {
        this.checkMemory()
      }

      // Check max duration - auto end recording
      if (this.duration >= MAX_RECORDING_DURATION_SEC) {
        this.emit('maxDurationReached')
      }
    }, 1000)
  }

  /**
   * Stop the duration timer
   */
  private stopDurationTimer(): void {
    if (this.durationTimer) {
      clearInterval(this.durationTimer)
      this.durationTimer = null
    }
  }

  /**
   * Start heartbeat timer
   */
  private startHeartbeat(): void {
    this.stopHeartbeat()  // Ensure previous timer is stopped
    this.heartbeatActive = true

    this.heartbeatTimer = setInterval(async () => {
      if (!this.heartbeatActive || this.destroyed) return  // Stop if deactivated or destroyed

      if (this.recordingInfo?.jobId) {
        try {
          await recordingApi.heartbeat(this.recordingInfo.jobId)
          // Check again after async operation
          if (!this.heartbeatActive) return

          // Success: reset fail count
          if (this.heartbeatFailCount > 0) {
            this.heartbeatFailCount = 0
            this.emit('heartbeatError', 0)
          }
        } catch (err) {
          if (!this.heartbeatActive) return  // Don't emit if stopped

          this.heartbeatFailCount++
          console.warn(`Heartbeat failed (${this.heartbeatFailCount}/${RecordingBridge.HEARTBEAT_FAIL_THRESHOLD}):`, err)
          this.emit('heartbeatError', this.heartbeatFailCount)
        }
      }
    }, HEARTBEAT_INTERVAL)
  }

  /**
   * Stop heartbeat timer
   */
  private stopHeartbeat(): void {
    this.heartbeatActive = false  // Prevent async callback from executing
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /**
   * Check memory usage and warn if high
   */
  private checkMemory(): void {
    const memory = (performance as any).memory
    if (memory) {
      const usedMB = memory.usedJSHeapSize / (1024 * 1024)
      const usage = (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100

      if (usage > 80) {
        this.emit('memoryWarning', { usage, usedMB })
      }
    }
  }

  /**
   * Reset all state variables
   */
  private resetState(): void {
    this.mediaRecorder = null
    this.mediaStream = null
    this.recordingInfo = null
    this.duration = 0
    this.currentSegmentIndex = 0
    this.segmentStartTime = 0
    this.baseOffsetMs = 0
    this.mimeType = ''
    this.uploadRetryCount.clear()
    this.uploadQueue = []
    this.isUploading = false
    this.isProcessingData = false
    this.heartbeatFailCount = 0
  }

  // ============= Upload Queue =============

  private async processUploadQueue(): Promise<void> {
    if (this.isUploading) return
    if (this.uploadQueue.length === 0) return
    if (this.destroyed) return

    // Development check: ensure queue is ordered by index
    if (import.meta.env.DEV) {
      for (let i = 1; i < this.uploadQueue.length; i++) {
        if (this.uploadQueue[i].index < this.uploadQueue[i - 1].index) {
          console.warn(`[RecordingBridge] Upload queue out of order: ${this.uploadQueue[i - 1].index} -> ${this.uploadQueue[i].index}`)
        }
      }
    }

    this.isUploading = true

    try {
      while (this.uploadQueue.length > 0 && !this.destroyed) {
        const segment = this.uploadQueue.shift()!
        await this.uploadSegment(segment)
      }
    } finally {
      this.isUploading = false
    }
  }

  private async uploadSegment(segment: PendingSegment): Promise<void> {
    if (this.destroyed) return  // Don't upload if destroyed

    const retryCount = this.uploadRetryCount.get(segment.index) ?? 0

    try {
      await recordingApi.uploadSegment({
        job_id: this.recordingInfo!.jobId,
        segment: segment.data,
        segment_index: segment.index,
        duration_ms: segment.durationMs,
        start_offset_ms: segment.startOffsetMs,
        end_offset_ms: segment.endOffsetMs,
      })
      // 上传成功，删除 IDB chunk（数据已安全上传）
      this.uploadRetryCount.delete(segment.index)
      if (this.recordingInfo) {
        await recordingIdbService.removeChunk(this.recordingInfo.jobId, segment.index).catch(() => {})
      }
    } catch (error: any) {
      if (this.destroyed) return

      const httpStatus = error?.response?.status
      const errorCode = error?.response?.data?.code
      const errorMsg = error?.response?.data?.message || ''

      if (this.isFFmpegUnavailableError(error)) {
        this.uploadRetryCount.delete(segment.index)
        this.emit('error', '录音功能暂不可用，请稍后重试')
        return
      }

      if (httpStatus === HTTP_STATUS.CONFLICT) {
        if (errorMsg.includes('already exists') || errorMsg.includes('已存在') || errorMsg.includes('segment already')) {
          this.uploadRetryCount.delete(segment.index)
          // 409：服务器已有此 segment，删除 IDB chunk
          if (this.recordingInfo) {
            await recordingIdbService.removeChunk(this.recordingInfo.jobId, segment.index).catch(() => {})
          }
          return
        }
        if (retryCount < MAX_RETRIES) {
          this.uploadRetryCount.set(segment.index, retryCount + 1)
          await new Promise(resolve => setTimeout(resolve, 2000))
          if (!this.destroyed) {
            this.uploadQueue.unshift(segment)
          }
          return
        }
        this.uploadRetryCount.delete(segment.index)
        console.warn(`Segment ${segment.index} upload retry exhausted, finalize will handle missing check`)
        return
      }

      const isServerError = httpStatus === HTTP_STATUS.INTERNAL_ERROR || httpStatus === HTTP_STATUS.BAD_GATEWAY

      if (retryCount < MAX_RETRIES) {
        // Use longer delay for server errors
        let delay: number
        if (isServerError) {
          // For 500/502, wait longer to allow server to recover
          delay = Math.min(3000 + retryCount * 2000, 10000) // 3s, 5s, 7s, max 10s
        } else {
          // Exponential backoff for other errors
          delay = Math.pow(2, retryCount) * 1000
        }

        this.uploadRetryCount.set(segment.index, retryCount + 1)

        await new Promise((resolve) => setTimeout(resolve, delay))

        // Check again after delay
        if (this.destroyed) return

        // Re-enqueue at front for retry
        this.uploadQueue.unshift(segment)
      } else {
        // Max retries exceeded
        const errorMessage = error instanceof Error ? error.message : String(error)
        this.uploadRetryCount.delete(segment.index)
      }
    }
  }

  // ============= Event Emission =============

  private emit(event: 'duration', duration: number): void
  private emit(event: 'tick', data: { duration: number; recordingId: string }): void
  private emit(event: 'chunkReady', chunk: { index: number; mimeType: string }): void
  private emit(event: 'stopped', info: { fileId: number; jobId: string }): void
  private emit(event: 'interrupted', info: { jobId: string }): void
  private emit(event: 'error', message: string): void
  private emit(event: 'deviceDisconnected', trackLabel: string): void
  private emit(event: 'memoryWarning', info: { usage: number; usedMB: number }): void
  private emit(event: 'heartbeatError', failCount: number): void
  private emit(event: 'maxDurationReached'): void
  private emit(event: EventType, ...args: unknown[]): void {
    const handlers = this.eventHandlers.get(event)
    if (!handlers) return

    for (const handler of handlers) {
      try {
        ;(handler as (...a: unknown[]) => void)(...args)
      } catch (error) {
        console.error(`[RecordingBridge] Error in ${event} handler:`, error)
      }
    }
  }
}

export default RecordingBridge
