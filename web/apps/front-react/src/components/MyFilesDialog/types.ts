import type { FileItem } from '@/api/modules/files/types'

export type FileSource = 'uploads' | 'ai-generated' | 'recordings' | 'favorites' | 'recently'

export type SelectedFilesBySource = {
  uploads?: FileItem[]
  'ai-generated'?: FileItem[]
  recordings?: FileItem[]
  favorites?: FileItem[]
  recently?: FileItem[]
}

export interface MyFilesDialogProps {
  /** 启用哪些数据源作为 Tab(顺序即 Tab 顺序) */
  enabledSources: FileSource[]
  /** 默认激活的 Tab;不传则取 enabledSources[0] */
  defaultTab?: FileSource
  /** 确认回调:files 按 source 分桶返回 */
  onConfirm?: (bySource: SelectedFilesBySource) => void
}

// 传入 open 方法的简化文件信息(合并后携带 source 字段用于推断归属)
export interface SelectedFileInfo {
  id: string
  name: string
  icon?: string
  path?: string
  isfolder?: boolean
  rawData?: any
  /** 可选:明确指定归属 source;不传则按 path 前缀推断 */
  source?: FileSource
}

export interface MyFilesDialogRef {
  open: (files?: SelectedFileInfo[]) => void
}

export interface TreeNode {
  id: string
  name: string
  icon: string
  isfolder: boolean
  path: string
  children?: TreeNode[]
  loaded?: boolean
  hasSubFolders?: boolean // 子节点中是否有文件夹
  rawData?: any
}

/** 单个 source 的状态(per-source 隔离) */
export interface SourceState {
  treeData: TreeNode[]
  checkedKeys: string[]
  expandedKeys: string[]
  searchKeyword: string
  /** 是否首次加载过(true 时切回 Tab 不重发请求) */
  loaded: boolean
  loading: boolean
}