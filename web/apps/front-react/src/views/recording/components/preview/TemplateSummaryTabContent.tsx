import { Suspense, lazy } from 'react'
import { Empty, Spin } from 'antd'
import { CloseCircleFilled } from '@ant-design/icons'
import { TemplateParsingPlaceholder } from '../audio/ParseStatusPlaceholder'
import type { RecordingFileSummary } from '@/api/modules/recording/types'
import type { AudioTabItem } from '../../hooks/useTemplateTabs'

const MarkdownViewer = lazy(() => import('@/components/FileViewer/MarkdownViewer'))

interface TemplateSummaryTabContentProps {
  /** 当前 tab key，形如 sum-{summaryId} */
  activeTab: string
  /** 总结列表 */
  fileSummaries: RecordingFileSummary[]
  /** 模板 tab 项（用于取模板名） */
  templateTabItems: AudioTabItem[]
  /** 首次拉取中 */
  fileSummariesLoading: boolean
}

/**
 * 总结模板 Tab 内容（sum-{summaryId} 形式）
 *
 * 状态机：
 * - 首次拉取 / 接口未返回 → TemplateParsingPlaceholder
 * - 异步模式下仍 processing → 继续显示 loading
 * - failed → 失败占位
 * - 已完成且有内容 → MarkdownViewer
 * - 已完成但无内容 → 空状态
 */
export function TemplateSummaryTabContent({
  activeTab,
  fileSummaries,
  templateTabItems,
  fileSummariesLoading,
}: TemplateSummaryTabContentProps) {
  const summaryId = activeTab.slice('sum-'.length)
  const summary = fileSummaries?.find((s) => s.id === summaryId)
  const templateName = templateTabItems.find((t) => t.key === activeTab)?.label || '模板'

  // 首次拉取 / 接口未返回 → 显示 loading
  if (fileSummariesLoading || !summary) {
    return <TemplateParsingPlaceholder templateName={templateName} />
  }
  // 异步模式：接口已返回但总结还在生成中 → 继续显示 loading
  if (summary.status === 'processing') {
    return <TemplateParsingPlaceholder templateName={templateName} />
  }
  // 生成失败 → 展示失败占位
  if (summary.status === 'failed') {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <div className="flex-none size-[60px] rounded-full border border-[#FECACA] bg-[#FEF2F2] flex items-center justify-center mb-6">
          <CloseCircleFilled style={{ fontSize: 24, color: '#EF4444' }} />
        </div>
        <h3 className="text-base font-medium text-[#1D1E1F] mb-2">{templateName}生成失败</h3>
        <p className="text-[#999999] text-sm mb-8">请稍后重试，或选择其他模板</p>
      </div>
    )
  }
  // 已生成完成，展示内容或空状态
  if (summary.summary_content) {
    return (
      <div className="h-full overflow-hidden">
        <Suspense fallback={<Spin className="flex items-center justify-center h-full" />}>
          <MarkdownViewer content={summary.summary_content} containerClass="w-4/5 mx-auto" />
        </Suspense>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center justify-center h-full">
      <Empty description="暂无总结内容" />
    </div>
  )
}