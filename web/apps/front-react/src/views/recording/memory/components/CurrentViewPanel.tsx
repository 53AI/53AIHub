import { Alert, Empty, Spin, Tag } from 'antd'
import type {
  RecordingCurrentViewEvidence,
  RecordingCurrentViewItem,
  RecordingCurrentViewList,
  RecordingCurrentViewResponse,
  RecordingCurrentViewValue,
} from '@/api/modules/recording/types'
import { sourceTypeLabel } from './utils'

interface CurrentViewPanelProps {
  view: RecordingCurrentViewResponse | null
  loading?: boolean
  error?: string | null
}

const stateLabels: Record<string, string> = {
  resolved: '已形成理解',
  unknown: '信息不足',
  conflicted: '存在冲突',
  degraded: '部分理解',
  unsupported: '暂不支持',
}

const stateColors: Record<string, string> = {
  resolved: 'success',
  unknown: 'default',
  conflicted: 'error',
  degraded: 'warning',
}

const statusLabels: Record<string, string> = {
  open: '进行中',
  overdue: '已逾期',
  completed: '已完成',
  fulfilled: '已完成',
  cancelled: '已取消',
  expired: '已失效',
  active: '当前有效',
  uncertain: '尚不确定',
}

function StateTag({ state }: { state?: string }) {
  const value = state || 'unknown'
  return <Tag color={stateColors[value] || 'default'}>{stateLabels[value] || value}</Tag>
}

function Confidence({ value }: { value?: number }) {
  if (value === undefined || value === null || value <= 0) return null
  return <span className="text-xs text-slate-400">可信度 {Math.round(value * 100)}%</span>
}

function EvidenceDetails({ evidence }: { evidence?: RecordingCurrentViewEvidence[] }) {
  if (!evidence?.length) return <span className="text-xs text-slate-400">暂无直接证据</span>
  return (
    <details className="mt-2 rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs text-slate-500">
      <summary className="cursor-pointer select-none text-blue-600">查看证据（{evidence.length}）</summary>
      <div className="mt-2 space-y-2">
        {evidence.map((item, index) => (
          <div key={`${item.file_id ?? 'evidence'}-${index}`} className="rounded-md bg-slate-50 px-2 py-1.5">
            <div>{item.source_file || '未命名会议'}</div>
            {item.source_segments?.length ? <div className="mt-0.5 text-slate-400">片段：{item.source_segments.join('、')}</div> : null}
            {item.source_type ? <div className="mt-0.5 text-slate-400">来源：{sourceTypeLabel(item.source_type)}</div> : null}
          </div>
        ))}
      </div>
    </details>
  )
}

function ItemCard({ item, tone = 'default' }: { item: RecordingCurrentViewItem; tone?: 'default' | 'warning' }) {
  return (
    <article className={`rounded-xl border px-3.5 py-3 ${tone === 'warning' ? 'border-amber-100 bg-amber-50/50' : 'border-slate-100 bg-white'}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="whitespace-pre-line text-sm leading-6 text-slate-700">{item.content || '暂无内容'}</p>
        {item.status ? <Tag color={item.status === 'overdue' ? 'error' : item.status === 'uncertain' ? 'warning' : 'blue'}>{statusLabels[item.status] || item.status}</Tag> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {item.source_type ? <span className="text-xs text-slate-400">{sourceTypeLabel(item.source_type)}</span> : null}
        <Confidence value={item.confidence} />
        <EvidenceDetails evidence={item.evidence_refs} />
      </div>
    </article>
  )
}

function ValueFacet({ title, value }: { title: string; value: RecordingCurrentViewValue }) {
  return (
    <section className="rounded-xl border border-slate-100 bg-white p-3.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-slate-700">{title}</h4>
        <StateTag state={value?.state} />
      </div>
      <p className="text-sm leading-6 text-slate-600">{value?.value || '暂无足够信息形成稳定判断'}</p>
      {value?.support ? <p className="mt-1 text-xs text-slate-400">{value.support === 'unsupported' ? '当前版本暂不支持该信息类型' : value.support === 'degraded' ? '依据有限，后续会议会继续校准' : '基于当前有效记忆编译'}</p> : null}
      <EvidenceDetails evidence={value?.evidence_refs} />
    </section>
  )
}

function ListFacet({ title, value, empty = '暂无记录' }: { title: string; value: RecordingCurrentViewList; empty?: string }) {
  const items = Array.isArray(value?.items) ? value.items : []
  const uncertain = Array.isArray(value?.uncertain_items) ? value.uncertain_items : []
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-slate-700">{title}</h4>
        <StateTag state={value?.state} />
      </div>
      {items.length || uncertain.length ? (
        <div className="space-y-2">
          {items.map((item) => <ItemCard key={`${item.id}-active`} item={item} />)}
          {uncertain.length ? <p className="pt-1 text-xs text-amber-600">以下内容曾被提及，但暂缺延续或关闭证据</p> : null}
          {uncertain.map((item) => <ItemCard key={`${item.id}-uncertain`} item={item} tone="warning" />)}
        </div>
      ) : <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-400">{value?.support === 'unsupported' ? '当前版本暂不支持该信息类型' : value?.state === 'unknown' || value?.support === 'degraded' ? '当前证据不足，暂不下结论' : empty}</p>}
    </section>
  )
}

export function CurrentViewPanel({ view, loading = false, error }: CurrentViewPanelProps) {
  if (loading) return <div className="flex min-h-64 items-center justify-center"><Spin tip="正在编译当前理解…" /></div>
  if (error) return <Alert type="error" showIcon title="当前理解暂时不可用" description={error} />
  if (!view) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未形成当前理解" />

  const facets = view.current_view
  const conflicts = Array.isArray(view.conflicts) ? view.conflicts : []
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">当前最佳理解</h3>
            <p className="mt-1 text-xs text-slate-500">只读汇总当前有效记忆，不会替代历史记录。</p>
          </div>
          <span className="text-xs text-slate-400">编译于 {new Date(view.compiled_at).toLocaleString('zh-CN')}</span>
        </div>
      </div>
      {conflicts.length ? (
        <Alert
          type="warning"
          showIcon
          title="有些信息正在发生变化"
          description={(
            <div className="space-y-3">
              {conflicts.map((conflict) => (
                <div key={`${conflict.facet}-${conflict.reason}`}>
                  <p className="mb-1">{conflict.reason}</p>
                  {conflict.candidates?.length ? <div className="space-y-2">{conflict.candidates.map((candidate) => <ItemCard key={String(candidate.id)} item={candidate} tone="warning" />)}</div> : null}
                </div>
              ))}
            </div>
          )}
        />
      ) : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <ValueFacet title="当前状态" value={facets.current_status} />
        <ValueFacet title="当前立场" value={facets.current_position} />
      </div>
      <ListFacet title="当前诉求" value={facets.current_demands} />
      <ListFacet title="当前风险" value={facets.current_risks} empty="暂无已确认的当前风险" />
      <ListFacet title="当前机会" value={facets.current_opportunities} empty="暂无已确认的当前机会" />
      <ListFacet title="未闭环事项" value={facets.open_loops} empty="暂无进行中的事项" />
      <ListFacet title="最近变化" value={facets.recent_changes} empty="暂无可确认的变化" />
      <ListFacet title="最近更新" value={facets.recent_updates} empty="暂无最近更新" />
    </div>
  )
}

export type { CurrentViewPanelProps }
