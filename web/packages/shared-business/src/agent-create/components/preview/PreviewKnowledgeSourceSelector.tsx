import { Dropdown, SvgIcon } from '@km/shared-components-react'
import { CheckOutlined, DownOutlined } from '@ant-design/icons'
import type { PreviewKnowledgeSourceState } from '../../hooks/useAgentPreviewSender'

/**
 * 预览态知识源选择状态
 *
 * - 'all'             全部知识（默认）
 * - 'knowledgeGraph'  仅检索知识图谱
 * - 'networkSearch'   仅启用联网搜索
 */
export type PreviewSourceMode = PreviewKnowledgeSourceState['mode']

export interface PreviewKnowledgeSourceSelectorProps {
  value: PreviewKnowledgeSourceState
  onChange: (state: PreviewKnowledgeSourceState) => void
  /** agent 配置中是否启用知识图谱 */
  graphEnabled?: boolean
  /** agent 配置中是否启用联网搜索 */
  webSearchEnabled?: boolean
  /** 翻译函数 */
  t?: (key: string, params?: Record<string, any>) => string
}

const SELECTED_COLOR = 'text-[#2563EB]'
const DEFAULT_COLOR = 'text-[#1D1E1F]'

/**
 * 预览态知识源选择器（仅样式 + 交互，无文件选择弹窗）。
 *
 * 视觉与交互对齐前台
 * `apps/front-react/src/components/KnowledgeSource/selector.tsx`，
 * 但裁剪掉「从知识库选择文件/库/空间」的能力（仅保留三选一互斥的
 * 全部知识 / 知识图谱 / 联网搜索）。
 */
export function PreviewKnowledgeSourceSelector({
  value,
  onChange,
  graphEnabled = false,
  webSearchEnabled = false,
  t,
}: PreviewKnowledgeSourceSelectorProps) {
  const translate = t || ((key: string) => key)

  // 三选一互斥：选中时取消其它两个
  const setMode = (mode: PreviewSourceMode) => {
    if (value.mode === mode) return
    onChange({ mode })
  }

  const items: Array<{ key: PreviewSourceMode; icon: string; labelKey: string }> = [
    { key: 'all', icon: 'documents', labelKey: 'library.all_knowledge' },
  ]
  if (graphEnabled) items.push({ key: 'knowledgeGraph', icon: 'graph_v2', labelKey: 'chat.knowledge_graph' })
  if (webSearchEnabled) items.push({ key: 'networkSearch', icon: 'network', labelKey: 'chat.online_search' })

  // 触发按钮：按当前 mode 展示对应图标与文案
  const currentItem = items.find((it) => it.key === value.mode) || items[0]
  const triggerLabel = translate(currentItem.labelKey)

  return (
    <Dropdown
      menu={{
        items: items.map((it) => ({
          key: it.key,
          label: (
            <div className={`flex items-center gap-2 ${it.key === value.mode ? SELECTED_COLOR : DEFAULT_COLOR}`}>
              <SvgIcon name={it.icon} />
              <span className="text-sm whitespace-nowrap">{translate(it.labelKey)}</span>
              {it.key === value.mode && <CheckOutlined style={{ fontSize: 14 }} />}
            </div>
          ),
        })),
        onClick: ({ key }: { key: string }) => setMode(key as PreviewSourceMode),
      }}
      trigger={['click']}
      placement="bottom"
    >
      <div
        role="button"
        tabIndex={0}
        data-testid="preview-knowledge-source-selector"
        className={`h-8 px-4 flex items-center gap-1 rounded-full border border-[#E3EEFF] bg-[#F3F8FF] cursor-pointer ${SELECTED_COLOR}`}
      >
        <SvgIcon name={currentItem.icon} />
        <span className="text-sm whitespace-nowrap">{triggerLabel}</span>
        <div className="size-4 flex items-center justify-center">
          <DownOutlined style={{ fontSize: 14 }} />
        </div>
      </div>
    </Dropdown>
  )
}

export default PreviewKnowledgeSourceSelector