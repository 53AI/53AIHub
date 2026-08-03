/**
 * KnowledgeSource 组件类型定义
 */
import type { SpaceItem } from "@/api/modules/spaces";
import type { WikiPageItem } from "@/api/modules/wiki";

/** 已选文件 */
export interface SelectedFile {
  id: string
  name: string
  icon?: string
  upload_file_id?: number
  file_size?: number
  file_mime?: string
  library_id?: string
  isfolder?: boolean
}

/** 已选知识库 */
export interface SelectedLibrary {
  id: string
  name: string
  icon?: string
  /** 标识这是知识库(用于消息 specified_files 与 selectedMentionLinks 区分) */
  islibrary?: boolean
}

/** 已选空间 */
export interface SelectedSpace {
  id: string
  name: string
  icon?: string
  wikiType?: 'space'
}

/** 知识源选择器状态 */
export interface KnowledgeSourceState {
  mode: 'all' | 'files' | 'libraries' | 'spaces' | 'wiki'
  allKnowledge: boolean
  knowledgeGraph: boolean
  networkSearch: boolean
  wiki: boolean
  selectedFiles: SelectedFile[]
  selectedLibraries?: SelectedLibrary[]
  selectedSpaces?: SelectedSpace[]
  /** 动态知识 - 选中的空间 */
  selectedWikiSpaces?: SelectedSpace[]
  /** 动态知识 - 选中的页面 */
  selectedWikiPages?: SelectedWikiPage[]
}

/** 动态知识 - 已选页面 */
export interface SelectedWikiPage {
  id: string
  title: string
  slug?: string
  summary?: string
  /** 页面所属空间 ID，用于 wiki_search_config.space_ids */
  space_id?: string
  wikiType: 'page'
}

/** KnowledgeSourceSelector 组件 Props */
export interface KnowledgeSourceSelectorProps {
  value: KnowledgeSourceState
  onChange: (state: KnowledgeSourceState) => void
  library?: { name: string; icon?: string; value: string[]; isSpace?: boolean }
  disabled?: boolean
  allowSelectLibrary?: boolean
  allowSelectSpace?: boolean
  allowSelectDynamicKnowledge?: boolean
  agentInfo?: {
    agent_id: string
    name: string
    logo: string
    settings?: {
      web_search_setting?: { enable: boolean }
      graph_search_setting?: { enable: boolean; default_enable: boolean }
      wiki_search_setting?: { enable: boolean; default_enable: boolean }
    }
  }
}

/** KnowledgeSourceSelector 组件 Ref */
export interface KnowledgeSourceSelectorRef {
  reset: () => void
  /** 基于当前 value 打开「从知识库选择」弹窗(预填已选文件/知识库/空间/动态知识) */
  open: () => void
}

/**
 * 动态知识统一项(空间或页面,通过 wikiType 区分)
 * - SpaceItem 来自 @/api/modules/spaces
 * - WikiPageItem 来自 @/api/modules/wiki
 *   type: 'wiki' 字段用于在消息 specified_files 中与普通文件/库/空间区分
 */
export type WikiItem =
  | (SpaceItem & { wikiType: 'space'; type: 'wiki' })
  | (WikiPageItem & { wikiType: 'page'; type: 'wiki' });