import { Spin } from 'antd'
import { t } from '@/locales'
import type { FileItem } from '../types'
import { FileTableRow, type FileTableRowProps } from './FileTableRow'

export interface FileTableProps<T extends FileItem = FileItem> {
  items: T[]
  loading?: boolean
  loadingMore?: boolean
  hasMore?: boolean
  timeLabel?: string
  onLoadMore?: () => void
  onRowClick?: (item: T) => void
  rowProps?: (item: T) => Partial<FileTableRowProps>
  sentinelRef?: React.RefObject<HTMLDivElement | null>
}

/**
 * 通用文件表格组件
 */
export function FileTable<T extends FileItem = FileItem>({
  items,
  loading,
  loadingMore,
  hasMore,
  timeLabel = t('common.create_time'),
  onRowClick,
  rowProps,
  sentinelRef,
}: FileTableProps<T>) {
  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Spin size="large" />
      </div>
    )
  }

  if (items.length === 0) {
    return null
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 mt-4 flex-1">
      {/* Table Header */}
      <div className="h-12 flex items-center gap-2 px-4 border-b border-gray-100">
        <div className="flex-1 min-w-0 text-sm text-[#4F5052] font-medium">
          {t("name")}
        </div>
        <div className="w-[140px] flex-shrink-0 text-sm text-[#4F5052] font-medium text-right">
          {timeLabel}
        </div>
        <div className="w-[48px] flex-shrink-0"></div>
      </div>

      {/* Table Content */}
      <div className="flex flex-col">
        {items.map((item, index) => (
          <FileTableRow
            key={`${item.id}-${index}`}
            item={item}
            onClick={() => onRowClick?.(item)}
            {...rowProps?.(item)}
          />
        ))}
      </div>

      {/* Load More Sentinel */}
      {hasMore && !loading && (
        <div className="flex justify-center py-4" ref={sentinelRef}>
          {loadingMore && <Spin size="small" />}
        </div>
      )}
    </div>
  )
}

export default FileTable