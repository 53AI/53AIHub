import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, message, Modal, Spin } from 'antd'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import filesApi from '@/api/modules/files'
import { formatFile } from '@/api/modules/files/transform'
import recordingApi from '@/api/modules/recording'
import { getFormatTimeStamp } from '@km/shared-utils'
import { buildUrl } from '@/utils/router'
import { t } from '@/locales'
import { extractFileName } from '@/views/mine/useInlineEditLite'
import { useFullscreen } from '@/hooks/useFullscreen'
import { useRecordingStore } from '@/stores/modules/recording'
import { useLibraryStore } from '@/stores/modules/library'
import { useRecordingTemplates } from '../hooks/useRecordingTemplates'
import { RecordingPreview, type PanelMutationEvent } from '../components/preview/RecordingPreview'
import { useFlutterPanelMutation } from '../components/flutter-panel/useFlutterPanelMutation'
import { notifyFlutterPanelMutation } from '../components/flutter-panel/notifyFlutterPanelMutation'
import type { RecordingOutletContext } from '..'
import type { PreviewFile } from '@/views/mine/types'
import type { FileParseStatus } from '@/api/modules/recording/types'

/**
 * /recording/preview/:fileId —— RecordingView 布局的右栏子路由。
 *
 * 左栏（文件列表）由父布局持有，这里只负责右栏：
 * 挂载即按 fileId 拉数据，加载期渲染 Spin 而不是首页，避免旧 ?preview= 方案
 * 那种"先闪一下首页再切到预览"的问题。
 *
 * 收藏/重命名/移动/删除都通过 Outlet context 回写父布局的列表状态，
 * 保证左右两栏看到的是同一份数据。
 */
export function RecordingPreviewRoute() {
  const { fileId = '' } = useParams<{ fileId: string }>()
  const navigate = useNavigate()
  const ctx = useOutletContext<RecordingOutletContext>()
  const recordingConfig = useRecordingStore((s) => s.recordingConfig)
  // 助手面板容器的显隐/宽度由 libraryStore 统一管理（与 LibraryMainView 同一份状态），
  // RecordingPreview 内部也是读 useLibraryStore —— 这里必须读同一个 store，
  // 否则容器永远不渲染，助手打开后无处挂载，右边就是空白。
  const assistantVisible = useLibraryStore((s) => s.assistantVisible)
  const assistantCollapsed = useLibraryStore((s) => s.assistantCollapsed)
  const assistantExpanded = useLibraryStore((s) => s.assistantExpanded)
  const assistantSiderRef = useRef<HTMLDivElement>(null)

  const { templates, categories: templateCategories } = useRecordingTemplates()
  const { fullscreen, toggle: toggleFullscreen, composeClassName } = useFullscreen()

  // Flutter 面板（右侧 iframe）里的写操作同步到本预览页：
  // - 添加总结模块（create）→ RecordingPreview 重拉 fileSummaries（sum-* tab /
  //   导出菜单 / 分享 chip 跟着更新）；
  // - 重写转写（update，如关联发言人）→ RecordingPreview 重拉转写 markdown，
  //   转写列表的说话人 / 头像同步；
  // - 删除录音（delete）→ 退回列表首页（列表由布局层 RecordingView 监听同一
  //   消息移除该项，这里只负责导航）。
  const [panelMutation, setPanelMutation] = useState<PanelMutationEvent | null>(null)
  const panelMutationSeqRef = useRef(0)
  useFlutterPanelMutation((mutation) => {
    if (mutation.module !== 'recording' || !mutation.fileId) return
    if (mutation.action === 'create' || mutation.action === 'update') {
      setPanelMutation({
        fileId: mutation.fileId,
        action: mutation.action,
        scope: mutation.scope,
        seq: ++panelMutationSeqRef.current,
      })
    } else if (mutation.action === 'delete') {
      // 删的正是当前预览对象（或列表里已找不到它）→ 退回列表首页；
      // 删的是别的文件 → 预览页不动，只由布局层刷新列表。
      if (mutation.fileId === fileId) {
        message.info('录音已在移动端删除')
        navigate('/recording', { replace: true })
      }
    }
  })

  const [file, setFile] = useState<PreviewFile | null>(null)
  const [parseStatus, setParseStatus] = useState<FileParseStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  // formatFile 结果 -> PreviewFile。filesApi.get 返回的是 RawFileItem
  // （只有 path，没有 name / file_ext），不转换预览组件取不到字段。
  const toPreviewFile = (
    formatted: ReturnType<typeof formatFile>,
    raw?: any,
  ): PreviewFile => ({
    id: formatted.id,
    name: formatted.name,
    icon: formatted.icon,
    file_url: formatted.file_url,
    file_ext: formatted.file_ext,
    file_mime: formatted.file_mime,
    library_id: formatted.library_id,
    updated_time: getFormatTimeStamp(formatted.updated_time),
    isFavorite: (formatted as any).is_favorite,
    isfolder: formatted.isfolder,
    rawData: raw ?? formatted,
  })

  useEffect(() => {
    let cancelled = false
    if (!fileId) {
      setError('文件 id 缺失')
      return
    }
    setFile(null)
    setParseStatus(null)
    setError(null)
    Promise.all([
      filesApi.get(fileId),
      recordingApi.getParseStatus(fileId).catch(() => null),
    ])
      .then(([fileData, parseStatusResult]) => {
        if (cancelled) return
        setFile(toPreviewFile(formatFile(fileData), fileData))
        setParseStatus(parseStatusResult)
      })
      .catch((e: any) => {
        if (cancelled) return
        setError(e?.message ?? '加载预览文件失败')
      })
    return () => {
      cancelled = true
    }
  }, [fileId])

  // 列表中同名文件的 name 变化时同步到本地 file 状态：
  // 列表侧 rename 走 refresh 刷新列表，本地 file 不会自动跟随更新。
  const previewListName = file?.id ? ctx.findListItem(file.id)?.name : undefined

  useEffect(() => {
    if (!file || !previewListName || previewListName === file.name) return
    setFile((prev) => (prev?.id === file.id ? { ...prev, name: previewListName } : prev))
  }, [file?.id, previewListName])

  // 右栏标题内联重命名
  const handleRename = async (id: string, newPath: string) => {
    await filesApi.rename({ id, path: newPath })
    const name = extractFileName(newPath).replace(/\.md$/, '')
    setFile((prev) => (prev ? { ...prev, name } : prev))
    ctx.updateFileName(id, name)
    ctx.refresh()
  }

  // 纪要生成完成后同步标题：只拉单文件，不刷新整个列表
  const handleMeetingMinutesRename = useCallback(
    async (id: string) => {
      try {
        const fileData = await filesApi.get(id)
        const formatted = formatFile(fileData)
        ctx.updateFileName(id, formatted.name)
        setFile((prev) =>
          prev?.id === id ? toPreviewFile(formatted, fileData) : prev,
        )
        // 同步 Flutter 面板（iframe）：列表 / 详情页同步新标题
        notifyFlutterPanelMutation('update', id)
      } catch (e) {
        console.error('Failed to sync file title after meeting minutes:', e)
      }
    },
    [ctx],
  )

  // 右栏更多菜单 / 收藏
  const handleCommand = async (cmd: string) => {
    if (!file) return
    const item = ctx.findListItem(file.id)
    if (cmd === 'new-tab') {
      window.open(buildUrl(`/recording/preview/${file.id}`), '_blank')
    } else if (
      cmd === 'favorite' ||
      cmd === 'favorite-added' ||
      cmd === 'favorite-removed'
    ) {
      const next = !file.isFavorite
      await ctx.toggleFavorite(file.id, file.isFavorite ?? false)
      setFile((prev) => (prev ? { ...prev, isFavorite: next } : prev))
    } else if (cmd === 'rename') {
      if (item) ctx.openRenameModal(item)
    } else if (cmd === 'delete') {
      Modal.confirm({
        title: t('common.tip'),
        content: t('status.file_del'),
        okText: t('action.confirm'),
        cancelText: t('action.cancel'),
        onOk: async () => {
          if (item) await ctx.removeFile(item)
          // 删掉的正是当前预览对象，退回列表首页
          navigate('/recording', { replace: true })
        },
      })
    }
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center flex-col gap-3 text-secondary">
        <div>{error}</div>
        <Button type="primary" onClick={() => navigate('/recording')}>
          返回录音列表
        </Button>
      </div>
    )
  }

  if (!file) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spin size="large" tip="加载中..." />
      </div>
    )
  }

  return (
    <>
      <div className={composeClassName('flex-1 overflow-hidden')}>
        <RecordingPreview
          file={file}
          recordingConfig={recordingConfig ?? undefined}
          parseStatus={parseStatus}
          templates={templates}
          templateCategories={templateCategories}
          onCommand={handleCommand}
          onRename={handleRename}
          enableFavorite
          fullscreen={fullscreen}
          onToggleFullscreen={toggleFullscreen}
          onDescriptionUpdate={ctx.updateFileDescription}
          onMeetingMinutesRename={handleMeetingMinutesRename}
          assistantSiderRef={assistantSiderRef}
          panelMutation={panelMutation ?? undefined}
        />
      </div>

      {/* AI 助手面板容器（与 LibraryMainView 一致，挂在预览外层） */}
      {assistantVisible && (
        <div
          ref={assistantSiderRef}
          className={`assistant-sider flex bg-white relative rounded-lg overflow-hidden transition-all duration-300 ${
            assistantCollapsed
              ? 'flex-none w-[452px]'
              : assistantExpanded
                ? 'flex-1 min-w-[452px]'
                : 'flex-none w-[48px]'
          }`}
        />
      )}
    </>
  )
}
