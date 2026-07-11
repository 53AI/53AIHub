import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { message, Modal } from 'antd'
import { useSearchParams } from 'react-router-dom'
import { formatFile } from '@/api/modules/files/transform'
import { t } from '@/locales'
import { buildUrl } from '@/utils/router'
import favoritesApi from '@/api/modules/favorites'
import filesApi from '@/api/modules/files'
import { getFormatTimeStamp } from '@km/shared-utils'
import type { FileItem, BreadcrumbItem, FetchParams, PreviewFile } from '../types'

const DEFAULT_PAGE_SIZE = 30

export interface FileListConfig<T = any> {
  defaultPath: string
  tabKey: string
  fetchFiles: (params: FetchParams) => Promise<{ data: T[] }>
  fetchDirs: (params: FetchParams) => Promise<{ data: T[] }>
  mapItem: (item: T) => FileItem
  pageSize?: number
  timeLabel?: string
  emptyText?: string
  enableFavorite?: boolean
  formatFileName?: (item: FileItem, newName: string) => string
  onPreview?: (file: PreviewFile, content?: string) => void
  refreshKey?: number
  fileRefreshKey?: number
  dirRefreshKey?: number
  contextReady?: boolean
  onCacheNames?: (files: any[], folders: any[]) => void
}

export interface UseFileListReturn {
  fileList: FileItem[]
  dirList: FileItem[]
  displayFiles: FileItem[]
  loading: boolean
  loadingMore: boolean
  isEmpty: boolean
  hasMore: boolean
  breadcrumb: BreadcrumbItem[]
  currentPath: string
  loadFiles: (forceRefresh?: boolean, onlyFiles?: boolean, onlyDirs?: boolean) => Promise<void>
  loadMore: () => Promise<void>
  searchFiles: (keyword: string) => Promise<void>
  handleRowClick: (item: FileItem) => Promise<void>
  handleDelete: (item: FileItem) => void
  handleRename: (item: FileItem) => void
  handleToggleFavorite: (fileId: string, isFavorite: boolean) => Promise<void>
  handleBreadcrumbClick: (index: number) => void
  handleOpenNewTab: (item: FileItem) => void
  dragItemId: string | null
  dragOverFolderId: string | null
  handleDragStart: (item: FileItem) => (e: React.DragEvent) => void
  handleDragOver: (item: FileItem) => (e: React.DragEvent) => void
  handleDragLeave: () => void
  handleDrop: (targetFolder: FileItem) => (e: React.DragEvent) => Promise<void>
  handleDragEnd: () => void
  sentinelRef: React.RefObject<HTMLDivElement>
  renameModalVisible: boolean
  renameValue: string
  setRenameValue: (value: string) => void
  handleRenameConfirm: () => Promise<void>
  handleRenameCancel: () => void
  timeLabel: string
  emptyText: string
}

export function useFileList<T = any>(config: FileListConfig<T>): UseFileListReturn {
  const {
    defaultPath,
    tabKey,
    fetchFiles,
    fetchDirs,
    mapItem,
    pageSize = DEFAULT_PAGE_SIZE,
    timeLabel = '创建时间',
    emptyText = '暂无文档',
    enableFavorite = true,
    formatFileName,
    onPreview,
    refreshKey,
    fileRefreshKey,
    dirRefreshKey,
    contextReady = true,
    onCacheNames
  } = config

  const [searchParams, setSearchParams] = useSearchParams()
  const currentPath = searchParams.get('path') || defaultPath

  const [fileList, setFileList] = useState<FileItem[]>([])
  const [dirList, setDirList] = useState<FileItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([{ name: '全部文件', path: defaultPath }])

  const [fileOffset, setFileOffset] = useState(0)
  const [dirOffset, setDirOffset] = useState(0)
  const [hasMoreFiles, setHasMoreFiles] = useState(true)
  const [hasMoreDirs, setHasMoreDirs] = useState(true)

  const loadingRef = useRef(false)
  const loadingMoreRef = useRef(false)
  const requestIdRef = useRef(0)
  const hasLoadedRef = useRef(false)
  const initialLoadDoneRef = useRef(false)
  const prevKeywordRef = useRef<string>('')
  const prevRefreshKeyRef = useRef<number | undefined>(undefined)
  const prevFileRefreshKeyRef = useRef<number | undefined>(undefined)
  const prevDirRefreshKeyRef = useRef<number | undefined>(undefined)
  const prevPathRef = useRef<string>(currentPath)
  const effectExecutedRef = useRef(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const loadFilesRef = useRef<((forceRefresh?: boolean, onlyFiles?: boolean, onlyDirs?: boolean) => Promise<void>) | null>(null)

  const [renameModalVisible, setRenameModalVisible] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renamingFile, setRenamingFile] = useState<FileItem | null>(null)

  const [dragItemId, setDragItemId] = useState<string | null>(null)
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null)

  const displayFiles = useMemo(() => [...dirList, ...fileList], [fileList, dirList])
  const isEmpty = displayFiles.length === 0

  const loadFiles = useCallback(async (forceRefresh: boolean = false, onlyFiles: boolean = false, onlyDirs: boolean = false) => {
    if (!contextReady) return
    if (loadingRef.current) return
    if (!forceRefresh && hasLoadedRef.current) return

    loadingRef.current = true
    setLoading(true)
    const currentRequestId = ++requestIdRef.current

    try {
      let rawDirs: any[] = []
      let rawFiles: any[] = []

      // 只在需要时加载文件夹
      if (!onlyFiles) {
        try {
          const dirRes = await fetchDirs({
            path: currentPath,
            type: 'dir',
            keyword: undefined,
            offset: 0,
            limit: pageSize
          })
          if (currentRequestId !== requestIdRef.current) return
          rawDirs = (dirRes.data || []).filter((item: any) => item.path !== '/')
          setDirList(rawDirs.map(mapItem))
          setDirOffset(rawDirs.length)
          setHasMoreDirs((dirRes.data || []).length >= pageSize)
        } catch (error) {
          console.error('Failed to load folders:', error)
          setDirList([])
          setHasMoreDirs(false)
        }
      }

      // 只在需要时加载文件
      if (!onlyDirs) {
        try {
          const fileRes = await fetchFiles({
            path: currentPath,
            type: 'file',
            keyword: undefined,
            offset: 0,
            limit: pageSize
          })
          if (currentRequestId !== requestIdRef.current) return
          rawFiles = fileRes.data || []
          setFileList(rawFiles.map(mapItem))
          setFileOffset(rawFiles.length)
          setHasMoreFiles((fileRes.data || []).length >= pageSize)
        } catch (error) {
          console.error('Failed to load files:', error)
          setFileList([])
          setHasMoreFiles(false)
        }
      }

      // 缓存名称给父组件用于新建时去重（只在全量刷新时）
      if (!onlyFiles && !onlyDirs) {
        onCacheNames?.(rawFiles, rawDirs)
      }

      hasLoadedRef.current = true
      initialLoadDoneRef.current = true
    } catch (error) {
      console.error('Failed to load files:', error)
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setLoading(false)
        loadingRef.current = false
      }
    }
  }, [currentPath, fetchFiles, fetchDirs, mapItem, pageSize, contextReady, onCacheNames])

  // 更新 refs，供 useEffect 使用
  loadFilesRef.current = loadFiles

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return
    if (!hasMoreFiles && !hasMoreDirs) return

    loadingMoreRef.current = true
    setLoadingMore(true)

    try {
      if (hasMoreDirs) {
        const dirRes = await fetchDirs({
          path: currentPath,
          type: 'dir',
          keyword: undefined,
          offset: dirOffset,
          limit: pageSize
        })
        const filteredDirs = (dirRes.data || []).filter((item: any) => item.path !== '/')
        if (filteredDirs.length > 0) {
          setDirList(prev => [...prev, ...filteredDirs.map(mapItem)])
          setDirOffset(prev => prev + filteredDirs.length)
          setHasMoreDirs((dirRes.data || []).length >= pageSize)
        } else {
          setHasMoreDirs(false)
        }
      }

      if (hasMoreFiles) {
        const fileRes = await fetchFiles({
          path: currentPath,
          type: 'file',
          keyword: undefined,
          offset: fileOffset,
          limit: pageSize
        })
        if ((fileRes.data || []).length > 0) {
          setFileList(prev => [...prev, ...(fileRes.data || []).map(mapItem)])
          setFileOffset(prev => prev + (fileRes.data || []).length)
          setHasMoreFiles((fileRes.data || []).length >= pageSize)
        } else {
          setHasMoreFiles(false)
        }
      }
    } catch (error) {
      console.error('Failed to load more:', error)
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [currentPath, hasMoreFiles, hasMoreDirs, dirOffset, fileOffset, fetchFiles, fetchDirs, mapItem, pageSize])

  const searchFiles = useCallback(async (keyword: string) => {
    if (!keyword.trim()) {
      loadFiles(true)
      return
    }

    setFileOffset(0)
    setDirOffset(0)
    setHasMoreFiles(false)
    setHasMoreDirs(false)
    setLoading(true)

    try {
      const results = await Promise.allSettled([
        fetchFiles({ keyword, type: 'file' }),
        fetchDirs({ keyword, type: 'dir' })
      ])

      if (results[0].status === 'fulfilled') {
        setFileList((results[0].value.data || []).map(mapItem))
      } else {
        setFileList([])
      }

      if (results[1].status === 'fulfilled') {
        setDirList((results[1].value.data || []).filter((item: any) => item.path !== '/').map(mapItem))
      } else {
        setDirList([])
      }
    } catch (error) {
      console.error('Failed to search files:', error)
    } finally {
      setLoading(false)
    }
  }, [fetchFiles, fetchDirs, loadFiles, mapItem])

  // 监听 currentPath 和 contextReady 变化刷新列表
  useEffect(() => {
    if (!contextReady) return

    const isSamePath = prevPathRef.current === currentPath

    // 如果是相同的路径且 effect 已经执行过，跳过（防止 StrictMode double-invoke）
    if (isSamePath && effectExecutedRef.current) return

    // currentPath 变化时重置分页状态
    if (!isSamePath) {
      setFileOffset(0)
      setDirOffset(0)
      setHasMoreFiles(true)
      setHasMoreDirs(true)
      setFileList([])
      setDirList([])
      hasLoadedRef.current = false
      initialLoadDoneRef.current = false
    }

    prevPathRef.current = currentPath
    effectExecutedRef.current = true

    loadFilesRef.current(true)
  }, [currentPath, contextReady])

  // 监听 refreshKey 变化刷新列表
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey !== prevRefreshKeyRef.current) {
      prevRefreshKeyRef.current = refreshKey
      loadFilesRef.current(true)
    }
  }, [refreshKey])

  // 监听 fileRefreshKey 变化只刷新文件列表
  useEffect(() => {
    if (fileRefreshKey !== undefined && fileRefreshKey !== prevFileRefreshKeyRef.current) {
      prevFileRefreshKeyRef.current = fileRefreshKey
      loadFilesRef.current(true, true, false)
    }
  }, [fileRefreshKey])

  // 监听 dirRefreshKey 变化只刷新文件夹列表
  useEffect(() => {
    if (dirRefreshKey !== undefined && dirRefreshKey !== prevDirRefreshKeyRef.current) {
      prevDirRefreshKeyRef.current = dirRefreshKey
      loadFilesRef.current(true, false, true)
    }
  }, [dirRefreshKey])

  useEffect(() => {
    if (currentPath === defaultPath) {
      setBreadcrumb([{ name: '全部文件', path: defaultPath }])
    } else {
      const relativePath = currentPath.startsWith(defaultPath)
        ? currentPath.slice(defaultPath.length)
        : currentPath
      const parts = relativePath.split('/').filter(Boolean)
      const crumbs: BreadcrumbItem[] = [{ name: '全部文件', path: defaultPath }]
      let accumulated = defaultPath
      parts.forEach((part) => {
        accumulated += '/' + part
        crumbs.push({ name: part, path: accumulated })
      })
      setBreadcrumb(crumbs)
    }
  }, [currentPath, defaultPath])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingRef.current && !loadingMoreRef.current) {
          loadMore()
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMore])

  const handleRowClick = useCallback(async (item: FileItem) => {
    try {
      if (item.isfolder) {
        const folderPath = item.path?.startsWith('/') ? item.path : `${currentPath}/${item.path}`
        setSearchParams({ tab: tabKey, path: folderPath })
      } else {
        const fileData = await filesApi.get(item.id)
        const formattedFile = formatFile(fileData)
        if (onPreview) {
          onPreview({
            id: formattedFile.id,
            name: formattedFile.name,
            icon: formattedFile.icon,
            file_url: formattedFile.file_url,
            file_ext: formattedFile.file_ext,
            file_mime: formattedFile.file_mime,
            library_id: formattedFile.library_id,
            updated_time: getFormatTimeStamp(formattedFile.updated_time),
            isFavorite: item.isFavorite,
            isfolder: false,
            rawData: fileData,
          }, '')
        }
      }
    } catch (error) {
      console.error('Failed to load file details:', error)
    }
  }, [currentPath, tabKey, setSearchParams, onPreview])

  const handleDelete = useCallback((item: FileItem) => {
    Modal.confirm({
      title: t('common.tip'),
      content: item.isfolder ? '确定删除此文件夹？' : t('status.file_del'),
      okText: t('action.confirm'),
      cancelText: t('action.cancel'),
      onOk: async () => {
        try {
          await filesApi.delete(item.id)
          message.success('已删除')
          // 根据删除的是文件夹还是文件，只刷新对应的列表
          loadFiles(true, !item.isfolder, item.isfolder)
        } catch (error) {
          message.error('删除失败')
        }
      }
    })
  }, [loadFiles])

  const handleRename = useCallback((item: FileItem) => {
    const realExt = item?.file_ext === 'md' ? '' : '.' + (item?.file_ext || '')
    const currentName = item.isfolder ? item.name : item.name.replace(realExt || '.md', '')
    setRenamingFile(item)
    setRenameValue(currentName)
    setRenameModalVisible(true)
  }, [])

  const handleRenameConfirm = useCallback(async () => {
    if (!renamingFile || !renameValue.trim()) return

    let fullName: string
    if (formatFileName) {
      fullName = formatFileName(renamingFile, renameValue)
    } else {
      const fileExt = renamingFile.file_ext || ''
      const normalizedExt = fileExt.replace(/^\./, '')
      if (renamingFile.isfolder) {
        fullName = renameValue
      } else if (normalizedExt === 'md' || !normalizedExt) {
        fullName = `${renameValue}.md`
      } else {
        fullName = `${renameValue}.${normalizedExt}.md`
      }
    }

    const basePath = renamingFile.rawData.path?.startsWith('/')
      ? renamingFile.rawData.path.substring(1)
      : renamingFile.rawData.path || ''
    const parentDir = basePath.includes('/') ? basePath.substring(0, basePath.lastIndexOf('/')) : ''
    const newPath = parentDir ? `/${parentDir}/${fullName}` : `/${fullName}`

    try {
      await filesApi.rename({ id: renamingFile.id, path: newPath })
      message.success('已重命名')
      // 根据重命名的是文件夹还是文件，只刷新对应的列表
      loadFiles(true, !renamingFile.isfolder, renamingFile.isfolder)
      setRenameModalVisible(false)
      setRenamingFile(null)
    } catch (error) {
      message.error('重命名失败')
    }
  }, [renamingFile, renameValue, formatFileName, loadFiles])

  const handleRenameCancel = useCallback(() => {
    setRenameModalVisible(false)
    setRenamingFile(null)
  }, [])

  const handleToggleFavorite = useCallback(async (fileId: string, isFavorite: boolean) => {
    if (!enableFavorite) return

    try {
      await favoritesApi.toggle({
        resource_type: 2,
        resource_id: fileId
      })
      message.success(isFavorite ? '已取消' : '已收藏')
      setFileList(prev => prev.map(item =>
        item.id === fileId ? { ...item, isFavorite: !isFavorite } : item
      ))
      setDirList(prev => prev.map(item =>
        item.id === fileId ? { ...item, isFavorite: !isFavorite } : item
      ))
    } catch (error) {
      message.error('操作失败')
    }
  }, [enableFavorite])

  const handleBreadcrumbClick = useCallback((index: number) => {
    if (index === 0) {
      setSearchParams({ tab: tabKey })
    } else {
      const targetPath = breadcrumb[index].path
      setSearchParams({ tab: tabKey, path: targetPath })
    }
  }, [tabKey, breadcrumb, setSearchParams])

  const handleOpenNewTab = useCallback((item: FileItem) => {
    const url = item.isfolder
      ? buildUrl(`/mine?tab=${tabKey}&path=${encodeURIComponent(item.rawData.path)}`)
      : buildUrl(`/mine?tab=${tabKey}&preview=${item.id}`)
    window.open(url, '_blank')
  }, [tabKey])

  const handleDragStart = useCallback((item: FileItem) => (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', item.id)
    e.dataTransfer.effectAllowed = 'move'
    setDragItemId(item.id)
  }, [])

  const handleDragOver = useCallback((item: FileItem) => (e: React.DragEvent) => {
    e.preventDefault()
    if (item.isfolder) {
      setDragOverFolderId(item.id)
      e.dataTransfer.dropEffect = 'move'
    }
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOverFolderId(null)
  }, [])

  const handleDrop = useCallback((targetFolder: FileItem) => async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOverFolderId(null)

    if (!targetFolder.isfolder) return

    const dragFileId = e.dataTransfer.getData('text/plain')
    if (!dragFileId || dragFileId === targetFolder.id) return

    const dragFile = [...fileList, ...dirList].find(f => f.id === dragFileId)
    if (!dragFile) return

    try {
      const ext = dragFile.file_ext ? `.${dragFile.file_ext}` : ''
      const fileName = dragFile.isfolder ? dragFile.name : `${dragFile.name}${ext}`
      const targetFolderPath = targetFolder.rawData.path?.startsWith('/') ? targetFolder.rawData.path : `${currentPath}/${targetFolder.rawData.path}`
      const newPath = `${targetFolderPath}/${fileName}`

      await filesApi.rename({
        id: dragFileId,
        path: newPath
      })

      // 根据移动的是文件夹还是文件，只刷新对应的列表
      loadFiles(true, !dragFile.isfolder, dragFile.isfolder)
      message.success('已移动')
    } catch (error) {
      console.error('移动文件失败:', error)
      message.error('移动失败')
    } finally {
      setDragItemId(null)
    }
  }, [fileList, dirList, currentPath, loadFiles])

  const handleDragEnd = useCallback(() => {
    setDragItemId(null)
    setDragOverFolderId(null)
  }, [])

  return {
    fileList,
    dirList,
    displayFiles,
    loading,
    loadingMore,
    isEmpty,
    hasMore: hasMoreFiles || hasMoreDirs,
    breadcrumb,
    currentPath,
    loadFiles,
    loadMore,
    searchFiles,
    handleRowClick,
    handleDelete,
    handleRename,
    handleToggleFavorite,
    handleBreadcrumbClick,
    handleOpenNewTab,
    dragItemId,
    dragOverFolderId,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
    sentinelRef,
    renameModalVisible,
    renameValue,
    setRenameValue,
    handleRenameConfirm,
    handleRenameCancel,
    timeLabel,
    emptyText
  }
}
