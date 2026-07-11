import { create } from 'zustand'
import librariesApi from '@/api/modules/libraries'

interface SpaceItem {
  id: string
  name: string
  icon: string
  library_count: number
  [key: string]: any
}

interface FileItem {
  id: string | number
  name: string
  file_mime: string
  file_icon?: string
  library_id: string | number
  updated_at: string
  is_favorite?: boolean
  [key: string]: any
}

interface ChunkItem {
  id: string | number
  content: string
  [key: string]: any
}

interface SpaceState {
  spaceId: string
  spaceList: SpaceItem[]
  hasLibrary: boolean
  currentSpace: SpaceItem | undefined

  // File state
  currentFile: FileItem | null
  chunks: ChunkItem[]
  fileViewType: 'preview' | 'chunk'

  setSpaceId: (id: string) => void
  loadSpaceList: () => Promise<SpaceItem[]>

  // File methods
  setCurrentFileId: (fileId: string) => Promise<void>
  setCurrentFile: (file: FileItem | null) => void
  setFileViewType: (type: 'preview' | 'chunk') => void
  clearChunks: () => void
  loadFile: (fileId: string, force?: boolean) => Promise<FileItem | null>
}

export const useSpaceStore = create<SpaceState>((set, get) => ({
  spaceId: '',
  spaceList: [],
  hasLibrary: false,
  currentSpace: undefined,
  currentFile: null,
  chunks: [],
  fileViewType: 'preview',

  setSpaceId: (id) => {
    const spaceList = get().spaceList
    const currentSpace = spaceList.find((item) => item.id === id)
    set({ spaceId: id, currentSpace })
  },

  loadSpaceList: async () => {
    let data: { spaces: SpaceItem[]; total: number } = { spaces: [], total: 0 }
    try {
      const spacesApi = (await import('@/api/modules/spaces')).default
      data = await spacesApi.list({
        status: 0,
        limit: 100,
        offset: 0,
        view: 'user'
      })
    } catch (error) {
      console.error('Failed to load space list:', error)
    }

    const spaceList = data.spaces || []
    const hasLibrary = spaceList.some((item) => item.library_count > 0)

    set({ spaceList, hasLibrary })
    return spaceList
  },

  setCurrentFileId: async (fileId: string) => {
    try {
      // This would typically call an API to get file details
      // For now, we'll set a placeholder
      set({
        currentFile: {
          id: fileId,
          name: '加载中...',
          file_mime: '',
          library_id: '',
          updated_at: '',
        }
      })
    } catch (error) {
      console.error('Failed to load file:', error)
      set({ currentFile: null })
    }
  },

  setCurrentFile: (file) => {
    set({ currentFile: file })
  },

  setFileViewType: (type) => {
    set({ fileViewType: type })
  },

  clearChunks: () => {
    set({ chunks: [] })
  },

  loadFile: async (fileId: string, force = false) => {
    try {
      const filesApi = (await import('@/api/modules/files')).filesApi
      const file = await filesApi.get(fileId)
      set({ currentFile: file as FileItem })
      return file as FileItem
    } catch (error) {
      console.error('Failed to load file:', error)
      return null
    }
  },
}))
