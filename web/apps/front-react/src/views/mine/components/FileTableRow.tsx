import { SvgIcon } from '@km/shared-components-react'
import { MoreDropdown } from '@/components/MoreDropdown'
import { t } from '@/locales'
import type { FileItem } from '../types'

export interface FileTableRowProps {
  item: FileItem
  onClick?: () => void
  onToggleFavorite?: (id: string, isFavorite: boolean) => void
  onRename?: (item: FileItem) => void
  onDelete?: (item: FileItem) => void
  onOpenNewTab?: (item: FileItem) => void
  enableFavorite?: boolean
  isDragging?: boolean
  isDragOver?: boolean
  dragProps?: {
    draggable?: boolean
    onDragStart?: (e: React.DragEvent) => void
    onDragOver?: (e: React.DragEvent) => void
    onDragLeave?: () => void
    onDrop?: (e: React.DragEvent) => void
    onDragEnd?: () => void
  }
}

/**
 * 文件行组件
 */
export function FileTableRow({
  item,
  onClick,
  onToggleFavorite,
  onRename,
  onDelete,
  onOpenNewTab,
  enableFavorite = true,
  isDragging = false,
  isDragOver = false,
  dragProps,
}: FileTableRowProps) {
  const rowClassName = `resource-item-row h-12 flex items-center gap-2 px-4 ${
    isDragOver ? 'bg-[#E8F3FF]' : ''
  } ${isDragging ? 'opacity-50' : ''}`

  const menuItems = [
    {
      key: 'new-tab',
      icon: 'arrow-right-up',
      label: t('common.new_tab_page') + t('action.open'),
    },
    ...(enableFavorite && !item.isfolder
      ? [
          { key: 'divider', divided: true },
          {
            key: 'favorite',
            icon: item.isFavorite ? 'star-cancel' : 'star',
            label: item.isFavorite ? '取消收藏' : '收藏',
          },
        ]
      : []),
    { key: 'divider-2', divided: true },
    { key: 'rename', icon: 'edit', label: '重命名' },
    { key: 'divider-3', divided: true },
    { key: 'delete', icon: 'delete', label: '删除', danger: true },
  ]

  const handleCommand = (cmd: string) => {
    switch (cmd) {
      case 'new-tab':
        onOpenNewTab?.(item)
        break
      case 'favorite':
        onToggleFavorite?.(item.id, item.isFavorite)
        break
      case 'rename':
        onRename?.(item)
        break
      case 'delete':
        onDelete?.(item)
        break
    }
  }

  return (
    <div
      className={rowClassName}
      onClick={onClick}
      {...dragProps}
    >
      {/* Name Column */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <img className="flex-none w-6 h-6" src={item.icon} alt="" />
        <span className="text-sm text-primary truncate">{item.name}</span>
        {item.isFavorite && (
          <SvgIcon
            name="star-filled"
            color="#FFB300"
            className="text-[#FFB300] flex-shrink-0"
            size="14"
          />
        )}
      </div>

      {/* Time Column */}
      <div className="w-[140px] flex-shrink-0 text-sm text-placeholder text-right">
        {item.createdTime}
      </div>

      {/* Actions Column */}
      <div className="w-[48px] flex-shrink-0 flex justify-end more-actions">
        <MoreDropdown
          size="28px"
          icon="more-h"
          iconSize={16}
          backgroundColor="#F5F6F7"
          items={menuItems}
          onCommand={handleCommand}
        />
      </div>
    </div>
  )
}

export default FileTableRow