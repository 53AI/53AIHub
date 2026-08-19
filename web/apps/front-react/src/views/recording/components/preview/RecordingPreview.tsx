import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Divider, Spin, message, Popover, Tooltip, Button } from 'antd'
import { LeftOutlined, QrcodeOutlined } from '@ant-design/icons'
import { QRCodeSVG } from 'qrcode.react'
import { LibraryHeader } from '@/views/library/components/header'
import { MoreDropdown } from '@/components/MoreDropdown'
import type { MenuItem } from '@/components/MoreDropdown'
import { FullscreenToggle } from '@/components/FullscreenToggle'
import { FavoriteToggle } from '@/components/FavoriteToggle'
import { IconButton } from '@/components/IconButton'
import {
  useInlineEditLite,
  getDisplayName,
  buildNewPath,
} from '@/views/mine/useInlineEditLite'
import { PERMISSION_TYPE } from '@/components/KMPermission/constant'
import { AUDIO_DOUBLE_EXT_REGEX } from '@/views/mine/constants'
import { t } from '@/locales'
import { buildUrl } from '@/utils/router'
import {
  cacheManager,
  CacheMode,
  copyToClip,
} from '@km/shared-utils'
import {
  DEFAULT_RECORDING_SHARE_SELECTION,
  appendRecordingSelectionToUrl,
  hasAnySelected,
  toggleRecordingTab,
  toggleRecordingSummary,
  type RecordingShareSelection,
} from '@/views/recording/selection/shareSelection'
import { SvgIcon } from '@km/shared-components-react'
import type { PreviewFile } from '@/views/mine/types'
import type { RecordingConfig, FileParseStatus } from '@/api/modules/recording/types'
import type { TemplateItem, TemplateCategory } from '@km/shared-business/recording-template'
import { AssistantBtn } from '@/views/library/main/file/components/assistant-btn'
import DocumentApp from '@/views/library/main/file/components/document-app'
import { InsightRegeneratePanel } from '@/views/recording/components/insight/InsightRegeneratePanel'
import { useLibraryStore } from '@/stores/modules/library'
import { AGENT_USAGES } from '@/constants/agent'
import recordingApi from '@/api/modules/recording'

const AudioView = lazy(() => import('../audio/AudioView'))
type AudioViewRef = import('../audio/AudioView').AudioViewRef

export interface RecordingPreviewProps {
  file: PreviewFile
  recordingConfig?: RecordingConfig
  parseStatus?: FileParseStatus | null
  templates?: TemplateItem[]
  templateCategories?: TemplateCategory[]
  onCommand?: (cmd: string) => void
  onRename?: (fileId: string, newName: string) => Promise<void>
  enableFavorite?: boolean
  fullscreen?: boolean
  onToggleFullscreen?: () => void
  /** 录音分组标签（用于「移动至」子菜单） */
  categoryTags?: { key: string; label: string }[]
  /** 洞察生成完成时回调，用于更新文件列表描述 */
  onDescriptionUpdate?: (fileId: string, description: string) => void
  /** 纪要完成时回调，刷新列表获取最新文件名 */
  onMeetingMinutesRename?: (fileId: string) => void
  /** AI 助手面板的挂载容器，由父级提供，避免 querySelector 选错多个同名节点 */
  assistantSiderRef?: React.RefObject<HTMLDivElement>
}

/**
 * 安心录右栏预览组件
 */
export function RecordingPreview({
  file,
  recordingConfig,
  parseStatus,
  templates,
  templateCategories,
  onCommand,
  onRename,
  enableFavorite = true,
  fullscreen = false,
  onToggleFullscreen,
  categoryTags,
  onDescriptionUpdate,
  onMeetingMinutesRename,
  assistantSiderRef,
}: RecordingPreviewProps) {

  const {
    handleClick: handleInlineClick,
    handleBlur: handleInlineBlur,
    handleKeydown: handleInlineKeydown,
    handlePaste: handleInlinePaste,
  } = useInlineEditLite()

  const isFolder = file.isfolder ?? false

  // 分享：链接状态 + 弹窗控制
  const [shareUrl, setShareUrl] = useState('')
  // 分享 Popover 的开关：受控模式，便于在洞察未就绪时拦截打开
  // （点击分享按钮直接弹 warning，不让 popover 出现）
  const [shareOpen, setShareOpen] = useState(false)
  // 分享 Popover 内部视图切换：链接视图 / 二维码视图
  const [shareView, setShareView] = useState<'link' | 'qrcode'>('link')
  // 分享范围：3 个核心 tab + 每个 sum-* 模板独立勾选。切文件时回到默认勾选
  const [shareSelection, setShareSelection] = useState<RecordingShareSelection>(
    DEFAULT_RECORDING_SHARE_SELECTION,
  )
  // 当前文件已生成的模板总结（template_id !== 0）。每次打开 popover 时从 AudioView
  // 拉一次最新列表，保证新生成的模板会出现在 chip 组里。
  const [shareTemplates, setShareTemplates] = useState<
    import('@/api/modules/recording/types').RecordingFileSummary[]
  >([])
  // 把分享选择编码进 URL（chip 切换会实时反映到显示 / 复制 / QR）
  const shareUrlWithTabs = shareUrl
    ? appendRecordingSelectionToUrl(shareUrl, shareSelection)
    : ''

  // 切文件时清空上一个文件的分享链接，避免弹窗先闪一下旧链接；并把 chip 还原到默认
  useEffect(() => {
    setShareUrl('')
    setShareOpen(false)
    setShareView('link')
    setShareSelection(DEFAULT_RECORDING_SHARE_SELECTION)
    setShareTemplates([])
  }, [file.id])

  // 导出/下载：通过 ref 调 AudioView；动态菜单项（sum-*）在打开菜单时实时拉取
  const audioViewRef = useRef<AudioViewRef>(null)
  const [exportMenuItems, setExportMenuItems] = useState<MenuItem[]>([])
  const [moreOpen, setMoreOpen] = useState(false)
  // 洞察生成状态（窄语义）：从 AudioView 的 onInsightStateChange 回调同步过来；
  // 用于分享按钮拦截——「正在生成中」的洞察内容不应被分享出去。
  const [insightGenerating, setInsightGenerating] = useState(false)
  // 解析整体在跑（宽语义）：任意阶段 loading（pending/parsing/processing）即为 true；
  // 用于「参谋洞察」面板在生成中再次提交时锁住按钮和切换文案。
  const [parseStatusRunning, setParseStatusRunning] = useState(false)

  // 切文件时清空旧菜单（避免下一个文件先展示上一个文件的模板项）
  useEffect(() => {
    setExportMenuItems([])
  }, [file.id])

  // AI 助手：复用知识库 DocumentApp / AssistantBtn，录音端使用 agent_usage=5
  const assistantVisible = useLibraryStore((state) => state.assistantVisible)
  const setAssistantVisible = useLibraryStore((state) => state.setAssistantVisible)

  // 切换文件时关闭右侧 AI 助手侧边栏，避免上一个文件的聊天上下文干扰新文件
  useEffect(() => {
    setAssistantVisible(false)
  }, [file.id, setAssistantVisible])
  const [assistantSiderContainer, setAssistantSiderContainer] =
    useState<HTMLElement | null>(null)

  // 同步当前录音文件到 library store，供 DocumentApp 通过 currentFile() 读取。
  // 数据源以 formatFile() 产出的 PreviewFile 为主（带 icon/name/file_ext 等 Chat 需要的字段），
  // 再用 rawData 兜底补齐 PreviewFile 未暴露的字段（如 origin_type/group_id/insight_summary 等）。
  // 依赖包含 file.rawData：同一个 file.id 下后端轮询更新 rawData（例如刷新解析状态）时
  // 也能重新同步，避免 store 里残留过期数据。
  useEffect(() => {
    const rawData = file.rawData as any
    const id = rawData?.id ?? file.id
    if (!id) return
    useLibraryStore.setState((s) => {
      const next = {
        ...rawData,
        id,
        name: file.name,
        icon: file.icon,
        file_ext: file.file_ext,
        file_mime: file.file_mime,
        isfile: file.isfolder === false,
        isfolder: file.isfolder === true,
      }
      const idx = s.files.findIndex((f) => f.id === id)
      const files =
        idx >= 0
          ? s.files.map((f) => (f.id === id ? { ...f, ...next } : f))
          : [next, ...s.files]
      return { files, currentFileId: id }
    })
  }, [file.id, file.rawData, file.name, file.icon, file.file_ext, file.file_mime, file.isfolder])

  // 离开录音视图时清理 store 里的 currentFileId，防止切回知识库时被误当作当前文件。
  // 不清 files 数组：录音文件可能需要继续展示在知识库视图里。
  useEffect(() => {
    return () => {
      useLibraryStore.setState({ currentFileId: '' })
    }
  }, [])

  // assistantInstall 由父级（recording/index.tsx）根据 recording_agent_enabled + usage=5 共同决定
  // 这里不再重复设置，避免覆盖父级的开关判断。

  // 查找 .assistant-sider 容器用于 createPortal。
  // 父级通过 assistantSiderRef 把容器 ref 直接传下来，避免 querySelector
  // 在多个同名节点（录音视图 + 知识库视图同时存在）的情况下选错容器，
  // 也避免靠 setTimeout 轮询容器的脆弱等待。
  useEffect(() => {
    if (!assistantVisible) {
      setAssistantSiderContainer(null)
      return
    }
    // 父级 ref 已经是同一个 div 实例，effect 重跑就同步最新 DOM 引用。
    setAssistantSiderContainer(assistantSiderRef?.current ?? null)
  }, [assistantVisible, assistantSiderRef])

  // 标题内联重命名：useInlineEditLite 对文件强制 .md 结尾，
  // 录音文件（.m4a 等）应保留音频后缀、去掉强制的 .md，避免变成 .m4a.md 双后缀。
  const handleClickTitle = (e: React.MouseEvent<HTMLElement>) => {
    if (!onRename) return
    const rawData = file.rawData as { path?: string } | undefined
    const originalPath = rawData?.path || ''
    handleInlineClick(e, {
      file: { id: file.id, name: file.name, file_ext: file.file_ext || '' },
      isFile: !isFolder,
      permission: PERMISSION_TYPE.edit_knowledge,
      onRename: async (id, newName) => {
        const fixedName = AUDIO_DOUBLE_EXT_REGEX.test(newName)
          ? newName.replace(/\.md$/i, '')
          : newName
        try {
          await onRename(id, buildNewPath(originalPath, fixedName))
        } catch (e: any) {
          const msg = e?.response?.data?.message || e?.message || ''
          const displayMsg = msg.includes('目标路径已存在') ? '已有相同文件名' : (msg || '重命名失败')
          message.error(displayMsg)
          throw e // 让 useInlineEditLite 恢复原文本
        }
      },
      onSave: () => {
        onCommand?.('rename-save')
      },
    })
  }

  const moveToChildren: MenuItem[] = (categoryTags ?? [])
    .filter((tag) => tag.key !== '0')
    .map((tag) => ({
      key: `move-to:${tag.key}`,
      label: tag.label,
    }))

  const menuItems = [
    {
      key: 'new-tab',
      icon: 'arrow-right-up',
      label: `${t('common.new_tab_page')}${t('action.open')}`,
    },
    { key: 'divider', divided: true },
    {
      key: 'export-download',
      icon: 'export',
      label: t('recording.export.menu_label'),
      children: exportMenuItems,
    },
    {
      key: 'move-to',
      icon: 'move',
      label: t('action.move_to'),
      children: moveToChildren,
      visible: moveToChildren.length > 0,
    },
    { key: 'rename', icon: 'edit', label: t('action.rename') },
    { key: 'divider', divided: true },
    { key: 'delete', icon: 'delete', label: t('action.delete'), danger: true },
  ]

  // 分享：参考 library FileShare 的交互（Popover + 缓存 + copyToClip），
  // 路径用 /share/recording/:id（区别于 library 的 /share/file/）。
  // 录音分享接口无有效期与取消，重复调用由后端决定是否复用同一 share_id；
  // 缓存 key 用 recording-share-* 前缀，避免与知识库 file-share-* 缓存命名空间冲突。
  // 同时拉一次 fileSummaries：分享 popover 要按每个 sum-* 模板渲染独立 chip，
  // 重新打开 popover 时也能反映最新生成的模板。
  const onSharePopoverShow = () => {
    setShareTemplates(audioViewRef.current?.getFileSummaries() ?? [])
    cacheManager
      .getOrFetch(
        `recording-share-${file.id}`,
        () => recordingApi.createFileShare(file.id),
        1 * 60,
        CacheMode.COOKIE,
      )
      .then((res) => {
        setShareUrl(buildUrl(`/share/recording/${res.share_id}`))
      })
      .catch((e: any) => {
        message.error(e?.message || t('share.create_failed'))
      })
  }

  const handleCopyShareUrl = () => {
    copyToClip(`【${file.name}】${shareUrlWithTabs}`)
    message.success(t('action.copy_link'))
  }

  const handleCopyUrl = () => {
    copyToClip(shareUrlWithTabs)
    message.success(t('action.copy_success'))
  }

  // chip 至少要勾选一个，否则复制 / QR 按钮置灰。
  const canShare = hasAnySelected(shareSelection)

  // 菜单命令：以 export- 开头的走 AudioView.ref.exportItem，其它透传给父级
  const handleCommand = (key: string | number) => {
    if (typeof key === 'string' && key.startsWith('export-')) {
      audioViewRef.current?.exportItem(key)
      return
    }
    onCommand?.(key as string)
  }

  // 打开「更多」菜单时从 AudioView 拉取最新的导出子菜单（含动态 sum-* 项）
  const handleMoreOpenChange = (open: boolean) => {
    setMoreOpen(open)
    if (open) {
      const items = audioViewRef.current?.getExportMenuItems() ?? []
      setExportMenuItems(items)
    }
  }

  const sharePopoverContent = (
    <div className="w-[400px]">
      {shareView === 'qrcode' ? (
        <>
          <div className="flex items-center gap-1">
            <span
              className="cursor-pointer text-base text-[#1D1E1F] font-medium flex items-center"
              onClick={() => setShareView('link')}
            >
              <LeftOutlined className="mr-1" />
              {t('share.scan_qrcode')}
            </span>
          </div>
          <div className="flex justify-center my-4">
            {shareUrlWithTabs ? (
              <QRCodeSVG value={shareUrlWithTabs} size={130} level="H" />
            ) : (
              <Spin />
            )}
          </div>
          <div className="px-20">
            <Divider className="!my-2 !text-sm !text-[#9A9A9A] !font-normal">
              {t('share.recording_scan_footer')}
            </Divider>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1">
            <p className="text-base text-main font-medium">{t('share.recording_title')}</p>
            <Tooltip title={t('share.recording_desc')}>
              <span>
                <SvgIcon name="question" />
              </span>
            </Tooltip>
          </div>
          {/* 分享范围：3 个核心 tab + 每个 sum-* 模板独立勾选（平铺）。
              模板数为 0 时只渲染核心 tab。 */}
          <div className="mt-3">
            <p className="text-xs text-[#6B7280] mb-2">
              {t('share.recording_chip_section')}
            </p>
            <div className="flex items-center gap-2.5 flex-wrap">
              {(['i', 's', 't'] as const).map((key) => {
                const selected = shareSelection[key]
                return (
                  <Button
                    key={key}
                    color={selected ? 'primary' : 'default'}
                    className={ selected ? 'bg-[#F2F6FF]' : '' }
                    variant="outlined"
                    onClick={() =>
                      setShareSelection((prev) => toggleRecordingTab(prev, key))
                    }
                  >
                    {key === 'i' && t('recording.tab.insight')}
                    {key === 's' && t('recording.tab.summary')}
                    {key === 't' && t('recording.tab.transcript')}
                  </Button>
                )
              })}
              {shareTemplates.map((tmpl) => {
                const selected = shareSelection.sums.includes(tmpl.id)
                return (
                  <Button
                    key={tmpl.id}
                    color={selected ? 'primary' : 'default'}
                    className={ selected ? 'bg-[#F2F6FF]' : '' }
                    variant="outlined"
                    onClick={() =>
                      setShareSelection((prev) =>
                        toggleRecordingSummary(prev, tmpl.id),
                      )
                    }
                  >
                    {tmpl.template_name}
                  </Button>
                )
              })}
            </div>
          </div>
          <div className="flex items-center border my-4 rounded">
            <div className="flex-1 px-4 text-sm text-[#4F5052] truncate">
              {shareUrlWithTabs}
            </div>
            <div className="h-4 border-r" />
            <div
              className={`h-9 flex-none flex items-center justify-center px-3 ${
                canShare ? 'cursor-pointer hover:bg-[#F0F0F0]' : 'opacity-40 cursor-not-allowed'
              }`}
              onClick={canShare ? handleCopyUrl : undefined}
            >
              <SvgIcon name="copy" />
            </div>
          </div>
          <div className="bg-[#F8F9FA] px-5 py-4 -mx-3 -mb-3">
            <div className="flex items-center gap-2">
              <Button
                color="default"
                shape="round"
                onClick={handleCopyShareUrl}
                disabled={!canShare}
              >
                <SvgIcon name="link" />
                {t('action.copy_link')}
              </Button>
              <Button
                color="default"
                shape="round"
                onClick={() => setShareView('qrcode')}
                disabled={!canShare}
              >
                <QrcodeOutlined />
                {t('share.scan_qrcode')}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )

  const headerFooter = (
    <div className="flex items-center gap-2">
      {enableFavorite && (
        <FavoriteToggle
          favorite={file.isFavorite}
          onToggle={() =>
            onCommand?.(file.isFavorite ? 'favorite-removed' : 'favorite-added')
          }
        />
      )}
      <Popover
        content={sharePopoverContent}
        trigger="click"
        open={shareOpen}
        onOpenChange={(open) => {
          // 拦截：洞察还在生成中时阻止 popover 打开，直接弹 warning
          // 走到这里意味着 click 已经发生，先提示再决定是否真正打开
          if (open && insightGenerating) {
            message.warning(t('share.recording_insight_not_ready'))
            return
          }
          setShareOpen(open)
          if (open) {
            onSharePopoverShow()
          } else {
            setShareView('link')
          }
        }}
      >
        <IconButton title={t('action.share')} size="medium">
          <SvgIcon name="share-two" />
        </IconButton>
      </Popover>
      <AssistantBtn />
      <FullscreenToggle fullscreen={fullscreen} onToggle={onToggleFullscreen} />
      <MoreDropdown
        iconSize={16}
        tooltip={t('action.more')}
        items={menuItems}
        onCommand={handleCommand}
        open={moreOpen}
        onOpenChange={handleMoreOpenChange}
      />
    </div>
  )

  // 轮询判断
  const shouldPoll =
    recordingConfig?.enabled !== false && !!recordingConfig?.parser_platform

  return (
    <div className="relative flex flex-col bg-white h-full">
      <LibraryHeader showBack={false} showSiderButton={false} footer={headerFooter}>
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
          <p className="text-xs text-[#9A9A9A] px-1">
            {/* {t('common.recently_edit')}： */}
            {file.updated_time}
          </p>
        </div>
      </LibraryHeader>

      <div className="flex flex-1 overflow-hidden">
        <Suspense
          fallback={
            <div className="w-full flex justify-center items-center h-full">
              <Spin size="large" />
            </div>
          }
        >
          <AudioView
            ref={audioViewRef}
            currentFile={{
              id: file.id,
              file_url: file.file_url,
              name: file.name,
              insight_summary: (file.rawData as any)?.insight_summary,
              rawData: file.rawData,
            } as any}
            shouldPoll={shouldPoll}
            templates={templates}
            templateCategories={templateCategories}
            recordingConfig={recordingConfig}
            initialFileData={file.rawData as Record<string, any>}
            parseStatus={parseStatus}
            onDescriptionUpdate={onDescriptionUpdate}
            onMeetingMinutesRename={onMeetingMinutesRename}
            onInsightStateChange={(state) => {
              setInsightGenerating(!!state?.generating)
              setParseStatusRunning(!!state?.parseStatusRunning)
            }}
          />
        </Suspense>
      </div>

      {/* Portal 挂载到外层 .assistant-sider 容器（由 recording/index.tsx 渲染） */}
      {assistantVisible &&
        assistantSiderContainer &&
        createPortal(
          <DocumentApp
            chatAgentUsage={AGENT_USAGES.KM_RECORDING_CHAT}
            mapAgentUsage={null}
            showInsightRegenerate={!!recordingConfig?.insight_regenerate_enabled}
            parseStatusRunning={parseStatusRunning}
            insightRegeneratePanel={
              <InsightRegeneratePanel fileId={file.id} />
            }
            onInsightRegenerateStarted={() => {
              // 让主视图洞察 Tab 立刻进入 loading + 重新轮询新结果
              audioViewRef.current?.startInsightRegeneration()
              // 重生成开始后让父级刷新文件描述，避免列表里残留旧的洞察摘要
              onDescriptionUpdate?.(file.id, '')
            }}
            onHide={() => setAssistantVisible(false)}
          />,
          assistantSiderContainer,
        )}
    </div>
  )
}

export default RecordingPreview
