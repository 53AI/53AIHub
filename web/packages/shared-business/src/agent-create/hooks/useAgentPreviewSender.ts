import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { SkillFeature } from '@km/hub-ui-x-react'
import { AdapterContext } from '../adapters'
import {
  buildKnowledgeSourcePayload as buildPayload,
  type KnowledgeSourcePayloadConfig,
  type KnowledgeSourcePayload,
} from '../../chat/utils/buildKnowledgeSourcePayload'

export interface AgentPreviewModelOption {
  id: string
  /**
   * 展示文本键值（送入 PreviewModelSelector 的 t 函数解析）
   * - fast_reasoning → 'chat.fast_response'
   * - deep_reasoning → 'chat.deep_thinking'
   */
  label: string
  /** 触发按钮与菜单项的图标名（用于 SvgIcon，例如 'lightning' / 'star-link'） */
  icon: string
  channel_id: number
  channel_type: number
  model: string
}

export interface AgentPreviewSenderConfig {
  enabled: boolean
  agentKind: 'workbench' | 'knowledge' | 'none'
  skill?: SkillFeature
  model?: {
    options: AgentPreviewModelOption[]
    selectedId: string
    /**
     * 后端分配的模型 id（knowledge 场景才有值）
     * 对齐 apps/front-react/src/views/knowledge/chat.tsx 行 435
     * `modelId = currentModel?.id`。preview 通过 adapter.getAgentModels 拉取，
     * 按 value 匹配后取 API 的 id。未匹配 / 未加载完成时为 undefined。
     */
    modelId?: string | number
    onChange: (id: string) => void
  }
  /**
   * 知识源选择配置（仅 knowledge 类型）
   */
  knowledgeSource?: KnowledgeSourceConfig
  /** 切换知识源状态回调 */
  onKnowledgeSourceChange?: (state: PreviewKnowledgeSourceState) => void
  reset: () => void
}

/**
 * 预览态知识源状态
 * - 联网搜索(networkSearch)与其他三个互斥
 * - 知识图谱(knowledgeGraph)和动态知识(wiki)可同时开启
 * - 全部知识(all) = !networkSearch && !knowledgeGraph && !wiki
 */
export interface PreviewKnowledgeSourceState {
  // 全部知识库 （可与wiki、knowledgeGraph 同时开启）
  allKnowledge: boolean
  /** 联网搜索（与其他互斥） */
  networkSearch: boolean
  /** 知识图谱（可与 wiki、全部知识库 同时开启，） */
  knowledgeGraph: boolean
  /** 动态知识（可与 knowledgeGraph、全部知识库 同时开启） */
  wiki: boolean
}

/**
 * 知识源配置（直通模式）
 * 从设置中读取启用状态，从 UI 状态读取当前选中模式
 * 末端统一转换为 payload
 *
 * 与 chat/utils/buildKnowledgeSourcePayload.ts 的 KnowledgeSourcePayloadConfig 兼容。
 */
export type KnowledgeSourceConfig = KnowledgeSourcePayloadConfig & {
  /** 选中的动态知识（空间和页面混合数组，通过 wikiType 字段区分：'space' | 'page'） */
  wikis?: Array<{
    id: string
    name: string
    wikiType?: 'space' | 'page'
    icon?: string
    title?: string
    slug?: string
    summary?: string
    type?: 'wiki'
  }>
}

/** 将 KnowledgeSourceConfig 转换为 API payload */
export function buildKnowledgeSourcePayload(
  config: KnowledgeSourceConfig,
): KnowledgeSourcePayload {
  return buildPayload(config)
}

export {
  buildKnowledgeSourcePayload as buildKnowledgeSourcePayloadShared,
  type BuildKnowledgeSourcePayloadOptions,
} from '../../chat/utils/buildKnowledgeSourcePayload'

interface AgentPreviewSenderParams {
  /** 智能体 ID，用于拉 agent_models（仅 knowledge 场景） */
  agent_id?: string | number
  agent_type?: string
  /** 表单数据（实时响应配置变更） */
  form_data?: {
    settings?: {
      skills?: Array<{ skill_id: string; display_name?: string; skill_name?: string }>
      fast_reasoning_config?: { channel_id?: number; channel_type?: number; model_name?: string }
      deep_thinking_config?: { enable?: boolean; channel_id?: number; channel_type?: number; model_name?: string }
      web_search_setting?: { enable?: boolean }
      graph_search_setting?: { enable?: boolean; default_enable?: boolean }
      wiki_search_setting?: { enable?: boolean; default_enable?: boolean }
    }
  }
  /** @deprecated 使用 form_data 代替，保留用于向后兼容 */
  agent_data?: {
    settings?: {
      skills?: Array<{ skill_id: string; display_name?: string; skill_name?: string }>
      fast_reasoning_config?: { channel_id?: number; channel_type?: number; model_name?: string }
      deep_thinking_config?: { enable?: boolean; channel_id?: number; channel_type?: number; model_name?: string }
      web_search_setting?: { enable?: boolean }
      graph_search_setting?: { enable?: boolean; default_enable?: boolean }
      wiki_search_setting?: { enable?: boolean; default_enable?: boolean }
    }
  }
}

function buildModelId(channel_id: number, channel_type: number, model_name: string): string {
  return `${channel_id}_${channel_type}_${model_name}`
}

export function useAgentPreviewSender(params: AgentPreviewSenderParams): AgentPreviewSenderConfig {
  const { agent_id, agent_type, form_data, agent_data } = params
  // 优先使用 form_data（实时响应配置变更），降级使用 agent_data（向后兼容）
  const settings = form_data?.settings || agent_data?.settings
  // 独立测试或非 AgentCreatePage 场景下没有 AdapterProvider，
  // 安全降级为 undefined（modelId 不会拉到，preview 仍可工作只是 modelId 缺失）
  const adapter = useContext(AdapterContext)?.adapter

  // ============ workbench: 单选技能 ============
  // 状态机：'idle'（未交互，列出全部供选择） → 'selected'（已选一条） → 'cleared'（清空，留空数组）
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)
  const [interacted, setInteracted] = useState(false)

  const skillConfig = useMemo<SkillFeature | undefined>(() => {
    if (agent_type !== 'workbench') return undefined
    const skills = settings?.skills || []
    const enabledSkills = skills.filter((s) => s.skill_id)
    const allOptions: Array<{ id: string; label: string; display_name: string; skill_name?: string }> = enabledSkills.map((s) => ({
      id: s.skill_id,
      label: s.display_name || s.skill_name || s.skill_id,
      display_name: s.display_name || s.skill_name || s.skill_id,
      skill_name: s.skill_name || s.display_name || s.skill_id,
    }))
    // SkillFeature 语义（packages/hub-ui-x-react/components/Sender/types.ts）：
    //   list = 已选择的技能；suggestions = 下拉候选。
    // 之前未交互时把 allOptions 同时塞进 list，XSender 会把候选当作已选技能
    // 在 onSend 时通过 selectedSkills 传出，导致 Chat.tsx 兜底取第一个并注入 /skill_name 前缀。
    // 修正：list 仅在用户实际选中某条时填充，其他情况下保持空数组。
    const selectedList: typeof allOptions = selectedSkillId
      ? allOptions.filter((s) => s.id === selectedSkillId)
      : []
    return {
      enabled: true,
      list: selectedList,
      suggestions: allOptions,
      onSelect: (item) => {
        setSelectedSkillId(item.id || null)
        setInteracted(true)
      },
      onRemove: () => {
        setSelectedSkillId(null)
        setInteracted(true)
      },
    }
  }, [agent_type, settings?.skills, selectedSkillId])

  // ============ knowledge: 模型选择 ============
  // 模型是 agent 级别配置，不随发送清空（reset 不影响）
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  /** 后端返回的 agent_models（每条带独立 id 字段） */
  const [agentModels, setAgentModels] = useState<Array<{
    id: string | number
    channel_id: number
    channel_type: number
    model: string
  }>>([])

  // 拉取 agent_models，按 agent_id 变化重新请求。
  // 关键：不要把 settings 对象放 deps（每次渲染都是新对象引用），否则会无限重渲染。
  useEffect(() => {
    if (agent_type !== 'knowledge') return
    if (!agent_id || !adapter?.getAgentModels) return
    let cancelled = false
    adapter.getAgentModels(agent_id)
      .then((list) => {
        if (cancelled) return
        setAgentModels(Array.isArray(list) ? list : [])
      })
      .catch(() => {
        if (cancelled) return
        setAgentModels([])
      })
    return () => {
      cancelled = true
    }
  }, [agent_type, agent_id, adapter])

  const modelConfig = useMemo(() => {
    if (agent_type !== 'knowledge') return undefined
    const fast = settings?.fast_reasoning_config
    if (!fast?.channel_id) return undefined

    const fastOption: AgentPreviewModelOption = {
      id: buildModelId(fast.channel_id, fast.channel_type || 0, fast.model_name || ''),
      label: 'chat.fast_response',
      icon: 'lightning',
      channel_id: fast.channel_id,
      channel_type: fast.channel_type || 0,
      model: fast.model_name || '',
    }
    const options: AgentPreviewModelOption[] = [fastOption]

    const deep = settings?.deep_thinking_config
    if (deep?.enable && deep.channel_id) {
      options.push({
        id: buildModelId(deep.channel_id, deep.channel_type || 0, deep.model_name || ''),
        label: 'chat.deep_thinking',
        icon: 'star-link',
        channel_id: deep.channel_id,
        channel_type: deep.channel_type || 0,
        model: deep.model_name || '',
      })
    }

    const defaultId = selectedModelId && options.some((o) => o.id === selectedModelId)
      ? selectedModelId
      : options[0].id
    const selectedOption = options.find((o) => o.id === defaultId)

    // 按 channel_id + channel_type + model 三元组匹配 agent_models，
    // 取 API 给的真实 id 当 modelId。对齐 knowledge/chat.tsx 行 435 语义。
    const matchedModel = selectedOption
      ? agentModels.find(
          (m) =>
            m.channel_id === selectedOption.channel_id &&
            m.channel_type === selectedOption.channel_type &&
            m.model === selectedOption.model,
        )
      : undefined

    return {
      options,
      selectedId: defaultId,
      modelId: matchedModel?.id,
      onChange: (id: string) => setSelectedModelId(id),
    }
  }, [agent_type, settings?.fast_reasoning_config, settings?.deep_thinking_config, selectedModelId, agentModels])

  const reset = useCallback(() => {
    setSelectedSkillId(null)
    setInteracted(true)
    // knowledge 模型是 agent 级别，reset 不动 selectedModelId / source
  }, [])

  // ============ knowledge: 知识源选择 ============
  // 联网搜索与其他互斥；知识图谱和动态知识可同时开启；全部知识为独立状态
  const [sourceState, setSourceState] = useState<PreviewKnowledgeSourceState>(() => {
    if (agent_type !== 'knowledge') return { networkSearch: false, knowledgeGraph: false, wiki: false, allKnowledge: true }
    return {
      networkSearch: false,
      knowledgeGraph: Boolean(settings?.graph_search_setting?.default_enable),
      wiki: Boolean(settings?.wiki_search_setting?.default_enable),
      allKnowledge: true,
    }
  })

  const knowledgeSource = useMemo<KnowledgeSourceConfig | undefined>(() => {
    if (agent_type !== 'knowledge') return undefined
    const graphEnabled = Boolean(settings?.graph_search_setting?.enable)
    const webSearchEnabled = Boolean(settings?.web_search_setting?.enable)
    const wikiEnabled = Boolean(settings?.wiki_search_setting?.enable)
    return {
      state: sourceState,
      graphEnabled,
      webSearchEnabled,
      wikiEnabled,
    }
  }, [agent_type, sourceState, settings?.graph_search_setting?.enable, settings?.web_search_setting?.enable, settings?.wiki_search_setting?.enable])

  // 监听配置变化，自动重置无效选择
  useEffect(() => {
    if (agent_type !== 'knowledge') return

    const graphEnabled = Boolean(settings?.graph_search_setting?.enable)
    const webSearchEnabled = Boolean(settings?.web_search_setting?.enable)
    const wikiEnabled = Boolean(settings?.wiki_search_setting?.enable)
    const deepThinkingEnabled = Boolean(settings?.deep_thinking_config?.enable)

    // 知识源联动：禁用的选项自动关闭
    if (!graphEnabled && sourceState.knowledgeGraph) {
      setSourceState((prev) => ({ ...prev, knowledgeGraph: false }))
    }
    if (!webSearchEnabled && sourceState.networkSearch) {
      setSourceState((prev) => ({ ...prev, networkSearch: false }))
    }
    if (!wikiEnabled && sourceState.wiki) {
      setSourceState((prev) => ({ ...prev, wiki: false }))
    }

    // 模型联动：深度思考被关闭时，如果当前选中的是深度思考，切换回快速回答
    if (!deepThinkingEnabled && selectedModelId) {
      const fast = settings?.fast_reasoning_config
      if (fast?.channel_id) {
        const fastId = buildModelId(fast.channel_id, fast.channel_type || 0, fast.model_name || '')
        if (selectedModelId !== fastId) {
          setSelectedModelId(fastId)
        }
      }
    }
  }, [agent_type, settings?.graph_search_setting?.enable, settings?.web_search_setting?.enable, settings?.deep_thinking_config?.enable, settings?.fast_reasoning_config, sourceState, selectedModelId])

  if (agent_type === 'workbench') {
    return {
      enabled: true,
      agentKind: 'workbench',
      skill: skillConfig,
      reset,
    }
  }
  if (agent_type === 'knowledge' && modelConfig) {
    return {
      enabled: true,
      agentKind: 'knowledge',
      model: modelConfig,
      knowledgeSource,
      onKnowledgeSourceChange: (state: PreviewKnowledgeSourceState) => setSourceState(state),
      reset,
    }
  }
  return {
    enabled: false,
    agentKind: 'none',
    reset,
  }
}
