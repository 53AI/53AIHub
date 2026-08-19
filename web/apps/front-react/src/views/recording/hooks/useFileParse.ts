import { useState, useRef, useEffect, useCallback } from 'react';
import filesApi from '@/api/modules/files';
import recordingApi from '@/api/modules/recording';
import type { RecordingFileSummary, FileParseStatus, StageStatus } from '@/api/modules/recording/types';
import { usePoll } from '@/hooks/usePoll';
import { parsePageJson, parseTranscription } from '../parsers/recordingParsers';
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
  isEmptyContent: boolean
  hasContent: boolean
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
  /** 外部已取到的文件数据，避免重复请求 filesApi.get */
  initialFileData?: Record<string, any>
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

function isCompletedStatus(status: string): boolean {
  return isStageDone(status)
}

/**
 * 合并新旧 stage：只对 status 字段做"已完成不被回退"保护，其他字段（error_type/...）直接用新值覆盖。
 * 返回 undefined 表示新值无效，应保留旧值不变。
 */
function mergeStage(previous: StageStatus | undefined, next: StageStatus | undefined): StageStatus | undefined {
  if (!next) return previous
  const prevStatus = previous?.status ?? ''
  const nextStatus = next.status ?? ''
  const protectedStatus = isCompletedStatus(prevStatus) && isStageLoading(nextStatus)
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

export function useFileParse({ fileId, shouldPoll = true, initialFileData, initialParseStatus, skipInsight = false }: UseFileParseOptions): UseFileParseResult {
  const [transcriptList, setTranscriptList] = useState<TranscriptItem[]>([])
  const [hasContent, setHasContent] = useState(false)
  const [isFailed, setIsFailed] = useState(false)
  const [isEmptyContent, setIsEmptyContent] = useState(false)

  /** 各阶段完整 stage 状态包（status/error_type 等），按需透传 */
  const [stageStatuses, setStageStatuses] = useState<StageStatusBag>({})

  // 派生：4 个 status 字符串。keepCompletedStatus 的语义已下沉到 mergeStage，
  // 已完成状态不会被后续轮询回退到 pending/parsing/processing。
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

  /** 拉取转写并写入 transcriptList（兼容新旧两种 JSON 格式） */
  const loadTranscription = useCallback(async (id: string) => {
    try {
      const transcriptionRes = await recordingApi.getTranscription(id)
      if (transcriptionRes?.content) {
        setTranscriptList(parseTranscription(transcriptionRes.content))
        setHasContent(true)
      } else {
        setHasContent(false)
      }
    } catch (e) {
      // 转写接口失败，不阻塞后续阶段
      console.warn('[useFileParse] getTranscription failed', e)
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

  // 加载文件详情（转写、纪要、洞察、总结列表）
  /**
   * 应用外部传入的 parseStatus 快照：合并 stage 状态 + 加载已完成阶段的数据 + 处理旧数据/失败兜底
   */
  const applyInitialParseStatus = useCallback(async (status: FileParseStatus, fileId: string) => {
    setStageStatuses((prev) => mergeStageBag(prev, {
      transcription: status.transcription,
      meetingMinutes: status.meeting_minutes,
      insights: status.insights,
      insightPage: status.insight_page,
    }))

    const transStatus = status.transcription?.status ?? ''
    const minutesStatus = status.meeting_minutes?.status ?? ''
    const insightStatus = status.insights?.status ?? ''
    const pageStatus = status.insight_page?.status ?? ''

    // 失败：直接标记，不进入加载分支。
    // skipInsight 模式下只关心 trans / minutes，insight 相关失败不影响 isFailed。
    const hasFailure = skipInsight
      ? isStageFailed(transStatus) || isStageFailed(minutesStatus)
      : hasAnyStageFailure(transStatus, minutesStatus, insightStatus, pageStatus)
    if (hasFailure) {
      setIsFailed(true)
      shouldStopPollRef.current = true
      return
    }

    const transCompleted = isStageDone(transStatus)
    const insightCompleted = insightStatus === STAGE_STATUS.Completed

    // 一次性预标记已完成的阶段，避免后续轮询重复加载
    if (transCompleted) loadedStagesRef.current.transcription = true
    if (minutesStatus === STAGE_STATUS.Completed) loadedStagesRef.current.minutes = true
    if (insightCompleted) loadedStagesRef.current.insights = true

    // 转录完成 → 拉取转写
    if (transCompleted) {
      await loadTranscription(fileId)
    }
    // 纪要阶段的数据由 init 顶部的 loadFileSummaries(fileId) 处理

    // skipInsight 模式：不发 filesApi.get 拉 insight_summary，也不调 getInsightPage
    if (!skipInsight) {
      // 洞察完成 → 从文件详情降级加载 insight_summary
      if (insightCompleted) {
        await loadInsightSummaryFromFile(fileId)
      }

      // 编排独立请求：完成后不再轮询
      if (pageStatus === STAGE_STATUS.Completed) {
        loadedStagesRef.current.insightPage = true
        await loadInsightPage(fileId)
        setInsightPageApiDone(true)
        shouldStopPollRef.current = true
        return
      }

      // 我的录音旧数据兼容：转录和洞察都成功，其他阶段都是 pending
      if (isLegacyCompleteData(transStatus, insightStatus, minutesStatus, pageStatus)) {
        isOldCompleteRef.current = true
        shouldStopPollRef.current = true
      }
    }
  }, [loadTranscription, loadInsightSummaryFromFile, loadInsightPage, skipInsight])

  // 轮询函数：获取解析状态，按阶段加载对应接口（仅语音模型调用）
  const pollParseStatus = useCallback(async () => {
    if (!fileId) {
      setTranscriptList([])
      setHasContent(false)
      return
    }

    let parseStatus: FileParseStatus | null
    try {
      parseStatus = await recordingApi.getParseStatus(fileId)
    } catch (e) {
      console.warn('[useFileParse] getParseStatus failed', e)
      setTranscriptList([])
      setHasContent(false)
      return
    }
    if (!parseStatus) return

    const trans = parseStatus.transcription
    const minutes = parseStatus.meeting_minutes
    const insights = parseStatus.insights
    const page = parseStatus.insight_page

    // 合并到 stageStatuses：status 防回退，其他字段覆盖
    setStageStatuses((prev) => mergeStageBag(prev, {
      transcription: trans,
      meetingMinutes: minutes,
      insights: insights,
      insightPage: page,
    }))

    const transStatus = trans?.status ?? ''
    const minutesStatus = minutes?.status ?? ''
    const insightStatus = insights?.status ?? ''
    const pageStatus = page?.status ?? ''

    const stopPolling = () => {
      shouldStopPollRef.current = true
      stopPollRef.current()
    }

    // 强制轮询模式下后端可能还没开始处理，取消强制轮询
    // 只有所有阶段都不是 failed/disabled 才说明后端已响应
    const failureDetected = skipInsight
      ? isStageFailed(transStatus) || isStageFailed(minutesStatus)
      : hasAnyStageFailure(transStatus, minutesStatus, insightStatus, pageStatus)
    if (forcePollRef.current && !failureDetected) {
      forcePollRef.current = false
    }

    // 阶段一：转录完成 → 调转写接口
    if (isStageDone(transStatus) && !loadedStagesRef.current.transcription) {
      loadedStagesRef.current.transcription = true
      if (isRegenerationRef.current) {
        // 重新生成流程：转写完成后等 2 秒再获取转写接口
        isRegenerationRef.current = false
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
      await loadTranscription(fileId)
    }

    // 阶段二：纪要完成 → 调总结列表接口
    if (minutesStatus === STAGE_STATUS.Completed && !loadedStagesRef.current.minutes) {
      loadedStagesRef.current.minutes = true
      await loadFileSummaries(fileId)
    }

    // skipInsight 模式：跳过以下所有 insight / insightPage 相关分支
    if (skipInsight) {
      // 仅 trans / minutes 失败 → 标记失败，停止轮询
      if (failureDetected) {
        if (forcePollRef.current) {
          // 强制轮询模式下后端可能还没开始处理，先不标记失败，继续轮询
        } else if (skipFailedCheckRef.current) {
          skipFailedCheckRef.current = false
        } else {
          setIsFailed(true)
          stopPolling()
          return
        }
      }
      return
    }

    // 阶段三：洞察完成 + 编排失败 → 从文件详情降级
    if (insightStatus === STAGE_STATUS.Completed
        && !loadedStagesRef.current.insights
        && pageStatus === STAGE_STATUS.Failed) {
      loadedStagesRef.current.insights = true
      await loadInsightSummaryFromFile(fileId)
    }

    // 阶段四：编排完成 → 调编排接口，停止轮询
    if (pageStatus === STAGE_STATUS.Completed && !loadedStagesRef.current.insightPage) {
      loadedStagesRef.current.insightPage = true
      await loadInsightPage(fileId)
      setInsightPageApiDone(true)
      stopPolling()
      return
    }

    // 我的录音旧数据兼容：转录和洞察都成功（normal/completed），其他阶段都是 pending
    // 旧数据 insight_page 不会完成，需从 insight_summary 加载洞察数据
    if (isLegacyCompleteData(transStatus, insightStatus, minutesStatus, pageStatus)
        && !loadedStagesRef.current.insights) {
      loadedStagesRef.current.insights = true
      isOldCompleteRef.current = true
      await loadInsightSummaryFromFile(fileId)
      stopPolling()
      return
    }

    // 有步骤失败 → 标记失败，停止轮询，但已加载的数据不受影响
    if (hasAnyStageFailure(transStatus, minutesStatus, insightStatus, pageStatus)) {
      if (forcePollRef.current) {
        // 强制轮询模式下后端可能还没开始处理，先不标记失败，继续轮询
      } else if (skipFailedCheckRef.current) {
        skipFailedCheckRef.current = false
      } else {
        setIsFailed(true)
        stopPolling()
        return
      }
    }
  }, [fileId, loadFileSummaries, skipInsight])

  // 首次加载 + 文件切换时重置
  useEffect(() => {
    if (!fileId) {
      setTranscriptList([])
      setHasContent(false)
      return
    }

    shouldStopPollRef.current = false
    loadedStagesRef.current = { transcription: false, minutes: false, insights: false, insightPage: false }
    setInitialLoadDone(false)
    setHasContent(false)
    setIsFailed(false)
    setIsEmptyContent(false)
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
        // 切文件时立即获取总结列表（不依赖转录状态）
        loadFileSummaries(fileId)

        // 如果外部已传入解析状态，跳过首次轮询请求，直接应用快照
        if (initialParseStatus) {
          await applyInitialParseStatus(initialParseStatus, fileId)
        } else {
          await pollParseStatus()
        }
      } catch (e) {
        // 获取文件详情失败也视为非语音模型
        console.warn('[useFileParse] init failed', e)
      } finally {
        setInitialLoadDone(true)
      }
    }
    init()
    // 仅依赖 fileId：initialFileData/initialParseStatus 是 fileId 切换瞬间的快照，
    // 不希望父组件 re-render 时重启加载；loadFileSummaries/pollParseStatus 由 useCallback 锁定引用。
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
    isEmptyContent,
    hasContent,
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
