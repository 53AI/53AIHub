import { useMemo, useState, type ReactNode } from 'react'
import { Input, Tooltip } from 'antd'
import { EditOutlined } from '@ant-design/icons'
import { SvgIcon } from '@km/shared-components-react'
import type { InsightBackground } from '@/api/modules/recording/types'

/** 洞察背景的空值，跨 InsightRegeneratePanel 与 InsightChatModal 复用，
 *  避免新增字段时遗漏其一造成行为不一致。 */
export const EMPTY_INSIGHT_BACKGROUND: InsightBackground = {
  personal_info: '',
  company_info: '',
  historical_context: '',
  external_constraints: '',
  material_context: '',
}

export function BackgroundCard({
  title,
  description,
  value,
  onChange,
  readOnly = false,
  collapsible = false,
  kind = 'text',
  iconName,
  iconColor,
  expanded: controlledExpanded,
  onExpandedChange,
  expandedContent,
}: {
  title: string
  description: string
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
  /** true 时切换为"可折叠面板"样式：顶部仅显示主副标题 + 折叠箭头，
   *  默认展开，点击标题区域可收起整张卡。 */
  collapsible?: boolean
  /** 'list' 时渲染成"行式列表"：每项一个输入框 + 删除按钮，底部一个「添加」按钮。
   *  列表状态用 '\n' 分隔串到 value 里，与 string 字段契约保持一致。 */
  kind?: 'text' | 'list' | 'history'
  /** 折叠卡片标题前的图标名；缺省时不渲染图标 */
  iconName?: string
  /** 图标颜色（仅在 iconName 存在时生效） */
  iconColor?: string
  /** 受控模式：传入后由父级决定是否展开。缺省时组件自身维护展开状态（默认展开）。 */
  expanded?: boolean
  /** 受控模式下的展开状态变更回调；与 expanded 配套使用。 */
  onExpandedChange?: (expanded: boolean) => void
  /** 替换展开区默认编辑器，用于把只读数据源嵌入现有卡片。 */
  expandedContent?: ReactNode
}) {
  const [internalExpanded, setInternalExpanded] = useState(true)
  const isControlled = controlledExpanded !== undefined
  const expanded = isControlled ? controlledExpanded : internalExpanded
  const toggleExpanded = () => {
    const next = !expanded
    if (isControlled) onExpandedChange?.(next)
    else setInternalExpanded(next)
  }

  if (collapsible) {
    return (
      <div className="rounded-xl p-4 border border-[#E7EAF0] bg-white">
        <div
          role="button"
          tabIndex={0}
          className="flex w-full items-start justify-between gap-2 cursor-pointer select-none"
          onClick={toggleExpanded}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              toggleExpanded()
            }
          }}
        >
          <div>
            <div className="text-base text-main flex items-center gap-1.5">
              {iconName && <SvgIcon name={iconName} color={iconColor} />}
              {title}
            </div>
            <div className="mt-1 text-sm leading-4 text-[#9CA3AF]">{description}</div>
          </div>
          <span className="mt-0.5 text-[#AAB4C3]">
            {expanded ? <SvgIcon name="up" /> : <SvgIcon name="down" />}
          </span>
        </div>
        {expanded && expandedContent}
        {expanded && !expandedContent && kind === 'list' && (
          <ListEditor
            value={value}
            onChange={onChange}
            readOnly={readOnly}
          />
        )}
        {expanded && !expandedContent && kind === 'history' && <RelatedHistoryViewer value={value} />}
        {expanded && !expandedContent && kind === 'text' && (
          <div className="pt-3">
            <Input.TextArea
              value={value}
              onChange={(event) => onChange(event.target.value)}
              readOnly={readOnly}
              autoSize={{ minRows: 8, maxRows: 18 }}
              className={ readOnly ? '!bg-[#F8FAFC] !outline-none' : '' }
              placeholder="暂无内容，可直接补充"
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-[#E7EAF0] bg-white p-3 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold text-[#1F2937]">{title}</div>
          <div className="mt-1 text-[11px] leading-4 text-[#98A2B3]">{description}</div>
        </div>
        {!readOnly && <EditOutlined className="mt-0.5 text-[#AAB4C3]" />}
      </div>
      <Input.TextArea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        readOnly={readOnly}
        autoSize={{ minRows: 3, maxRows: 8 }}
        bordered={false}
        className="!resize-none !bg-[#F8FAFC] !px-2 !py-2 !text-xs !leading-5"
        placeholder="暂无内容，可直接补充"
      />
    </div>
  )
}

/**
 * 行式列表编辑器：把 string 字段按 '\n' 拆分成多条，每条一个输入框 + 删除按钮，
 *  底部一个「添加」按钮。readOnly 时禁用添加/删除与编辑，但仍保留删除图标以便
 *  阅读者感知"行"的存在（与设计稿一致）。
 */
function ListEditor({
  value,
  onChange,
  readOnly,
}: {
  value: string
  onChange: (next: string) => void
  readOnly: boolean
}) {
  // 用 useMemo 解析条目，避免每次渲染都重新 split。
  // 空字符串视作"没有任何条目"，但 UI 上仍渲染一个空输入框，方便用户开始输入。
  const items = useMemo(() => {
    if (value === '') return ['']
    return value.split('\n')
  }, [value])

  const updateItem = (index: number, next: string) => {
    const arr = items.slice()
    arr[index] = next
    onChange(arr.join('\n'))
  }

  const removeItem = (index: number) => {
    const arr = items.slice()
    arr.splice(index, 1)
    if (arr.length === 0) arr.push('')
    onChange(arr.join('\n'))
  }

  const addItem = () => {
    const arr = items.slice()
    arr.push('')
    onChange(arr.join('\n'))
  }

  return (
    <div className="pt-3">
      {items.map((item, index) => (
        <div
          key={index}
          className={`flex items-center gap-2 py-1.5 ${
            index > 0 ? 'border-t border-[#F1F2F4]' : ''
          }`}
        >
          <Input
            value={item}
            onChange={(event) => updateItem(index, event.target.value)}
            readOnly={readOnly}
            placeholder={readOnly ? '' : '请输入关联记忆'}
          />
          {!readOnly && (
            <button
              type="button"
              aria-label="删除"
              className="flex-none text-[#9CA3AF] hover:text-[#EF4444] transition-colors"
              onClick={() => removeItem(index)}
            >
              <SvgIcon name="delete" size={16} />
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button
          type="button"
          className="mt-1 inline-flex h-7 items-center rounded-md bg-[#F2F6FF] px-3 text-xs text-[#2563EB] hover:bg-[#E0EAFF]"
          onClick={addItem}
        >
          添加
        </button>
      )}
    </div>
  )
}

type EditableInsightBackgroundKey = Exclude<
  keyof InsightBackground,
  | 'conversation'
  | 'scene'
  | 'scene_mode'
  | 'resolved_insight_perspective'
  | 'perspective_confidence'
  | 'perspective_reason_codes'
  | 'perspective_evidence'
  | 'perspective_abstained'
>

type RelatedMemory = {
  memory_id?: number
  type?: string
  content?: string
  recall_reason?: string
  assertion_state?: string
  source_file?: string
  confidence?: number
  evidence_available?: boolean
}

type RelatedMeeting = {
  file_id?: number
  title?: string
  minutes?: string
}

type RelatedHistory = {
  memories: RelatedMemory[]
  meetings: RelatedMeeting[]
}

const MIN_RELATED_MEMORY_CONFIDENCE = 0.6

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** 解析历史关联上下文；解析失败时由界面降级为旧版纯文本。 */
export function parseRelatedHistory(value: string): RelatedHistory | null {
  if (!value.trim()) return { memories: [], meetings: [] }
  try {
    const parsed = asRecord(JSON.parse(value))
    if (!parsed) return null
    return {
      memories: Array.isArray(parsed.related_memories)
        ? parsed.related_memories.map(asRecord).filter(Boolean).filter((memory) => {
          const confidence = (memory as RelatedMemory).confidence
          return typeof confidence !== 'number' || confidence >= MIN_RELATED_MEMORY_CONFIDENCE
        }) as RelatedMemory[]
        : [],
      meetings: Array.isArray(parsed.related_meetings)
        ? parsed.related_meetings.map(asRecord).filter(Boolean) as RelatedMeeting[]
        : [],
    }
  } catch {
    return null
  }
}

const historyTypeLabels: Record<string, string> = {
  decision: '决策',
  commitment: '承诺',
  risk: '风险',
  fact: '事实',
  person: '人物',
  matter: '事项',
  principle: '原则',
  viewpoint: '观点',
  action: '行动',
  opportunity: '机会',
  issue: '问题',
  open_question: '待解问题',
  quote: '原话',
}

const historyStateLabels: Record<string, string> = {
  confirmed: '已确认',
  open: '进行中',
  superseded: '已被替代',
  pending: '待确认',
  proposed: '待确认',
  inferred: '推测',
  uncertain: '不确定',
  rejected: '已排除',
}

function historyLabel(value?: string, labels?: Record<string, string>) {
  if (!value) return ''
  return labels?.[value] || value.replaceAll('_', ' ')
}

export function RelatedHistoryViewer({ value }: { value: string }) {
  const history = parseRelatedHistory(value)
  if (!history) {
    return (
      <div className="pt-3 whitespace-pre-wrap rounded-lg bg-[#F8FAFC] px-3 py-2 text-xs leading-5 text-[#667085]">
        {value || '暂无关联记忆'}
      </div>
    )
  }

  if (history.memories.length === 0 && history.meetings.length === 0) {
    return <div className="pt-3 text-xs text-[#98A2B3]">暂无关联记忆</div>
  }

  return (
    <div className="space-y-3 pt-3">
      {history.memories.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] text-[#98A2B3]">
            <span>关联记忆</span>
            <span>{history.memories.length} 条</span>
          </div>
          {history.memories.map((memory, index) => {
            const chips = [
              historyLabel(memory.type, historyTypeLabels),
              historyLabel(memory.assertion_state, historyStateLabels),
              memory.evidence_available ? '有证据' : '',
            ].filter(Boolean)
            return (
              <div key={memory.memory_id || index} className="rounded-lg border border-[#E8ECF2] bg-[#FBFCFE] px-3 py-2.5">
                <div className="flex flex-wrap gap-1.5">
                  {chips.map((chip) => (
                    <span key={chip} className="rounded-full bg-[#EEF4FF] px-2 py-0.5 text-[10px] text-[#526DDE]">
                      {chip}
                    </span>
                  ))}
                </div>
                <div className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#344054]">
                  {memory.content || '暂无记忆内容'}
                </div>
                {(memory.source_file || memory.recall_reason || typeof memory.confidence === 'number') && (
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] leading-4 text-[#98A2B3]">
                    {memory.source_file && <span>来源：{memory.source_file}</span>}
                    {memory.recall_reason && <span>关联：{memory.recall_reason}</span>}
                    {typeof memory.confidence === 'number' && (
                      <Tooltip title="来源可信度：模型对这条记忆来自原始材料、表达是否明确的判断，不等同于事实真伪。低于 60% 的自动记忆不会参与新的历史召回。">
                        <span className="cursor-help border-b border-dotted border-[#98A2B3]">来源可信度：{Math.round(memory.confidence * 100)}%</span>
                      </Tooltip>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {history.meetings.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] text-[#98A2B3]">相关会议 · {history.meetings.length} 场</div>
          {history.meetings.map((meeting, index) => (
            <details key={meeting.file_id || index} className="rounded-lg border border-[#E8ECF2] bg-[#FBFCFE] px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-[#475467]">
                {meeting.title || '未命名会议'}
              </summary>
              {meeting.minutes && <div className="mt-2 whitespace-pre-wrap border-t border-[#F1F2F4] pt-2 text-xs leading-5 text-[#667085]">{meeting.minutes}</div>}
            </details>
          ))}
        </div>
      )}
    </div>
  )
}

type InsightBackgroundCard = {
  key: EditableInsightBackgroundKey
  iconName: string
  iconColor: string
  title: string
  description: string
  readOnly?: boolean
  collapsible?: boolean
  kind?: 'text' | 'list' | 'history'
}

/** 洞察背景可编辑字段配置：与 InsightBackground 类型字段对齐，
 *  供「参谋洞察」面板与独立聊天弹窗共享，避免双写。 */
export const INSIGHT_BACKGROUND_CARDS: InsightBackgroundCard[] = [
  {
    key: 'external_constraints' as const,
    iconName: 'prescription',
    iconColor: '#EB9E10',
    title: '补充背景',
    description: '补充更多的背景信息',
    collapsible: true,
  },
  {
    key: 'historical_context' as const,
    iconName: 'history-query',
    iconColor: '#7948EA',
    title: '关联记忆',
    description: '关联记忆中的人物、事项、重复问题和已验证教训',
    collapsible: true,
    kind: 'history',
    readOnly: true,
  },
  {
    key: 'personal_info' as const,
    iconName: 'personal-collection',
    iconColor: '#FA5151',
    title: '个人信息',
    description: '用于确定洞察视角、关注重点与表达方式',
    collapsible: true,
    readOnly: true,
  },
  {
    key: 'company_info' as const,
    iconName: 'building-one',
    iconColor: '#2563EB',
    title: '企业信息',
    description: '用于校准建议是否符合企业信息与行业背景',
    collapsible: true,
  },
]
