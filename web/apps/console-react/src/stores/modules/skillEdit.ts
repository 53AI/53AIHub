import { create } from 'zustand'
import { skillApi } from '@/api/modules/skill'
import type { SkillFileItem, AdminStatus } from '@/api/modules/skill/types'
import { isKKFileViewSupported } from '@km/shared-utils'

/** 获取文件扩展名 */
function getFileExtension(filename: string): string {
  if (!filename) return ''
  const lastDotIndex = filename.lastIndexOf('.')
  if (lastDotIndex === -1 || lastDotIndex === filename.length - 1) return ''
  return filename.slice(lastDotIndex + 1).toLowerCase()
}

/** 暂存的文件更改 */
interface PendingFileChange {
  original: string      // 原始内容
  edited: string        // 编辑后的内容
}

/** 编辑器区域确认弹窗状态 */
interface ConfirmModalState {
  visible: boolean
  onConfirm?: () => void
  onCancel?: () => void
}

interface SkillEditState {
  // 技能 ID
  skillId: string | null

  // 文件列表
  files: SkillFileItem[]
  filesLoading: boolean

  // 当前文件
  currentFile: SkillFileItem | null
  currentFileContent: string      // 当前显示的内容
  currentFileOriginalContent: string  // 当前文件的原始内容（用于检测是否有修改）
  contentLoading: boolean

  // 暂存区：所有修改过的文件内容（前端缓存）
  pendingChanges: Map<string, PendingFileChange>

  // 当前文件是否有未暂存的更改
  isCurrentFileDirty: boolean

  // 整体是否有任何更改（用于 beforeunload）
  hasAnyChanges: boolean

  // 保存状态
  saving: boolean

  // 二次确认弹窗状态
  confirmModalState: ConfirmModalState

  // 初始化技能编辑
  init: (skillId: string) => Promise<void>

  // 获取文件列表
  fetchFiles: () => Promise<void>

  // 切换文件（含二次确认）
  selectFile: (file: SkillFileItem) => Promise<boolean>

  // 加载文件内容
  loadFileContent: (file: SkillFileItem) => Promise<void>

  // 更新当前文件内容（编辑时调用）
  updateCurrentContent: (content: string) => void

  // 保存当前文件到暂存区
  saveCurrentToPending: () => void

  // 放弃当前文件的更改
  discardCurrentChanges: () => void

  // 发布时批量保存所有暂存的文件
  batchSaveAll: (formData: {
    display_name?: string
    description?: string
    usage_guide?: string
    version?: string
    sort?: number
    admin_status?: AdminStatus
    group_ids?: number[]
    subscription_group_ids?: number[]
    user_group_ids?: number[]
  }, hasFormDataChanges?: boolean) => Promise<boolean>

  // 显示确认弹窗
  showConfirmModal: (state: ConfirmModalState) => void

  // 隐藏确认弹窗
  hideConfirmModal: () => void

  // 重置状态
  reset: () => void

  // 获取某个文件的暂存内容（如果有）
  getPendingContent: (path: string) => string | null

  // 检查某个文件是否有暂存的更改
  hasPendingChange: (path: string) => boolean
}

const initialState = {
  skillId: null,
  files: [],
  filesLoading: false,
  currentFile: null,
  currentFileContent: '',
  currentFileOriginalContent: '',
  contentLoading: false,
  pendingChanges: new Map<string, PendingFileChange>(),
  isCurrentFileDirty: false,
  hasAnyChanges: false,
  saving: false,
  confirmModalState: { visible: false },
}

/** 递归查找文件 */
function findFileByName(files: SkillFileItem[], targetName: string): SkillFileItem | null {
  for (const file of files) {
    if (file.type === 'file' && file.name.toLowerCase() === targetName.toLowerCase()) {
      return file
    }
    if (file.children) {
      const found = findFileByName(file.children, targetName)
      if (found) return found
    }
  }
  return null
}

export const useSkillEditStore = create<SkillEditState>((set, get) => ({
  ...initialState,

  async init(skillId: string) {
    const { skillId: currentSkillId, filesLoading } = get()
    // 如果已初始化过相同的 skillId 或正在加载中，跳过
    if (currentSkillId === skillId || filesLoading) return
    set({ ...initialState, skillId })
    await get().fetchFiles()
  },

  async fetchFiles() {
    const { skillId } = get()
    if (!skillId) return

    set({ filesLoading: true })
    try {
      const files = await skillApi.getFileList(skillId)
      set({ files, filesLoading: false })

      // 默认选中 skill.md 文件
      const skillMdFile = findFileByName(files, 'skill.md')
      if (skillMdFile) {
        get().loadFileContent(skillMdFile)
      }
    } catch (error) {
      console.error('Failed to fetch files:', error)
      set({ filesLoading: false })
    }
  },

  async selectFile(file: SkillFileItem): Promise<boolean> {
    const { isCurrentFileDirty } = get()

    // 如果当前文件有未暂存的更改，需要二次确认
    if (isCurrentFileDirty) {
      // 返回 Promise，等待用户确认
      return new Promise((resolve) => {
        set({
          confirmModalState: {
            visible: true,
            onConfirm: async () => {
              // 确认离开：放弃当前修改，不保存到暂存区
              set({ confirmModalState: { visible: false } })
              await get().loadFileContent(file)
              resolve(true)
            },
            onCancel: () => {
              set({ confirmModalState: { visible: false } })
              resolve(false)
            },
          },
        })
      })
    }

    // 直接切换文件
    await get().loadFileContent(file)
    return true
  },

  async loadFileContent(file: SkillFileItem) {
    const { skillId, pendingChanges } = get()
    if (!skillId || file.type === 'directory') return

    set({ contentLoading: true, currentFile: file, isCurrentFileDirty: false })

    // KKFileView 类型文件（PDF、图片等）不需要加载内容，直接渲染预览
    const ext = getFileExtension(file.name)
    if (isKKFileViewSupported(ext)) {
      set({
        currentFileContent: '',
        currentFileOriginalContent: '',
        contentLoading: false,
      })
      return
    }

    try {
      // 先检查暂存区是否有该文件的内容
      const pendingContent = pendingChanges.get(file.path)
      if (pendingContent) {
        // 使用暂存区的编辑内容作为当前内容，原始内容用于对比
        set({
          currentFileContent: pendingContent.edited,
          currentFileOriginalContent: pendingContent.original,
          contentLoading: false,
        })
        return
      }

      // 从 API 加载文件内容
      const response = await skillApi.getFileContent(skillId, file.path)
      set({
        currentFileContent: response.content,
        currentFileOriginalContent: response.content,
        contentLoading: false,
      })
    } catch (error) {
      console.error('Failed to load file content:', error)
      set({
        currentFileContent: '',
        currentFileOriginalContent: '',
        contentLoading: false,
      })
    }
  },

  updateCurrentContent(content: string) {
    const { currentFile, currentFileOriginalContent } = get()
    if (!currentFile) return

    // 检查是否与原始内容相同
    const isDirty = content !== currentFileOriginalContent

    set({
      currentFileContent: content,
      isCurrentFileDirty: isDirty,
    })
  },

  saveCurrentToPending() {
    const { currentFile, currentFileContent, currentFileOriginalContent, pendingChanges, hasAnyChanges } = get()
    if (!currentFile) return

    // 如果当前内容与原始内容相同，则从暂存区移除
    if (currentFileContent === currentFileOriginalContent) {
      const newPendingChanges = new Map(pendingChanges)
      newPendingChanges.delete(currentFile.path)
      set({
        pendingChanges: newPendingChanges,
        isCurrentFileDirty: false,
        hasAnyChanges: newPendingChanges.size > 0,
      })
      return
    }

    // 更新暂存区
    const newPendingChanges = new Map(pendingChanges)
    newPendingChanges.set(currentFile.path, {
      original: currentFileOriginalContent,
      edited: currentFileContent,
    })

    set({
      pendingChanges: newPendingChanges,
      isCurrentFileDirty: false,
      hasAnyChanges: true,
      // 更新原始内容为当前内容，这样保存按钮会消失
      currentFileOriginalContent: currentFileContent,
    })
  },

  discardCurrentChanges() {
    const { currentFile, currentFileOriginalContent, pendingChanges } = get()
    if (!currentFile) return

    // 如果暂存区有该文件的内容，恢复到暂存的内容
    const pendingChange = pendingChanges.get(currentFile.path)
    if (pendingChange) {
      set({
        currentFileContent: pendingChange.edited,
        currentFileOriginalContent: pendingChange.original,
        isCurrentFileDirty: false,
      })
    } else {
      // 恢复到原始内容
      set({
        currentFileContent: currentFileOriginalContent,
        isCurrentFileDirty: false,
      })
    }
  },

  async batchSaveAll(formData, hasFormDataChanges?: boolean): Promise<boolean> {
    const { skillId, pendingChanges, saving } = get()
    if (!skillId || saving) return false

    // 如果没有数据变化且没有文件修改，直接返回成功
    const hasFileChanges = pendingChanges.size > 0
    if (!hasFormDataChanges && !hasFileChanges) return true

    set({ saving: true })

    try {
      // 1. 如果左侧数据有变化，更新技能信息
      if (hasFormDataChanges) {
        await skillApi.update(skillId, {
          display_name: formData.display_name,
          description: formData.description,
          usage_guide: formData.usage_guide,
          version: formData.version,
          sort: formData.sort,
          admin_status: formData.admin_status,
          group_ids: formData.group_ids,
          subscription_group_ids: formData.subscription_group_ids,
          user_group_ids: formData.user_group_ids,
        })
      }

      // 2. 如果有文件修改，更新文件
      if (hasFileChanges) {
        const files = Array.from(pendingChanges.entries()).map(([path, change]) => ({
          path,
          content: change.edited,
        }))

        await skillApi.updateFiles(skillId, { files })
      }

      // 更新状态
      const { currentFile, currentFileContent } = get()
      set({
        pendingChanges: new Map(),  // 清空暂存区
        hasAnyChanges: false,
        saving: false,
        // 如果当前文件有修改，更新原始内容为保存后的内容
        currentFileOriginalContent: currentFile ? currentFileContent : '',
      })

      return true
    } catch (error) {
      console.error('Failed to batch save files:', error)
      set({ saving: false })
      return false
    }
  },

  showConfirmModal(state: ConfirmModalState) {
    set({ confirmModalState: { ...state, visible: true } })
  },

  hideConfirmModal() {
    set({ confirmModalState: { visible: false } })
  },

  reset() {
    set(initialState)
  },

  getPendingContent(path: string): string | null {
    const { pendingChanges } = get()
    const change = pendingChanges.get(path)
    return change?.edited || null
  },

  hasPendingChange(path: string): boolean {
    const { pendingChanges } = get()
    return pendingChanges.has(path)
  },
}))

export default useSkillEditStore