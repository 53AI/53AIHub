import { EyeOutlined } from '@ant-design/icons';
import { Button, Dropdown, Empty, Modal, Space, Spin, Table, Tag, Tooltip, message } from 'antd';
import type { TableColumnsType } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import recordingApi from '@/api/modules/recording';
import { Search, SafeImage, Tabs } from '@km/shared-components-react';
import type {
  RecordingMemoryEntityDetail,
  RecordingMemoryEntityItem,
  RecordingMemoryEntitySchemas,
  RecordingMemoryEntityType,
  RecordingMemorySchemaCategory,
} from '@/api/modules/recording/types';
import { t } from '@/locales';
import { getSimpleDateFormatString } from '@km/shared-utils';
import { useRecordingFlutterPanel } from '@/stores/modules/recording-flutter-panel';
import { EntityFormDrawer } from './components/EntityFormDrawer';
import { MemoryKnowledgeGraph } from './components/MemoryKnowledgeGraph';
import { MergeEntityModal } from './components/MergeEntityModal';
import { buildFlutterWebUrl } from '../components/flutter-panel/flutterUrl';
import { useFlutterPanelClosed } from '../components/flutter-panel/useFlutterPanelClosed';
import { useFlutterPanelMutation } from '../components/flutter-panel/useFlutterPanelMutation';
import './index.css';

export interface RecordingMemoryHomeViewProps {
  /** 实体 schema 分类：memory=经营记忆（默认）/ relation=关系。页面完全由 schema 驱动，
   *  关系模块等复用本页时仅切换此参数。 */
  category?: RecordingMemorySchemaCategory
  /** 页面标题（正文 h1） */
  title?: string
  /** 标题下的描述文案 */
  description?: string
}

/** 类型维度的表格列配置：按当前类型 tab 的 schema label 命中。
 *  人脉 / 企业 等类型用更贴业务的列头；未命中的类型用通用列头（实体 / 记忆内容 / 关联）。
 *  showType：单类型 tab 行内类型恒定，隐藏冗余的"类型"列。
 *  avatarAttr / avatarFallback / subtitleAttr：首列头像 + 副标题排版
 *  （人脉=avatar+职位、企业=logo+地区，数据见 20261010 协议 §2.2 列表行 attributes），
 *  副标题统一用 Tag 展示。
 *  extra：首列后的附加列（人脉=所属企业，企业=行业）。 */
type TypeTableColumnConfig = {
  entity: string
  content: string
  relation: string
  showType: boolean
  avatarAttr?: string
  avatarFallback?: string
  subtitleAttr?: string
  extra?: 'company' | 'industry'
}

const TYPE_TABLE_COLUMN_LABELS: Record<string, TypeTableColumnConfig> = {
  // key 用后端 schema 的实体 type（稳定契约：person / company，见
  // KM-Record mockMemorySchemas 与 20261010 协议）；label 是可变的展示
  // 文案，用作匹配 key 会在后端改名时失配落到纯文本首列。
  person: {
    entity: '人物',
    content: '描述',
    relation: '相关',
    showType: false,
    avatarAttr: 'avatar',
    avatarFallback: '/images/recording/user.png',
    subtitleAttr: 'position',
    extra: 'company'
  },
  company: {
    entity: '企业',
    content: '描述',
    relation: '相关',
    showType: false,
    avatarAttr: 'logo',
    avatarFallback: '/images/recording/company.png',
    subtitleAttr: 'region',
    extra: 'industry'
  }
}

const DEFAULT_TABLE_COLUMN_LABELS: TypeTableColumnConfig = {
  entity: '实体',
  content: '记忆内容',
  relation: '关联',
  showType: true
}

export function RecordingMemoryHomeView({
  category = 'memory',
  title = '记忆',
  description = '提取对话关键信息，沉淀各类业务记忆',
}: RecordingMemoryHomeViewProps) {
  const [items, setItems] = useState<RecordingMemoryEntityItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  // 类型 tab 无"全部"选项：默认选中 schema 第一个类型，schema 加载前为 null（不请求列表）
  const [activeType, setActiveType] = useState<RecordingMemoryEntityType | null>(null)
  const [keyword, setKeyword] = useState('')
  // 分页：参考 order/index.tsx，Table 内置 pagination 走 showSizeChanger。
  // filter 变化（搜索关键词 / 类型 tab）时由各 onChange 同步重置 currentPage 到 1。
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [editingEntity, setEditingEntity] = useState<RecordingMemoryEntityDetail | null>(null)
  const [editDrawerOpen, setEditDrawerOpen] = useState(false)
  // 主页 tabs: 经营记忆(列表/统计) | 知识图谱(G6 力导向图)。
  // 默认进入经营记忆 tab,符合现有用户路径;切到知识图谱时不需要重新拉 schema/entity 列表。
  const [activeTab] = useState<'memory' | 'graph'>('memory')
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

  // 编辑打开 token：用户连点不同行的编辑时，只有最后一次点击的 setEditingEntity 生效。
  const openTokenRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    recordingApi
      // 页面完全由 schema 驱动：category 决定展示哪些实体类型（memory=经营记忆 / relation=关系）
      .getMemorySchema({ category })
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

  // schema 到位后默认选中第一个类型（仅首次，后续用户切换不受影响）
  useEffect(() => {
    if (!schema || schema.length === 0) return
    setActiveType((prev) => prev ?? schema[0].type)
  }, [schema])

  const loadEntities = useCallback(async () => {
    // 类型未就绪（schema 未加载、默认类型未定）时跳过本次请求，待默认类型设定后由依赖变化重新触发
    if (!activeType) return
    const myToken = ++loadTokenRef.current
    setLoading(true)
    try {
      const data = await recordingApi.getMemoryEntities({
        entity_type: activeType,
        keyword: keyword.trim() || undefined,
        offset: (currentPage - 1) * pageSize,
        limit: pageSize,
      })
      if (myToken !== loadTokenRef.current) return
      setItems(data.items || [])
      setTotal(data.total || 0)
    } catch {
      if (myToken !== loadTokenRef.current) return
      message.error(`${title}加载失败，请稍后重试`)
    } finally {
      if (myToken === loadTokenRef.current) setLoading(false)
    }
  }, [activeType, keyword, currentPage, pageSize])

  useEffect(() => {
    const timer = window.setTimeout(loadEntities, keyword ? 260 : 0)
    return () => window.clearTimeout(timer)
  }, [loadEntities, keyword])

  // 「查看详情」「创建」改为界面最右侧 375px Flutter Web 面板（KM-Record）承载。
  // 面板内增 / 改 / 删实时上报，关闭面板时再刷新一次兜底。
  const openFlutterPanel = useRecordingFlutterPanel((s) => s.open)
  useFlutterPanelMutation((mutation) => {
    if (mutation.module === 'memory') loadEntities()
  })
  useFlutterPanelClosed(loadEntities)

  // 查看详情：打开 Flutter Web 实体详情页（Flutter 侧按 id 自行拉取，这里不再预取）。
  const openEntity = (item: RecordingMemoryEntityItem) => {
    openFlutterPanel(buildFlutterWebUrl(`/business/memory/${item.id}`))
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

  // 创建：打开 Flutter Web 新增页，携带当前类型 tab 与 schema 分类作表单默认值。
  const openAddEntity = () => {
    openFlutterPanel(
      buildFlutterWebUrl('/business/memory/add', { type: activeType ?? undefined, category }),
    )
  }

  const removeEntityFromTable = async (item: RecordingMemoryEntityItem) => {
    await recordingApi.deleteMemoryEntity(item.id)
    message.success(t('memory.delete_success'))
    loadEntities()
  }

  // 批量删除：循环调单条删除接口（后端无批量端点），allSettled 并发后统计结果。
  // 二次确认列出将删除的条目名；部分失败时保留成功项的刷新，失败数单独提示。
  const batchDeleteSelected = () => {
    const selected = items.filter((i) => mergeSelectedIds.includes(i.id))
    if (selected.length === 0) return
    Modal.confirm({
      title: t('memory.batch_delete_confirm_title'),
      content: (
        <div>
          <p className="text-sm text-[#1D1E1F]">
            {t('memory.batch_delete_confirm_desc', { n: selected.length })}
          </p>
          <p className="mt-2 max-h-32 overflow-y-auto text-xs text-[#9CA3AF]">
            {selected.map((s) => s.canonical_name).join('、')}
          </p>
        </div>
      ),
      okText: t('memory.delete_confirm_ok'),
      okButtonProps: { danger: true },
      cancelText: t('memory.delete_confirm_cancel'),
      onOk: async () => {
        const results = await Promise.allSettled(
          selected.map((s) => recordingApi.deleteMemoryEntity(s.id)),
        )
        const failed = results.filter((r) => r.status === 'rejected').length
        const success = results.length - failed
        if (failed === 0) {
          message.success(t('memory.batch_delete_success', { n: success }))
        } else {
          message.warning(t('memory.batch_delete_partial', { success, failed }))
        }
        setMergeSelectedIds([])
        loadEntities()
      },
    })
  }

  /** 类型中文名：取自 schema，未知类型直接回退到原始 key。 */
  const entityTypeLabel = (type: string) => schema?.find((s) => s.type === type)?.label ?? type

  // 类型 tab 列表：按 schema 顺序展开，无"全部"选项。
  const typeTabs: Array<{ key: RecordingMemoryEntityType; label: string }> = schema
    ? schema.map((s) => ({ key: s.type, label: s.label }))
    : []

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
  // 列顺序：实体 / 类型 / 记忆内容 / 关联 / 最近更新 / 操作。
  // 列头文案按当前类型 tab 覆盖（人脉→人物/描述/相关、企业→企业/描述/相关），
  // 未命中类型用通用列头。
  // 所有列的字体 / 颜色 / 间距与 EntityRow 里的实体行展示一致：
  //   主信息（实体）text-sm text-[#1D1E1F]，
  //   次信息（记忆内容 / 关联 / 更新人 / 最近更新）text-xs text-[#999999]，
  //   类型沿用 meta 色调的圆角 chip。
  // 关联 / 更新人后端列表接口暂未提供，统一显示 "--"，保持列位稳定避免后续接口补齐时位移。
  // 操作列只暴露"查看"，行 hover 时显示（invisible group-hover:visible），与 chunk.tsx 的行操作一致。
  const columnLabels = TYPE_TABLE_COLUMN_LABELS[activeType ?? ''] ?? DEFAULT_TABLE_COLUMN_LABELS
  // 附加列：人脉→所属企业（结构化 related_company 优先，回退历史 attributes.company 文本，
  // 20261010 协议 §2.1 渲染优先级）；企业→行业（attributes.industry）
  const extraColumn =
    columnLabels.extra === 'company'
      ? {
          title: '企业',
          key: 'related_company',
          width: 150,
          render: (_: unknown, record: RecordingMemoryEntityItem) => (
            <span className="truncate text-sm text-[#1D1E1F]">
              {record.related_company?.related_name || record.attributes?.company || '--'}
            </span>
          )
        }
      : columnLabels.extra === 'industry'
        ? {
            title: '行业',
            key: 'industry',
            width: 120,
            ellipsis: true,
            render: (_: unknown, record: RecordingMemoryEntityItem) => (
              <span className="truncate text-sm text-[#1D1E1F]">{record.attributes?.industry || '--'}</span>
            )
          }
        : null
  const entityColumns: TableColumnsType<RecordingMemoryEntityItem> = [
    {
      title: columnLabels.entity,
      dataIndex: 'canonical_name',
      key: 'canonical_name',
      minWidth: 220,
      ellipsis: true,
      render: (name: string, record: RecordingMemoryEntityItem) => {
        // 通用类型：纯文本首列；人脉 / 企业：头像 + 名称 + 副标题（职位 / 地区）
        if (!columnLabels.avatarAttr) {
          return (
            <span className="block truncate text-sm text-[#1D1E1F] group-hover:text-blue-600 transition-colors">{name}</span>
          )
        }
        const subtitle = (record.attributes?.[columnLabels.subtitleAttr ?? ''] ?? '').trim()
        return (
          <div className="flex items-center gap-2.5">
            <SafeImage
              src={record.attributes?.[columnLabels.avatarAttr] || ''}
              fallback={columnLabels.avatarFallback}
              className="size-9 rounded-full object-cover"
            />
            <div className="min-w-0">
              <div className="truncate text-sm text-[#1D1E1F] group-hover:text-blue-600 transition-colors">{name}</div>
              {subtitle && <Tag className="mt-0.5 max-w-full overflow-hidden">{subtitle}</Tag>}
            </div>
          </div>
        )
      }
    },
    ...(columnLabels.showType
      ? [
          {
            title: '类型',
            dataIndex: 'entity_type',
            key: 'entity_type',
            width: 100,
            render: (_: RecordingMemoryEntityType, record: RecordingMemoryEntityItem) => (
              <span className="truncate text-sm text-[#1D1E1F]">{entityTypeLabel(record.entity_type)}</span>
            )
          }
        ]
      : []),
    ...(extraColumn ? [extraColumn] : []),
    {
      title: columnLabels.content,
      dataIndex: 'summary',
      key: 'summary',
      minWidth: 240,
      ellipsis: true,
      render: (summary: string) => (
        <span className="truncate text-sm text-[#1D1E1F]">{summary || '尚未形成总结性描述'}</span>
      ),
    },
    {
      title: columnLabels.relation,
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
        <div className="flex items-center gap-1 justify-end visible md:invisible md:group-hover:visible transition-colors">
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
          {/* <Tooltip title="编辑">
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
            </Tooltip> */}
        </div>
      ),
    },
  ]

  return (
    <div className="flex-1 min-w-0 h-full overflow-auto bg-white text-[#1D1E1F] px-8 pb-12 pt-7">
      {schemaError ? (
        <div className="min-h-full max-w-[1200px] mx-auto">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={schemaError} />
        </div>
      ) : !schema ? (
        <div className="flex h-[60vh] items-center justify-center"><Spin size="large" tip="加载中..." /></div>
      ) : (
      <div className="memory-content-container  max-w-[1200px] mx-auto">

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

        <div className="memory-title-area">
          <h1 className="memory-title text-2xl font-medium  text-[#333332]">{title}</h1>
          <p className="memory-desc mt-1 text-sm text-[#888994]">{description}</p>
          <Search
            mode="expanded"
            value={keyword}
            placeholder="搜索实体名称或内容"
            debounceMs={260}
            className="memory-title-search"
            onDebouncedChange={(val) => {
              setKeyword(val)
              setCurrentPage(1)
              setMergeSelectedIds([])
            }}
          />
        </div>

        {activeTab === 'memory' ? (
          <>
            <div className="memory-toolbar mt-5">
              <div className="flex items-center gap-3">
 
                <Tabs
                  variant="segmented"
                  className="memory-type-tabs"
                  items={typeTabs}
                  activeKey={activeType ?? undefined}
                  onChange={(key) => {
                    setActiveType(key as RecordingMemoryEntityType)
                    setCurrentPage(1)
                    setMergeSelectedIds([])
                  }}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button type="primary" onClick={openAddEntity}>{t('action.add')}</Button>
                {/* 批量操作：常驻已选计数 + 下拉菜单（合并 / 删除）。
                    合并保持「恰好 2 个 + 同类型」约束（并入口前旧融合按钮的语义）；
                    删除不限量，循环调单条接口。未选中时下拉整体禁用。 */}
                <Space.Compact>
                  <Button>
                    {t('memory.selected_prefix')}
                    <span className="font-medium text-[#2563EB]">{mergeSelectedIds.length}</span>
                    {t('memory.selected_suffix')}
                  </Button>
                  <Dropdown
                    placement="bottomRight"
                    disabled={mergeSelectedIds.length === 0}
                    menu={{
                      items: [
                        {
                          key: 'merge',
                          label: t('memory.batch_merge', { n: mergeSelectedIds.length }),
                          // 融合仅恰好 2 个且同类型可用；disabled 原因经 title 提示
                          disabled: mergeSelectedIds.length !== 2 || !sameType,
                          title:
                            mergeSelectedIds.length !== 2
                              ? t('memory.merge_need_two')
                              : !sameType
                                ? t('memory.merge_type_mismatch_tip')
                                : undefined,
                          onClick: () => {
                            if (mergeEntities) setMergeOpen(true)
                          },
                        },
                        {
                          key: 'delete',
                          label: t('memory.batch_delete', { n: mergeSelectedIds.length }),
                          disabled: mergeSelectedIds.length === 0,
                          danger: true,
                          onClick: batchDeleteSelected,
                        },
                      ],
                    }}
                  >
                    <Button>{t('common.action')} <DownOutlined /></Button>
                  </Dropdown>
                </Space.Compact>
              </div>
            </div>
            <section className="bg-white mt-5 p-5 rounded-2xl border border-[#e2e8f0] overflow-hidden shadow-sm">
              {/* 横向滚动下限取各列宽之和（含选择列，约 950px）：窄屏可横向滚动，
                  宽屏下"实体/记忆内容"等弹性列按剩余空间分配，不会无限撑开 */}
              <Table
                dataSource={items}
                columns={entityColumns}
                rowKey="id"
                scroll={{ x: 950 }}
                rowSelection={{
                  selectedRowKeys: mergeSelectedIds,
                  // 勾选不限量（批量删除可多选）；融合的「恰好 2 个」约束在
                  // 下拉菜单项上把关（数量不符时禁用 + tooltip 提示）。
                  onChange: (keys) => {
                    setMergeSelectedIds(keys as Array<string | number>)
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

      {schema && (
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
