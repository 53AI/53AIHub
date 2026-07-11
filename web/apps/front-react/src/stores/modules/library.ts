import { create } from 'zustand'
import { CHUNK_STATUS, RUN_STATUS, type RunStatus } from '@/constants/chunk'
import { RESOURCE_TYPE } from '@/components/KMPermission/constant'

import filesApi, { type FileItem } from '@/api/modules/files'
import { type SpaceItem, spacesApi } from '@/api/modules/spaces'
import chunksApi, { type KnowledgeChunk } from '@/api/modules/chunks'
import { LibraryItem, librariesApi } from '@/api/modules/libraries'
import permissionsApi, { type PermissionItem, type PermissionMeResponse } from '@/api/modules/permissions'
import { formatFile, buildFileTree } from '@/api/modules/files/transform'

import { getSimpleDateFormatString, cacheManager as cache, CacheMode } from '@km/shared-utils'

// Types
export interface UploadItem {
  id: string
  file: File
  status: 'waiting' | 'uploading' | 'paused' | 'completed' | 'error' | 'cancelled'
  progress: number
  icon?: string
  error?: string
  abortController?: AbortController | { signal: { aborted: boolean }; abort: () => void }
  startTime?: number
  folder?: string
  batchId: string
  uploadToken: string
  fileUploadId: string
  fileId: string
  // 用于内存管理
  progressTimer?: ReturnType<typeof setInterval>
  pendingProgress?: number
  duplicateMode?: 'replace' | 'sequence'
}

// Helper functions
export const formatLibrary = (library: LibraryItem): LibraryItem & { updated_date: string; updated_at: string } => {
  return {
    ...library,
    name: library.name,
    updated_date: getSimpleDateFormatString({
      date: library.updated_time,
      format: 'MM-DD'
    }),
    updated_at: getSimpleDateFormatString({
      date: library.updated_time,
      format: 'YYYY-MM-DD hh:mm'
    })
  }
}

// Constants
const POLLING_INTERVAL = 5000
const MIN_SIDEBAR_WIDTH = 240
const MAX_SIDEBAR_WIDTH = 480

interface LibraryState {
  // State
  space_id: string
  library_id: string
  siderVisible: boolean
  sidebarCollapsed: boolean
  sidebarWidth: number
  currentFileId: string
  space: SpaceItem | null
  library: LibraryItem | null
  chunks: KnowledgeChunk[]
  isRestore: boolean
  restoreContent: string
  fileViewType: 'preview' | 'chunk' | ''
  files: FileItem[]
  pollingTimer: ReturnType<typeof setInterval> | null
  expandedKeys: string[]
  uploadQueue: UploadItem[]
  assistantExpanded: boolean
  assistantCollapsed: boolean
  assistantInstall: boolean
  assistantVisible: boolean // 控制助手面板容器是否显示
  fileRefreshKey: number // 用于触发文件列表刷新
  // Agent 缓存（避免每次打开面板都请求）
  assistantChatAgent: any | null
  assistantMapAgent: any | null
  assistantCustomApps: any[]

  // Getters (computed)
  currentFile: () => FileItem | undefined
  treeFiles: () => FileItem[]
  pureFiles: () => FileItem[]
  pureFolders: () => FileItem[]
  uploadingUploads: () => UploadItem[]
  completedUploads: () => UploadItem[]
  failedUploads: () => UploadItem[]

  // Actions
  loadSpace: () => void
  setLibraryType: (fileViewType: 'preview' | 'chunk' | '') => Promise<void>
  setLibraryId: (library_id: string) => Promise<void>
  loadLibrary: () => Promise<void>
  loadChunks: (file_id: string) => Promise<void>
  deleteChunk: (chunk: KnowledgeChunk) => Promise<void>
  updateChunkContent: (chunk: KnowledgeChunk) => void
  enableChunk: (chunk: KnowledgeChunk) => Promise<void>
  disabledChunk: (chunk: KnowledgeChunk) => Promise<void>
  clearChunks: () => void
  toggleSider: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setSidebarWidth: (width: number) => Promise<void>
  loadSidebarWidth: () => Promise<void>
  loadFilesAll: () => Promise<void>
  hasProcessingFiles: () => boolean
  startPollingIfNeeded: () => void
  stopPolling: () => void
  loadFile: (file_id: string, force?: boolean) => Promise<FileItem | null>
  updateFile: (file: Partial<FileItem>) => void
  setCurrentFileId: (file_id: string) => Promise<FileItem | undefined>
  loadFilePermissions: (file_id: string) => void
  createFile: (data: { path: string; name: string; permissions: PermissionItem[] }) => Promise<any>
  findNodesInPath: (path: string, files: FileItem[]) => FileItem[]
  findNodeInPath: (path: string, files: FileItem[]) => FileItem | null
  findNodeInBasePath: (base_path: string, files: FileItem[]) => FileItem[]
  createFolder: (data: { path: string; name: string }) => Promise<any>
  rename: (id: string, path: string) => Promise<any>
  updateFolder: () => void
  deleteFile: (file: FileItem) => Promise<void>
  setExpandedKeys: (keys: string[]) => void
  setUploadQueue: (val: UploadItem[]) => void
  setAssistantExpanded: (expanded: boolean) => void
  setAssistantCollapsed: (collapsed: boolean) => void
  setAssistantInstall: (install: boolean) => void
  setAssistantVisible: (visible: boolean) => void
  setAssistantAgents: (chatAgent: any | null, mapAgent: any | null, customApps: any[]) => void
  clearState: () => void
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  // Initial state
  library_id: '',
  space_id: '',
  siderVisible: true,
  sidebarCollapsed: false,
  sidebarWidth: MIN_SIDEBAR_WIDTH,
  currentFileId: '',
  space: null,
  library: null,
  chunks: [],
  isRestore: false,
  restoreContent: '',
  fileViewType: 'preview',
  files: [],
  pollingTimer: null,
  expandedKeys: [],
  uploadQueue: [],
  assistantExpanded: false,
  assistantCollapsed: false,
  assistantInstall: false,
  assistantVisible: false,
  fileRefreshKey: 0,
  assistantChatAgent: null,
  assistantMapAgent: null,
  assistantCustomApps: [],

  // Getters
  currentFile: () => {
    const state = get()
    return state.files.find((item) => item.id === state.currentFileId)
  },

  treeFiles: () => {
    const state = get()
    return buildFileTree<FileItem>(state.files)
  },

  pureFiles: () => {
    const state = get()
    return state.files.filter((item) => item.isfile)
  },

  pureFolders: () => {
    const state = get()
    return state.files.filter((item) => !item.isfile)
  },

  uploadingUploads: () => {
    const state = get()
    return state.uploadQueue.filter(
      (item) => item.status === 'uploading' || item.status === 'waiting'
    )
  },

  completedUploads: () => {
    const state = get()
    return state.uploadQueue.filter((item) => item.status === 'completed')
  },

  failedUploads: () => {
    const state = get()
    return state.uploadQueue.filter((item) => item.status === 'error')
  },

  // Actions
  loadSpace: () => {
    const state = get()
    spacesApi.get(state.space_id).then((data) => {
      set({ space: data })
    })
  },

  setLibraryType: async (fileViewType: 'preview' | 'chunk' | '') => {
    const state = get()
    if (state.fileViewType === fileViewType) return
    set({ fileViewType })
  },

  setLibraryId: async (library_id: string) => {
    const state = get()
    if (state.library_id === library_id) return
    set({ library_id })
    await get().loadLibrary()
  },

  loadLibrary: () => {
    const state = get()
    return librariesApi.get(state.library_id).then((data) => {
      set({ library: data, space_id: data.space_id })
      get().loadSpace()
    })
  },

  loadChunks: (file_id: string) => {
    return chunksApi.files.list(file_id).then((data) => {
      set({ chunks: data.chunks })
    })
  },

  deleteChunk: (chunk: KnowledgeChunk) => {
    return chunksApi.delete(chunk.id).then(() => {
      set((state) => ({
        chunks: state.chunks.filter((item) => item.id !== chunk.id)
      }))
    })
  },

  updateChunkContent: (chunk: KnowledgeChunk) => {
    set((state) => ({
      chunks: state.chunks.map((item) => {
        if (item.id === chunk.id) {
          return {
            ...item,
            content: chunk.content
          }
        }
        return item
      })
    }))
  },

  enableChunk: (chunk: KnowledgeChunk) => {
    return chunksApi.enable(chunk.id).then(() => {
      set((state) => {
        const chunks = [...state.chunks]
        const data = chunks.find((item) => item.id === chunk.id)
        if (data) {
          data.status = CHUNK_STATUS.ENABLED
        }
        return { chunks }
      })
    })
  },

  disabledChunk: (chunk: KnowledgeChunk) => {
    return chunksApi.disable(chunk.id).then(() => {
      set((state) => {
        const chunks = [...state.chunks]
        const data = chunks.find((item) => item.id === chunk.id)
        if (data) {
          data.status = CHUNK_STATUS.DISABLED
        }
        return { chunks }
      })
    })
  },

  clearChunks: () => {
    set({ chunks: [] })
  },

  toggleSider: () => {
    set((state) => {
      const newVisible = !state.siderVisible
      return {
        siderVisible: newVisible,
        sidebarCollapsed: newVisible ? false : state.sidebarCollapsed
      }
    })
  },

  setSidebarCollapsed: (collapsed: boolean) => {
    set({ sidebarCollapsed: collapsed })
  },

  setSidebarWidth: async (width: number) => {
    // 限制宽度在 240-480 之间
    const clampedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, width))
    set({ sidebarWidth: clampedWidth })

    // 保存到缓存
    await cache.set('sidebar_width', clampedWidth, 60 * 24 * 30, CacheMode.LOCAL_STORAGE) // 30天过期
  },

  loadSidebarWidth: async () => {
    const cachedWidth = await cache.get<number>('sidebar_width', CacheMode.LOCAL_STORAGE)
    if (cachedWidth && cachedWidth >= MIN_SIDEBAR_WIDTH && cachedWidth <= MAX_SIDEBAR_WIDTH) {
      set({ sidebarWidth: cachedWidth })
    }
  },

  loadFilesAll: () => {
    const state = get()
    if (!state.library_id) return Promise.resolve()
    return filesApi.all({ library_id: state.library_id }).then((data) => {
      const list = data.map(formatFile)
      const formattedFiles = list.map((item) => {
        const file = state.files.find((file) => file.id === item.id)
        if (file) {
          return {
            ...item,
            last_body_time: file.last_body_time,
            permission: file.permission,
            is_favorite: file.is_favorite,
            file_url: file.file_url
          }
        } else {
          return item
        }
      })
      set({ files: formattedFiles })
      get().startPollingIfNeeded()
    })
  },

  hasProcessingFiles: () => {
    const state = get()
    return state.files.some(file => [RUN_STATUS.PROCESSING, RUN_STATUS.PENDING].includes(file.cleaning_info?.status as RunStatus))
  },

  startPollingIfNeeded: () => {
    get().stopPolling() // 先停止现有的轮询

    if (get().hasProcessingFiles()) {
      const timer = setInterval(() => {
        get().loadFilesAll()
      }, POLLING_INTERVAL)
      set({ pollingTimer: timer })
    }
  },

  stopPolling: () => {
    const state = get()
    if (state.pollingTimer) {
      clearInterval(state.pollingTimer)
      set({ pollingTimer: null })
    }
  },

  loadFile: (file_id: string, force: boolean = false) => {
    return filesApi.get(file_id).then((data) => {
      const file = formatFile(data)
      set((state) => {
        const files = [...state.files]
        const fileIndex = files.findIndex(item => item.id === file_id)
        if (fileIndex !== -1) {
          // 使用对象展开和替换来确保响应式更新
          if (force) {
            files[fileIndex] = {
              ...file,
              permission: files[fileIndex].permission,
              is_favorite: files[fileIndex].is_favorite,
              file_url: files[fileIndex].file_url
            }
          } else if (file.isfile) {
            files[fileIndex] = {
              ...files[fileIndex],
              is_favorite: file.is_favorite,
              last_body_time: file.last_body_time,
              parse_type: file.parse_type,
              parsing_status: file.parsing_status,
              updated_at: file.updated_at,
              updated_time: file.updated_time,
              file_url: file.file_url,
              cleaning_info: file.cleaning_info
            }
          } else {
            files[fileIndex] = {
              ...files[fileIndex],
              is_favorite: file.is_favorite,
            }
          }
        }
        return { files }
      })

      const currentState = get()
      if (force) {
        currentState.loadFilePermissions(file.id)
      }
      return file
    })
  },

  updateFile: (file: Partial<FileItem>) => {
    set((state) => {
      const files = [...state.files]
      const fileIndex = files.findIndex(item => item.id === file.id)
      if (fileIndex !== -1) {
        files[fileIndex] = {
          ...files[fileIndex],
          ...file
        }
      }
      return { files }
    })
  },

  setCurrentFileId: async (file_id: string) => {
    const state = get()
    if (state.currentFileId === file_id) return state.currentFile()
    try {
      const file = await get().loadFile(file_id)
      get().loadFilePermissions(file_id)
      set({ currentFileId: file_id })
      return file || undefined
    } catch (error) {
      set({ currentFileId: file_id })
      return undefined
    }
  },

  loadFilePermissions: (file_id: string) => {
    cache.getOrFetch(`file_permissions_${file_id}`, () => {
      return permissionsApi.my({
        resource_type: RESOURCE_TYPE.file,
        resource_id: file_id
      })
    }).then((data: PermissionMeResponse) => {
      set((state) => {
        const files = [...state.files]
        const file = files.find((item) => item.id === file_id)
        if (file) {
          file.permission = data.max_permission
        }
        return { files }
      })
      return data
    })
  },

  createFile: (data: { path: string; name: string; permissions: PermissionItem[] }) => {
    const state = get()
    return filesApi.create({
      path: `${data.path}/${data.name}`,
      type: 1,
      library_id: state.library_id,
      permissions: data.permissions
    })
  },

  findNodesInPath: (path: string, files: FileItem[]): FileItem[] => {
    for (let i = 0; i < files.length; i++) {
      const element = files[i]
      if (element.path === path) {
        return element.children || []
      }
      if (element.children) {
        const result = get().findNodesInPath(path, element.children)
        if (result.length > 0) {
          return result
        }
      }
    }
    return []
  },

  findNodeInPath: (path: string, files: FileItem[]): FileItem | null => {
    for (let i = 0; i < files.length; i++) {
      const element = files[i]
      if (element.path === path) {
        return element
      }
      if (element.children) {
        const result = get().findNodeInPath(path, element.children)
        if (result) {
          return result
        }
      }
    }
    return null
  },

  findNodeInBasePath: (base_path: string, files: FileItem[]): FileItem[] => {
    const result: FileItem[] = []
    for (let i = 0; i < files.length; i++) {
      const element = files[i]
      if (element.base_path === base_path) {
        result.push(element)
      }
      if (element.children) {
        const childResult = get().findNodeInBasePath(base_path, element.children)
        if (childResult.length > 0) {
          result.push(...childResult)
        }
      }
    }
    return result
  },

  createFolder: (data: { path: string; name: string }) => {
    const state = get()
    return filesApi.create({
      path: `${data.path}/${data.name}`,
      type: 0,
      library_id: state.library_id,
      permissions: []
    })
  },

  rename: (id: string, path: string) => {
    return filesApi.rename({
      id,
      path
    }).then(() => {
      // 触发文件列表刷新
      set((state) => ({ fileRefreshKey: state.fileRefreshKey + 1 }))
      // 清除 Space 弹窗知识目录文件缓存
      const libraryId = get().library_id
      if (libraryId) {
        cache.delete(`files_all_${libraryId}_root`)
      }
    })
  },

  updateFolder: () => {
    // 实现时应清除相关缓存
  },

  deleteFile: (file: FileItem) => {
    return filesApi.delete(file.id).then((res) => {
      get().loadFilesAll()
      // 清除 Space 弹窗知识目录文件缓存
      const libraryId = get().library_id
      if (libraryId) {
        cache.delete(`files_all_${libraryId}_root`)
      }
    })
  },

  setExpandedKeys: (keys: string[]) => {
    set({ expandedKeys: keys })
  },

  setUploadQueue: (val: UploadItem[]) => {
    set({ uploadQueue: val })
  },

  setAssistantExpanded: (expanded: boolean) => {
    set({ assistantExpanded: expanded })
  },

  setAssistantCollapsed: (collapsed: boolean) => {
    set({ assistantCollapsed: collapsed })
  },

  setAssistantInstall: (install: boolean) => {
    set({ assistantInstall: install })
  },

  setAssistantVisible: (visible: boolean) => {
    set({ assistantVisible: visible })
  },

  setAssistantAgents: (chatAgent: any | null, mapAgent: any | null, customApps: any[]) => {
    set({ assistantChatAgent: chatAgent, assistantMapAgent: mapAgent, assistantCustomApps: customApps })
  },

  clearState: () => {
    get().stopPolling()
    set({
      library_id: '',
      space_id: '',
      library: null,
      space: null,
      siderVisible: true,
      sidebarCollapsed: false,
      fileViewType: 'preview',
      currentFileId: '',
      chunks: [],
      files: [],
      isRestore: false,
      expandedKeys: [],
      fileRefreshKey: 0,
      assistantVisible: false,
    })
  },
}))

export type { FileItem, SpaceItem, LibraryItem, KnowledgeChunk }
