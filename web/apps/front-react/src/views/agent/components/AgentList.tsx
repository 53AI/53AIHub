import { useState, useMemo } from 'react'
import { PlusOutlined } from '@ant-design/icons'
import { AgentCard, AgentCardSkeleton, AgentEmpty } from './AgentCard'
import { useAgentStore } from '@/stores/modules/agent'
import { checkPermission } from '@/utils/permission'
import AddMyList from './AddMyList'
import { t } from '@/locales'

interface AgentListProps {
  list?: Agent.State[]          // 探索模式传入列表
  loading?: boolean             // 探索模式传入加载状态
  keyword?: string              // 关键词搜索
  type: 'explore' | 'my'        // 模式：探索/我的
  sort?: 'created_time' | 'updated_time'  // 我的模式排序
  groupId?: number              // 当前分组ID（探索模式）
  className?: string
  onRefresh?: () => void        // 我的模式刷新回调
  selectMode?: boolean          // 选择模式
  flatMode?: boolean            // 扁平渲染模式
  canView?: boolean
  /** 分页模式：当前页（1-based）；与 pageSize 配合使用 */
  page?: number
  /** 分页模式：每页条数。设置后启用切片 */
  pageSize?: number
  /** 选中 Agent 时的回调（透传给卡片，用于关闭外层 Modal 等） */
  onSelect?: () => void
}

export function AgentList({
  list = [],
  loading = false,
  keyword = '',
  type = 'explore',
  sort = 'created_time',
  groupId,
  className,
  onRefresh,
  selectMode = false,
  flatMode = false,
  canView = true,
  page = 1,
  pageSize,
  onSelect,
}: AgentListProps) {
  const agentStore = useAgentStore()
  const [showAddDialog, setShowAddDialog] = useState(false)

  // 探索模式：过滤传入的列表
  // 我的模式：从 store 获取列表并排序
  const showList = useMemo(() => {
    let result = type === 'explore' ? list : [...agentStore.myAgentList]

    // 我的模式排序
    if (type === 'my') {
      const sortKey = sort === 'created_time' ? 'created_time' : 'updated_time'
      result.sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0))
    }

    // 关键词过滤
    const kw = keyword.trim().toLowerCase()
    if (kw) {
      result = result.filter((item) =>
        item.name.toLowerCase().includes(kw) || item.description?.toLowerCase().includes(kw)
      )
    }

    // 分页切片（在过滤/排序之后）
    if (pageSize && pageSize > 0) {
      const start = (page - 1) * pageSize
      result = result.slice(start, start + pageSize)
    }

    return result
  }, [type, list, agentStore.myAgentList, keyword, sort, page, pageSize])

  // 加载状态判断
  const isLoading = type === 'explore' ? loading : agentStore.myAgentLoading

  // 添加 Agent（仅我的模式）
  const handleAddAgent = () => {
    checkPermission({
      onClick: () => {
        setShowAddDialog(true)
      }
    })
  }

  {/* 空状态 */}
  if(!isLoading && type !== 'my' && showList.length === 0) {
    return <AgentEmpty className="max-h-[600px] h-[63vh] flex-center" />
  }

  return (
      <div className={flatMode ? `flex flex-col gap-2 ${className}` : className}>
        {/* 我的模式：添加卡片（扁平模式隐藏） */}
        {type === 'my' && !flatMode && (
          <div
            className="min-h-[130px] relative flex items-center justify-center p-4 rounded-lg overflow-hidden border border-[#E8EEFA] bg-[#F7FAFF] hover:bg-[#F5F8FF] cursor-pointer transition-all duration-300"
            onClick={handleAddAgent}
          >
            <div className="size-10 rounded-lg bg-[#E6EEFF] flex items-center justify-center mr-2">
              <PlusOutlined style={{ fontSize: 16, color: '#2563EB' }} />
            </div>
            <span className="text-sm text-[#2563EB]">{t('action.add')}</span>
          </div>
        )}

        {/* 加载骨架屏 */}
        {isLoading && (
          <>
            {Array.from({ length: type === 'my' ? 5 : 6 }).map((_, i) => (
              <AgentCardSkeleton key={i} flatMode={flatMode} />
            ))}
          </>
        )}

        {/* Agent 卡片列表 */}
        {!isLoading && showList.length > 0 && (
          <>
            {showList.map((item) => (
              <AgentCard
                key={item.agent_id}
                item={item}
                keyword={keyword}
                type={type}
                groupId={groupId}
                canView={canView}
                fixedType={type === 'my' ? 'Openclaw' : undefined}
                onRefresh={onRefresh}
                selectMode={selectMode}
                flatMode={flatMode}
                showTypeTag={!flatMode}
                onSelect={onSelect}
              />
            ))}
          </>
        )}

        {/* 我的模式：添加弹窗 */}
        {type === 'my' && (
          <AddMyList
            visible={showAddDialog}
            onClose={() => setShowAddDialog(false)}
            onSuccess={() => {
              onRefresh?.()
            }}
          />
        )}
      </div>
  )
}

export default AgentList