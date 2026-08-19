import { SvgIcon } from '@km/shared-components-react'
import { InsightContent } from '@/components/Audio/InsightContent'
import { InsightPageRenderer } from '../insightRenderer'
import {
  ParsingPlaceholder,
  ParsingUnavailable,
  PendingPlaceholder,
  InsightLoadingPlaceholder,
  hasStageFailed,
} from '../audio/ParseStatusPlaceholder'
import type { StageStatusBag } from '../../hooks/useFileParse'
import { STAGE_STATUS, isStageLoading } from '../../constants/recordingStatus'

interface InsightTabContentProps {
  /** 无语音模型 */
  noVoiceModel: boolean
  /** 是否需要用户手动触发（PendingPlaceholder） */
  showInsightPending: boolean
  /** 是否正在轮询/解析 */
  isBeingParsed: boolean
  /** 各阶段完整 stage 包 */
  stages: StageStatusBag
  /** 洞察/页面编排完成的结果 */
  insightSummary: Record<string, any>
  insightPageJson: Record<string, any> | null
  insightPageApiDone: boolean
  /** 首次加载（切文件）是否已完成 — 未完成时一律展示 loading，避免空状态闪烁 */
  initialLoadDone: boolean
  /** 是否正在生成中（按钮 loading 态） */
  generating: boolean
  /** 开始生成回调；只读模式（分享页）下不传，按钮会被隐藏 */
  onStartGenerate?: () => void
  /** 带补充背景重新生成后，让父级清空旧结果并开始轮询 */
  onRegenerateStarted?: () => void
}

/**
 * 洞察 Tab 内容：编排结果展示，包含占位/降级/空状态等多分支
 *
 * 优先级：
 * 1. 无语音模型 → ParsingUnavailable
 * 2. 首次加载未完成 → InsightLoadingPlaceholder（避免切文件瞬间显示空状态）
 * 3. 用户手动触发态 → PendingPlaceholder
 * 4. 仍在生成中 → ParsingPlaceholder
 * 5. 我的录音旧数据（有 keywords）→ InsightContent
 * 6. 页面编排接口仍在请求中 → InsightLoadingPlaceholder
 * 7. 编排失败/旧数据无编排 → 降级展示 insight_summary
 * 8. 没有任何内容 → 空状态
 * 9. 已完成 → InsightPageRenderer
 */
export function InsightTabContent({
  noVoiceModel,
  showInsightPending,
  isBeingParsed,
  stages,
  insightSummary,
  insightPageJson,
  insightPageApiDone,
  initialLoadDone,
  generating,
  onStartGenerate,
  onRegenerateStarted,
}: InsightTabContentProps) {
  if (noVoiceModel) return <ParsingUnavailable />

  // 切换文件瞬间 stages 是空对象，会误判进入空状态。先展示 loading。
  if (!initialLoadDone) {
    return <InsightLoadingPlaceholder />
  }

  const insightsStatus = stages.insights?.status ?? ''
  const insightPageStatus = stages.insightPage?.status ?? ''
  const insightsLoading = isStageLoading(insightsStatus)
  const insightPageLoading = isStageLoading(insightPageStatus)
  const insightParsing = isBeingParsed && (insightsLoading || insightPageLoading)

  // 洞察阶段（insights + insightPage）失败 → 展示错误态（仅看本组阶段，不被前置阶段拖累）
  if (hasStageFailed(stages, ['insights', 'insightPage'])) {
    return <ParsingPlaceholder stages={stages} onStart={onStartGenerate} loading={generating} />
  }

  if (showInsightPending) {
    return <PendingPlaceholder activeStep="insight" onStart={onStartGenerate} loading={generating} />
  }
  if (insightParsing) {
    return <ParsingPlaceholder stages={stages} />
  }
  // 我的录音旧数据：insightSummary 含 keywords 时按旧版块结构展示
  if (insightSummary?.keywords?.length > 0) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="w-4/5 mx-auto pb-8">
          <InsightContent insightSummary={insightSummary} />
        </div>
      </div>
    )
  }

  // 页面编排接口仍在请求中 → 展示 loading 而不是被 insight_summary 兜底闪一下
  // 包括：1) status 是 pending/processing；2) status 是 completed 但 pageJson 还没拿到、且 API 请求还没结束
  const pageApiInFlight = insightPageLoading || (insightPageStatus === STAGE_STATUS.Completed && !insightPageJson && !insightPageApiDone)
  if (pageApiInFlight) {
    return <InsightLoadingPlaceholder />
  }

  // 页面编排失败或旧数据无页面编排结果时，降级使用决策分析结果
  const pageJson = insightPageStatus === STAGE_STATUS.Failed ? insightSummary : (insightPageJson || insightSummary)

  if (!pageJson || Object.keys(pageJson).length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <div className="flex-none size-[60px] rounded-full border border-[#D1E0FF] bg-[#E3ECFF] flex items-center justify-center mb-6">
          <SvgIcon name="microphone" size={24} color="#2563EB" />
        </div>
        <p className="text-[#999999] text-sm mb-8 whitespace-pre-wrap text-center max-w-md">
          该音频未识别到有效人声，请重新上传正确的录音文件
        </p>
      </div>
    )
  }
  
  return (
    <div className="h-full overflow-y-auto">
      <div className="w-4/5 mx-auto pb-8">
        <InsightPageRenderer pageJson={pageJson} />
      </div>
    </div>
  )
}
