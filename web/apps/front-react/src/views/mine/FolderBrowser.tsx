import { Spin, Button } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import { MoreDropdown } from '@/components/MoreDropdown'
import { t } from '@/locales'
import { buildUrl } from '@/utils/router'
import filesApi from '@/api/modules/files'
import favoritesApi from '@/api/modules/favorites'
import { formatFile } from '@/api/modules/files/transform'
import { getFormatTimeStamp } from '@km/shared-utils'
import { message } from 'antd'
import { BreadcrumbNav } from './components/BreadcrumbNav'
import type { FolderItem, BreadcrumbItem } from './useFolderNavigation'

interface FolderBrowserProps {
  breadcrumb: BreadcrumbItem[]
  dirList: FolderItem[]
  fileList: FolderItem[]
  dirLoading: boolean
  fileLoading: boolean
  dirError: boolean
  fileError: boolean
  onBreadcrumbClick: (index: number) => void
  onPreview?: (file: any, content?: string) => void
  onEnterFolder: (path: string) => void
  onRefreshDirs: () => void
  onRefreshFiles: () => void
}

export function FolderBrowser({
  breadcrumb,
  dirList,
  fileList,
  dirLoading,
  fileLoading,
  dirError,
  fileError,
  onBreadcrumbClick,
  onPreview,
  onEnterFolder,
  onRefreshDirs,
  onRefreshFiles
}: FolderBrowserProps) {
  const handleOpenNewTab = (url: string) => {
    window.open(url, '_blank')
  }

  const handleRowClick = async (item: FolderItem) => {
    try {
      const fileData = await filesApi.get(item.id)
      const formattedFile = formatFile(fileData)
      if (formattedFile.isfolder) {
        const folderPath = formattedFile.path?.startsWith('/') ? formattedFile.path : `/${formattedFile.path}`
        onEnterFolder(folderPath)
      } else if (onPreview) {
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
    } catch (error) {
      console.error('Failed to load file details:', error)
    }
  }

  const handleToggleFavorite = async (fileId: string, isFavorite: boolean) => {
    try {
      await favoritesApi.toggle({
        resource_type: 2,
        resource_id: fileId
      })
      message.success(isFavorite ? '已取消' : '已收藏')
      onRefreshFiles()
    } catch (error) {
      message.error('操作失败')
    }
  }

  const allItems = [...dirList, ...fileList]

  return (
    <div>
      {/* Breadcrumb Navigation */}
      <BreadcrumbNav items={breadcrumb} onItemClick={onBreadcrumbClick} />

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 mt-4">
        <div className="h-12 flex items-center gap-2 px-4 border-b border-gray-100">
          <div className="flex-1 min-w-0 text-sm text-[#4F5052] font-medium">名称</div>
          <div className="w-[140px] flex-shrink-0 text-sm text-[#4F5052] font-medium text-right">更新时间</div>
          <div className="w-[48px] flex-shrink-0"></div>
        </div>

        {/* 加载中 - 文件夹 */}
        {dirLoading && (
          <div className="flex justify-center py-4">
            <Spin size="small" />
          </div>
        )}

        {/* 加载中 - 文件 */}
        {!dirLoading && fileLoading && dirList.length === 0 && (
          <div className="flex justify-center py-4">
            <Spin size="small" />
          </div>
        )}

        {/* 文件夹错误 */}
        {dirError && !dirLoading && (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-[#9A9A9A]">
            文件夹加载失败
            <Button type="link" size="small" onClick={onRefreshDirs}>重试</Button>
          </div>
        )}

        {/* 文件错误 */}
        {fileError && !fileLoading && (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-[#9A9A9A]">
            文件加载失败
            <Button type="link" size="small" onClick={onRefreshFiles}>重试</Button>
          </div>
        )}

        {/* 正常列表 */}
        {!dirLoading && !fileLoading && allItems.map((item, index) => (
          <div
            key={`folder-${item.id}-${index}`}
            className="resource-item-row h-12 flex items-center gap-2 px-4"
            onClick={() => handleRowClick(item)}
          >
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <img className="flex-none w-6 h-6" src={item.icon} alt="" />
              <span className="text-sm text-primary truncate">{item.name}</span>
              {item.isFavorite && (
                <SvgIcon name="star-filled" color="#FFB300" className="text-[#FFB300] flex-shrink-0" size="14" />
              )}
            </div>
            <div className="w-[140px] flex-shrink-0 text-sm text-placeholder text-right">{item.updatedTime}</div>
            <div className="w-[48px] flex-shrink-0 flex justify-end more-actions">
              <MoreDropdown
                size="28px"
                icon="more-h"
                iconSize={16}
                backgroundColor="#F5F6F7"
                items={[
                  { key: 'new-tab', icon: 'arrow-right-up', label: t('common.new_tab_page') + t('action.open') },
                  { key: 'divider', divided: true },
                  { key: 'favorite', icon: item.isFavorite ? 'star-cancel' : 'star', label: item.isFavorite ? '取消收藏' : '收藏' },
                ]}
                onCommand={(cmd) => {
                  if (cmd === 'new-tab') handleOpenNewTab(buildUrl(`/mine?preview=${item.id}`))
                  else if (cmd === 'favorite') handleToggleFavorite(item.id, item.isFavorite)
                }}
              />
            </div>
          </div>
        ))}

        {/* 加载更多文件时底部 loading */}
        {!dirLoading && !fileLoading && allItems.length > 0 && fileLoading && (
          <div className="flex justify-center py-4">
            <Spin size="small" />
          </div>
        )}
      </div>
    </div>
  )
}
