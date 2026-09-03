import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Input, Modal, Select, Spin, message } from 'antd'
import {
  CommentOutlined,
  EditOutlined,
  RobotOutlined,
} from '@ant-design/icons'
import { SvgIcon } from '@km/shared-components-react'
import recordingApi from '@/api/modules/recording'
import type {
  InsightBackground,
  InsightConversationMessage,
  InsightPerspective,
  InsightPerspectiveOption,
} from '@/api/modules/recording/types'
import {
  InsightChatPanel,
  starterMessage,
  withoutStarterMessage,
} from './InsightChatPanel'

interface InsightBackgroundWorkshopProps {
  fileId: string
  onRegenerateStarted: () => void
}

/** 洞察背景的空值，跨 InsightBackgroundWorkshopModal 与 InsightRegeneratePanel 复用，
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
  kind?: 'text' | 'list'
  /** 折叠卡片标题前的图标名；缺省时不渲染图标 */
  iconName?: string
  /** 图标颜色（仅在 iconName 存在时生效） */
  iconColor?: string
  /** 受控模式：传入后由父级决定是否展开。缺省时组件自身维护展开状态（默认展开）。 */
  expanded?: boolean
  /** 受控模式下的展开状态变更回调；与 expanded 配套使用。 */
  onExpandedChange?: (expanded: boolean) => void
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
        {expanded && kind === 'list' && (
          <ListEditor
            value={value}
            onChange={onChange}
            readOnly={readOnly}
          />
        )}
        {expanded && kind === 'text' && (
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
  'conversation' | 'insight_perspective' | 'resolved_insight_perspective'
>

type InsightBackgroundCard = {
  key: EditableInsightBackgroundKey
  iconName: string
  iconColor: string
  title: string
  description: string
  readOnly?: boolean
  collapsible?: boolean
  kind?: 'text' | 'list'
}

/** 洞察背景可编辑字段配置：与 InsightBackground 类型字段对齐，
 *  供两个 modal（带对话 / 仅编辑）共享，避免双写。 */
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
    kind: 'list',
    readOnly: true,
  },
  {
    key: 'personal_info' as const,
    iconName: 'personal-collection',
    iconColor: '#FA5151',
    title: '个人信息',
    description: '用于确定洞察视角、关注重点与表达方式',
    collapsible: true,
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

export function InsightRegenerationBanner({
  fileId,
  onRegenerateStarted,
}: InsightBackgroundWorkshopProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <div className="my-8 overflow-hidden rounded-2xl border border-[#283858] bg-[linear-gradient(110deg,#111B33_0%,#182B51_60%,#253967_100%)] px-5 py-4 text-white shadow-[0_12px_30px_rgba(17,27,51,0.16)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[#BBD4FF]">
              <RobotOutlined />
            </div>
            <div>
              <div className="text-sm font-semibold">觉得当前洞察和真实的企业现状、老板偏好不符？</div>
              <div className="mt-1 text-xs leading-5 text-[#B7C3D9]">补充背景并通过多轮对话校准细节，确认后将生成新的当前洞察报告。</div>
            </div>
          </div>
          <Button
            type="primary"
            icon={<CommentOutlined />}
            className="!h-9 !shrink-0 !border-0 !bg-[#5B7CFF] !px-4 !text-xs !font-medium shadow-[0_5px_16px_rgba(91,124,255,0.32)]"
            onClick={() => setOpen(true)}
          >
            补充背景并多轮对齐
          </Button>
        </div>
      </div>
      <InsightBackgroundWorkshopModal
        fileId={fileId}
        open={open}
        onClose={() => setOpen(false)}
        onRegenerateStarted={() => {
          setOpen(false)
          onRegenerateStarted()
        }}
      />
    </>
  )
}

function InsightBackgroundWorkshopModal({
  fileId,
  open,
  onClose,
  onRegenerateStarted,
}: InsightBackgroundWorkshopProps & { open: boolean; onClose: () => void }) {
  const [background, setBackground] = useState<InsightBackground>(EMPTY_INSIGHT_BACKGROUND)
  const [messages, setMessages] = useState<InsightConversationMessage[]>([starterMessage])
  const [loading, setLoading] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [perspectiveOptions, setPerspectiveOptions] = useState<InsightPerspectiveOption[]>([])
  const [selectedPerspective, setSelectedPerspective] = useState<InsightPerspective>('auto')

  const loadBackground = useCallback(async () => {
    setLoading(true)
    try {
      const [result, options] = await Promise.all([
        recordingApi.getInsightBackground(fileId),
        recordingApi.getInsightPerspectives(),
      ])
      setBackground({ ...EMPTY_INSIGHT_BACKGROUND, ...result })
      setPerspectiveOptions(options)
      setSelectedPerspective(result.insight_perspective || 'auto')
      const savedMessages = result.conversation || []
      setMessages(savedMessages.length > 0 ? savedMessages : [starterMessage])
    } catch (error: any) {
      message.error(error?.message || '读取洞察背景失败')
    } finally {
      setLoading(false)
    }
  }, [fileId])

  useEffect(() => {
    if (open) loadBackground()
  }, [open, loadBackground])

  const updateBackground = (key: EditableInsightBackgroundKey, value: string) => {
    setBackground((current) => ({ ...current, [key]: value }))
  }

  const confirmRegenerate = async () => {
    if (regenerating || loading) return
    setRegenerating(true)
    try {
      await recordingApi.regenerateInsights(fileId, {
        background,
        conversation: withoutStarterMessage(messages),
        insight_perspective: selectedPerspective,
      })
      message.success('已确认背景，正在重新生成洞察')
      onRegenerateStarted()
    } catch (error: any) {
      message.error(error?.message || '重新生成洞察失败，请稍后重试')
    } finally {
      setRegenerating(false)
    }
  }

  const cards = useMemo(() => INSIGHT_BACKGROUND_CARDS, [])
  const perspectiveName = (key?: InsightPerspective) => {
    if (!key) return '尚未记录'
    if (key === 'auto') return '自动场景'
    return perspectiveOptions.find((option) => option.key === key)?.name || key
  }
  const appliedPerspective = background.resolved_insight_perspective

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={null}
      footer={null}
      width={1180}
      centered
      destroyOnClose={false}
      styles={{ body: { padding: 0 } }}
    >
      <div className="flex h-[min(760px,calc(100vh-80px))] min-h-0 flex-col overflow-hidden rounded-xl bg-[#F8FAFC] text-[#1F2937]">
        <div className="flex shrink-0 items-center justify-between border-b border-[#E8ECF2] bg-white px-6 py-4">
          <div>
            <div className="flex items-center gap-2 text-base font-semibold text-[#172033]">
              决策洞察 · 背景协同研讨
              <span className="rounded-full bg-[#EEF4FF] px-2 py-0.5 text-[10px] font-medium text-[#3F65B8]">当前会议</span>
            </div>
            <div className="mt-1 text-xs text-[#98A2B3]">左侧补充背景，右侧研讨判断；原始纪要和动态历史始终保持只读</div>
          </div>
          <Button type="text" onClick={onClose} className="!text-[#98A2B3]">关闭</Button>
        </div>

        {loading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center"><Spin /></div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <div className="min-h-0 overflow-y-auto border-b border-[#E8ECF2] p-5 md:border-b-0 md:border-r">
              <div className="mb-4 flex items-center gap-2">
                <EditOutlined className="text-[#5B7CFF]" />
                <div>
                  <div className="text-sm font-semibold">背景与证据</div>
                  <div className="mt-0.5 text-[11px] text-[#98A2B3]">仅可编辑的补充背景会保存并参与下一次洞察</div>
                </div>
              </div>
              <div className="mb-3 rounded-xl border border-[#DCE6FF] bg-[#F5F8FF] p-3">
                <div className="text-xs font-semibold text-[#344054]">洞察场景</div>
                <div className="mt-1 text-[11px] leading-4 text-[#667085]">
                  当前已应用：{perspectiveName(appliedPerspective)}
                </div>
                <Select
                  className="mt-2 w-full"
                  value={selectedPerspective}
                  loading={perspectiveOptions.length === 0}
                  options={perspectiveOptions.map((option) => ({
                    value: option.key,
                    label: option.key === 'auto' ? '自动场景' : option.name,
                  }))}
                  onChange={(value) => setSelectedPerspective(value as InsightPerspective)}
                  disabled={regenerating}
                />
                <div className="mt-1 text-[11px] leading-4 text-[#98A2B3]">
                  选择后点击底部按钮，下一次洞察将按此场景生成。
                </div>
              </div>
              <div className="space-y-3">
                {cards.map((card) => (
                  <BackgroundCard
                    key={card.key}
                    title={card.title}
                    description={card.description}
                    value={background[card.key] || ''}
                    onChange={(value) => updateBackground(card.key, value)}
                    readOnly={card.readOnly}
                    collapsible={card.collapsible}
                    kind={card.kind}
                    iconName={card.iconName}
                    iconColor={card.iconColor}
                  />
                ))}
              </div>
            </div>

            <InsightChatPanel
              fileId={fileId}
              background={background}
              messages={messages}
              setMessages={setMessages}
              disabled={regenerating}
            />
          </div>
        )}

        <div className="flex shrink-0 flex-col gap-3 border-t border-[#E8ECF2] bg-white px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-[11px] text-[#98A2B3]">确认后保存补充背景并生成新的当前洞察报告</div>
          <div className="flex items-center justify-end gap-2">
            <Button onClick={onClose}>返回洞察报告</Button>
            <Button type="primary" loading={regenerating} onClick={confirmRegenerate} className="!bg-[#172033] hover:!bg-[#273653]">确认并重新生成洞察</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
