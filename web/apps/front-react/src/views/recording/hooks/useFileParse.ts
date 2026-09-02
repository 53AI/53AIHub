import { useState, useRef, useEffect, useCallback } from 'react';
import filesApi from '@/api/modules/files';
import recordingApi from '@/api/modules/recording';
import type { RecordingFileSummary, FileParseStatus, StageStatus } from '@/api/modules/recording/types';
import { usePoll } from '@/hooks/usePoll';
import { parsePageJson, parseTranscriptLines } from '../parsers/recordingParsers';
import type { TranscriptItem } from '../parsers/recordingParsers';
import {
  STAGE_STATUS,
  isStageDone,
  isStageLoading,
  isStageFailed,
  isStageFailedOnly,
} from '../constants/recordingStatus';

/** 各阶段的 stage 包（透传 StageStatus 全部字段，UI 按需读取） */
export interface StageStatusBag {
  transcription?: StageStatus
  meetingMinutes?: StageStatus
  insights?: StageStatus
  insightPage?: StageStatus
}

/** 转写条目类型定义已下沉到 recordingParsers，这里再导出保持既有引用路径可用 */
export type { TranscriptItem }

export interface UseFileParseResult {
  transcriptList: TranscriptItem[]
  insightSummary: Record<string, any>
  /** 页面编排结果（第四阶段完成后的决策页面 JSON） */
  insightPageJson: Record<string, any> | null
  fileSummaries: RecordingFileSummary[]
  fileSummariesLoading: boolean
  isFailed: boolean
  isBeingParsed: boolean
  /** 首次加载（切文件时重新加载）是否已完成 — 用于避免切换瞬间显示空状态 */
  initialLoadDone: boolean
  transcriptionStatus: string
  meetingMinutesStatus: string
  insightsStatus: string
  insightPageStatus: string
  /** 各阶段的完整 StageStatus 包（含 status/error_type 等），按需透传 */
  stageStatuses: StageStatusBag
  /** 重置失败状态，重新开始轮询（用户点击"继续生成"后调用） */
  resetFailed: () => void
  /** 清空旧洞察并开始等待带背景的新洞察/页面编排结果 */
  startInsightRegeneration: () => void
  /** 手动刷新总结列表 */
  loadFileSummaries: (id: string) => Promise<void>
  /** 更新单条总结（轮询场景下回填 processing → completed/failed） */
  updateSummary: (summary: RecordingFileSummary) => void
  /** 页面编排接口（getInsightPage）是否已结束（成功或失败都算结束） */
  insightPageApiDone: boolean
}

interface UseFileParseOptions {
  fileId?: string
  shouldPoll?: boolean
  /** 外部已取到的解析状态，避免重复请求 parseStatus */
  initialParseStatus?: FileParseStatus | null
  /**
   * 跳过 insights / insight_page 阶段：
   * - 不发 filesApi.get 拉 insight_summary 降级数据
   * - 不发 recordingApi.getInsightPage 拉页面编排
   * - 不让 insights / insight_page 状态影响 isBeingParsed / isFailed / 轮询停止条件
   * 用于不展示洞察 Tab 的视图（如库视图 mp3 只展示「纪要 / 转写 / 撰写」）。
   */
  skipInsight?: boolean
}

/**
 * 合并新旧 stage：只对 status 字段做"已完成不被回退"保护，其他字段（error_type/...）直接用新值覆盖。
 * 返回 undefined 表示新值无效，应保留旧值不变。
 */
function mergeStage(previous: StageStatus | undefined, next: StageStatus | undefined): StageStatus | undefined {
  if (!next) return previous
  const prevStatus = previous?.status ?? ''
  const nextStatus = next.status ?? ''
  const protectedStatus = isStageDone(prevStatus) && isStageLoading(nextStatus)
    ? prevStatus
    : nextStatus
  return { ...next, status: protectedStatus }
}

/** 合并新旧 stage 包 */
function mergeStageBag(prev: StageStatusBag, next: StageStatusBag): StageStatusBag {
  return {
    transcription: mergeStage(prev.transcription, next.transcription),
    meetingMinutes: mergeStage(prev.meetingMinutes, next.meetingMinutes),
    insights: mergeStage(prev.insights, next.insights),
    insightPage: mergeStage(prev.insightPage, next.insightPage),
  }
}

/** 我的录音旧数据：转录和洞察都完成，其他阶段都是 pending */
function isLegacyCompleteData(
  transStatus: string,
  insightStatus: string,
  minutesStatus: string,
  pageStatus: string,
): boolean {
  return isStageDone(transStatus)
    && isStageDone(insightStatus)
    && minutesStatus === STAGE_STATUS.Pending
    && pageStatus === STAGE_STATUS.Pending
}

/** 任一阶段处于失败态（含 transcription 的 disabled） */
function hasAnyStageFailure(
  transStatus: string,
  minutesStatus: string,
  insightStatus: string,
  pageStatus: string,
): boolean {
  return isStageFailed(transStatus)
    || isStageFailedOnly(minutesStatus)
    || isStageFailedOnly(insightStatus)
    || isStageFailedOnly(pageStatus)
}

/** 解析一帧状态的决策：continue 继续轮询，stop 已到终态应停止 */
type SnapshotDecision = 'continue' | 'stop'

export function useFileParse({ fileId, shouldPoll = true, initialParseStatus, skipInsight = false }: UseFileParseOptions): UseFileParseResult {
  const [transcriptList, setTranscriptList] = useState<TranscriptItem[]>([])
  const [isFailed, setIsFailed] = useState(false)

  /** 各阶段完整 stage 状态包（status/error_type 等），按需透传 */
  const [stageStatuses, setStageStatuses] = useState<StageStatusBag>({})

  // 派生：4 个 status 字符串。已完成状态不会被后续轮询回退到 pending/parsing/processing
  //（防回退语义下沉在 mergeStage）。
  const transcriptionStatus = stageStatuses.transcription?.status ?? ''
  const meetingMinutesStatus = stageStatuses.meetingMinutes?.status ?? ''
  const insightsStatus = stageStatuses.insights?.status ?? ''
  const insightPageStatus = stageStatuses.insightPage?.status ?? ''

  const [insightSummary, setInsightSummary] = useState<Record<string, any>>({})
  const [insightPageJson, setInsightPageJson] = useState<Record<string, any> | null>(null)
  const [fileSummaries, setFileSummaries] = useState<RecordingFileSummary[]>([])

  const stopPollRef = useRef<() => void>(() => {})
  const startPollRef = useRef<() => void>(() => {})
  const shouldStopPollRef = useRef(false)
  const loadedStagesRef = useRef({ transcription: false, minutes: false, insights: false, insightPage: false })
  const skipFailedCheckRef = useRef(false)
  const forcePollRef = useRef(false)  // resetFailed 后强制继续轮询，直到后端真正开始处理
  const isOldCompleteRef = useRef(false)  // 旧数据兼容：转录和洞察都成功，其他阶段都是 pending
  const isRegenerationRef = useRef(false)  // 重新生成流程标记，用于在转写完成后加延迟等待后端就绪
  const [initialLoadDone, setInitialLoadDone] = useState(false)

  // 是否正在加载 fileSummaries（用于 sum-* tab 的 loading 态）
  const [fileSummariesLoading, setFileSummariesLoading] = useState(true)

  // 页面编排接口（getInsightPage）是否已完成请求（无论成功失败）— 用于区分「请求中」与「请求结束但无数据」
  const [insightPageApiDone, setInsightPageApiDone] = useState(false)

  // 获取总结列表
  const loadFileSummaries = useCallback(async (id: string) => {
    setFileSummariesLoading(true)
    try {
      const summaries = await recordingApi.getFileSummaries(id)
      setFileSummaries(summaries)
    } catch (e) {
      console.warn('[useFileParse] getFileSummaries failed', e)
    } finally {
      setFileSummariesLoading(false)
    }
  }, [])

  // 更新或插入单条总结（按 id 匹配：找到则替换，找不到则追加），用于轮询场景下回填 processing → completed/failed，
  // 同时承担 createFileSummary 返回后把新记录同步到列表的职责
  const updateSummary = useCallback((summary: RecordingFileSummary) => {
    setFileSummaries((prev) => {
      const idx = prev.findIndex((s) => s.id === summary.id)
      if (idx === -1) return [...prev, summary]
      const next = prev.slice()
      next[idx] = summary
      return next
    })
  }, [])

  /** 拉取转写并写入 transcriptList
   * 改用 /transcription/export 导出接口：后端统一把 DashScope JSON 渲染为
   * `[hh:mm:ss] 说话人: 内容` 格式的 Markdown，前端用 parseTranscriptLines
   * 还原为 TranscriptItem 列表。原 getTranscription 偶尔返回空 content
   * （「状态 normal 但内容空」），导出接口是后端预渲染的稳定产物，能避免空内容。
   * 复用同一份 Markdown，与「导出转写」按钮同源，解析口径完全一致。
   */
  const loadTranscription = useCallback(async (id: string) => {
    try {
      const exportRes = await recordingApi.exportTranscription(id)
      if (exportRes?.markdown) {
        setTranscriptList(parseTranscriptLines(exportRes.markdown))
      }
    } catch (e) {
      // 转写接口失败，不阻塞后续阶段
      console.warn('[useFileParse] exportTranscription failed', e)
    }
  }, [])

  /** 从文件详情降级读取 insight_summary */
  const loadInsightSummaryFromFile = useCallback(async (id: string) => {
    try {
      const fileData = await filesApi.get(id)
      if (fileData?.insight_summary) {
        setInsightSummary(parsePageJson(fileData.insight_summary))
      }
    } catch (e) {
      console.warn('[useFileParse] filesApi.get (insight summary) failed', e)
    }
  }, [])

  /** 拉取页面编排结果 */
  const loadInsightPage = useCallback(async (id: string) => {
    try {
      const pageData = await recordingApi.getInsightPage(id)
      if (pageData?.page_json) {
        setInsightPageJson(parsePageJson(pageData.page_json))
      }
    } catch (e) {
      // 获取失败时降级使用 insightSummary
      console.warn('[useFileParse] getInsightPage failed', e)
    }
  }, [])

  /**
   * 统一处理一次解析状态快照：合并 stage 状态 + 按完成阶段加载对应数据 + 判定失败与是否停止轮询。
   * 首帧（外部传入的 initialParseStatus / 挂载首次拉取）与轮询帧共用同一套判定，避免两套实现漂移。
   * 返回 'stop' 表示该帧已到终态（全部完成 / 失败 / 旧数据），应停止轮询。
   */
  const processSnapshot = useCallback(async (
    status: FileParseStatus,
    fileId: string,
    opts: { summariesPreloaded?: boolean } = {},
  ): Promise<SnapshotDecision> => {
    const trans = status.transcription
    const minutes = status.meeting_minutes
    const insights = status.insights
    const page = status.insight_page

    setStageStatuses((prev) => mergeStageBag(prev, {
      transcription: trans,
      meetingMinutes: minutes,
      insights,
      insightPage: page,
    }))

    const transStatus = trans?.status ?? ''
    const minutesStatus = minutes?.status ?? ''
    const insightStatus = insights?.status ?? ''
    const pageStatus = page?.status ?? ''

    // 任一阶段失败（含 transcription 的 disabled）。skipInsight 只关心 trans / minutes。
    const failureDetected = skipInsight
      ? isStageFailed(transStatus) || isStageFailed(minutesStatus)
      : hasAnyStageFailure(transStatus, minutesStatus, insightStatus, pageStatus)

    // 失败兜底：forcePoll 期间 / 单次跳过时继续轮询，否则标记失败并停止
    const decideFailure = (): SnapshotDecision => {
      if (forcePollRef.current) return 'continue'
      if (skipFailedCheckRef.current) {
        skipFailedCheckRef.current = false
        return 'continue'
      }
      setIsFailed(true)
      return 'stop'
    }

    // 强制轮询（resetFailed 后）：后端可能还没开始处理，本轮无失败才解除强制
    if (forcePollRef.current && !failureDetected) {
      forcePollRef.current = false
    }

    // 阶段一：转录完成 → 拉取转写（即使其他阶段失败，已完成的转录也应在转写 tab 正常展示）
    if (isStageDone(transStatus) && !loadedStagesRef.current.transcription) {
      loadedStagesRef.current.transcription = true
      if (isRegenerationRef.current) {
        // 重新生成流程：转写完成后等 2 秒再获取转写接口（后端就绪窗口）
        isRegenerationRef.current = false
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
      await loadTranscription(fileId)
    }

    // 阶段二：纪要完成 → 拉取总结列表。
    // 首帧已由 init 立即 loadFileSummaries 预加载，仅标记不重复请求；其余帧按需加载。
    if (minutesStatus === STAGE_STATUS.Completed && !loadedStagesRef.current.minutes) {
      loadedStagesRef.current.minutes = true
      if (!opts.summariesPreloaded) {
        await loadFileSummaries(fileId)
      }
    }

    // skipInsight 模式：不关心 insight 相关阶段
    if (skipInsight) {
      return failureDetected ? decideFailure() : 'continue'
    }

    // 阶段三：洞察完成 → 拉取 insight_summary 降级数据。
    // 页面编排中提前缓存、编排失败 / 编排接口返回空时兜底、旧数据无编排时兜底。
    if (insightStatus === STAGE_STATUS.Completed && !loadedStagesRef.current.insights) {
      loadedStagesRef.current.insights = true
      await loadInsightSummaryFromFile(fileId)
    }

    // 阶段四：编排完成 → 拉取页面编排结果，停止轮询
    if (pageStatus === STAGE_STATUS.Completed && !loadedStagesRef.current.insightPage) {
      loadedStagesRef.current.insightPage = true
      await loadInsightPage(fileId)
      setInsightPageApiDone(true)
      return 'stop'
    }

    // 我的录音旧数据兼容：转录和洞察都成功，其他阶段都是 pending。
    // insight_summary 已由阶段三加载，这里只需标记旧数据并停止轮询。
    if (isLegacyCompleteData(transStatus, insightStatus, minutesStatus, pageStatus)) {
      isOldCompleteRef.current = true
      return 'stop'
    }

    return failureDetected ? decideFailure() : 'continue'
  }, [skipInsight, loadTranscription, loadFileSummaries, loadInsightSummaryFromFile, loadInsightPage])

  /** 拉取解析状态（单帧），失败返回 null 由调用方决定兜底 */
  const fetchParseStatus = useCallback(async (id: string): Promise<FileParseStatus | null> => {
    try {
      return await recordingApi.getParseStatus(id)
    } catch (e) {
      console.warn('[useFileParse] getParseStatus failed', e)
      setTranscriptList([])
      return null
    }
  }, [])

  // 轮询帧：拉取解析状态并按统一判定处理
  const pollParseStatus = useCallback(async () => {
    if (!fileId) {
      setTranscriptList([])
      return
    }
    const status = await fetchParseStatus(fileId)
    if (!status) return
    const decision = await processSnapshot(status, fileId)
    if (decision === 'stop') {
      shouldStopPollRef.current = true
      stopPollRef.current()
    }
  }, [fileId, fetchParseStatus, processSnapshot])

  // 首次加载 + 文件切换时重置
  useEffect(() => {
    if (!fileId) {
      setTranscriptList([])
      return
    }

    shouldStopPollRef.current = false
    loadedStagesRef.current = { transcription: false, minutes: false, insights: false, insightPage: false }
    setInitialLoadDone(false)
    setIsFailed(false)
    setInsightSummary({})
    setInsightPageJson(null)
    setFileSummaries([])
    setFileSummariesLoading(true)
    setTranscriptList([])
    setStageStatuses({})
    setInsightPageApiDone(false)
    isOldCompleteRef.current = false

    const init = async () => {
      try {
        // 切文件时立即获取总结列表（不依赖转录状态），并避免首帧重复拉取
        loadFileSummaries(fileId)

        // 外部已传入解析状态 → 直接应用快照；否则先拉取一次再应用（与轮询共用同一判定）
        const snapshot = initialParseStatus ?? await fetchParseStatus(fileId)
        if (snapshot) {
          const decision = await processSnapshot(snapshot, fileId, { summariesPreloaded: true })
          if (decision === 'stop') {
            shouldStopPollRef.current = true
          }
        }
      } catch (e) {
        // 获取文件详情失败也视为非语音模型
        console.warn('[useFileParse] init failed', e)
      } finally {
        setInitialLoadDone(true)
      }
    }
    init()
    // 仅依赖 fileId：initialParseStatus 是 fileId 切换瞬间的快照，
    // 不希望父组件 re-render 时重启加载；loadFileSummaries/fetchParseStatus/processSnapshot 由 useCallback 锁定引用。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId])

  // 轮询
  const { start: startPoll, stop: stopPoll } = usePoll(() => pollParseStatus(), 5000)
  stopPollRef.current = stopPoll
  startPollRef.current = startPoll

  const isBeingParsed = (
    !isOldCompleteRef.current && (
      isStageLoading(transcriptionStatus) ||
      isStageLoading(meetingMinutesStatus) ||
      (!skipInsight && (isStageLoading(insightsStatus) || isStageLoading(insightPageStatus)))
    )
  ) || forcePollRef.current  // resetFailed 后强制轮询期间视为正在解析

  useEffect(() => {
    if (!initialLoadDone) return

    if (shouldStopPollRef.current) {
      stopPoll()
      return
    }

    // 当有阶段在解析中时启动轮询
    // resetFailed 直接启动轮询会绕过 shouldPoll 检查，因此这里不主动关闭
    if (isBeingParsed && shouldPoll && !isFailed) {
      startPoll()
    } else if (!isBeingParsed) {
      stopPoll()
    }
    return () => {
      stopPoll()
    }
  }, [isBeingParsed, shouldPoll, isFailed, startPoll, stopPoll, initialLoadDone])

  // 重置失败状态，重新开始轮询（用户点击"继续生成"后调用）
  const resetFailed = useCallback(() => {
    setIsFailed(false)
    shouldStopPollRef.current = false
    skipFailedCheckRef.current = true
    forcePollRef.current = true  // 标记强制轮询，后端还没开始处理时继续轮询
    isRegenerationRef.current = true  // 标记重新生成流程，转写完成后加延迟
    // 将失败步骤的状态改为 pending，让 UI 立即显示 ParsingPlaceholder
    // 不影响已完成阶段（completed/normal）
    setStageStatuses((prev) => {
      const reset = (stage: StageStatus | undefined): StageStatus | undefined => {
        if (!stage) return stage
        if (isStageFailed(stage.status)) {
          return { ...stage, status: STAGE_STATUS.Pending }
        }
        return stage
      }
      return {
        transcription: reset(prev.transcription),
        meetingMinutes: reset(prev.meetingMinutes),
        insights: reset(prev.insights),
        insightPage: reset(prev.insightPage),
      }
    })
    // 清空已加载标记，让后续轮询重新加载各阶段数据
    // 转录完成：新数据 completed，旧数据 normal
    loadedStagesRef.current = {
      transcription: isStageDone(transcriptionStatus),
      minutes: meetingMinutesStatus === STAGE_STATUS.Completed,
      insights: insightsStatus === STAGE_STATUS.Completed,
      insightPage: insightPageStatus === STAGE_STATUS.Completed,
    }
    // 直接启动轮询，不依赖 useEffect 检测状态变化
    startPollRef.current()
  }, [transcriptionStatus, meetingMinutesStatus, insightsStatus, insightPageStatus])

  const startInsightRegeneration = useCallback(() => {
    setIsFailed(false)
    shouldStopPollRef.current = false
    skipFailedCheckRef.current = true
    forcePollRef.current = true
    isRegenerationRef.current = false
    isOldCompleteRef.current = false
    setInsightSummary({})
    setInsightPageJson(null)
    setInsightPageApiDone(false)
    setStageStatuses((prev) => {
      const pending = (stage: StageStatus | undefined): StageStatus => ({
        ...(stage || {}),
        status: STAGE_STATUS.Pending,
        updated_at: Date.now(),
      })
      return {
        ...prev,
        insights: pending(prev.insights),
        insightPage: pending(prev.insightPage),
      }
    })
    loadedStagesRef.current = {
      transcription: isStageDone(transcriptionStatus),
      minutes: meetingMinutesStatus === STAGE_STATUS.Completed,
      insights: false,
      insightPage: false,
    }
    startPollRef.current()
  }, [transcriptionStatus, meetingMinutesStatus])

  return {
    transcriptList,
    insightSummary,
    insightPageJson,
    fileSummaries,
    fileSummariesLoading,
    isFailed,
    isBeingParsed,
    initialLoadDone,
    transcriptionStatus,
    meetingMinutesStatus,
    insightsStatus,
    insightPageStatus,
    stageStatuses,
    resetFailed,
    startInsightRegeneration,
    loadFileSummaries,
    updateSummary,
    insightPageApiDone,
  }
}
