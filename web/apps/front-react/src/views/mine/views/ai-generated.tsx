import React, { useEffect, useRef } from 'react'
import { Empty, Spin, Modal, Input, Breadcrumb } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import { MoreDropdown } from '@/components/MoreDropdown'
import { getPublicPath } from '@/utils/config'
import { t } from '@/locales'
import mySpaceApi from '@/api/modules/my-space'
import { formatFile } from '@/api/modules/files/transform'
import { getFormatTimeStamp } from '@km/shared-utils'
import { useFileList } from '../hooks/useFileList'
import type { PreviewFile, FileItem } from '../types'
import '../mine.css'

interface AIGeneratedViewProps {
  keyword?: string
  onPreview?: (file: PreviewFile, content?: string) => void
  refreshKey?: number
  fileRefreshKey?: number
  dirRefreshKey?: number
  contextReady?: boolean
  enableFavorite?: boolean
}

const PAGE_SIZE = 30
const DEFAULT_PATH = '/ai-generated'

export default function AIGeneratedView({
  keyword = '',
  onPreview,
  refreshKey = 0,
  fileRefreshKey,
  dirRefreshKey,
  contextReady = true,
  enableFavorite = true
}: AIGeneratedViewProps) {
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
      createdTime: item.created_time ? getFormatTimeStamp(item.created_time) : '',
      updatedTime: item.updated_time ? getFormatTimeStamp(item.updated_time) : '',
      isFavorite: item.is_favorite ?? formattedFile.is_favorite,
      rawData: item
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
    defaultPath: DEFAULT_PATH,
    tabKey: 'ai',
    fetchFiles: (params) => mySpaceApi.getAIGenerated({ ...params, type: 'file' }),
    fetchDirs: (params) => mySpaceApi.getAIGenerated({ ...params, type: 'dir' }),
    mapItem,
    pageSize: PAGE_SIZE,
    timeLabel: t("common.create_time"),
    emptyText: t("mine.ai_empty"),
    enableFavorite,
    onPreview,
    refreshKey,
    fileRefreshKey,
    dirRefreshKey,
    contextReady
  })

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
      {breadcrumb.length > 1 && (
        <div className="mt-4 flex items-center">
          <Breadcrumb
            separator={<SvgIcon name="arrow-right" classname="pt-1" size={14} />}
            items={breadcrumb.map((item, index) => ({
              title: (
                <span
                  className={`cursor-pointer ${index === breadcrumb.length - 1 ? 'text-[#1D1E1F]' : 'hover:text-[#2563EB]'}`}
                  onClick={() => index < breadcrumb.length - 1 && handleBreadcrumbClick(index)}
                >
                  {item.name}
                </span>
              ),
            }))}
          />
        </div>
      )}

      {!isEmpty && (
        <div className="bg-white rounded-lg border border-gray-200 mt-4">
          <div className="h-12 flex items-center gap-2 px-4 border-b border-gray-100">
            <div className="flex-1 min-w-0 text-sm text-[#4F5052] font-medium">{t("name")}</div>
            <div className="w-[140px] flex-shrink-0 text-sm text-[#4F5052] font-medium text-right">{timeLabel}</div>
            <div className="w-[48px] flex-shrink-0"></div>
          </div>

          <div className="flex flex-col">
            {displayFiles.map((item, index) => (
              <div
                key={`ai-file-${item.id}-${index}`}
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
                      { key: 'divider-2', divided: true },
                      { key: 'rename', icon: 'edit', label: t('action.rename') },
                      { key: 'divider-3', divided: true },
                      { key: 'delete', icon: 'delete', label: t('action.delete'), danger: true },
                    ]}
                    onCommand={(cmd) => {
                      if (cmd === 'new-tab') handleOpenNewTab(item)
                      else if (cmd === 'favorite') handleToggleFavorite(item.id, item.isFavorite)
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

      <Modal
        open={renameModalVisible}
        title={t('action.rename')}
        onOk={handleRenameConfirm}
        onCancel={handleRenameCancel}
        okText={t('action.confirm')}
        cancelText={t('action.cancel')}
      >
        <div className="py-4">
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder={t('common.file_name')}
            onPressEnter={handleRenameConfirm}
          />
        </div>
      </Modal>
    </div>
  )
}
