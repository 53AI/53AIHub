import { useEffect, useRef, useState } from 'react'
import { Button, Drawer, Empty, Select, Spin } from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  RightOutlined,
  WarningOutlined
} from '@ant-design/icons'
import { IconAction, SafeImage, Search } from '@km/shared-components-react'
import { useInfiniteScroll } from '@/hooks'
import recordingApi from '@/api/modules/recording'
import type { RecordingCognition, RecordingCognitionCanonicalType, RecordingCognitionLayer, RecordingCognitionDetail } from '@/api/modules/recording/types'
import { CANONICAL_TYPE_LABELS, CORE_GROUPS, DEFAULT_DOMAIN_LOGO } from '../constants'
import { RegistryIcon } from './RegistryIcon'
import { CognitionEditorModal, type CognitionEditorInit } from './CognitionEditorModal'
import { CognitionRow } from './CognitionRow'
import { PendingCognitionDrawer } from './PendingCognitionDrawer'
import { useRemoveCognition } from './useRemoveCognition'
import { useCognitionContext } from './CognitionContext'
import type { DrawerScope } from './types'
import { getPublicPath } from '@/utils/config'

// 按抽屉作用域派生列表查询参数：核心认知固定类型，领域认知取类型筛选；来源筛选取逗号拼接字符串
const buildDrawerQuery = (scope: DrawerScope, typeFilter: string, keyword: string, sourceType?: string) => ({
  layer: scope.kind,
  cognition_type: scope.kind === 'core' ? scope.key : typeFilter === 'all' ? undefined : typeFilter,
  domain_id: scope.kind === 'situational' ? scope.id : undefined,
  keyword: keyword.trim() || undefined,
  ...(sourceType ? { source_type: sourceType } : {}),
})

// 添加方式筛选项的 value（后端 fetch 直接复用）；
// 全部=两种来源拼接；自行添加=boss_authored；智能生成=boss_confirmed,auto_confirmed
const SELF_SOURCES = 'boss_authored'
const SMART_SOURCES = 'boss_confirmed,auto_confirmed'
const ALL_SOURCES = [SELF_SOURCES, SMART_SOURCES].join(',')


interface CognitionDrawerProps {
  open: boolean
  scope: DrawerScope | null
  onClose: () => void
  onOpenDetail: (item: RecordingCognition) => void
  onAdd: (scope: DrawerScope) => void
}

export function CognitionDrawer({ open, scope, onClose, onOpenDetail, onAdd }: CognitionDrawerProps) {
  const { coreTotals, domainRegistry, mutationTick } = useCognitionContext()

  const [keyword, setKeyword] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [sourceFilter, setSourceFilter] = useState<string>(ALL_SOURCES)
  const [items, setItems] = useState<RecordingCognition[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [itemsTotal, setItemsTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [pendingOpen, setPendingOpen] = useState(false)
  const [editingCognition, setEditingCognition] = useState<CognitionEditorInit | null>(null)
  const itemsRequestRef = useRef(0)
  const confirmedListRef = useRef<HTMLDivElement | null>(null)

  // 切换作用域：重置筛选、待确认子抽屉，拉取第一页
  useEffect(() => {
    if (!scope) return
    setKeyword('')
    setTypeFilter('all')
    setSourceFilter(ALL_SOURCES)
    setPendingCount(0)
    setPendingOpen(false)
  }, [scope])

  const loadDrawer = async (currentScope: DrawerScope, currentKeyword: string, currentTypeFilter: string, offset = 0) => {
    const append = offset > 0
    const requestId = ++itemsRequestRef.current
    if (append) setLoadingMore(true)
    else setLoading(true)

    const common = buildDrawerQuery(currentScope, currentTypeFilter, currentKeyword, sourceFilter)
    if (append) {
      // 已确认列表滚动加载：只取下一页已确认，不动待确认部分
      const formalResult = await recordingApi.getCognitions({ ...common, status: 'confirmed', offset, limit: 20 })
      if (requestId !== itemsRequestRef.current) return
      setItems((prev) => [...prev, ...(formalResult.items || [])])
      setItemsTotal(formalResult.total || 0)
    } else {
      // 打开抽屉/筛选变化：已确认第 1 页 + 待确认数量 +（「全部」来源时）导入候选数
      const [formalResult, pendingCountResult] = await Promise.all([
        recordingApi.getCognitions({ ...common, status: 'confirmed', offset: 0, limit: 20 }),
        recordingApi.getCognitionCandidates({ ...common, source_type: undefined, status: 'candidate', limit: 1 })
      ])
      if (requestId !== itemsRequestRef.current) return
      setItems(formalResult.items || [])
      setItemsTotal(formalResult.total || 0)

      setPendingCount((pendingCountResult?.total || 0))
    }
    if (requestId === itemsRequestRef.current) {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  // 关键词 / 类型 / 添加方式筛选变化时重拉第一页
  useEffect(() => {
    if (scope) void loadDrawer(scope, keyword, typeFilter, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, typeFilter, keyword, sourceFilter])

  const loadMore = () => {
    if (!scope || loading || loadingMore) return
    if (items.length >= itemsTotal) return
    void loadDrawer(scope, keyword, typeFilter, items.length)
  }

  // 外部写操作（编辑/详情/审核等）成功后：重拉已确认列表
  useEffect(() => {
    if (scope) void loadDrawer(scope, keyword, typeFilter, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutationTick])

  // 已确认列表编辑在抽屉内就近处理，便于保存后原地更新列表（不重新拉取）
  const beginEditCognition = (item: RecordingCognition) => {
    setEditingCognition({
      editingId: item.id,
      title: item.title,
      statement: item.statement,
      cognitionType: (item.cognition_type || '') as RecordingCognitionCanonicalType | '',
      layer: (item.layer || 'core') as RecordingCognitionLayer,
      domainId: item.domain_id || '',
    })
  }

  // 已确认认知编辑保存成功：原地替换对应行的可编辑字段
  const applyCognitionSaved = (detail: RecordingCognitionDetail) => {
    setItems((prev) =>
      prev.map((c) => (String(c.id) === String(detail.id) ? { ...c, ...detail } : c)),
    )
    setEditingCognition(null)
  }

  const remove = useRemoveCognition()

  const { sentinelRef } = useInfiniteScroll({ hasMore: items.length < itemsTotal, loadingMore, onLoadMore: loadMore, rootRef: confirmedListRef })
  const SOURCE_FILTER_OPTIONS = [
    { value: ALL_SOURCES, label: '全部' },
    { value: SELF_SOURCES, label: '自行添加' },
    { value: SMART_SOURCES, label: '智能生成' },
  ]
  const drawerTitle = scope ? scope.label : '认知详情'
  const drawerCoreGroup = scope?.kind === 'core' ? CORE_GROUPS.find((group) => group.key === scope.key) : undefined
  const drawerDomain = scope?.kind === 'situational' ? domainRegistry.find((domain) => domain.id === scope.id) : undefined
  const drawerCount = scope
    ? scope.kind === 'core' ? coreTotals[scope.key] : domainRegistry.find((domain) => domain.id === scope.id)?.cognition_count
    : undefined
  const drawerHeader = scope
    ? (
      <>
        <div className="flex items-center gap-3">
          {scope.kind === 'core' ? (
            <RegistryIcon name={scope.key} iconBg={drawerCoreGroup?.iconBg} />
          ) : (
            <SafeImage src={drawerDomain?.logo || ''} fallback={DEFAULT_DOMAIN_LOGO} round={8} className="size-8 shrink-0 rounded-lg object-cover" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-base font-medium  text-[#1D1E1F]">
              <span>{drawerTitle}</span>
              {typeof drawerCount === 'number' && (
                <span className="rounded-full bg-[#F2F4F7] px-2 py-0.5 text-xs font-medium leading-4 text-[#000000]">{drawerCount}</span>
              )}
            </div>
          </div>
        </div>
        <div className="mt-0.5 text-xs font-normal leading-5 text-[#8E9AAC]">
          {scope.hint || '--'}
        </div>
      </>
    )
    : <div className="text-lg font-medium leading-6 text-[#253B5D]">{drawerTitle}</div>
  const drawerTypeOptions = scope?.kind === 'core'
    ? [{ value: 'all', label: '全部' }, { value: scope.key, label: `${scope.label}` }]
    : scope?.kind === 'situational'
      ? [{ value: 'all', label: '全部' }, ...Object.entries(CANONICAL_TYPE_LABELS).map(([value, label]) => ({ value, label: `${label}` }))]
      : []

  // 已确认列表行：编辑/删除动作 + 详情入口，行渲染复用 CognitionRow
  const renderDrawerCognition = (item: RecordingCognition) => (
    <CognitionRow
      key={String(item.id)}
      item={item}
      showLifecycle
      onClick={onOpenDetail}
      actions={
        <>
          <IconAction variant="row" title="编辑" onClick={() => beginEditCognition(item)}>
            <EditOutlined />
          </IconAction>
          <IconAction variant="row" danger title="删除" onClick={() => remove(item)}>
            <DeleteOutlined />
          </IconAction>
        </>
      }
    />
  )

  const renderDrawerCognitionList = (list: RecordingCognition[]) => (
    <div className="space-y-3">{list.map(renderDrawerCognition)}</div>
  )

  return (
    <Drawer
      size={800}
      placement="right"
      open={open}
      push={false}
      onClose={onClose}
      title={drawerHeader}
      destroyOnHidden
    >
      {scope && (
        <div className="flex h-full min-h-0 flex-col">
          <div className="mb-4 flex gap-2">
            <div>
              <Search
                value={keyword}
                mode="expanded"
                placeholder="搜索"
                onDebouncedChange={setKeyword}
              />
            </div>
            {scope?.kind === 'situational' && (
              <Select className="w-[152px] shrink-0" value={typeFilter} prefix={<span className="text-[#9CA3AF]">类型：</span>} options={drawerTypeOptions} onChange={setTypeFilter} />
            )}
            <Select className="w-[172px] shrink-0" value={sourceFilter} prefix={<span className="text-[#9CA3AF]">添加方式：</span>} options={SOURCE_FILTER_OPTIONS} onChange={setSourceFilter} />
            <div className="flex-1"></div>
            <Button type="primary" onClick={() => onAdd(scope)}>添加</Button>
          </div>
          {pendingCount > 0 && (
            <button
              type="button"
              onClick={() => setPendingOpen(true)}
              className="mb-3 flex w-full items-center gap-2 rounded-lg bg-[#EEF5FF] px-3 py-2 text-left text-xs leading-5 text-[#373A3D] transition-colors hover:bg-[#E5F0FF]"
            >
              <WarningOutlined className="text-[#F0A400]" />
              <span className="flex-1">您有 {pendingCount} 个待确认的认知</span>
              <RightOutlined className="text-[#4D7FE8]" />
            </button>
          )}
          <div ref={confirmedListRef} className="min-h-0 flex-1 overflow-auto pr-1">
            {loading ? (
              <div className="flex h-48 items-center justify-center">
                <Spin />
              </div>
            ) : items.length ? (
              <>
                {renderDrawerCognitionList(items)}
                <div ref={sentinelRef} className="flex items-center justify-center py-3 text-xs text-[#9CA3AF]">
                  {loadingMore ? <Spin size="small" /> : items.length < itemsTotal ? null : '已经到底啦'}
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center">
                <Empty image={getPublicPath('/images/empty.png')} description="暂无数据" />
              </div>
            )}
          </div>
        </div>
      )}
      <PendingCognitionDrawer
        layer={scope?.kind || 'core'}
        domainId={scope?.kind === 'situational' ? scope.id : undefined}
        cognitionType={scope?.kind === 'core' ? scope.key : undefined}
        open={pendingOpen}
        onClose={() => setPendingOpen(false)}
        placement="bottom"
      />
      <CognitionEditorModal
        open={Boolean(editingCognition)}
        initial={editingCognition}
        onClose={() => setEditingCognition(null)}
        onSaved={applyCognitionSaved}
      />
    </Drawer>
  )
}

export default CognitionDrawer