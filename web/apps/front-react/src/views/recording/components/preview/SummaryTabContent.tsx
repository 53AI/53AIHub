import { Empty } from 'antd'
import { ParsingPlaceholder, ParsingUnavailable, PendingPlaceholder, InsightLoadingPlaceholder, hasStageFailed, type ParsingStep } from '../audio/ParseStatusPlaceholder'
import { SummaryContent } from './SummaryContent'
import type { RecordingFileSummary, StageStatusBag } from '../../hooks/useFileParse'
import { isStageLoading } from '../../constants/recordingStatus'

interface SummaryTabContentProps {
  /** 无语音模型 */
  noVoiceModel: boolean
  /** 是否需要用户手动触发 */
  showSummaryPending: boolean
  /** 是否正在轮询/解析 */
  isBeingParsed: boolean
  /** 各阶段完整 stage 包 */
  stages: StageStatusBag
  /** 总结列表（template_id === 0 表示纪要） */
  fileSummaries: RecordingFileSummary[]
  /** 首次加载（切文件）是否已完成 — 未完成时一律展示 loading */
  initialLoadDone: boolean
  /** 是否正在生成中 */
  generating: boolean
  /** 开始生成回调；只读模式（分享页）下不传，按钮会被隐藏 */
  onStartGenerate?: () => void
  /**
   * 限制 ParsingPlaceholder 渲染的步骤集合；
   * 库视图等不展示洞察 Tab 的场景可传 `['transcript','summary']`，
   * 避免进度面板与 Tab 列表展示不一致。不传时走 ParsingPlaceholder 默认全量行为。
   */
  visibleSteps?: ReadonlyArray<ParsingStep>
}

/**
 * 纪要 Tab 内容
 *
 * 展示 template_id === 0 的纪要数据，兼容 JSON（旧）和 Markdown（新）两种格式；
 * 失败/未触发时展示 PendingPlaceholder 或 ParsingPlaceholder。
 */
export function SummaryTabContent({
  noVoiceModel,
  showSummaryPending,
  isBeingParsed,
  stages,
  fileSummaries,
  initialLoadDone,
  generating,
  onStartGenerate,
  visibleSteps,
}: SummaryTabContentProps) {
  // 纪要阶段状态汇总（pending/processing 都视为加载中）
  const meetingMinutesStatus = stages.meetingMinutes?.status ?? ''
  const summaryLoading = isStageLoading(meetingMinutesStatus)

  // 从 fileSummaries 中查找 template_id === 0 的纪要数据
  const meetingMinutesSummary = fileSummaries?.find((s) => s.template_id === 0)

  if (noVoiceModel) return <ParsingUnavailable />

  // 切换文件瞬间 stages/fileSummaries 是空的，先展示 loading
  if (!initialLoadDone) {
    return <InsightLoadingPlaceholder />
  }

  if (meetingMinutesSummary?.summary_content) {
    return <SummaryContent content={meetingMinutesSummary.summary_content} />
  }
  // 纪要阶段失败 → 展示错误态（仅看本阶段，不被后置阶段拖累）
  if (hasStageFailed(stages, ['meetingMinutes'])) {
    return <ParsingPlaceholder stages={stages} visibleSteps={visibleSteps} onStart={onStartGenerate} loading={generating} />
  }
  if (showSummaryPending) {
    return <PendingPlaceholder activeStep="summary" onStart={onStartGenerate} loading={generating} />
  }
  if (summaryLoading && isBeingParsed) {
    return <ParsingPlaceholder stages={stages} visibleSteps={visibleSteps} />
  }
  return (
    <div className="flex flex-col items-center justify-center h-full">
      <Empty description="暂无纪要" />
    </div>
  )
}