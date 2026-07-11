import React from 'react'
import { create } from 'zustand'
import { message, Modal } from 'antd'
import { RecordingBridge } from '@/services/recording-bridge'
import { recordingChannel } from '@/services/recording-channel'
import { wakeLockService } from '@/services/wake-lock'
import { recordingApi } from '@/api/modules/recording'
import { RecordingStateAction } from '@/api/modules/recording/types'
import { MAX_RECORDING_DURATION_HOURS } from '@/constants/recording'

// ============= Type Definitions =============

export type RecordingStatus = 'idle' | 'recording' | 'paused' | 'interrupted' | 'finalizing'

export interface InterruptedJobInfo {
  id: string
  title: string
  durationSec: number
}

export interface RecordingState {
  // State fields
  status: RecordingStatus
  duration: number
  jobId: string | null
  libraryId: string | null
  startTime: number | null
  floatVisible: boolean
  networkOffline: boolean
  segmentCount: number
  uploadedSegmentCount: number
  totalRecordedMs: number
  interruptedJob: InterruptedJobInfo | null  // 中断的任务信息
  heartbeatFailCount: number      // 心跳连续失败计数
  heartbeatError: boolean         // 心跳连续失败 3 次标记
  isTransitioning: boolean        // 状态切换中（防止快速点击）
  _bridge: RecordingBridge | null
  blockedByOtherTab: boolean       // 被其他正在录音的标签页阻塞

  // Actions
  start: (showFloat?: boolean) => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  finish: () => Promise<void>
  setDuration: (d: number) => void
  showFloat: () => void
  hideFloat: () => void
  setFloatVisible: (visible: boolean) => void
  fetchActive: (showFloat?: boolean) => Promise<void>
  setRecordingState: (action: RecordingStateAction) => Promise<void>
  _setNetworkOffline: (offline: boolean) => void
  _setHeartbeatFail: (failCount: number) => void
  _resetHeartbeatError: () => void
  recoverInterrupted: (showFloatOnStart?: boolean) => Promise<void>
  interrupt: () => Promise<void>
  _onWakeLockReleased: () => void
  _onRecordingInterrupted: (gap: number) => void
  _initChannelListeners: () => void
  _cleanup: () => void
  _setBlockedByOtherTab: (blocked: boolean) => void
  _finalizeWithRetry: (jobId: string, skipFinalizeCall?: boolean) => Promise<void>
}

// ============= Helper Functions =============

/** Register common bridge event handlers */
function registerBridgeHandlers(bridge: RecordingBridge) {
  bridge.on('duration', (duration: number) => {
    useRecordingStore.getState().setDuration(duration)
  })

  bridge.on('tick', (data: { duration: number; recordingId: string }) => {
    // Broadcast tick to other tabs
    recordingChannel.broadcast({
      type: 'RECORDING_TICK',
      duration: data.duration,
      recordingId: data.recordingId
    })
  })

  bridge.on('error', (errorMsg: string) => {
    errorMsg && message.error(errorMsg)
  })

  bridge.on('deviceDisconnected', (trackLabel: string) => {
    message.warning(`录音设备已断开: ${trackLabel}`)
  })

  bridge.on('memoryWarning', (info: { usage: number; usedMB: number }) => {
    message.warning(`内存使用较高 (${info.usedMB.toFixed(1)}MB)，建议尽快停止录音`)
  })

  bridge.on('heartbeatError', (failCount: number) => {
    useRecordingStore.getState()._setHeartbeatFail(failCount)
  })

  bridge.on('interrupted', (data: { jobId: string }) => {
    const state = useRecordingStore.getState()
    wakeLockService.release()

    useRecordingStore.setState({
      status: 'interrupted',
      interruptedJob: {
        id: data.jobId,
        title: state.jobId || '录音任务',
        durationSec: state.duration
      },
      _bridge: null
    })

    recordingChannel.broadcast({
      type: 'RECORDING_STOPPED'
    })

    message.warning('录音设备已断开，录音已中断')
  })

  bridge.on('maxDurationReached', () => {
    message.warning(`录音已达上限(${MAX_RECORDING_DURATION_HOURS}小时)，正在自动结束...`)
    useRecordingStore.getState().finish()
  })
}

/** Get reset state object for idle status */
function getIdleResetState(): Partial<RecordingState> {
  return {
    status: 'idle',
    duration: 0,
    jobId: null,
    libraryId: null,
    startTime: null,
    floatVisible: false,
    segmentCount: 0,
    uploadedSegmentCount: 0,
    totalRecordedMs: 0,
    interruptedJob: null,
    _bridge: null,
    heartbeatFailCount: 0,
    heartbeatError: false,
    isTransitioning: false,
    blockedByOtherTab: false
  }
}

/** Handle permission/media errors with user-friendly messages */
function handleMediaError(error: unknown): string {
  const errorMsg = error instanceof Error ? error.message : String(error)
  const errorName = (error as any)?.name || ''

  // Only treat as permission error if it's specifically a media access denial
  if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
    return '麦克风权限被拒绝，请在浏览器设置中允许麦克风访问'
  }
  // Check for specific permission denied messages (not generic "Permission" keyword)
  if (errorMsg.includes('Permission denied') || errorMsg.includes('permission denied') || errorMsg.includes('用户拒绝') || errorMsg.includes('权限被拒绝')) {
    return '麦克风权限被拒绝，请在浏览器设置中允许麦克风访问'
  }
  if (errorName === 'NotFoundError') {
    return '未检测到麦克风设备，请连接麦克风后重试'
  }
  if (errorName === 'NotReadableError' || errorName === 'TrackStartError') {
    return '麦克风被其他应用占用，请关闭其他应用后重试'
  }
  return errorMsg
}

/** Auto-pause recording and show warning modal */
function autoPauseRecording(title: string, content: string) {
  const state = useRecordingStore.getState()
  // Don't auto-pause if already transitioning or not recording
  if (state.isTransitioning || state.status !== 'recording' || !state._bridge) {
    return
  }

  state._bridge.pause()
  wakeLockService.release()
  useRecordingStore.setState({ status: 'paused' })

  recordingChannel.broadcast({
    type: 'RECORDING_PAUSED',
    duration: state.duration,
    recordingId: state.jobId!
  })

  Modal.warning({
    title,
    content
  })
}

/** Handle active job state - shared by start and fetchActive */
async function handleActiveJob(job: any, showFloat: boolean): Promise<boolean> {
  const durationSec = Math.floor(job.total_recorded_ms / 1000)
  const store = useRecordingStore.getState()

  // recording 状态视为中断，因为前端没有 bridge 无法控制
  if (job.status === 'recording') {
    // 调用后端接口修改状态为 interrupt
    try {
      await recordingApi.updateState(job.id, 'interrupt')
    } catch (error) {
      console.error('Failed to update recording state to interrupt:', error)
    }
    useRecordingStore.setState({
      status: 'interrupted',
      jobId: job.id,
      duration: durationSec,
      interruptedJob: { id: job.id, title: job.title || '未知', durationSec },
      floatVisible: showFloat
    })
    return true
  }

  if (job.status === 'paused') {
    useRecordingStore.setState({
      status: 'paused',
      jobId: job.id,
      totalRecordedMs: job.total_recorded_ms,
      duration: durationSec,
      segmentCount: job.segment_count,
      uploadedSegmentCount: job.uploaded_segment_count,
      floatVisible: showFloat
    })
    return true
  }

  if (job.status === 'interrupted') {
    useRecordingStore.setState({
      status: 'interrupted',
      jobId: job.id,
      duration: durationSec,
      interruptedJob: { id: job.id, title: job.title || '未知', durationSec },
      floatVisible: showFloat
    })
    return true
  }

  if (job.status === 'finalizing' || job.status === 'finalizing_processing') {
    useRecordingStore.setState({
      status: 'finalizing',
      jobId: job.id,
      duration: durationSec,
      floatVisible: showFloat,
      isTransitioning: true
    })
    await store._finalizeWithRetry(job.id, true)
    return true
  }

  return false
}

export const useRecordingStore = create<RecordingState>((set, get) => ({
  // ============= State Fields =============
  status: 'idle',
  duration: 0,
  jobId: null,
  libraryId: null,
  startTime: null,
  floatVisible: false,
  networkOffline: false,
  segmentCount: 0,
  uploadedSegmentCount: 0,
  totalRecordedMs: 0,
  interruptedJob: null,
  heartbeatFailCount: 0,
  heartbeatError: false,
  isTransitioning: false,
  blockedByOtherTab: false,
  _bridge: null,

  // ============= Actions =============

  start: async (showFloat: boolean = true) => {
    const state = get()

    // Prevent rapid clicks
    if (state.isTransitioning) return

    // Guard: already in progress
    if (state.status !== 'idle') {
      message.warning('录音正在进行中')
      return
    }

    // Guard: blocked by other tab's recording
    if (state.blockedByOtherTab) {
      message.warning('其他标签页正在录音中，请先停止该录音')
      return
    }

    // Check if backend has an active recording job
    try {
      const activeJob = await recordingApi.getActive()
      if (activeJob && await handleActiveJob(activeJob, showFloat)) {
        return
      }
    } catch {
      // getActive failed, proceed to start new recording
    }

    // Check if another tab is recording
    const { busy } = await recordingChannel.checkOtherTabRecording()
    if (busy) {
      message.warning('其他标签页正在录音中，请先停止其他录音')
      return
    }

    // Check microphone permission
    try {
      const permissionStatus = await navigator.permissions.query({
        name: 'microphone' as PermissionName
      })
      if (permissionStatus.state === 'denied') {
        message.error('麦克风权限被拒绝，请在浏览器设置中允许麦克风访问')
        return
      }
      // Notify user if they will be prompted for permission
      if (permissionStatus.state === 'prompt') {
        message.info('请允许浏览器访问麦克风以开始录音', 3)
      }
    } catch {
      // permissions.query may not be supported for microphone on all browsers;
      // proceed and let getUserMedia handle it downstream
    }

    // Request WakeLock to keep screen on
    wakeLockService.request()

    // Create new RecordingBridge
    const bridge = new RecordingBridge()

    // Register event handlers
    registerBridgeHandlers(bridge)

    try {
      // Start recording via bridge
      const jobId = await bridge.start()
      const info = bridge.getRecordingInfo()
      const recordingStartTime = Date.now()

      set({
        status: 'recording',
        jobId,
        libraryId: info?.libraryId || null,
        startTime: recordingStartTime,
        duration: 0,
        floatVisible: showFloat,
        _bridge: bridge
      })

      // Set this tab as the main recorder
      recordingChannel.setAsMainRecorder()

      // Broadcast recording started to other tabs
      recordingChannel.broadcast({
        type: 'RECORDING_STARTED',
        recordingId: jobId,
        startTime: recordingStartTime
      })
    } catch (error: any) {
      // Start failed - clean up
      bridge.destroy()
      wakeLockService.release()

      const errorMsg = error?.message || ''

      if (errorMsg === '功能已被停用，请刷新页面后重试') {
        message.warning(errorMsg)
      } else {
        const displayMsg = handleMediaError(error)
        message.error(`录音启动失败: ${displayMsg}`)
      }
    }
  },

  pause: async (showFloat: boolean = true) => {
    const state = get()
    if (state.status !== 'recording') return
    if (state.isTransitioning) return

    set({ isTransitioning: true })
    state._bridge?.pause()
    wakeLockService.release()

    set({ status: 'paused', isTransitioning: false })

    recordingChannel.broadcast({
      type: 'RECORDING_PAUSED',
      duration: state.duration,
      recordingId: state.jobId!
    })
  },

  resume: async (showFloat: boolean = true) => {
    const state = get()
    if (state.status !== 'paused') return
    if (state.isTransitioning) return

    set({ isTransitioning: true })

    // If no bridge (e.g., after page refresh), use recover logic
    if (!state._bridge) {
      if (!state.jobId) {
        set({ status: 'idle', duration: 0, jobId: null, floatVisible: false, isTransitioning: false })
        return
      }

      // Use recoverInterrupted logic for paused state after refresh
      wakeLockService.request()

      const bridge = new RecordingBridge()

      // Register event handlers
      registerBridgeHandlers(bridge)

      try {
        await bridge.recover(state.jobId)

        set({
          status: 'recording',
          _bridge: bridge,
          floatVisible: showFloat
        })

        recordingChannel.setAsMainRecorder()
        recordingChannel.broadcast({
          type: 'RECORDING_STARTED',
          recordingId: state.jobId,
          startTime: Date.now()
        })

        get()._resetHeartbeatError()
        set({ isTransitioning: false })
        message.success('录音已恢复')
      } catch (error) {
        bridge.destroy()
        wakeLockService.release()

        const errorMsg = handleMediaError(error)
        set({ isTransitioning: false })
        message.error(`恢复录音失败: ${errorMsg}`)
      }
      return
    }

    // Normal resume with existing bridge
    wakeLockService.request()
    state._bridge.resume()

    set({ status: 'recording', isTransitioning: false, floatVisible: showFloat })

    recordingChannel.broadcast({
      type: 'RECORDING_RESUMED',
      recordingId: state.jobId!
    })
  },

  finish: async (showFloat: boolean = true) => {
    const state = get()
    if (state.status === 'idle') return
    if (state.isTransitioning) return

    // Set finalizing state before API call
    set({ status: 'finalizing', isTransitioning: true })

    wakeLockService.release()

    if (!state.jobId) {
      set({ status: 'idle', duration: 0, jobId: null, floatVisible: false, isTransitioning: false })
      return
    }
    const jobId = state.jobId

    // If have bridge, call bridge.finish() (stop recording, upload segments, call finalize once)
    if (state._bridge) {
      try {
        await state._bridge.finish()
      } catch (error: any) {
        const errorMsg = error?.response?.data?.message || error?.message || ''
        message.error(errorMsg || '录音结束失败')
        set(getIdleResetState())
        recordingChannel.broadcast({ type: 'RECORDING_STOPPED' })
        state._bridge.destroy()
        return
      }
      // bridge 已调用 finalize，跳过 finalize 调用，只轮询状态
      await get()._finalizeWithRetry(jobId, true)
      return
    }

    // No bridge: call finalize + poll status
    await get()._finalizeWithRetry(jobId, false)
  },

  setDuration: (d: number) => {
    set({ duration: d })
  },

  showFloat: () => {
    const state = get()
    if (state.status !== 'idle') {
      set({ floatVisible: true })
    }
  },

  hideFloat: () => {
    set({ floatVisible: false })
  },

  setFloatVisible: (visible: boolean) => {
    set({ floatVisible: visible })
  },

  fetchActive: async (showFloat = true) => {
    try {
      const currentState = get()

      // If we're already recording with an active bridge, don't override our state
      if (currentState._bridge && currentState.status !== 'idle') {
        return
      }

      const job = await recordingApi.getActive()
      if (!job) return

      await handleActiveJob(job, showFloat)
    } catch (error) {
      console.error('Failed to fetch active recording:', error)
    }
  },

  setRecordingState: async (action: RecordingStateAction) => {
    const state = get()
    if (state.jobId) {
      try {
        await recordingApi.updateState(state.jobId, action)
        message.success('已修改')
      } catch {
        message.error('失败，请稍后重试')
        return
      }
    }
    set({
      status: 'idle',
      jobId: null,
      duration: 0,
      interruptedJob: null,
      floatVisible: false
    })
  },

  recoverInterrupted: async (showFloatOnStart = true) => {
    const state = get()

    // Guard: must have interrupted job
    if (state.status !== 'interrupted' || !state.interruptedJob) {
      message.warning('没有可恢复的录音任务')
      return
    }

    if (state.isTransitioning) return
    set({ isTransitioning: true })

    const jobId = state.interruptedJob.id

    // Request WakeLock
    wakeLockService.request()

    // Create new RecordingBridge
    const bridge = new RecordingBridge()

    // Register event handlers
    registerBridgeHandlers(bridge)

    bridge.on('stopped', (info: { fileId: number; jobId: string }) => {
      // Handled by stop action
    })

    try {
      // Recover recording via bridge
      await bridge.recover(jobId)

      // Calculate duration from interrupted job
      const startDuration = state.interruptedJob.durationSec

      set({
        status: 'recording',
        jobId,
        duration: startDuration,
        interruptedJob: null,
        floatVisible: showFloatOnStart,
        _bridge: bridge,
        isTransitioning: false
      })

      // Set this tab as the main recorder
      recordingChannel.setAsMainRecorder()

      // Broadcast recording recovered
      recordingChannel.broadcast({
        type: 'RECORDING_STARTED',
        recordingId: jobId,
        startTime: Date.now()
      })

      // Reset heartbeat error state
      get()._resetHeartbeatError()

      message.success('录音已恢复')
    } catch (error) {
      // Recovery failed
      bridge.destroy()
      wakeLockService.release()

      set({ isTransitioning: false })
      const errorMsg = handleMediaError(error)
      message.error(`恢复录音失败: ${errorMsg}`)
    }
  },

  interrupt: async () => {
    const state = get()

    // Guard: must have an active job
    if (!state.jobId || state.status === 'idle') {
      return
    }

    const jobId = state.jobId

    // Use bridge.interrupt() for graceful shutdown with data save
    // This ensures the current segment data is uploaded before marking as interrupted
    if (state._bridge) {
      try {
        await state._bridge.interrupt()
      } catch (error) {
        // interrupt() handles its own errors, but catch to prevent unhandled rejection
        console.error('Bridge interrupt failed:', error)
      }
    } else {
      // No bridge, just call API directly
      try {
        await recordingApi.updateState(jobId, 'interrupt')
      } catch (error) {
        console.error('Failed to notify server about interrupt:', error)
      }
    }

    wakeLockService.release()

    // Reset state
    set(getIdleResetState())

    // Broadcast recording stopped
    recordingChannel.broadcast({
      type: 'RECORDING_STOPPED'
    })
  },

  _setNetworkOffline: (offline: boolean) => {
    set({ networkOffline: offline })

    // Auto-pause recording when network goes offline
    if (offline) {
      autoPauseRecording('网络断开', '网络已断开，录音已自动暂停。请检查网络连接后点击"继续"恢复录音。')
    }
  },

  _setHeartbeatFail: (failCount: number) => {
    const heartbeatError = failCount >= 3
    set({
      heartbeatFailCount: failCount,
      heartbeatError
    })

    // Auto-pause recording when heartbeat fails 3 times
    if (heartbeatError) {
      autoPauseRecording('网络异常', '心跳连续失败，录音已自动暂停。请检查网络连接后点击"继续"恢复录音。')
    }
  },

  _resetHeartbeatError: () => {
    set({
      heartbeatFailCount: 0,
      heartbeatError: false
    })
  },

  _onWakeLockReleased: () => {
    const state = get()
    if (state.status === 'recording') {
      // Try to re-request the wake lock
      wakeLockService.request()
    }
  },

  _onRecordingInterrupted: (gap: number) => {
    const state = get()
    if (state.status === 'recording') {
      state._bridge?.pause()
      wakeLockService.release()
      set({ status: 'paused' })

      recordingChannel.broadcast({
        type: 'RECORDING_PAUSED',
        duration: state.duration,
        recordingId: state.jobId!
      })
    }

    Modal.warning({
      title: '录音中断',
      content: `录音因系统原因中断了 ${gap} 秒，已自动暂停。您可以手动恢复录音。`
    })
  },

  _initChannelListeners: () => {
    const state = get()

    // Another tab started recording - mark as blocked, don't show float
    recordingChannel.on('recordingStarted', (data) => {
      const currentState = get()
      // Don't override our own state if we're the one recording
      if (currentState._bridge) return

      set({
        blockedByOtherTab: true,  // Block this tab from recording
        // Don't set status, floatVisible, or jobId - passive tab should stay idle
        // and not show the recording float
      })
    })

    // Tick from the main recorder tab - ignored by passive tabs
    // (Passive tabs don't show duration, no handler needed)

    // Recording paused in another tab - ignored by passive tabs
    // (Passive tabs stay idle and blocked, no handler needed)

    // Recording resumed in another tab - ignored by passive tabs
    // (Passive tabs stay idle and blocked, no handler needed)

    // Recording stopped in another tab
    recordingChannel.on('recordingStopped', () => {
      set({
        status: 'idle',
        duration: 0,
        jobId: null,
        startTime: null,
        floatVisible: false,
        _bridge: null,
        blockedByOtherTab: false  // Unblock when recording stops elsewhere
      })
    })

    // Another tab is querying if we are recording
    recordingChannel.on('queryStatus', (data) => {
      const currentState = get()
      if (currentState.status !== 'idle' && currentState.jobId) {
        recordingChannel.respondQuery(data.requestId, true, currentState.jobId)
      }
    })
  },

  _cleanup: () => {
    const state = get()
    state._bridge?.destroy()
    set(getIdleResetState())
  },

  _setBlockedByOtherTab: (blocked: boolean) => {
    set({ blockedByOtherTab: blocked })
  },

  _finalizeWithRetry: async (jobId: string, skipFinalizeCall = false) => {
    const maxPolls = 20
    const baseInterval = 3000
    const maxInterval = 60000

    // 1. 调用 finalize（如果 bridge 已经调用过则跳过）
    if (!skipFinalizeCall) {
      try {
        await recordingApi.finalize(jobId)
      } catch (error: any) {
        const errorCode = error?.response?.data?.code
        const errorMsg = error?.response?.data?.message || ''

        // 非处理中错误，直接失败
        if (errorCode !== 14 && errorCode !== 100401 && !errorMsg.includes('处理中')) {
          message.error(errorMsg || '录音结束失败')
          set(getIdleResetState())
          return
        }
        // 处理中错误，继续轮询
      }
    }

    // 2. 轮询 getRecordingById 获取状态（仅在首次显示处理提示）
    let processingToastShown = false
    for (let i = 0; i < maxPolls; i++) {
      try {
        const job = await recordingApi.getById(jobId)
        if (job.status === 'completed' && job.output_file_id > 0) {
          set(getIdleResetState())
          recordingChannel.broadcast({ type: 'RECORDING_STOPPED' })
          get()._bridge?.destroy()
          message.success(
            React.createElement('span', null,
              '录音保存成功，前往 ',
              React.createElement('a', { href: '/mine?tab=audio', style: { color: '#1890ff' } }, '我的录音'),
              ' 查看'
            )
          )
          return
        }
        if (job.status === 'failed') {
          message.error(job.last_error || '录音处理失败')
          set(getIdleResetState())
          get()._bridge?.destroy()
          return
        }
        // 仍在处理中，仅显示一次提示
        if (!processingToastShown) {
          message.info('分段正在处理中，请稍候...')
          processingToastShown = true
        }
        // 指数递增：baseInterval * 2^i，上限 maxInterval
        const currentInterval = Math.min(baseInterval * Math.pow(2, i), maxInterval)
        await new Promise(resolve => setTimeout(resolve, currentInterval))
      } catch (error: any) {
        const errorMsg = error?.response?.data?.message || ''
        message.error(errorMsg || '获取录音状态失败')
        set(getIdleResetState())
        get()._bridge?.destroy()
        return
      }
    }
    message.warning('处理时间较长，请稍后在"我的录音"中查看')
    get()._bridge?.destroy()
  }
}))
