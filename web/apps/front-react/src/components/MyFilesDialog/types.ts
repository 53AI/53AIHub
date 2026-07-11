import type { FileItem } from '@/api/modules/files/types'

export type FileSource = 'uploads' | 'ai-generated' | 'recordings'

export interface MyFilesDialogProps {
  source: FileSource
  onConfirm?: (files: FileItem[]) => void
}

// 传入 open 方法的简化文件信息
export interface SelectedFileInfo {
  id: string
  name: string
  icon?: string
  path?: string
  isfolder?: boolean
  rawData?: any
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
