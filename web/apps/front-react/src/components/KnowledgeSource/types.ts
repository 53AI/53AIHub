/**
 * KnowledgeSource 组件类型定义
 */

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
}

/** 已选空间 */
export interface SelectedSpace {
  id: string
  name: string
  icon?: string
}

/** 知识源选择器状态 */
export interface KnowledgeSourceState {
  mode: 'all' | 'files' | 'libraries' | 'spaces'
  allKnowledge: boolean
  knowledgeGraph: boolean
  networkSearch: boolean
  selectedFiles: SelectedFile[]
  selectedLibraries?: SelectedLibrary[]
  selectedSpaces?: SelectedSpace[]
}

/** KnowledgeSourceSelector 组件 Props */
export interface KnowledgeSourceSelectorProps {
  value: KnowledgeSourceState
  onChange: (state: KnowledgeSourceState) => void
  library?: { name: string; icon?: string; value: string[]; isSpace?: boolean }
  disabled?: boolean
  allowSelectLibrary?: boolean
  allowSelectSpace?: boolean
  agentInfo?: {
    agent_id: string
    name: string
    logo: string
    settings?: {
      web_search_setting?: { enable: boolean }
      graph_search_setting?: { enable: boolean; default_enable: boolean }
    }
  }
}

/** KnowledgeSourceSelector 组件 Ref */
export interface KnowledgeSourceSelectorRef {
  reset: () => void
}