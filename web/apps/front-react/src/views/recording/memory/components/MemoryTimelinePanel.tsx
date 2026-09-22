import { Alert, Button, Empty, Spin, Tag } from 'antd'
import type { RecordingMemoryTimeline, RecordingMemoryTimelineItem } from '@/api/modules/recording/types'
import { sourceTypeLabel } from './utils'

interface MemoryTimelinePanelProps {
  timeline: RecordingMemoryTimeline | null
  loading?: boolean
  error?: string | null
  onLoadMore?: () => void
}

const validityLabels: Record<string, string> = {
  active: '当前有效',
  invalid: '已失效',
  compiler_replaced: '已被新记录替换',
  unknown: '有效性未知',
}

const lifecycleLabels: Record<string, string> = {
  open: '进行中',
  overdue: '已逾期',
  completed: '已完成',
  fulfilled: '已完成',
  cancelled: '已取消',
  expired: '已失效',
}

function Evidence({ item }: { item: RecordingMemoryTimelineItem }) {
  if (!item.evidence_refs?.length && !item.source_file && !item.source_segments?.length) {
    return <span className="text-xs text-slate-400">暂无直接证据</span>
  }
  return (
    <details className="mt-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
      <summary className="cursor-pointer select-none text-blue-600">查看来源与证据</summary>
      <div className="mt-2 space-y-1.5">
        {item.source_file ? <div>会议：{item.source_file}</div> : null}
        {item.source_segments?.length ? <div>片段：{item.source_segments.join('、')}</div> : null}
        {item.source_type ? <div>来源：{sourceTypeLabel(item.source_type)}</div> : null}
        {item.evidence_refs?.map((evidence, index) => (
          <div key={`${evidence.file_id ?? 'evidence'}-${index}`} className="rounded-md bg-white px-2 py-1.5">
            {evidence.source_file || '未命名会议'}{evidence.source_segments?.length ? ` · ${evidence.source_segments.join('、')}` : ''}
          </div>
        ))}
      </div>
    </details>
  )
}

function TimelineItem({ item }: { item: RecordingMemoryTimelineItem }) {
  const timestamp = item.timestamp ? new Date(item.timestamp).toLocaleString('zh-CN') : '时间未知'
  const status = item.status || item.lifecycle
  return (
    <article className="relative rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
      <span className="absolute -left-[23px] top-5 size-2.5 rounded-full border-2 border-white bg-blue-500 shadow" />
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span>{timestamp}</span>
        <Tag color={item.record_type === 'fact' ? 'cyan' : 'blue'}>{item.record_type === 'fact' ? '事实' : '判断'}</Tag>
        {status ? <Tag color={status === 'overdue' ? 'error' : status === 'completed' || status === 'fulfilled' ? 'success' : 'default'}>{lifecycleLabels[status] || status}</Tag> : null}
        <span>{validityLabels[item.current_validity] || item.current_validity || '有效性未知'}</span>
      </div>
      <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">{item.content || '暂无内容'}</p>
      {item.previous_value || item.new_value ? (
        <div className="mt-2 rounded-lg bg-blue-50/70 px-3 py-2 text-xs text-slate-600">
          {item.previous_value ? <span>{item.previous_value}</span> : <span>空</span>}
          <span className="mx-2 text-blue-400">→</span>
          {item.new_value ? <span>{item.new_value}</span> : <span>空</span>}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {item.confidence !== undefined && item.confidence > 0 ? <span className="text-xs text-slate-400">可信度 {Math.round(item.confidence * 100)}%</span> : null}
        <Evidence item={item} />
      </div>
    </article>
  )
}

export function MemoryTimelinePanel({ timeline, loading = false, error, onLoadMore }: MemoryTimelinePanelProps) {
  if (loading) return <div className="flex min-h-64 items-center justify-center"><Spin tip="正在整理历史记录…" /></div>
  if (error) return <Alert type="error" showIcon title="历史时间线暂时不可用" description={error} />
  if (!timeline) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无历史记录" />

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-500">
        <span>共 {timeline.total} 条历史记录</span>
        <span>{timeline.has_more ? `当前展示 ${timeline.items.length} 条，还可继续查看` : '已展示全部记录'}</span>
      </div>
      {timeline.has_more ? (
        <Alert
          type="info"
          showIcon
          title="历史记录较多"
          description={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>当前接口已返回最新一页，可继续查看更早记录。</span>
              {onLoadMore ? <Button size="small" type="link" onClick={onLoadMore}>加载更早记录</Button> : null}
            </div>
          }
        />
      ) : null}
      {timeline.items.length ? (
        <div className="relative space-y-3 pl-5 before:absolute before:bottom-4 before:left-[4px] before:top-4 before:w-px before:bg-blue-100">
          {timeline.items.map((item) => <TimelineItem key={`${item.record_type}-${String(item.id)}`} item={item} />)}
        </div>
      ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无历史记录" />}
    </div>
  )
}

export type { MemoryTimelinePanelProps }
