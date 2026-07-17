import { useState, useEffect, useCallback } from 'react'
import mySpaceApi from '@/api/modules/my-space'
import { formatFile } from '@/api/modules/files/transform'
import { getFormatTimeStamp } from '@km/shared-utils'
import type { BreadcrumbItem as BaseBreadcrumbItem } from './types'

export interface BreadcrumbItem extends BaseBreadcrumbItem {}

export interface FolderItem {
  id: string
  name: string
  icon: string
  createdTime: string
  updatedTime: string
  isFavorite: boolean
  isfolder: boolean
  file_ext?: string
  file_url?: string
  rawData: any
}

interface UseFolderNavigationReturn {
  currentPath: string
  breadcrumb: BreadcrumbItem[]
  dirList: FolderItem[]
  fileList: FolderItem[]
  dirLoading: boolean
  fileLoading: boolean
  dirError: boolean
  fileError: boolean
  enterFolder: (path: string) => void
  goToPath: (path: string) => void
  goBack: () => void
  refreshDirs: () => void
  refreshFiles: () => void
}

export function useFolderNavigation(rootLabel: string = '全部'): UseFolderNavigationReturn {
  const [currentPath, setCurrentPath] = useState('/')
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([{ name: rootLabel, path: '/' }])
  const [dirList, setDirList] = useState<FolderItem[]>([])
  const [fileList, setFileList] = useState<FolderItem[]>([])
  const [dirLoading, setDirLoading] = useState(false)
  const [fileLoading, setFileLoading] = useState(false)
  const [dirError, setDirError] = useState(false)
  const [fileError, setFileError] = useState(false)

  const mapItem = useCallback((item: any): FolderItem => {
    const formattedFile = formatFile(item)
    return {
      ...formattedFile,
      id: formattedFile.id,
      name: formattedFile.name,
      icon: formattedFile.icon,
      createdTime: getFormatTimeStamp(item.created_time),
      updatedTime: getFormatTimeStamp(item.updated_time),
      isFavorite: item.is_favorite ?? formattedFile.is_favorite,
      rawData: item
    }
  }, [])

  const loadDirs = useCallback(async (path: string) => {
    setDirLoading(true)
    setDirError(false)
    try {
      const res = await mySpaceApi.getUploads({ type: 'dir', path })
      const dirs = res.data.filter((item: any) => item.path !== '/').map(mapItem)
      setDirList(dirs)
    } catch (error) {
      console.error('Failed to load folders:', error)
      setDirList([])
      setDirError(true)
    } finally {
      setDirLoading(false)
    }
  }, [mapItem])

  const loadFiles = useCallback(async (path: string) => {
    setFileLoading(true)
    setFileError(false)
    try {
      const res = await mySpaceApi.getUploads({ type: 'file', path })
      const files = res.data.map(mapItem)
      setFileList(files)
    } catch (error) {
      console.error('Failed to load files:', error)
      setFileList([])
      setFileError(true)
    } finally {
      setFileLoading(false)
    }
  }, [mapItem])

  // 路径变化时加载内容
  useEffect(() => {
    if (currentPath !== '/') {
      loadDirs(currentPath)
      loadFiles(currentPath)
    }
  }, [currentPath, loadDirs, loadFiles])

  // 面包屑同步
  useEffect(() => {
    if (currentPath === '/') {
      setBreadcrumb([{ name: rootLabel, path: '/' }])
    } else {
      const parts = currentPath.split('/').filter(Boolean)
      const crumbs: BreadcrumbItem[] = [{ name: rootLabel, path: '/' }]
      let accumulated = ''
      parts.forEach((part) => {
        accumulated += '/' + part
        crumbs.push({ name: part, path: accumulated })
      })
      setBreadcrumb(crumbs)
    }
  }, [currentPath, rootLabel])

  const enterFolder = useCallback((path: string) => {
    const normalizedPath = path?.startsWith('/') ? path : `/${path}`
    setCurrentPath(normalizedPath)
  }, [])

  const goToPath = useCallback((path: string) => {
    setCurrentPath(path)
  }, [])

  const goBack = useCallback(() => {
    if (currentPath === '/') return
    const parts = currentPath.split('/').filter(Boolean)
    parts.pop()
    const parentPath = parts.length === 0 ? '/' : '/' + parts.join('/')
    setCurrentPath(parentPath)
  }, [currentPath])

  const refreshDirs = useCallback(() => {
    if (currentPath !== '/') {
      loadDirs(currentPath)
    }
  }, [currentPath, loadDirs])

  const refreshFiles = useCallback(() => {
    if (currentPath !== '/') {
      loadFiles(currentPath)
    }
  }, [currentPath, loadFiles])

  return {
    currentPath,
    breadcrumb,
    dirList,
    fileList,
    dirLoading,
    fileLoading,
    dirError,
    fileError,
    enterFolder,
    goToPath,
    goBack,
    refreshDirs,
    refreshFiles
  }
}
