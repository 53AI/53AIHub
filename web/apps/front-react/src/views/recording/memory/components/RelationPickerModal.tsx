import { CloseOutlined } from '@ant-design/icons';
import { Button, Empty, Modal, Table, message } from 'antd';
import type { TableColumnsType } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Search } from '@km/shared-components-react';
import recordingApi from '@/api/modules/recording';
import type {
  RecordingMemoryEntityItem,
  RecordingMemoryEntitySchemas,
  RecordingMemoryEntityType,
} from '@/api/modules/recording/types';

// 「添加关联」选实体弹窗:tab 按 schema 顺序展开(全部 / 人物 / 事项 / 风险 / 原则),
// 搜索 + 表格 + 分页 + 底部「已选择 X 个 / 取消 / 确定」。
// excludeEntityId 在编辑模式下传入当前实体 id,避免把实体链到自己。
// excludeFactsIds 传入当前实体已关联的实体 id 列表(已保存的 facts + 暂存中的 picks),
// 弹窗里禁用这些行,避免重复添加。
export function RelationPickerModal({
  open,
  onClose,
  onConfirm,
  schema,
  excludeEntityId,
  excludeFactsIds = [],
}: {
  open: boolean
  onClose: () => void
  onConfirm: (entities: RecordingMemoryEntityItem[]) => void
  schema: RecordingMemoryEntitySchemas
  excludeEntityId?: string | number
  excludeFactsIds?: Array<string | number>
}) {
  const [activeType, setActiveType] = useState<RecordingMemoryEntityType | 'all'>('all')
  const [keyword, setKeyword] = useState('')
  const [items, setItems] = useState<RecordingMemoryEntityItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  // 选中态仅在当前页内保留(跨页选择会丢),由父组件在「确定」时一次性取走。
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set())
  // 列表请求 token：搜索 / 翻页 / 切 tab 连续触发时,只让最后一次的 setItems 生效。
  const loadTokenRef = useRef(0)

  // tab 派生自 schema,后端增减类型时前端无需发版。
  const typeTabs: Array<{ key: RecordingMemoryEntityType | 'all'; label: string }> = [
    { key: 'all', label: '全部' },
    ...schema.map((s) => ({ key: s.type, label: s.label })),
  ]

  const typeLabel = (type: string) => schema.find((s) => s.type === type)?.label ?? type

  const loadEntities = useCallback(async () => {
    const myToken = ++loadTokenRef.current
    setLoading(true)
    try {
      const data = await recordingApi.getMemoryEntities({
        entity_type: activeType === 'all' ? undefined : activeType,
        keyword: keyword.trim() || undefined,
        offset: (currentPage - 1) * pageSize,
        limit: pageSize,
      })
      if (myToken !== loadTokenRef.current) return
      setItems(data.items || [])
      setTotal(data.total || 0)
    } catch {
      if (myToken !== loadTokenRef.current) return
      message.error('实体列表加载失败')
    } finally {
      if (myToken === loadTokenRef.current) setLoading(false)
    }
  }, [activeType, keyword, currentPage, pageSize])

  useEffect(() => {
    if (!open) return
    loadEntities()
  }, [open, loadEntities])

  // 每次打开重置:避免上次打开留下的选中态 / 搜索词 / tab 状态泄露。
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set())
      setActiveType('all')
      setKeyword('')
      setCurrentPage(1)
    }
  }, [open])

  const columns: TableColumnsType<RecordingMemoryEntityItem> = [
    {
      title: '实体',
      dataIndex: 'canonical_name',
      key: 'canonical_name',
      ellipsis: true,
      render: (name: string) => (
        <span className="text-sm text-[#1D1E1F]">{name}</span>
      ),
    },
    {
      title: '类型',
      dataIndex: 'entity_type',
      key: 'entity_type',
      width: 100,
      render: (_: RecordingMemoryEntityType, record) => (
        <span className="text-sm text-[#1D1E1F]">{typeLabel(record.entity_type)}</span>
      ),
    },
    {
      title: '记忆内容',
      dataIndex: 'summary',
      key: 'summary',
      ellipsis: true,
      render: (summary: string) => (
        <span className="text-sm text-[#1D1E1F]">{summary || '尚未形成总结性描述'}</span>
      ),
    },
  ]

  const handleConfirm = () => {
    const selected = items.filter((item) => selectedIds.has(item.id))
    onConfirm(selected)
    onClose()
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={920}
      title="关联"
      closeIcon={<CloseOutlined className="text-[#999999] hover:!text-[#1D1E1F]" />}
      styles={{ body: { padding: 0, maxHeight: '70vh', overflowY: 'auto' } }}
      footer={
        <div className="flex items-center justify-between">
          <span className="text-sm text-[#1D1E1F]">已选择 {selectedIds.size} 个</span>
          <div className="flex gap-2">
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" disabled={selectedIds.size === 0} onClick={handleConfirm}>
              确定
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-wrap shrink-0 items-center justify-between gap-2 pb-4">
        <div className="flex flex-wrap gap-1">
          {typeTabs.map((tab) => (
            <button
              type="button"
              key={tab.key}
              onClick={() => {
                setActiveType(tab.key)
                setCurrentPage(1)
              }}
              className={`px-3 py-1.5 text-sm rounded transition-colors ${
                activeType === tab.key
                  ? 'bg-[#2563EB]/10 text-[#2563EB] font-medium'
                  : 'text-[#1D1E1F] hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <Search
          mode="expanded"
          value={keyword}
          placeholder="搜索"
          debounceMs={260}
          className="w-[200px]"
          onDebouncedChange={(val) => {
            setKeyword(val)
            setCurrentPage(1)
          }}
        />
      </div>

      <Table
        dataSource={items}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{
          current: currentPage,
          pageSize,
          total,
          showSizeChanger: true,
          showQuickJumper: true,
          showTotal: (count) => `共有 ${count} 个`,
          pageSizeOptions: ['10', '20', '50'],
          onChange: (page, size) => {
            setCurrentPage(page)
            setPageSize(size)
          },
        }}
        rowSelection={{
          selectedRowKeys: Array.from(selectedIds),
          onChange: (keys) => setSelectedIds(new Set(keys as Array<string | number>)),
          getCheckboxProps: (record) => ({
            disabled:
              record.id === excludeEntityId || excludeFactsIds.includes(record.id),
          }),
        }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有可选的实体" /> }}
      />
    </Modal>
  )
}
