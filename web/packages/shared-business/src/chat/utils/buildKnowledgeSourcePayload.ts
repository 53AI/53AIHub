/**
 * 知识源配置 → API payload 转换器。
 *
 * 由 useChatSend(发送消息)与 useAgentPreviewSender(预览)共享,
 * 避免两处实现漂移导致 chat / preview 行为不一致。
 *
 * 字段语义:
 * - enable_graph_search: 知识图谱开启(需要 graphEnabled 守卫)
 * - web_search_config:   联网搜索开启(需要 webSearchEnabled 守卫)
 * - wiki_search_config:  动态知识开启(需要 wikiEnabled 守卫);
 *                        当 wikis 非空时附带 space_ids / wiki_page_ids。
 */
export interface WikiItemPayload {
  id: string
  wikiType?: 'space' | 'page'
  /** 页面所属空间 ID；page 类型需携带，用于 wiki_search_config.space_ids */
  space_id?: string
}

export interface KnowledgeSourcePayloadConfig {
  state: {
    allKnowledge: boolean
    networkSearch: boolean
    knowledgeGraph: boolean
    wiki: boolean
  }
  graphEnabled: boolean
  webSearchEnabled: boolean
  wikiEnabled: boolean
  /** 选中的动态知识(空间/页面混合数组,通过 wikiType 字段区分) */
  wikis?: WikiItemPayload[]
}

export interface KnowledgeSourcePayload {
  enable_graph_search?: boolean
  web_search_config?: Record<string, unknown>
  wiki_search_config?: {
    enabled: boolean
    space_ids?: string[]
    wiki_page_ids?: string[]
  }
}

export interface BuildKnowledgeSourcePayloadOptions {
  /**
   * 联网搜索时附带的具体配置(top_k、provider 等)。
   * 不传时只发 `web_search_config: {}`,由后端使用默认值。
   */
  webSearchConfig?: Record<string, unknown>
}

export function buildKnowledgeSourcePayload(
  config: KnowledgeSourcePayloadConfig,
  options: BuildKnowledgeSourcePayloadOptions = {},
): KnowledgeSourcePayload {
  const { state, graphEnabled, webSearchEnabled, wikiEnabled, wikis } = config
  const { webSearchConfig } = options

  // 仅在有内容时才发出对应字段，避免向 API 发送空数组。
  // space_ids = space 类型 wiki 的 id ∪ page 类型 wiki 所属的 space_id（去重）。
  const wikiSpaceIdSet = new Set<string>()
  const wikiPageIds: string[] = []
  for (const w of wikis ?? []) {
    if (w.wikiType === 'space') {
      wikiSpaceIdSet.add(w.id)
    } else if (w.wikiType === 'page') {
      wikiPageIds.push(w.id)
      if (w.space_id) wikiSpaceIdSet.add(w.space_id)
    }
  }
  const wikiSpaceIds = [...wikiSpaceIdSet]

  const wikiSearchConfig =
    state.wiki && wikiEnabled
      ? {
          enabled: true,
          ...(wikiSpaceIds.length > 0 ? { space_ids: wikiSpaceIds } : {}),
          ...(wikiPageIds.length > 0 ? { wiki_page_ids: wikiPageIds } : {}),
        }
      : undefined

  return {
    ...(state.knowledgeGraph && graphEnabled ? { enable_graph_search: true } : {}),
    ...(state.networkSearch && webSearchEnabled
      ? { web_search_config: webSearchConfig ?? {} }
      : {}),
    ...(wikiSearchConfig ? { wiki_search_config: wikiSearchConfig } : {}),
  }
}