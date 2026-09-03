import { CloseOutlined, DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Drawer, Empty, Modal, Spin, Table, Tooltip, message } from 'antd';
import type { TableColumnsType } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import Header from '@/components/Layout/Header';
import recordingApi from '@/api/modules/recording';
import { Search } from '@km/shared-components-react';
import type {
  RecordingMemoryEntityDetail,
  RecordingMemoryEntityItem,
  RecordingMemoryEntitySchemas,
  RecordingMemoryEntityType,
} from '@/api/modules/recording/types';
import { t } from '@/locales';
import { getSimpleDateFormatString } from '@km/shared-utils';
import { EntityFormDrawer } from './components/EntityFormDrawer';
import { FactCard } from './components/FactCard';
import { MemoryKnowledgeGraph } from './components/MemoryKnowledgeGraph';
import { MergeEntityModal } from './components/MergeEntityModal';
import { factEntityTypeLabel, formatSourceFile, isEnumAttribute } from './components/utils';

export function RecordingMemoryHomeView() {
  const [items, setItems] = useState<RecordingMemoryEntityItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [activeType, setActiveType] = useState<RecordingMemoryEntityType | 'all'>('all')
  const [keyword, setKeyword] = useState('')
  // 分页：参考 order/index.tsx，Table 内置 pagination 走 showSizeChanger。
  // filter 变化（搜索关键词 / 类型 tab）时由各 onChange 同步重置 currentPage 到 1。
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [selected, setSelected] = useState<RecordingMemoryEntityDetail | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingEntity, setEditingEntity] = useState<RecordingMemoryEntityDetail | null>(null)
  const [editDrawerOpen, setEditDrawerOpen] = useState(false)
  const [addDrawerOpen, setAddDrawerOpen] = useState(false)
  // 主页 tabs: 经营记忆(列表/统计) | 知识图谱(G6 力导向图)。
  // 默认进入经营记忆 tab,符合现有用户路径;切到知识图谱时不需要重新拉 schema/entity 列表。
  const [activeTab, setActiveTab] = useState<'memory' | 'graph'>('memory')
  // 记忆融合:仅当恰好选中 2 个实体时才允许点击。
  // selectedIds 用全量列表的 id 集合跟踪;切页 / 切类型后 Ant Design 自动丢弃不在 dataSource 里的 key,
  // 这里再 defensive 在 activeType / activeTab / keyword 变化时清空,避免跨筛选态的脏选择。
  const [mergeSelectedIds, setMergeSelectedIds] = useState<Array<string | number>>([])
  const [mergeOpen, setMergeOpen] = useState(false)

  // Schema 缓存：进入页面时拉一次，整页使用。中性名/枚举值全部来自后端，
  // 避免新增实体类型或枚举时需要前端发版。
  const [schema, setSchema] = useState<RecordingMemoryEntitySchemas | null>(null)
  const [schemaError, setSchemaError] = useState<string | null>(null)

  // 列表请求 token：每次自增，写回前判当前 token 是否仍生效，旧请求丢弃。
  // 防搜索 / 翻页连续触发时后到先到覆盖。
  const loadTokenRef = useRef(0)

  // 详情 / 编辑打开 token：用户连点不同行时，只有最后一次点击的 setSelected 生效。
  const openTokenRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    recordingApi
      .getMemorySchema()
      .then((data) => {
        if (cancelled) return
        setSchema(data)
      })
      .catch((e: any) => {
        if (cancelled) return
        setSchemaError(e?.message ?? '实体 schema 加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [])

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
      message.error('会议记忆加载失败，请稍后重试')
    } finally {
      if (myToken === loadTokenRef.current) setLoading(false)
    }
  }, [activeType, keyword, currentPage, pageSize])

  useEffect(() => {
    const timer = window.setTimeout(loadEntities, keyword ? 260 : 0)
    return () => window.clearTimeout(timer)
  }, [loadEntities, keyword])

  const openEntity = async (item: RecordingMemoryEntityItem) => {
    const myToken = ++openTokenRef.current
    setDrawerOpen(true)
    setSelected(null)
    try {
      const detail = await recordingApi.getMemoryEntity(item.id)
      if (myToken !== openTokenRef.current) return
      setSelected(detail)
    } catch {
      if (myToken !== openTokenRef.current) return
      message.error('记忆详情加载失败')
      setDrawerOpen(false)
    }
  }

  // 从 table 行 hover 编辑按钮进入：fetch 详情后切到编辑 Drawer。
  const openEditEntity = async (item: RecordingMemoryEntityItem) => {
    const myToken = ++openTokenRef.current
    try {
      const detail = await recordingApi.getMemoryEntity(item.id)
      if (myToken !== openTokenRef.current) return
      setEditingEntity(detail)
      setEditDrawerOpen(true)
    } catch {
      if (myToken !== openTokenRef.current) return
      message.error('记忆详情加载失败，无法进入编辑')
    }
  }

  const openAddEntity = () => {
    setAddDrawerOpen(true)
  }

  // 详情 Drawer 右上角「编辑」入口：复用已加载的 selected 详情，切到编辑 Drawer。
  const openEditFromDetail = () => {
    if (!selected) return
    setEditingEntity(selected)
    setEditDrawerOpen(true)
    setDrawerOpen(false)
  }

  const removeEntityFromTable = async (item: RecordingMemoryEntityItem) => {
    await recordingApi.deleteMemoryEntity(item.id)
    message.success(t('memory.delete_success'))
    loadEntities()
  }

  /** 类型中文名：取自 schema，未知类型直接回退到原始 key。 */
  const entityTypeLabel = (type: string) => schema?.find((s) => s.type === type)?.label ?? type

  /** 把 schema 的 attribute 展开为详情字段定义。 */
  const attributeFieldDefs = selected && schema
    ? (schema.find((s) => s.type === selected.entity_type)?.attributes.map((attr) => ({
        key: attr.key,
        label: attr.label,
      })) ?? [])
    : []

  /** 展示某属性值：有枚举候选则翻成中文，否则原样展示（自由文本）。 */
  const renderAttributeValue = (type: RecordingMemoryEntityType, key: string, value: string | undefined) => {
    if (value === undefined || value === null || value === '') return '--'
    const values = schema?.find((s) => s.type === type)?.attributes.find((a) => a.key === key)?.values
    if (isEnumAttribute(values)) return values.find((v) => v.value === value)?.label ?? value
    return value
  }

  // 类型 tab 列表：'全部' 始终是第一个 UI 入口，其余按 schema 顺序展开。
  const typeTabs: Array<{ key: RecordingMemoryEntityType | 'all'; label: string }> = schema
    ? [{ key: 'all', label: '全部' }, ...schema.map((s) => ({ key: s.type, label: s.label }))]
    : [{ key: 'all', label: '全部' }]

  // 记忆融合:从当前页 items 里按 selectedIds 顺序取出选中的实体;
  // 切页 / 切类型 / 切搜索词时 selectedIds 已被 reset,这里防御性地再查一次,
  // 任一 id 不在 items(已离开当前页)就视为不可融合,不开弹窗。
  const mergeEntities: [RecordingMemoryEntityItem, RecordingMemoryEntityItem] | null = (() => {
    if (mergeSelectedIds.length !== 2) return null
    const e0 = items.find((i) => i.id === mergeSelectedIds[0])
    const e1 = items.find((i) => i.id === mergeSelectedIds[1])
    if (!e0 || !e1) return null
    return [e0, e1]
  })()

  // 仅当两个实体的 entity_type 相同时才允许融合(异类记忆语义不通,合并会污染 recall)。
  const sameType = mergeEntities
    ? mergeEntities[0].entity_type === mergeEntities[1].entity_type
    : false

  // 实体记忆列表列定义：参考 chunk.tsx 知识列表的 Table 结构。
  // 列顺序：实体 / 类型 / 记忆内容 / 关联 / 更新人 / 最近更新 / 操作。
  // 所有列的字体 / 颜色 / 间距与 EntityRow 里的实体行展示一致：
  //   主信息（实体）text-sm text-[#1D1E1F]，
  //   次信息（记忆内容 / 关联 / 更新人 / 最近更新）text-xs text-[#999999]，
  //   类型沿用 meta 色调的圆角 chip。
  // 关联 / 更新人后端列表接口暂未提供，统一显示 "--"，保持列位稳定避免后续接口补齐时位移。
  // 操作列只暴露"查看"，行 hover 时显示（invisible group-hover:visible），与 chunk.tsx 的行操作一致。
  const entityColumns: TableColumnsType<RecordingMemoryEntityItem> = [
    {
      title: '实体',
      dataIndex: 'canonical_name',
      key: 'canonical_name',
      minWidth: 200,
      ellipsis: true,
      render: (name: string) => (
        <span className="block truncate text-sm text-[#1D1E1F] group-hover:text-blue-600 transition-colors">{name}</span>
      ),
    },
    {
      title: '类型',
      dataIndex: 'entity_type',
      key: 'entity_type',
      width: 100,
      render: (_: RecordingMemoryEntityType, record) => (
        <span className="truncate text-sm text-[#1D1E1F]">{entityTypeLabel(record.entity_type)}</span>
      ),
    },
    {
      title: '记忆内容',
      dataIndex: 'summary',
      key: 'summary',
      minWidth: 240,
      ellipsis: true,
      render: (summary: string) => (
        <span className="truncate text-sm text-[#1D1E1F]">{summary || '尚未形成总结性描述'}</span>
      ),
    },
    {
      title: '关联',
      dataIndex: 'fact_count',
      key: 'fact_count',
      width: 80,
      render: (fact_count: number) => <span className="truncate text-sm text-[#1D1E1F]">{fact_count || 0}</span>,
    },
    {
      title: '最近更新',
      dataIndex: 'updated_time',
      key: 'updated_time',
      width: 160,
      render: (ts: number) => <span className="truncate text-sm text-[#1D1E1F]">{ts ? getSimpleDateFormatString({ date: ts, format: 'YYYY-MM-DD hh:mm' }) : '--'}</span>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 130,
      align: 'right',
      render: (_: unknown, record) => (
        <div className="flex items-center gap-1 justify-end invisible group-hover:visible transition-colors">
          <Tooltip title="查看">
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined />}
              className="!text-[#2563EB]"
              onClick={(e) => {
                e.stopPropagation()
                openEntity(record)
              }}
            />
          </Tooltip>
          <Tooltip title="编辑">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              className="!text-[#2563EB]"
              onClick={(e) => {
                e.stopPropagation()
                openEditEntity(record)
              }}
            />
          </Tooltip>
          <Tooltip title="删除">
              <Button
                type="text"
                size="small"
                icon={<DeleteOutlined />}
                className="!text-red-500"
                onClick={(e) => {
                  e.stopPropagation()
                  Modal.confirm({
                    title: t('memory.delete_confirm_title'),
                    content: (
                      <div>
                        <p className="text-sm text-[#1D1E1F]">{record.canonical_name}</p>
                        <p className="mt-3 text-sm text-[#9CA3AF]">{t('memory.delete_confirm_desc')}</p>
                      </div>
                    ),
                    okText: t('memory.delete_confirm_ok'),
                    okButtonProps: { danger: true },
                    cancelText: t('memory.delete_confirm_cancel'),
                    onOk: () => removeEntityFromTable(record),
                  })
                }}
              />
            </Tooltip>
        </div>
      ),
    },
  ]

  return (
    <div className="flex-1 min-w-0 h-full overflow-auto bg-[#FAFBFD] text-[#1D1E1F]">
      <Header title={t("library.home")} border={false} />
      {schemaError ? (
        <div className="mx-auto min-h-full w-11/12 lg:w-4/5 max-w-[1200px] p-6">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={schemaError} />
        </div>
      ) : !schema ? (
        <div className="flex h-[60vh] items-center justify-center"><Spin size="large" tip="加载中..." /></div>
      ) : (
      <div className="mx-auto w-11/12 lg:w-4/5 max-w-[1200px] p-6">

        {/* <h2 className="mb-6 text-base font-medium text-[#1D1E1F]">数据统计</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6 mb-8">
          <div className="bg-white rounded-xl px-5 py-6 flex items-center gap-3">
            <div className="flex-none size-12 rounded-xl bg-[#ecfdf5] text-[#10b981] flex items-center justify-center text-xl">
              <SvgIcon name="success" size={24} />
            </div>
            <div className="flex-1">
              <p className="text-[#999999] text-sm mb-1 font-medium">记忆总数</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-[#1D1E1F]">128</span>
                <span className="text-sm text-[#1D1E1F]">个</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl px-5 py-6 flex items-center gap-3">
            <div className="flex-none size-12 rounded-xl bg-[#eff6ff] text-[#3b82f6] flex items-center justify-center text-xl">
              <SvgIcon name="list-numbers" size={24} />
            </div>
            <div className="flex-1">
              <p className="text-[#999999] text-sm mb-1 font-medium">进行中承诺数</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-[#1D1E1F]">543</span>
                <span className="text-sm text-[#1D1E1F]">条</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl px-5 py-6 flex items-center gap-3">
            <div className="flex-none size-12 rounded-xl bg-[#fff1f2] text-[#f43f5e] flex items-center justify-center text-xl">
              <SvgIcon name="file-failed" size={24} />
            </div>
            <div className="flex-1">
              <p className="text-[#999999] text-sm mb-1 font-medium">活跃风险源</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-[#1D1E1F]">4</span>
                <span className="text-sm text-[#1D1E1F]">类</span>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl px-5 py-6 flex items-center gap-3">
            <div className="flex-none size-12 rounded-xl bg-[#fff7ed] text-[#f97316] flex items-center justify-center text-xl">
              <SvgIcon name="time" size={24} />
            </div>
            <div className="flex-1">
              <p className="text-[#999999] text-sm mb-1 font-medium">长期原则规范</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-[#1D1E1F]">89</span>
                <span className="text-sm text-[#1D1E1F]">对</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl px-5 py-6 flex items-center gap-3">
            <div className="flex-none size-12 rounded-xl bg-[#fff1f2] text-[#f43f5e] flex items-center justify-center text-xl">
              <SvgIcon name="file-failed" size={24} />
            </div>
            <div className="flex-1">
              <p className="text-[#999999] text-sm mb-1 font-medium">干系人物档案</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-[#1D1E1F]">4</span>
                <span className="text-sm text-[#1D1E1F]">类</span>
              </div>
            </div>
          </div>
        </div> */}

        {/* <Tabs
          variant="underline"
          tabClassName="!text-base"
          className="mb-6"
          activeKey={activeTab}
          onChange={(key) => {
            setActiveTab(key as 'memory' | 'graph')
            // 切 tab 后记忆融合的选择不再适用,清掉避免下次切回时残留。
            setMergeSelectedIds([])
          }}
          items={[
            { key: 'memory', label: '经营记忆' },
            // { key: 'graph', label: '知识图谱' },
          ]}
        /> */}

        <h3 className="mb-5 text-base font-medium text-[#1D1E1F]">经营记忆</h3>

        {activeTab === 'memory' ? (
          <>
            <div className="mb-5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
 
                <div className="flex bg-[#F6F7F7] p-1 rounded-lg w-fit">
                  {typeTabs.map((option) => (
                    <button
                      type="button"
                      key={option.key}
                      onClick={() => {
                        setActiveType(option.key)
                        setCurrentPage(1)
                        setMergeSelectedIds([])
                      }}
                      className={`px-4 h-8 text-base transition-all rounded flex items-center ${
                        activeType === option.key
                          ? 'bg-white text-[#2563EB] shadow-sm'
                          : 'text-[#999999] hover:text-[#1e293b]'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Search
                  mode="expanded"
                  value={keyword}
                  placeholder="搜索记忆实体名称或内容"
                  debounceMs={260}
                  className="w-full lg:w-[280px]"
                  onDebouncedChange={(val) => {
                    setKeyword(val)
                    setCurrentPage(1)
                    setMergeSelectedIds([])
                  }}
                />
                {mergeSelectedIds.length >= 2 && (
                  <Tooltip title={sameType ? '' : t('memory.merge_type_mismatch_tip')}>
                    <span className={sameType ? undefined : 'cursor-not-allowed'}>
                      <Button
                        color="primary"
                        variant="outlined"
                        disabled={!sameType}
                        onClick={() => setMergeOpen(true)}
                      >
                        {t('memory.merge_button')}
                      </Button>
                    </span>
                  </Tooltip>
                )}
                <Button type="primary" icon={<PlusOutlined />} onClick={openAddEntity}>{t('action.add')}</Button>
              </div>
            </div>
            <section className="bg-white p-5 rounded-2xl border border-[#e2e8f0] overflow-hidden shadow-sm">
              <Table
                dataSource={items}
                columns={entityColumns}
                rowKey="id"
                rowSelection={{
                  selectedRowKeys: mergeSelectedIds,
                  // 记忆融合只允许恰好 2 个:超过 2 个时自动取消最早选中的,保证最多 2 个。
                  // 用户感觉是"勾第 3 个时把最早勾的踢掉",跟大多数批量操作的直觉一致。
                  onChange: (keys) => {
                    const next = keys as Array<string | number>
                    if (next.length <= 2) {
                      setMergeSelectedIds(next)
                    } else {
                      setMergeSelectedIds(next)
                    }
                  },
                  getCheckboxProps: () => ({}),
                }}
                loading={loading}
                pagination={{
                  total,
                  pageSize,
                  current: currentPage,
                  showSizeChanger: true,
                  showTotal: (count) => `共 ${count} 条`,
                  onChange: (page, size) => {
                    // 参考 order/index.tsx：pageSize 变化时回到第一页，避免 offset 越界拿到空列表。
                    setPageSize(size)
                    setCurrentPage(size === pageSize ? page : 1)
                    // 切页后旧 selectedRowKeys 已不在当前 dataSource,清掉避免按钮显示可点但弹窗打不开。
                    setMergeSelectedIds([])
                  },
                }}
                onRow={(record) => ({
                  onClick: () => openEntity(record),
                  className: 'group hover:bg-[#f8fafc] transition-colors cursor-pointer',
                })}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有可观察的实体记忆" /> }}
              />
            </section>
          </>
        ) : (
          <MemoryKnowledgeGraph />
        )}
      </div>
      )}

      <Drawer width={620} placement="right" open={drawerOpen} onClose={() => setDrawerOpen(false)} title="记忆详情" destroyOnClose
        closable={false}
        extra={
          <div className="flex items-center gap-2">
            <Button color="primary" size="small" variant="outlined" icon={<EditOutlined />} onClick={openEditFromDetail}>
              编辑
            </Button>
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              aria-label="关闭"
              onClick={() => setDrawerOpen(false)}
            />
          </div>
        }
      >
        {!selected ? <div className="flex h-64 items-center justify-center"><Spin /></div> : <div className="pb-5">
          <h3 className="mb-4 text-base font-medium text-[#1D1E1F]">记忆</h3>
          <div className="bg-[#F7F8FA] p-5 rounded-xl">
            <section className="border-b border-dashed border-slate-200 pb-5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-lg text-[#1D1E1F] min-w-0 truncate" title={selected.canonical_name}>{selected.canonical_name}</span>
                <span className={`shrink-0 rounded-md px-2 py-1 text-xs bg-slate-100 text-slate-600 `}>{entityTypeLabel(selected.entity_type)}</span>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-4">
                {attributeFieldDefs.length === 0 ? (
                  <p className="col-span-2 text-sm text-[#9CA3AF]">该类型暂无属性</p>
                ) : attributeFieldDefs.map((field) => {
                  const value = renderAttributeValue(selected.entity_type, field.key, selected.attributes[field.key])
                  return (
                    <div key={field.key} className="min-w-0">
                      <p className="mb-1 text-sm text-[#9CA3AF]">{field.label}</p>
                      <p className="text-sm text-[#1D1E1F] break-words" title={value}>{value}</p>
                    </div>
                  )
                })}
              </div>
            </section>
            <section className="pt-5">
              <p className="mb-2 text-sm text-[#9CA3AF]">内容</p>
              <div className="whitespace-pre-line break-words text-sm text-[#1D1E1F]">{selected.summary || '尚未形成总结性描述'}</div>
            </section>
          </div>
          <section className="py-5">
            <h3 className="text-base font-medium text-[#1D1E1F]">相关</h3>
            {selected.facts.length ? (
              <div className="relative space-y-3 before:absolute before:bottom-3 before:left-[5px] before:top-3 before:w-px before:bg-[#E8EAED]">
                {selected.facts.map((fact) => (
                  <FactCard
                    key={String(fact.id)}
                    variant="persisted"
                    time={fact.occurred_at ? getSimpleDateFormatString({ date: fact.occurred_at, format: 'YYYY-MM-DD hh:mm' }) : '--'}
                    sourceLabel={formatSourceFile(fact.source_file)}
                    body={fact.content}
                    typeLabel={factEntityTypeLabel(fact.related_type || fact.entity_type, schema)}
                  />
                ))}
              </div>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无相关数据" />}
          </section>
        </div>}
      </Drawer>

      {schema && (
        <>
          <EntityFormDrawer
            mode="edit"
            open={editDrawerOpen}
            entity={editingEntity}
            schema={schema}
            onClose={() => {
              setEditDrawerOpen(false)
              setEditingEntity(null)
            }}
            onSaved={loadEntities}
          />
          <EntityFormDrawer
            mode="add"
            open={addDrawerOpen}
            entity={null}
            schema={schema}
            onClose={() => setAddDrawerOpen(false)}
            onSaved={loadEntities}
          />
        </>
      )}

      {mergeOpen && mergeEntities && (
        <MergeEntityModal
          open={mergeOpen}
          entities={mergeEntities}
          onClose={() => {
            setMergeOpen(false)
            setMergeSelectedIds([])
          }}
          onSuccess={() => {
            setMergeSelectedIds([])
            loadEntities()
          }}
        />
      )}
    </div>
  )
}
