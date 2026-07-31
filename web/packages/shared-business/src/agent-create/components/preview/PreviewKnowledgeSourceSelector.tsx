import { Dropdown, SvgIcon } from '@km/shared-components-react'
import { CheckOutlined, DownOutlined } from '@ant-design/icons'
import type { KnowledgeSourceConfig, PreviewKnowledgeSourceState } from '../../hooks/useAgentPreviewSender'

export interface PreviewKnowledgeSourceSelectorProps {
  /** 知识源配置（直通模式） */
  knowledgeSource?: KnowledgeSourceConfig
  /** 切换知识源状态回调 */
  onKnowledgeSourceChange?: (state: PreviewKnowledgeSourceState) => void
  /** 翻译函数 */
  t?: (key: string, params?: Record<string, any>) => string
}

const SELECTED_COLOR = 'text-[#2563EB]'
const DEFAULT_COLOR = 'text-[#1D1E1F]'

/**
 * 预览态知识源选择器（仅样式 + 交互，无文件选择弹窗）。
 *
 * 对齐前台 `apps/front-react/src/components/KnowledgeSource/selector.tsx`：
 * - 联网搜索 与 知识图谱/动态知识/全部知识 互斥
 * - 知识图谱 与 动态知识 可同时开启
 * - 全部知识 = !networkSearch && !knowledgeGraph && !wiki
 */
export function PreviewKnowledgeSourceSelector({
  knowledgeSource,
  onKnowledgeSourceChange,
  t,
}: PreviewKnowledgeSourceSelectorProps) {
  const translate = t || ((key: string) => key)
  const state = knowledgeSource?.state || { networkSearch: false, knowledgeGraph: false, wiki: false, allKnowledge: true }
  const graphEnabled = knowledgeSource?.graphEnabled || false
  const webSearchEnabled = knowledgeSource?.webSearchEnabled || false
  const wikiEnabled = knowledgeSource?.wikiEnabled || false


  // 触发按钮显示逻辑（与 front-react 保持一致的优先级）
  const getDisplayContent = () => {
    if (state.networkSearch) {
      return { icon: 'network', labelKey: 'chat.online_search' }
    }
    if (state.wiki) {
      return { icon: 'book-one', labelKey: 'chat.wiki' }
    }
    if (state.knowledgeGraph) {
      return { icon: 'graph_v2', labelKey: 'chat.knowledge_graph' }
    }
    return { icon: 'documents', labelKey: 'library.all_knowledge' }
  }

  const current = getDisplayContent()

  // 菜单项配置（不含 onClick，由 menu.onClick 统一处理）
  const menuItems: Array<{
    key: string
    icon: string
    labelKey: string
    checked: boolean
  }> = [
    {
      key: 'all',
      icon: 'documents',
      labelKey: 'knowledge.document_file',
      checked: state.allKnowledge,
    },
  ]
  if (wikiEnabled) {
    menuItems.push({
      key: 'wiki',
      icon: 'book-one',
      labelKey: 'chat.wiki',
      checked: state.wiki,
    })
  }
  if (graphEnabled) {
    menuItems.push({
      key: 'knowledgeGraph',
      icon: 'graph_v2',
      labelKey: 'chat.knowledge_graph',
      checked: state.knowledgeGraph,
    })
  }
  if (webSearchEnabled) {
    menuItems.push({
      key: 'networkSearch',
      icon: 'network',
      labelKey: 'chat.online_search',
      checked: state.networkSearch,
    })
  }

  // 统一在 menu.onClick 层级处理点击
  const handleMenuClick = ({ key }: { key: string }) => {
    // 规则1: 知识图谱必须选中全部知识，关闭联网搜索
    // 规则2: 动态知识可与全部知识/知识图谱同时开
    // 规则3: 联网搜索关闭全部知识、动态知识、知识图谱
    // 取消全部知识时，关闭知识图谱
    // 全部知识 = 无任何特殊模式选中（networkSearch/knowledgeGraph/wiki 都为 false）

    let newState: PreviewKnowledgeSourceState

    if (key === 'all') {
      if (state.allKnowledge) {
        // 取消全部知识
        newState = { ...state, networkSearch: false, allKnowledge: false, knowledgeGraph: false }
      } else {
        // 选中全部知识
        newState = { ...state, networkSearch: false, allKnowledge: true }
      }
    } else if (key === 'knowledgeGraph') {
      const newKnowledgeGraph = !state.knowledgeGraph
      newState = {
        ...state,
        networkSearch: false,
        allKnowledge: newKnowledgeGraph ? true : state.allKnowledge,
        knowledgeGraph: newKnowledgeGraph,
      }
    } else if (key === 'networkSearch') {
      const newNetworkSearch = !state.networkSearch
      newState = {
        ...state,
        allKnowledge: newNetworkSearch ? false : state.allKnowledge,
        wiki: newNetworkSearch ? false : state.wiki,
        knowledgeGraph: newNetworkSearch ? false : state.knowledgeGraph,
        networkSearch: newNetworkSearch,
      }
    } else if (key === 'wiki') {
      // 动态知识与联网搜索互斥：启用时取消联网搜索，取消时恢复
      const newWiki = !state.wiki
      newState = {
        ...state,
        networkSearch: newWiki ? false : state.networkSearch,
        wiki: newWiki,
      }
    } else {
      return
    }

    // 如果无任何特殊模式选中，自动选中全部知识
    if (!newState.networkSearch && !newState.knowledgeGraph && !newState.wiki) {
      newState.allKnowledge = true
    }

    onKnowledgeSourceChange?.(newState)
  }

  return (
    <Dropdown
      menu={{
        items: menuItems.map((it) => ({
          key: it.key,
          label: (
            <div className={`flex items-center gap-2 ${it.checked ? SELECTED_COLOR : DEFAULT_COLOR}`}>
              <SvgIcon name={it.icon} />
              <span className="text-sm whitespace-nowrap">{translate(it.labelKey)}</span>
              {it.checked && <CheckOutlined style={{ fontSize: 14 }} />}
            </div>
          ),
        })),
        onClick: handleMenuClick,
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
        <SvgIcon name={current.icon} />
        <span className="text-sm whitespace-nowrap">{translate(current.labelKey)}</span>
        <div className="size-4 flex items-center justify-center">
          <DownOutlined style={{ fontSize: 14 }} />
        </div>
      </div>
    </Dropdown>
  )
}

export default PreviewKnowledgeSourceSelector
