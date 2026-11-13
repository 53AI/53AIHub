import { useEffect, useRef, useState } from 'react'
import { Button, Drawer, Empty, Modal, Select, Spin, message } from 'antd'
import {
  CheckOutlined,
  DeleteOutlined,
  EditOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { IconAction } from '@km/shared-components-react'
import { useInfiniteScroll } from '@/hooks'
import recordingApi from '@/api/modules/recording'
import type { RecordingCognitionCandidate } from '@/api/modules/recording/types'
import { CognitionRow } from './CognitionRow'
import { CandidateEditorModal, type CandidateEditorInit, type SavedCandidateFields } from './CandidateEditorModal'
import { useCognitionContext } from './CognitionContext'
import { CANONICAL_TYPE_LABELS } from '../constants'
import { getPublicPath } from '@/utils/config'

type ReviewAction = 'confirm' | 'reject'

const PAGE_SIZE = 20

// 类型筛选选项：全部 + 七类标准认知（原则/价值排序/判断标准/偏好/边界/前提/触发条件）
const TYPE_FILTER_OPTIONS = [
  { value: 'all', label: '全部' },
  ...Object.entries(CANONICAL_TYPE_LABELS).map(([value, label]) => ({ value, label })),
]

interface PendingCognitionDrawerProps {
  open: boolean
  onClose: () => void
  /**
   * 出场方位。全局入口（认知页统计卡）用 right：右侧全高独立抽屉；
   * 认知抽屉内嵌入口沿用 bottom：底部 88vh 上滑、贴右 800 宽，与原实现一致。
   */
  layer?: 'core' | 'situational'
  domainId?: string | number
  cognitionType?: string
  placement?: 'right' | 'bottom'
}

/**
 * 全局「待确认认知」抽屉：列出所有待老板确认的认知候选，支持编辑 / 忽略 / 确认。
 *
 * 筛选：抽屉内可按类型（原则/价值排序/…）筛选，与核心认知/领域认知抽屉的
 * 类型筛选同口径；外部传入的 layer/domainId/cognitionType 作为入口预筛
 * （认知抽屉内嵌入口带作用域进来），用户可在抽屉内自行改选。
 * 审核/编辑等写操作经 `refreshAfterMutation(true)` 递增 pendingTick，
 * 本组件据此原地重拉第一页。
 */
export function PendingCognitionDrawer({ layer, domainId, cognitionType, open, onClose, placement = 'right' }: PendingCognitionDrawerProps) {
  const { refreshAfterMutation, pendingTick } = useCognitionContext()

  const [candidates, setCandidates] = useState<RecordingCognitionCandidate[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [reviewingId, setReviewingId] = useState<string | number | null>(null)
  const [editingCandidate, setEditingCandidate] = useState<CandidateEditorInit | null>(null)
  // 类型筛选：入口预筛值作初值，抽屉内可改；每次打开重置回入口预筛
  const [typeFilter, setTypeFilter] = useState<string>(cognitionType || 'all')
  const requestRef = useRef(0)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (open) setTypeFilter(cognitionType || 'all')
  }, [open, cognitionType])

  const loadFirstPage = async () => {
    const requestId = ++requestRef.current
    setLoading(true)
    const res = await recordingApi.getCognitionCandidates({
      layer,
      domain_id: domainId != null ? String(domainId) : undefined,
      cognition_type: typeFilter === 'all' ? undefined : typeFilter,
      status: 'candidate',
      offset: 0,
      limit: PAGE_SIZE,
    })
    if (requestId !== requestRef.current) return
    setCandidates(res.items || [])
    setTotal(res.total || 0)
    setLoading(false)
  }

  // 打开时拉第一页；写操作后 pendingTick 变化则重拉；筛选变化重拉，保持列表最新
  useEffect(() => {
    if (!open) return
    void loadFirstPage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pendingTick, typeFilter])

  const loadMore = async () => {    if (loading || loadingMore) return
    if (candidates.length >= total) return
    const requestId = ++requestRef.current
    setLoadingMore(true)
    // 修复：分页参数此前误传驼峰（domainId/cognitionType），接口要求下划线，
    // 且需带当前筛选（typeFilter），否则第二页起筛选条件丢失
    const res = await recordingApi.getCognitionCandidates({
      layer,
      domain_id: domainId != null ? String(domainId) : undefined,
      cognition_type: typeFilter === 'all' ? undefined : typeFilter,
      status: 'candidate',
      offset: candidates.length,
      limit: PAGE_SIZE,
    })
    if (requestId !== requestRef.current) return
    setCandidates((prev) => [...prev, ...(res.items || [])])
    setTotal(res.total || 0)
    setLoadingMore(false)
  }

  const review = async (item: RecordingCognitionCandidate, action: ReviewAction) => {
    setReviewingId(item.id)
    try {
      // 待确认候选走候选动作接口（确认转正/忽略），不走正式认知的 update/expire
      await recordingApi.reviewImportedCognitionCandidate(item.id, action)
      message.success(action === 'confirm' ? '认知已确认' : '认知已忽略')
      await refreshAfterMutation(true)
    } finally {
      setReviewingId(null)
    }
  }

  // 「删除」= 忽略；先弹确认框再走候选动作接口
  const reject = (item: RecordingCognitionCandidate) => {
    Modal.confirm({
      title: '删除认知',
      icon: <WarningOutlined />,
      content: `确定忽略「${item.title}」这条认知候选吗？`,
      okText: '删除',
      cancelText: '取消',
      onOk: () => review(item, 'reject'),
    })
  }

  // 编辑在抽屉内就近处理，便于保存后原地更新列表（不重新拉取）
  const beginEdit = (item: RecordingCognitionCandidate) => {
    setEditingCandidate({
      editingId: item.id,
      title: item.title,
      statement: item.statement,
      cognitionType: (item.cognition_type || '') as CandidateEditorInit['cognitionType'],
      layer: (item.layer || 'core') as CandidateEditorInit['layer'],
      scope: item.scope ?? [],
    })
  }

  // 编辑保存成功：仅替换对应行的可编辑字段，保持其余字段与统计计数不变
  const applyCandidateUpdate = (updated: SavedCandidateFields) => {
    setCandidates((prev) =>
      prev.map((c) => (String(c.id) === String(updated.id) ? { ...c, ...updated } : c)),
    )
    setEditingCandidate(null)
  }

  const { sentinelRef } = useInfiniteScroll({
    hasMore: candidates.length < total,
    loadingMore,
    onLoadMore: loadMore,
    rootRef: listRef,
  })

  const renderActions = (item: RecordingCognitionCandidate) => (
    <>
      <IconAction variant="row" title="编辑" onClick={() => beginEdit(item)}>
        <EditOutlined />
      </IconAction>
      <IconAction variant="row" danger title="删除" onClick={() => reject(item)}>
        <DeleteOutlined />
      </IconAction>
      <Button
        type="primary"
        size="small"
        icon={<CheckOutlined />}
        className="invisible group-hover:visible"
        loading={reviewingId === item.id}
        onClick={() => void review(item, 'confirm')}
      >
        确认
      </Button>
    </>
  )

  return (
    <Drawer
      // 全局入口：右侧全高。内嵌入口：底部 88vh 上滑，靠 wrapper 覆盖定位贴右 800 宽
      // （antd v6 的 size 在 bottom 布局下表示高度，宽度只能经 wrapper 指定）
      {...(placement === 'bottom'
        ? { placement: 'bottom' as const, size: '88vh', styles: { wrapper: { width: 800, left: 'auto', right: 0, marginLeft: 'auto' } } }
        : { placement: 'right' as const, size: 800 })}
      title="待确认"
      open={open}
      onClose={onClose}
      destroyOnHidden
    >
      <div className="flex h-full min-h-0 flex-col">
        {/* 类型筛选：与核心认知/领域认知抽屉同口径（全部 + 七类标准认知） */}
        <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
          <Select
            className="w-[152px] shrink-0"
            value={typeFilter}
            prefix={<span className="text-[#9CA3AF]">类型：</span>}
            options={TYPE_FILTER_OPTIONS}
            onChange={setTypeFilter}
          />
          <span className="text-xs text-[#9CA3AF]">共 {total} 条</span>
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-auto pr-1">
          {loading ? (
            <div className="flex h-48 items-center justify-center">
              <Spin />
            </div>
          ) : candidates.length ? (
            <>
              <div className="space-y-3">
                {candidates.map((item) => (
                  <CognitionRow placement={placement} key={String(item.id)} item={item} actions={renderActions(item)} />
                ))}
              </div>
              <div ref={sentinelRef} className="flex items-center justify-center py-3 text-xs text-[#9CA3AF]">
                {loadingMore ? <Spin size="small" /> : candidates.length < total ? null : '已经到底啦'}
              </div>
            </>
          ) : (
            <Empty image={getPublicPath('/images/empty.png')} description="暂无待确认的认知" />
          )}
        </div>
      </div>
      <CandidateEditorModal
        open={Boolean(editingCandidate)}
        initial={editingCandidate}
        onClose={() => setEditingCandidate(null)}
        onSaved={applyCandidateUpdate}
      />
    </Drawer>
  )
}

export default PendingCognitionDrawer
