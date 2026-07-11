import { lazy, Suspense } from 'react'
import { Spin, Tooltip } from 'antd'
import { StarFilled, StarOutlined } from '@ant-design/icons'
import { LibraryHeader } from '@/views/library/components/header'
import { MoreDropdown } from '@/components/MoreDropdown'
import { t } from '@/locales'
import { useInlineEditLite, getDisplayName, buildNewPath } from '../useInlineEditLite'
import { PERMISSION_TYPE } from '@/components/KMPermission/constant'
import type { PreviewFile } from '../types'
import FileEditBtn from './FileEditBtn'

const AudioViewer = lazy(() => import('@/components/Audio/index'))
const VideoViewer = lazy(() => import('../views/video-viewer'))
const FileViewer = lazy(() => import('@/components/FileViewer/index'))

import type { MineTabKey } from '../types'

export interface PreviewPanelProps {
  file: PreviewFile | null
  content: string
  loading?: boolean
  onBack: () => void
  onCommand?: (cmd: string) => void
  onEdit?: () => void
  onRename?: (fileId: string, newName: string) => Promise<void>
  libraryId?: string
  activeTab?: MineTabKey
  enableFavorite?: boolean
}

/**
 * 预览面板组件
 */
const AUDIO_EXTS = ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'aac', 'wma', 'aiff']
const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'wmv']

export function PreviewPanel({ file, content, loading, onBack, onCommand, onEdit, onRename, libraryId, activeTab, enableFavorite = true }: PreviewPanelProps) {
  // Inline edit
  const { handleClick: handleInlineClick, handleBlur: handleInlineBlur, handleKeydown: handleInlineKeydown, handlePaste: handleInlinePaste } = useInlineEditLite();

  if (!file) return null

  const fileExt = file.file_ext?.toLowerCase() || 'md'
  const isAudio = AUDIO_EXTS.includes(fileExt)
  const isVideo = VIDEO_EXTS.includes(fileExt)
  const isAudioVideo = isAudio || isVideo
  const isFolder = file.isfolder ?? false

  // 优先使用文件自身的 library_id，否则使用传入的 libraryId
  const fileLibraryId = file.library_id || libraryId

  // 编辑按钮：非音频/视频文件显示
  const showEditBtn = !isAudioVideo && onEdit
  // 收藏按钮：非文件夹且有权限时显示
  const showFavBtn = enableFavorite && !isFolder
  // 更多按钮：始终显示

  // Handle title click for rename
  const handleClickTitle = (e: React.MouseEvent<HTMLElement>) => {
    if (!onRename) return;
    const rawData = file.rawData as { path?: string } | undefined;
    const originalPath = rawData?.path || "";
    handleInlineClick(e, {
      file: {
        id: file.id,
        name: file.name,
        file_ext: file.file_ext || "",
      },
      isFile: !isFolder,
      permission: PERMISSION_TYPE.edit_knowledge,
      onRename: async (id, newName) => {
        await onRename(id, buildNewPath(originalPath, newName));
      },
      onSave: () => {
        onCommand?.("rename-save");
      },
    });
  };

  const menuItems = [
    {
      key: 'new-tab',
      icon: 'arrow-right-up',
      label: t('common.new_tab_page') + t('action.open'),
    },
    {
      key: 'rename',
      icon: 'edit',
      label: t('action.rename'),
    },
    { key: 'divider', divided: true },
    {
      key: 'delete',
      icon: 'delete',
      label: t('action.delete'),
      danger: true,
    },
  ]

  // Header footer 按钮组
  const headerFooter = (
    <div className="flex items-center gap-2">
      {showEditBtn && (
        <FileEditBtn
          fileId={file.id}
          fileExt={fileExt}
          fileMime={file.file_mime}
          libraryId={fileLibraryId}
          onEdit={onEdit}
        />
      )}
      {showFavBtn && (
        <Tooltip title={file.isFavorite ? t('action.unfavorite') : t('action.favorite')}>
          <div
            className="size-[34px] rounded hover:bg-[#F0F0F0] flex items-center justify-center cursor-pointer"
            onClick={() => onCommand?.(file.isFavorite ? 'favorite-removed' : 'favorite-added')}
          >
            {file.isFavorite ? (
              <StarFilled className="text-[#FFB300] text-base" />
            ) : (
              <StarOutlined className="text-[#1D1E1F] text-base" />
            )}
          </div>
        </Tooltip>
      )}
      <MoreDropdown
        size="32px"
        icon="more-h"
        iconSize={16}
        tooltip={t('action.more')}
        backgroundColor="#F0F0F0"
        items={menuItems}
        onCommand={onCommand}
      />
    </div>
  )

  return (
    <div className="relative flex flex-col bg-white h-full">
      <LibraryHeader
        showBack
        backProxy={onBack}
        showSiderButton={false}
        footer={headerFooter}
      >
        <div className="flex-1">
          <h3
            className="py-0.5 text-base text-[#1D1E1F] truncate inline-editable"
            onClick={handleClickTitle}
            onBlur={handleInlineBlur}
            onKeyDown={handleInlineKeydown}
            onPaste={handleInlinePaste}
          >
            {getDisplayName(file.name, !isFolder, file.file_ext)}
          </h3>
          <p className="text-xs text-[#9A9A9A]">
            {t('common.recently_edit')}：{file.updated_time}
          </p>
        </div>
      </LibraryHeader>

      {/* Preview Content */}
      <div className="flex flex-1 overflow-hidden">
        {loading ? (
          <div className="flex justify-center items-center h-full">
            <Spin size="large" />
          </div>
        ) : (
          (() => {
            if (AUDIO_EXTS.includes(fileExt)) {
              // 判断是否应该轮询：enabled 不为 false 且 parser_platform 有值
              const recordingConfig = file.recordingConfig
              const shouldPollAudio = recordingConfig?.enabled !== false && (recordingConfig?.parser_platform?.length ?? 0) > 0
              return (
                <Suspense fallback={<Spin size="large" />}>
                  <AudioViewer
                    currentFile={{
                      id: file.id,
                      file_url: file.file_url,
                      name: file.name,
                      insight_summary: (file.rawData as any)?.insight_summary,
                    } as any}
                    shouldPoll={shouldPollAudio}
                  />
                </Suspense>
              )
            }
            if (VIDEO_EXTS.includes(fileExt)) {
              return (
                <Suspense fallback={<Spin size="large" />}>
                  <VideoViewer
                    currentFile={{
                      file_url: file.file_url,
                      name: file.name,
                    } as any}
                  />
                </Suspense>
              )
            }
            return (
              <FileViewer
                key={file.updated_time || file.id}
                url={file.file_url}
                content={content}
                extension={file.file_ext || 'md'}
              />
            )
          })()
        )}
      </div>
    </div>
  )
}

export default PreviewPanel