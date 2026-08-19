import { DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import { Button, Drawer, Empty, Form, Input, Modal, Popconfirm, Select, Spin, Table, Tooltip, message } from 'antd';
import type { TableColumnsType } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import Header from "@/components/Layout/Header";
import recordingApi from '@/api/modules/recording';
import { Search } from '@km/shared-components-react';
import type {
  RecordingMemoryEntityDetail, RecordingMemoryEntityItem,
  RecordingMemoryEntitySchemas,
  RecordingMemoryEntityType
} from '@/api/modules/recording/types';
import { t } from '@/locales';
import { getSimpleDateFormatString } from '@km/shared-utils';


/** 自由文本属性 → 没有枚举映射，直接展示原值 */
function isEnumAttribute(values: Record<string, string> | undefined): values is Record<string, string> {
  return !!values && Object.keys(values).length > 0
}

// source_file 可能是后端返回的完整路径（包含目录前缀），时间线展示只取 basename。
// 出现双重后缀时（如 "xxx.m4a.md"）沿用 share/recording.tsx 的 stripLastExtension 处理：
// 仅当去掉最后一个后缀后剩余部分仍包含「.」时，才认定是双重后缀，剥掉一层；
// 否则原样返回，保留真实扩展名。
function formatSourceFile(path: string) {
  if (!path) return ''
  const segments = path.split(/[\\/]/).filter(Boolean)
  const basename = segments.length ? segments[segments.length - 1] : path
  const lastDot = basename.lastIndexOf('.')
  if (lastDot <= 0) return basename
  if (basename.slice(0, lastDot).includes('.')) {
    return basename.slice(0, lastDot)
  }
  return basename
}


const factEntityTypeLabel = (
  type: RecordingMemoryEntityType | string,
  schema: RecordingMemoryEntitySchemas | null,
) => schema?.[type as RecordingMemoryEntityType]?.label ?? type

export function RecordingMemoryHomeView() {
  const [items, setItems] = useState<RecordingMemoryEntityItem[]>([])
  const [candidateItems, setCandidateItems] = useState<RecordingMemoryEntityItem[]>([])
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
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [addingFact, setAddingFact] = useState(false)
  const [factText, setFactText] = useState('')
  const [correctionAttributes, setCorrectionAttributes] = useState<Record<string, string>>({})
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeTarget, setMergeTarget] = useState<string | number>()
  const [relationTarget, setRelationTarget] = useState<string | number>()
  const [form] = Form.useForm()

  // Schema 缓存：进入页面时拉一次，整页使用。中性名/枚举值全部来自后端，
  // 避免新增实体类型或枚举时需要前端发版。
  const [schema, setSchema] = useState<RecordingMemoryEntitySchemas | null>(null)
  const [schemaError, setSchemaError] = useState<string | null>(null)

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
    setLoading(true)
    try {
      const data = await recordingApi.getMemoryEntities({
        entity_type: activeType === 'all' ? undefined : activeType,
        keyword: keyword.trim() || undefined,
        offset: (currentPage - 1) * pageSize,
        limit: pageSize,
      })
      setItems(data.items || [])
      setTotal(data.total || 0)
    } catch {
      message.error('会议记忆加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [activeType, keyword, currentPage, pageSize])

  useEffect(() => {
    const timer = window.setTimeout(loadEntities, keyword ? 260 : 0)
    return () => window.clearTimeout(timer)
  }, [loadEntities, keyword])

  const loadCandidateItems = useCallback(async () => {
    const candidates: RecordingMemoryEntityItem[] = []
    let offset = 0
    let total = 0
    do {
      const page = await recordingApi.getMemoryEntities({ limit: 100, offset })
      candidates.push(...(page.items || []))
      total = page.total || 0
      offset += page.items?.length || 0
      if (!page.items?.length) break
    } while (candidates.length < total)
    return candidates
  }, [])

  const openEntity = async (item: RecordingMemoryEntityItem) => {
    setDrawerOpen(true)
    setEditing(false)
    setSelected(null)
    try {
      const detail = await recordingApi.getMemoryEntity(item.id)
      setSelected(detail)
      form.setFieldsValue({ canonical_name: detail.canonical_name, summary: detail.summary, attributes: detail.attributes })
      void loadCandidateItems().then(setCandidateItems).catch(() => message.warning('关联实体加载失败，可稍后重试'))
    } catch {
      message.error('记忆详情加载失败')
      setDrawerOpen(false)
    }
  }

  const beginEdit = () => {
    if (!selected) return
    form.setFieldsValue({ canonical_name: selected.canonical_name, summary: selected.summary, attributes: selected.attributes })
    setEditing(true)
  }

  const saveEntity = async () => {
    if (!selected) return
    const values = await form.validateFields()
    setSaving(true)
    try {
      const changedAttributes = Object.fromEntries(Object.entries(values.attributes || {}).filter(([key, value]) => value !== selected.attributes[key]))
      const detail = await recordingApi.updateMemoryEntity(selected.id, {
        canonical_name: values.canonical_name,
        summary: values.summary,
        attributes: Object.keys(changedAttributes).length ? changedAttributes : undefined,
      })
      setSelected(detail)
      setEditing(false)
      message.success('记忆已保存')
      loadEntities()
    } catch {
      message.error('保存失败，请稍后重试')
    } finally { setSaving(false) }
  }

  const addManualFact = async () => {
    if (!selected || !factText.trim()) return
    setSaving(true)
    try {
      const detail = await recordingApi.addMemoryEntityFact(selected.id, { content: factText.trim(), attributes: correctionAttributes })
      setSelected(detail)
      setFactText('')
      setCorrectionAttributes({})
      setAddingFact(false)
      message.success('已添加人工修正事实')
      loadEntities()
    } catch { message.error('添加事实失败') } finally { setSaving(false) }
  }

  const deleteFact = async (factId: string | number) => {
    if (!selected) return
    try {
      await recordingApi.deleteMemoryEntityFact(selected.id, factId)
      const detail = await recordingApi.getMemoryEntity(selected.id)
      setSelected(detail)
      message.success('事实已删除')
      loadEntities()
    } catch { message.error('删除事实失败') }
  }

  const mergeEntity = async () => {
    if (!selected || !mergeTarget) return
    setSaving(true)
    try {
      const detail = await recordingApi.mergeMemoryEntities(selected.id, mergeTarget)
      setSelected(detail)
      setMergeOpen(false)
      setMergeTarget(undefined)
      message.success('记忆已融合')
      loadEntities()
    } catch { message.error('融合失败，请确认两个实体类型相同') } finally { setSaving(false) }
  }

  const addRelation = async () => {
    if (!selected || !relationTarget) return
    try {
      const detail = await recordingApi.addMemoryEntityRelation(selected.id, relationTarget)
      setSelected(detail)
      setRelationTarget(undefined)
    } catch { message.error('添加关联失败') }
  }

  const removeRelation = async (relationId: string | number) => {
    if (!selected) return
    try {
      await recordingApi.deleteMemoryEntityRelation(selected.id, relationId)
      setSelected(await recordingApi.getMemoryEntity(selected.id))
    } catch { message.error('删除关联失败') }
  }

  const removeEntity = async () => {
    if (!selected) return
    try {
      await recordingApi.deleteMemoryEntity(selected.id)
      setDrawerOpen(false)
      setSelected(null)
      message.success('空记忆实体已删除')
      loadEntities()
    } catch { message.error('实体仍有有效事实，不能删除') }
  }

  const candidates = candidateItems.filter((item) => selected && String(item.id) !== String(selected.id))

  /** 类型中文名：取自 schema，未知类型直接回退到原始 key。 */
  const entityTypeLabel = (type: string) => schema?.[type as RecordingMemoryEntityType]?.label ?? type

  /** 把 schema 的 attribute 展开为表单/详情字段定义（自由文本 vs 枚举）。 */
  const attributeFieldDefs = selected && schema
    ? Object.entries(schema[selected.entity_type]?.attributes ?? {}).map(([key, def]) => ({
        key,
        label: def.label,
        options: isEnumAttribute(def.values)
          ? Object.entries(def.values).map(([value, label]) => ({ value, label }))
          : undefined,
      }))
    : []

  /** 展示某属性值：有枚举映射则翻成中文，否则原样展示（自由文本）。 */
  const renderAttributeValue = (type: RecordingMemoryEntityType, key: string, value: string | undefined) => {
    if (value === undefined || value === null || value === '') return '--'
    const values = schema?.[type]?.attributes?.[key]?.values
    if (isEnumAttribute(values)) return values[value] ?? value
    return value
  }

  // 类型 tab 列表：'全部' 始终是第一个 UI 入口，其余按 schema 顺序展开。
  const typeTabs: Array<{ key: RecordingMemoryEntityType | 'all'; label: string }> = schema
    ? [{ key: 'all', label: '全部' }, ...Object.entries(schema).map(([key, def]) => ({ key: key as RecordingMemoryEntityType, label: def.label }))]
    : [{ key: 'all', label: '全部' }]

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
      width: 80,
      align: 'right',
      render: (_: unknown, record) => (
        <div className="flex items-center justify-end invisible group-hover:visible transition-colors">
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
        </div>
      ),
    },
  ]

  return (
    <div className="flex-1 min-w-0 h-full overflow-auto bg-[#FAFBFD] text-[#1D1E1F]">
      <Header title={t("library.home")} border={false} />
      {schemaError ? (
        <div className="mx-auto min-h-full max-w-[1440px] p-6">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={schemaError} />
        </div>
      ) : !schema ? (
        <div className="flex h-[60vh] items-center justify-center"><Spin size="large" tip="加载中..." /></div>
      ) : (
      <div className="mx-auto min-h-full max-w-[1440px] p-6">

        <h3 className="mb-5 text-base font-medium text-[#1D1E1F]">经营记忆</h3>

        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex bg-[#F6F7F7] p-1 rounded-lg w-fit">
            {typeTabs.map((option) => (
              <button
                type="button"
                key={option.key}
                onClick={() => {
                  setActiveType(option.key)
                  setCurrentPage(1)
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
          <Search
            mode="expanded"
            value={keyword}
            placeholder="搜索记忆实体名称"
            debounceMs={260}
            className="w-full lg:w-[280px]"
            onDebouncedChange={(val) => {
              setKeyword(val)
              setCurrentPage(1)
            }}
          />
        </div>
        <section className="bg-white p-5 rounded-2xl border border-[#e2e8f0] overflow-hidden shadow-sm">
          <Table
            dataSource={items}
            columns={entityColumns}
            rowKey="id"
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
              },
            }}
            onRow={(record) => ({
              onClick: () => openEntity(record),
              className: 'group hover:bg-[#f8fafc] transition-colors cursor-pointer',
            })}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有可观察的实体记忆" /> }}
          />
        </section>
      </div>
      )}

      <Drawer width={620} placement="right" open={drawerOpen} onClose={() => { setDrawerOpen(false); setEditing(false); setAddingFact(false) }} title={editing ? '编辑记忆' : '记忆详情'} destroyOnClose>
        {!selected ? <div className="flex h-64 items-center justify-center"><Spin /></div> : <Form form={form} layout="vertical" className="pb-5">
          {editing ? (
            <>
              <section className="border-b border-slate-100 pb-5"><h3 className="mb-4 text-[13px] font-semibold text-slate-700">基本信息</h3><Form.Item label="实体类型"><Input readOnly value={entityTypeLabel(selected.entity_type)} /></Form.Item><Form.Item label="名称" name="canonical_name" rules={[{ required: true, message: '请输入实体名称' }]}><Input maxLength={50} /></Form.Item></section>
              <section className="border-b border-slate-100 py-5"><h3 className="mb-4 text-[13px] font-semibold text-slate-700">实体属性</h3>{attributeFieldDefs.map((field) => <Form.Item key={field.key} label={field.label} name={['attributes', field.key]}>{field.options ? <Select allowClear options={field.options} /> : <Input />}</Form.Item>)}</section>
              <section className="border-b border-slate-100 py-5"><h3 className="mb-4 text-[13px] font-semibold text-slate-700">内容</h3><Form.Item name="summary" className="!mb-0"><Input.TextArea rows={5} maxLength={500} showCount /></Form.Item></section>
            </>
          ) : (
            <>
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
            </>
          )}
          <section className="border-b border-slate-100 py-5">
            <h3 className="mb-4 text-base font-medium text-[#1D1E1F]">相关</h3>
            {selected.facts.length ? (
              <div className="relative space-y-3 before:absolute before:bottom-3 before:left-[5px] before:top-3 before:w-px before:bg-[#E8EAED]">
                {selected.facts.map((fact) => {
                  return (
                    <div key={String(fact.id)} className="relative pl-5">
                      <span className="absolute left-0 top-1 h-3 w-3 rounded-full border-2 border-blue-500 bg-white shadow-sm" />
                      <div className="mb-2 flex items-center gap-2 text-sm text-[#9CA3AF] min-w-0">
                        <span className="shrink-0">{fact.occurred_at ? getSimpleDateFormatString({ date: fact.occurred_at, format: 'YYYY-MM-DD hh:mm' }) : '--'}</span>
                        <span className="shrink-0">·</span>
                        <span className="flex-1 min-w-0 truncate" title={formatSourceFile(fact.source_file)}>{formatSourceFile(fact.source_file)}</span>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="whitespace-pre-line break-words text-sm leading-6 text-[#1D1E1F]">{fact.content}</p>
                        <div className="mt-2">
                          <span className={`inline-block rounded bg-[#F7F0EF] px-2 py-0.5 text-xs text-[#FF5C2C]`}>{factEntityTypeLabel(fact.entity_type, schema)}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无事实" />}
          </section>
          {!editing && selected.fact_count === 0 && <div className="mt-8 border-t border-slate-100 pt-4"><Popconfirm title="确认删除这个空实体？" onConfirm={removeEntity}><Button danger icon={<DeleteOutlined />}>删除空实体</Button></Popconfirm></div>}
        </Form>}
      </Drawer>

      <Modal title="记忆融合" open={mergeOpen} onCancel={() => setMergeOpen(false)} onOk={mergeEntity} okText="确认融合" confirmLoading={saving} okButtonProps={{ disabled: !mergeTarget }}>
        <p className="mb-4 text-[13px] leading-6 text-slate-500">保留目标实体的当前属性与总结；当前实体的事实会转入目标实体，并保留为别名。</p>
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[13px] text-blue-700">待融合：{selected?.canonical_name}</div>
        <div className="my-3 text-center text-slate-300">↓</div>
        <Select className="w-full" placeholder="选择保留的同类型实体" value={mergeTarget} onChange={setMergeTarget} options={candidates.filter((item) => item.entity_type === selected?.entity_type).map((item) => ({ value: item.id, label: item.canonical_name }))} />
      </Modal>
    </div>
  )
}
