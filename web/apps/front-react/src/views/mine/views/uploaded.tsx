import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Empty, message, Spin } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import { getPublicPath } from '@/utils/config'
import { t } from '@/locales'
import { MoreDropdown } from '@/components/MoreDropdown'
import mySpaceApi from '@/api/modules/my-space'
import filesApi from '@/api/modules/files'
import { formatFile } from '@/api/modules/files/transform'
import { getFormatTimeStamp } from '@km/shared-utils'
import { useFileList } from '../hooks/useFileList'
import { BreadcrumbNav } from '../components/BreadcrumbNav'
import { RenameModal } from '../components/RenameModal'
import { MoveToModal } from '../components/MoveToModal'
import { buildNewPath } from '../utils/buildNewPath'
import type { PreviewFile, FileItem } from '../types'
import '../mine.css'

interface UploadedViewProps {
  keyword?: string
  onPreview?: (file: PreviewFile, content?: string) => void
  refreshKey?: number
  fileRefreshKey?: number
  dirRefreshKey?: number
  contextReady?: boolean
  onCacheNames?: (files: any[], folders: any[]) => void
  libraryId?: string
  enableFavorite?: boolean
}

const PAGE_SIZE = 30

export default function UploadedView({
  keyword = '',
  onPreview,
  refreshKey = 0,
  fileRefreshKey,
  dirRefreshKey,
  contextReady = true,
  onCacheNames,
  libraryId = '',
  enableFavorite = true
}: UploadedViewProps) {
  const mapItem = (item: any): FileItem => {
    const formattedFile = formatFile(item)
    const isFolder = item.type === 0
    return {
      ...formattedFile,
      id: formattedFile.id,
      name: formattedFile.name,
      icon: isFolder ? getPublicPath('/images/file/folder.png') : formattedFile.icon,
      path: item.path || '',
      isfolder: isFolder,
      createdTime: getFormatTimeStamp(item.created_time),
      updatedTime: getFormatTimeStamp(item.updated_time),
      isFavorite: item.is_favorite ?? formattedFile.is_favorite,
      rawData: item
    }
  }

  // 格式化文件名（只返回文件名，不含路径）
  const formatFileName = (item: FileItem, newName: string): string => {
    let fileExt = item.rawData.upload_file?.extension || item.rawData.file_ext || ''
    fileExt = fileExt.replace(/^\./, '')

    if (item.isfolder) {
      return newName
    } else if (fileExt === 'md' || !fileExt) {
      return `${newName}.md`
    } else {
      return `${newName}.${fileExt}.md`
    }
  }

  const {
    displayFiles,
    loading,
    loadingMore,
    isEmpty,
    hasMore,
    breadcrumb,
    currentPath,
    searchFiles,
    loadFiles,
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
  } = useFileList({
    defaultPath: '/',
    tabKey: 'upload',
    fetchFiles: (params) => mySpaceApi.getUploads({ ...params, type: 'file' }),
    fetchDirs: (params) => mySpaceApi.getUploads({ ...params, type: 'dir' }),
    mapItem,
    pageSize: PAGE_SIZE,
    timeLabel: t("mine.upload_time"),
    emptyText: t("mine.upload_empty"),
    enableFavorite,
    formatFileName,
    onPreview,
    refreshKey,
    fileRefreshKey,
    dirRefreshKey,
    contextReady,
    onCacheNames
  })

  // 「移动到」弹窗状态
  const [moveToModalVisible, setMoveToModalVisible] = useState(false)
  const [moveToSourceItem, setMoveToSourceItem] = useState<FileItem | null>(null)

  // 「移动到」弹窗适配：透传 path/keyword/type 到 mySpaceApi.getUploads
  // type 由 hook 根据场景传入（'dir' 加载子目录、'file' 加载同级文件）
  // 注：根目录自身（path === '/'）的过滤由 MoveToModal 内部完成，
  // 见 components/MoveToModal.tsx 中 filteredFetchDirs 的实现，
  // 这样任何 MoveToModal 调用方都自带防御，不会因忘记过滤导致 RangeError。
  const moveToFetchDirs = useMemo(
    () => async (params: { path?: string; keyword?: string; type?: 'dir' | 'file' }) => {
      const res = await mySpaceApi.getUploads({
        type: params.type || 'dir',
        path: params.path,
        keyword: params.keyword,
      })
      return { data: res.data || [] }
    },
    [],
  )

  // 提交移动：调 filesApi.rename 改 path 实现移动
  const handleMoveToConfirm = useCallback(async (targetPath: string) => {
    if (!moveToSourceItem) return
    try {
      const newPath = buildNewPath(
        { name: moveToSourceItem.name, isfolder: moveToSourceItem.isfolder, file_ext: moveToSourceItem.file_ext },
        targetPath
      )
      await filesApi.rename({ id: moveToSourceItem.id, path: newPath })
      message.success(t('mine.moved'))
      // 根据移动的是文件夹还是文件，只刷新对应的列表
      loadFiles(true, !moveToSourceItem.isfolder, moveToSourceItem.isfolder)
      setMoveToModalVisible(false)
      setMoveToSourceItem(null)
    } catch (error) {
      message.error(t('mine.move_failed'))
    }
  }, [moveToSourceItem, loadFiles])

  // 搜索处理 - 只依赖 keyword，避免 searchFiles 变化导致重复请求
  const searchFilesRef = useRef(searchFiles)
  searchFilesRef.current = searchFiles
  const prevKeywordRef = useRef(keyword)

  useEffect(() => {
    if (keyword) {
      searchFilesRef.current(keyword)
    } else if (prevKeywordRef.current && !keyword) {
      // keyword 从有值变为空值，重新加载列表
      searchFilesRef.current('')
    }
    prevKeywordRef.current = keyword
  }, [keyword])

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div className="flex-1">
      {/* Breadcrumb Navigation */}
      <BreadcrumbNav items={breadcrumb} onItemClick={handleBreadcrumbClick} />

      {!isEmpty && (
        <div className="bg-white rounded-lg border border-gray-200 mt-4 flex-1">
          <div className="h-12 flex items-center gap-2 px-4 border-b border-gray-100">
            <div className="flex-1 min-w-0 text-sm text-[#4F5052] font-medium">{t("name")}</div>
            <div className="w-[140px] flex-shrink-0 text-sm text-[#4F5052] font-medium text-right">{timeLabel}</div>
            <div className="w-[48px] flex-shrink-0"></div>
          </div>

          <div className="flex flex-col">
            {displayFiles.map((item, index) => (
              <div
                key={`upload-${item.id}-${index}`}
                className={`resource-item-row h-12 flex items-center gap-2 px-4 ${
                  dragOverFolderId === item.id ? 'bg-[#E8F3FF]' : ''
                } ${dragItemId === item.id ? 'opacity-50' : ''}`}
                onClick={() => handleRowClick(item)}
                draggable
                onDragStart={handleDragStart(item)}
                onDragOver={handleDragOver(item)}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop(item)}
                onDragEnd={handleDragEnd}
              >
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <img className="flex-none w-6 h-6" src={item.icon} alt="" />
                  <span className="text-sm text-primary truncate">{item.name}</span>
                  {enableFavorite && item.isFavorite && (
                    <SvgIcon name="star-filled" color="#FFB300" className="text-[#FFB300] flex-shrink-0" size="14" />
                  )}
                </div>

                <div className="w-[140px] flex-shrink-0 text-sm text-placeholder text-right">{item.createdTime}</div>

                <div className="w-[48px] flex-shrink-0 flex justify-end more-actions">
                  <MoreDropdown
                    size="28px"
                    icon="more-h"
                    iconSize={16}
                    backgroundColor="#F5F6F7"
                    items={[
                      {
                        key: 'new-tab',
                        icon: 'arrow-right-up',
                        label: t('common.new_tab_page') + t('action.open'),
                      },
                      ...(enableFavorite && !item.isfolder ? [
                        { key: 'divider', divided: true },
                        {
                          key: 'favorite',
                          icon: item.isFavorite ? 'star-cancel' : 'star',
                          label: item.isFavorite ? t('action.unfavorite') : t('action.favorite'),
                        },
                      ] : []),
                      { key: 'rename', icon: 'edit', label: t('action.rename') },
                      { key: 'move-to', icon: 'move', label: t('action.move_to') },
                      { key: 'divider-3', divided: true },
                      { key: 'delete', icon: 'delete', label: t('action.delete'), danger: true },
                    ]}
                    onCommand={(cmd) => {
                      if (cmd === 'new-tab') handleOpenNewTab(item)
                      else if (cmd === 'favorite') handleToggleFavorite(item.id, item.isFavorite)
                      else if (cmd === 'move-to') {
                        setMoveToSourceItem(item)
                        setMoveToModalVisible(true)
                      }
                      else if (cmd === 'rename') handleRename(item)
                      else if (cmd === 'delete') handleDelete(item)
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          {hasMore && !loading && (
            <div className="flex justify-center py-4" ref={sentinelRef}>
              {loadingMore && <Spin size="small" />}
            </div>
          )}
        </div>
      )}

      {isEmpty && (
        <div className="mt-[200px]">
          <Empty
            styles={{ image: { height: 100 } }}
            image={getPublicPath('/images/empty.png')}
            description={emptyText}
          />
        </div>
      )}

      <RenameModal
        open={renameModalVisible}
        value={renameValue}
        onChange={setRenameValue}
        onConfirm={handleRenameConfirm}
        onCancel={handleRenameCancel}
      />

      <MoveToModal
        open={moveToModalVisible}
        sourceItem={moveToSourceItem ? {
          id: moveToSourceItem.id,
          name: moveToSourceItem.name,
          path: (moveToSourceItem.rawData as any)?.path || moveToSourceItem.path,
          isfolder: moveToSourceItem.isfolder,
          file_ext: moveToSourceItem.file_ext,
          icon: moveToSourceItem.icon,
        } : null}
        title={t("mine.uploaded")}
        fetchDirs={moveToFetchDirs}
        onConfirm={handleMoveToConfirm}
        onCancel={() => {
          setMoveToModalVisible(false)
          setMoveToSourceItem(null)
        }}
      />
    </div>
  )
}
