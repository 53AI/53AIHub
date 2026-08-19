import { useRef, useEffect } from 'react'
import { Empty, Spin } from 'antd'
import { t } from '@/locales'
import type { RecordingFileItemUI } from '../../hooks/useRecordingList'
import { SvgIcon } from "@km/shared-components-react"
import { MoreDropdown, type MenuItem } from '@/components/MoreDropdown'

interface RecordingFileListProps {
  list: RecordingFileItemUI[]
  loading: boolean
  selectedId: string | null
  onSelect: (item: RecordingFileItemUI) => void
  onCommand: (item: RecordingFileItemUI, cmd: string) => void
  hasMore: boolean
  onLoadMore: () => void
  categoryTags?: { key: string; label: string }[]
}

/**
 * 安心录左栏录音文件列表
 *
 */
export function RecordingFileList({
  list,
  loading,
  selectedId,
  onSelect,
  onCommand,
  hasMore,
  onLoadMore,
  categoryTags,
}: RecordingFileListProps) {
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading) {
          onLoadMore()
        }
      },
      { threshold: 0.1 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [onLoadMore, loading])

  if (loading && list.length === 0) {
    return (
      <div className="flex justify-center py-8">
        <Spin size="large" />
      </div>
    )
  }

  if (list.length === 0) {
    return (
      <div className="mt-8 flex justify-center">
        <Empty description={t('mine.no_recording_empty')} />
      </div>
    )
  }

  return (
    <div className="px-3 flex-1 overflow-y-auto">
      {list.map((item) => {
        const moveToChildren: MenuItem[] = (categoryTags ?? [])
          .filter((tag) => tag.key !== '0')
          .map((tag) => ({
            key: `move-to:${tag.key}`,
            label: tag.label,
          }))
        const dropdownItems: MenuItem[] = [
          { key: 'rename', icon: 'edit', label: t('action.rename') },
          {
            key: 'move-to',
            icon: 'move',
            label: t('action.move_to'),
            children: moveToChildren,
            visible: moveToChildren.length > 0,
          },
          { key: 'divider', divided: true },
          { key: 'delete', icon: 'delete', label: t('action.delete'), danger: true },
        ]
        const isSelected = selectedId === item.id
        return (
          <div
            key={item.id}
            className={`group relative p-3 cursor-pointer rounded-lg ${
              isSelected ? 'bg-[#F0F5FF]' : 'hover:bg-[#F5F6F7]'
            }`}
            onClick={() => onSelect(item)}
          >
            <div className="flex items-start gap-2">
              <span className="flex-1 truncate text-sm text-primary">{item.name}</span>
            </div>
            {item.description && (
              <div className="my-1.5 text-xs text-secondary line-clamp-2">
                {item.description}
              </div>
            )}
            <div className="mt-1 flex justify-between items-center gap-2">
              <span className="text-[11px] px-1 rounded text-secondary flex-center gap-1">
                <SvgIcon name="folder-minus" size={14} /> { item.groupId ? categoryTags?.find(t => t.key === String(item.groupId ?? 0))?.label || item.category :'未分类'}
              </span>
              <span className="text-[11px] text-secondary">{item.createdTime}</span>
            </div>
            <div
              className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 bg-white rounded group-hover:opacity-100 transition-opacity"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreDropdown
                size="24px"
                icon="more-h"
                iconSize={14}
                backgroundColor="#ffffff"
                tooltip={t('action.more')}
                items={dropdownItems}
                onCommand={(cmd) => onCommand(item, String(cmd))}
                destroyOnHidden
              />
            </div>
          </div>
        )
      })}
      {hasMore && !loading && (
        <div className="flex justify-center py-4" ref={sentinelRef}>
          <Spin size="small" />
        </div>
      )}
    </div>
  )
}

export default RecordingFileList
