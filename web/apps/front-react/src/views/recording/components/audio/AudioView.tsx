import { forwardRef, useImperativeHandle, useState, useRef, useEffect, useCallback } from 'react';
import { message, Modal } from 'antd';
import { PlusOutlined, CloseCircleFilled } from "@ant-design/icons";
import { FileItem } from '@/api/modules/files/types';
import { Tabs } from '@km/shared-components-react';
import { copyToClip } from '@km/shared-utils';
import loadLib from '@/utils/loadLib';
import { TemplateListModal } from '@km/shared-business/recording-template';
import type { TemplateItem, TemplateCategory } from '@km/shared-business/recording-template';
import type { FileParseStatus } from '@/api/modules/recording/types';
import type { RecordingConfig } from '@/api/modules/recording/types';
import type { RecordingFileSummary } from '@/api/modules/recording/types';
import recordingApi from '@/api/modules/recording';
import ragJobApi from '@/api/modules/rag-job';
import promptApi from '@/api/modules/prompt';
import { GROUP_TYPE } from '@/constants/group';
import { useTemplateTabs } from '../../hooks/useTemplateTabs';
import { useFileParse } from '../../hooks/useFileParse';
import { useInsightDescriptionUpdate, useMeetingMinutesRename } from '../../hooks/useInsightCallbacks';
import { useExport } from '../../hooks/useExport';
import { STAGE_STATUS, isStageActionable, isStageFailed, isStageDone, isStageLoading, isStageActive } from '../../constants/recordingStatus';
import { InsightTabContent } from '../preview/InsightTabContent';
import { SummaryTabContent } from '../preview/SummaryTabContent';
import { TemplateSummaryTabContent } from '../preview/TemplateSummaryTabContent';
import { TranscriptPanel } from './TranscriptPanel';
import { AudioPlayerBar, type AudioPlayerBarHandles } from './AudioPlayerBar';
import { useLibraryStore } from '@/stores/modules/library';
import { t } from '@/locales';
import type { MenuItem } from '@/components/MoreDropdown';
import './AudioView.css';

// 声明全局 TextHighlighter 类型（高亮器库 lazy 加载）
declare global {
  interface Window {
    TextHighlighter: any
  }
}


import './AudioView.css';

/** 总结详情轮询间隔（异步生成模式下，前端每 3 秒回查一次状态） */
const SUMMARY_POLL_INTERVAL_MS = 3000

/** 划词菜单的「复制」项：highlighter 库只负责把 highlightInfo 透传给 item.handler，
 *  不会内置写入剪贴板——必须由调用方实现。复用 MarkdownViewer 的同款写法。 */
const copyItem = {
  logo: '/viewer/images/copy.png',
  label: '复制',
  handler: (info: { text: string }) => {
    copyToClip(info.text).then(() => {
      message.success('已复制')
    })
  },
}

interface AudioViewProps {
  currentFile: FileItem
  /** 是否应该轮询文字稿，由父组件根据 recordingConfig 判断 */
  shouldPoll?: boolean
  /** TemplateListModal 数据源，不传则使用组件内置默认模板 */
  templates?: TemplateItem[]
  /** TemplateListModal 分类列表 */
  templateCategories?: TemplateCategory[]
  /** 录音配置（用于判断语音模型是否可用） */
  recordingConfig?: RecordingConfig
  /** 外部已取到的文件数据，避免 useFileParse 重复请求 */
  initialFileData?: Record<string, any>
  /** 外部已取到的解析状态，避免 useFileParse 重复请求 */
  parseStatus?: FileParseStatus | null
  /** 洞察/页面编排完成时回调，用于更新左侧列表描述文本 */
  onDescriptionUpdate?: (fileId: string, description: string) => void
  /** 纪要生成完成时回调，用纪要标题重命名文件 */
  onMeetingMinutesRename?: (fileId: string) => void
  /** 只读模式：禁用「+ 新增模板」、「删除模板 tab」、「开始/继续生成」按钮
   * 用于分享页等接收方场景，保留轮询和被动展示 */
  readOnly?: boolean
  /**
   * 洞察生成状态变化回调：让父级（RecordingPreview）感知当前是否还在生成中，
   * 供「参谋洞察」面板在生成中再次提交时弹出确认提示。
   */
  onInsightStateChange?: (state: {
    /** 洞察 / 页面编排任一在真正 active（parsing/processing）→ 主视图在生成洞察 */
    generating: boolean
    /** 任意解析阶段在 loading（pending/parsing/processing）→ 后端在跑，不可重生成洞察 */
    parseStatusRunning?: boolean
  }) => void
}

/**
 * AudioView 暴露给父组件的命令式句柄
 * - exportItem(key): 派发到对应的导出函数（见 useExport 的 ExportKey）
 * - getExportMenuItems(): 生成「导出/下载」二级菜单项（含动态 sum-* 项）
 * - getFileSummaries(): 当前文件已生成的模板总结（template_id !== 0），
 *   给录音分享 popover 用于渲染「每个 sum-* 模板独立勾选」的 chip 组
 */
export interface AudioViewRef {
  exportItem: (key: string) => Promise<void>
  getExportMenuItems: () => MenuItem[]
  getFileSummaries: () => RecordingFileSummary[]
  /**
   * 重新触发洞察生成：清空 insightSummary / insightPageJson、把对应 stage 重置为 pending，
   *  并启动新一轮轮询。供「参谋洞察」面板提交后调用，让主视图洞察 Tab 立刻进入 loading。
   */
  startInsightRegeneration: () => void
}

export const AudioView = forwardRef<AudioViewRef, AudioViewProps>(function AudioView({ currentFile, shouldPoll = true, templates, templateCategories, recordingConfig, initialFileData, parseStatus, onDescriptionUpdate, onMeetingMinutesRename, readOnly = false, onInsightStateChange }, ref) {
  const [currentTranscriptId, setCurrentTranscriptId] = useState('')
  const audioPlayerRef = useRef<AudioPlayerBarHandles>(null)

  // 切文件时重置高亮（transcriptList 还没就绪，避免用旧 ID 命中新文件）
  useEffect(() => {
    setCurrentTranscriptId('')
  }, [currentFile?.id])

  // 语音模型名称为空 → 无可用语音模型，跳过 parse_status 请求
  const noVoiceModel = recordingConfig ? !recordingConfig.voice_model_name : false

  // AI 助手未开启时，不要加载 slide 命令菜单 —— 划词菜单只保留"复制"基础能力，
  // 避免在未启用 AI 助手的情况下发起 slide commands 接口请求。
  // assistantInstall 是从 library 共享过来的派生值（口径不同），从 library 切到 recording
  // 时残留 true 会导致 AudioView 的子 effect 先跑一次再被父 effect 重置；这里再叠一道
  // recording_agent_enabled 闸门，recordingConfig 已在路由层加载完毕可直接读，不依赖时序。
  // 另外，slide commands 是给"已打开 AI 助手侧边栏 + 选中文字后弹出菜单"用的运行时能力，
  // 侧边栏未打开时不预取，等用户真正打开侧边栏再请求。
  const assistantInstall = useLibraryStore((s) => s.assistantInstall)
  const assistantVisible = useLibraryStore((s) => s.assistantVisible)
  const recordingAgentEnabled = !!recordingConfig?.recording_agent_enabled

  // 划词菜单（v0.x §录音划词配套）：加载 slide 命令并缓存到 state，
  // 依赖 activeTab 每次重新派发 `viewer-event { type: 'menu' }`，与 Chat.tsx:223-237 /
  // MarkdownViewer.tsx:54-74 协议一致。MarkdownViewer / 洞察 highlighter 重建后能立即
  // 收到新事件注入菜单项，避免切回 tab 时菜单回到默认（只有"复制"）。
  const [slideCommands, setSlideCommands] = useState<any[]>([])
  useEffect(() => {
    if (!assistantInstall || !recordingAgentEnabled || !assistantVisible) {
      setSlideCommands([])
      return
    }
    let mounted = true
    promptApi
      .list({ group_type: GROUP_TYPE.KM_FILE_CHAT_SLIDE_COMMAND, limit: 100 } as any)
      .then((res: any) => {
        if (!mounted) return
        setSlideCommands(res?.prompts || [])
      })
      .catch(() => {
        // ignore
      })
    return () => {
      mounted = false
    }
  }, [assistantInstall, recordingAgentEnabled, assistantVisible])

  // 解析状态 hook
  const {
    transcriptList,
    insightSummary,
    insightPageJson,
    fileSummaries,
    fileSummariesLoading,
    hasContent,
    transcriptionStatus,
    meetingMinutesStatus,
    insightsStatus,
    insightPageStatus,
    stageStatuses,
    isBeingParsed,
    initialLoadDone,
    resetFailed,
    startInsightRegeneration,
    updateSummary,
    insightPageApiDone,
  } = useFileParse({ fileId: currentFile?.id, shouldPoll, initialFileData, initialParseStatus: parseStatus })

  // 我的录音旧数据：转录和洞察都完成，纪要/页面编排为 pending → 不展示重新生成页面
  const isLegacyData = isStageDone(transcriptionStatus) && isStageDone(insightsStatus) &&
    meetingMinutesStatus === STAGE_STATUS.Pending && insightPageStatus === STAGE_STATUS.Pending
  const showInsightPending = !isLegacyData && (isStageActionable(insightsStatus) || isStageActionable(meetingMinutesStatus) || isStageActionable(transcriptionStatus))
  const showTranscriptPending = !isLegacyData && isStageActionable(transcriptionStatus)

  // 洞察 + 页面编排任一在 active（parsing/processing）→ 主视图洞察 Tab 在生成中。
  // 用于分享按钮拦截：「正在生成中」的洞察内容不应被分享出去，避免接收方看到半成品。
  // 关键：initialLoadDone=false 时默认视为 generating，避免刷新瞬间的 race window。
  // 注意：这里用 isStageActive 而不是 isStageLoading——pending 在主 Tab 显示 loading 占位（等后端自动衔接），不算「后端正在生成」。
  const insightsActive = isStageActive(insightsStatus)
  const insightPageActive = isStageActive(insightPageStatus)
  const insightGenerating = !initialLoadDone
    || (isBeingParsed && (insightsActive || insightPageActive))

  // 任何解析阶段处于 loading（pending/parsing/processing）→ 关闭「重新生成洞察」入口，
  // 包含转写 / 纪要 / 洞察 / 页面编排——后端任一步在跑都不该和重生成请求打架。
  // 同样保留 !initialLoadDone 的 race window 保护。
  const insightsActionable = isStageActionable(insightsStatus)
  const parseStatusRunning = !initialLoadDone
    || (isBeingParsed && !insightsActionable)
  useEffect(() => {
    onInsightStateChange?.({
      generating: insightGenerating,
      parseStatusRunning,
    })
  }, [insightGenerating, parseStatusRunning, onInsightStateChange])
  const showSummaryPending = !isLegacyData && (isStageActionable(meetingMinutesStatus) || isStageActionable(transcriptionStatus))

  // 音频播放 → 转写列表反向联动：按当前播放时间找出应高亮的转写项
  // （最后一个 seconds <= currentTime 的项）。transcriptList 变化时无需重建回调，
  // 用 ref 持有最新列表，让 AudioPlayerBar 的 timeupdate 事件不会因依赖变化而失效。
  const transcriptListRef = useRef(transcriptList)
  useEffect(() => {
    transcriptListRef.current = transcriptList
  }, [transcriptList])

  const handleAudioTimeUpdate = useCallback((currentTime: number) => {
    const list = transcriptListRef.current
    if (list.length === 0) return
    // 找最后一个 seconds <= currentTime 的项；list 已按 seconds 升序
    let activeIdx = -1
    for (let i = 0; i < list.length; i++) {
      if (list[i].seconds <= currentTime) activeIdx = i
      else break
    }
    if (activeIdx < 0) return
    const nextId = list[activeIdx].id
    setCurrentTranscriptId((prev) => (prev === nextId ? prev : nextId))
  }, [])

  // Tab 状态（含模板 tab 扩展 + 总结列表 tab）
  const {
    activeTab,
    setActiveTab,
    tabItems,
    templateTabItems,
    templateListModalRef,
    openTemplateList,
    removeSummaryTab,
  } = useTemplateTabs(fileSummaries, currentFile?.id, fileSummariesLoading)

  // 洞察 tab 划词：给 .insight-schema 容器挂 highlighter 库（与 MarkdownViewer 同款），
  // 浮层菜单由 highlighter 自带，菜单项通过 viewer-event { type: 'menu' } 注入。
  const insightContainerRef = useRef<HTMLDivElement | null>(null)
  const insightHighlighterRef = useRef<any>(null)
  useEffect(() => {
    if (activeTab !== 'insight') return
    const container = insightContainerRef.current?.querySelector('.insight-schema') as HTMLElement | null
    if (!container) return
    let destroyed = false
    let pendingViewerEvent: Event | null = null
    const onViewerEvent = (event: Event) => {
      const detail = (event as CustomEvent).detail
      const inst = insightHighlighterRef.current
      if (!inst) {
        pendingViewerEvent = event
        return
      }
      if (detail?.type === 'menu') {
        const slideItems = (detail.data || []).map((item: any) => ({
          logo: item.logo,
          label: item.name,
          handler: (e: any) => {
            window.dispatchEvent(
              new CustomEvent('quick-command', {
                detail: { name: item.name, prompt: item.content, text: e.text },
              }),
            )
          },
        }))
        try {
          inst.updateMenuItems?.(slideItems, copyItem)
        } catch (e) {
          // ignore
        }
      }
      if (detail?.type === 'auto-select-enabled') {
        try { inst.updateAutoSelectEnabled?.(detail.data) } catch {}
      }
    }
    window.addEventListener('viewer-event', onViewerEvent)
    loadLib('highlighter')
      .then(() => {
        if (destroyed || !window.TextHighlighter) return
        if (insightHighlighterRef.current) {
          try { insightHighlighterRef.current.destroy() } catch {}
        }
        insightHighlighterRef.current = new window.TextHighlighter({
          container,
          enableAutoHighlight: false,
          enableManualHighlight: true,
          forceVirtualMode: true,
          menuItems: [copyItem],
          onSelectionChange: (text: string) => {
            window.dispatchEvent(new CustomEvent('selection-change', { detail: { text } }))
          },
        })
        insightHighlighterRef.current.init()
        if (pendingViewerEvent) {
          onViewerEvent(pendingViewerEvent)
          pendingViewerEvent = null
        }
      })
      .catch(() => {
        // ignore
      })
    return () => {
      destroyed = true
      window.removeEventListener('viewer-event', onViewerEvent)
      if (insightHighlighterRef.current) {
        try { insightHighlighterRef.current.destroy() } catch {}
        insightHighlighterRef.current = null
      }
    }
  }, [activeTab, insightPageJson])

  // 切换文件时重置 activeTab 到 insight

  // 正在创建的模板 id（防重复点击；返回后清空）
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(null)
  // 异步模式下需要轮询状态的总结 ID 集合
  const [pollingSummaryIds, setPollingSummaryIds] = useState<Set<string>>(new Set())

  // 切换文件时重置本地状态
  useEffect(() => {
    setCreatingTemplateId(null)
    setPollingSummaryIds(new Set())
  }, [currentFile?.id])

  // 切 tab / slide commands / insightPageJson 变化时重派发 viewer-event：让新挂载的
  // MarkdownViewer / 洞察 highlighter 能立即收到菜单项注入。MarkdownViewer 卸载时会清掉
  // highlighter 和 eventCallbackRef（MarkdownViewer.tsx:180-196），重建后必须重新注入菜单。
  // 关键：insightPageJson 变化也会触发上面 highlighter 初始化 effect 重建 highlighter，
  // 不在依赖里加 insightPageJson 会导致重建后的新 highlighter 拿不到 slideCommands 菜单项，
  // 用户划词只能看到"复制"按钮，要靠反复切 tab 才能重新派发。
  // AI 助手未开启时只传空菜单，划词菜单只保留"复制"基础能力。
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('viewer-event', {
        detail: { type: 'menu', data: assistantInstall ? slideCommands : [] },
      }),
    )
  }, [activeTab, slideCommands, insightPageJson, assistantInstall])

  // MarkdownViewer 是 lazy 组件，首次切到纪要/模板 tab 时模块还在异步加载，
  // 上面 effect 派发的 viewer-event 在 MarkdownViewer 监听注册前就发出去了，
  // eventCallbackRef 又是 mount 时清空的，导致菜单只剩"复制"。
  // 监听 highlighter-ready 后重新派发，覆盖 MarkdownViewer 的 lazy 加载窗口。
  // AI 助手未开启时只传空菜单。
  useEffect(() => {
    const onHighlighterReady = () => {
      window.dispatchEvent(
        new CustomEvent('viewer-event', {
          detail: { type: 'menu', data: assistantInstall ? slideCommands : [] },
        }),
      )
    }
    window.addEventListener('highlighter-ready', onHighlighterReady)
    return () => {
      window.removeEventListener('highlighter-ready', onHighlighterReady)
    }
  }, [slideCommands, assistantInstall])


  // 选择模板 → 添加 tab + 调用生成总结 API
  // 选择模板 → 调生成总结 API，接口返回后再展示 tab
  const handleTemplateSelect = useCallback(
    async (template: TemplateItem) => {
      const fileId = currentFile?.id
      if (!fileId) return
      if (creatingTemplateId) return
      // 同一模板已生成过则不重复
      if (fileSummaries?.some((s) => String(s.template_id) === String(template.id))) {
        message.info('该模板已生成')
        return
      }

      setCreatingTemplateId(template.id)
      try {
        const result = await recordingApi.createFileSummary(fileId, template.id)
        // 同步到 fileSummaries，sum-* tab 自然出现
        updateSummary(result)
        if (result.status === STAGE_STATUS.Processing) {
          setPollingSummaryIds((prev) => new Set(prev).add(result.id))
        }
        // 关闭 Modal 并切到新生成的 sum-* tab
        templateListModalRef.current?.close()
        setActiveTab(`sum-${result.id}`)
      } catch (e: any) {
        message.error(e?.message || '生成总结失败')
      } finally {
        setCreatingTemplateId(null)
      }
    },
    [currentFile?.id, updateSummary, setActiveTab, creatingTemplateId, fileSummaries],
  )

  // 加载完成后扫描 fileSummaries，识别仍处于 processing 状态的总结并加入轮询
  // （例如页面刷新后，之前还在生成中的总结需要继续轮询）
  useEffect(() => {
    if (!fileSummaries || fileSummaries.length === 0) return
    const processingIds = fileSummaries
      .filter((s) => s.status === STAGE_STATUS.Processing)
      .map((s) => s.id)
    if (processingIds.length === 0) return
    setPollingSummaryIds((prev) => {
      const next = new Set(prev)
      processingIds.forEach((id) => next.add(id))
      return next
    })
  }, [fileSummaries])

  // 轮询所有 processing 状态的总结：状态变为 completed/failed 时停止轮询
  // 仅以「是否有任务」为启停条件，避免每条 summary 达到终态都重启 setInterval
  const pollingIdsRef = useRef<Set<string>>(pollingSummaryIds)
  pollingIdsRef.current = pollingSummaryIds

  useEffect(() => {
    const hasTask = pollingSummaryIds.size > 0
    if (!hasTask) return
    let cancelled = false

    const pollOnce = async () => {
      if (cancelled) return
      const ids = Array.from(pollingIdsRef.current)
      if (ids.length === 0) return
      await Promise.allSettled(
        ids.map(async (id) => {
          try {
            const detail = await recordingApi.getSummaryDetail(id)
            if (cancelled) return
            // 回填 fileSummaries 列表（sum-* tab 内容）
            updateSummary(detail)
            // 终态：停止轮询。旧版本接口可能不返回 status，视为 completed
            const detailStatus = detail.status ?? STAGE_STATUS.Completed
            if (isStageDone(detailStatus) || detailStatus === STAGE_STATUS.Failed) {
              if (cancelled) return
              setPollingSummaryIds((prev) => {
                const next = new Set(prev)
                next.delete(id)
                return next
              })
            }
          } catch (e) {
            // 单次失败不中断其他 summary 的轮询；已卸载场景不输出日志
            if (cancelled) return
            console.warn('[summary poll] getSummaryDetail failed', e)
          }
        }),
      )
    }

    pollOnce()
    const timer = setInterval(pollOnce, SUMMARY_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [pollingSummaryIds.size > 0, updateSummary])

  // ── 洞察生成完成 → 更新左侧列表描述文本 ──
  useInsightDescriptionUpdate({
    file: currentFile,
    insightPageStatus,
    insightsStatus,
    insightPageJson,
    insightSummary,
    onUpdate: onDescriptionUpdate,
  })

  // ── 纪要完成 → 刷新列表获取最新文件名 ──
  useMeetingMinutesRename({
    file: currentFile,
    status: meetingMinutesStatus,
    onRename: onMeetingMinutesRename,
  })

  // ── 导出/下载：把当前数据透传给 useExport，父级通过 ref 调用 ──
  const exportApi = useExport({
    file: currentFile as any,
    insightSummary,
    insightPageJson,
    fileSummaries,
    transcriptList,
    stageStatuses,
  })

  // ── 把导出入口和动态菜单项通过 ref 暴露给父级（RecordingPreview） ──
  useImperativeHandle(
    ref,
    () => ({
      exportItem: exportApi.exportItem,
      getExportMenuItems: () => {
        const prefix = t('recording.export.template_prefix')
        const templateItems: MenuItem[] = (fileSummaries || [])
          .filter((s) => String(s.template_id) !== '0')
          .map((s) => ({
            key: `export-${s.id}`,
            icon: 'notes',
            label: `${prefix}${s.template_name}`,
          }))
        return [
          { key: 'export-audio', icon: 'audio-file', label: t('recording.export.audio') },
          { key: 'export-insight', icon: 'doc-search', label: t('recording.export.insight') },
          { key: 'export-summary', icon: 'notebook-one', label: t('recording.export.summary') },
          { key: 'export-transcript', icon: 'doc-success', label: t('recording.export.transcript') },
          ...templateItems,
        ]
      },
      // 只返回模板总结（template_id !== 0），纪要（template_id === 0）走独立的 's' chip
      getFileSummaries: () => (fileSummaries || []).filter((s) => String(s.template_id) !== '0'),
      startInsightRegeneration,
    }),
    [exportApi.exportItem, fileSummaries, startInsightRegeneration],
  )

  // ── 继续生成（补跑失败的步骤） ──
  const [generating, setGenerating] = useState(false)
  // 重新生成
  const handleStartGenerate = useCallback(async () => {
    // 只读模式（如分享页）不允许触发写入操作
    if (readOnly) return
    const fileId = currentFile?.id
    if (!fileId || generating) return
    setGenerating(true)
    try {
      if (isStageFailed(transcriptionStatus)) {
        // 覆盖生成（重新转写 + 重新生成全部）
        await ragJobApi.batchRetry({
          run: {
            related_id: fileId,
          },
          jobs: [
            { step_key: "document_parsing" },
            { step_key: "document_chunking" },
            { step_key: "vector_indexing" },
          ]
        })
      } else {
        // 转写成功但后续步骤失败 → 继续生成（不重新转写）
        const result = await recordingApi.pipeline(fileId)
        if (result.meeting_minutes === STAGE_STATUS.Skipped && result.insights === STAGE_STATUS.Skipped && result.insight_page === STAGE_STATUS.Skipped) {
          // 所有步骤已完成，无需重新生成
          return
        }
      }
      // 重置失败状态，让轮询继续
      resetFailed()
    } catch (e: any) {
      message.error(e?.message || '继续生成失败，请稍后重试')
    } finally {
      setGenerating(false)
    }
  }, [currentFile?.id, generating, resetFailed, readOnly])

  // 关闭总结 tab（二次确认弹窗）—— tab 全部来自后端 fileSummaries
  const handleCloseTab = useCallback(
    (e: React.MouseEvent, isActive: boolean, tplId: string, label: string) => {
      // 只读模式不允许删除
      if (readOnly) return
      e.stopPropagation()
      Modal.confirm({
        title: '确认删除',
        content: `确定要删除模板'${label}'吗`,
        okText: '确定',
        cancelText: '取消',
        centered: true,
        onOk: () => {
          if (isActive) setActiveTab('insight')
          recordingApi.deleteSummary(tplId).then(() => {
            removeSummaryTab(tplId)
            message.success('已删除')
          }).catch((err) =>
            message.error(err?.message || '删除总结失败'),
          )
        },
      })
    },
    [setActiveTab, removeSummaryTab, readOnly],
  )

  return (
    <div className={`flex-1  min-h-0 flex flex-col ${ activeTab === 'insight' ? 'bg-[#FAFBFC]' : 'bg-white' } overflow-hidden`}>
      <div className="w-4/5 mx-auto relative">
        {/* Top Tabs */}
        <div className="py-2.5 ">
          <Tabs
            variant="underline"
            activeKey={activeTab}
            onChange={(key) => setActiveTab(key)}
            prefixItems={tabItems.map((t) => ({ key: t.key, label: t.label }))}
            items={[]}
            divider={
              templateTabItems.length > 0 ? (
                <div className="flex-none h-4 w-px bg-[#E6E8EB] mx-1" />
              ) : null
            }
            extra={
              <>
                {templateTabItems.map((t) => {
                  const isActive = activeTab === t.key
                  const tplId = t.key.slice('sum-'.length)
                  // 加载中 = 首次拉取/异步模式下正在轮询
                  const tabSummary = fileSummaries?.find((s) => s.id === tplId)
                  const isPolling = tabSummary?.status === STAGE_STATUS.Processing && pollingSummaryIds.has(tabSummary.id)
                  const isLoading = fileSummariesLoading || isPolling
                  return (
                    <div
                      key={t.key}
                      className={`relative px-4 h-[52px] flex items-center text-xl cursor-pointer whitespace-nowrap group/tab ${
                        isActive
                          ? 'text-[#2563EB]'
                          : 'text-[#4F5052] hover:text-[#2563EB]'
                      }`}
                      onClick={() => setActiveTab(t.key)}
                    >
                      {t.label}
                      {isActive && (
                        <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-[#2563EB] rounded-full" />
                      )}
                      {!isLoading && !readOnly && (
                        <span
                          className="absolute -top-0 -right-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-xs text-[#999] bg-[#F0F0F0] opacity-0 group-hover/tab:opacity-100 transition-opacity duration-150 cursor-pointer"
                          onClick={(e) => handleCloseTab(e, isActive, tplId, t.label)}
                        >
                          <CloseCircleFilled style={{ fontSize: '16px'}} />
                        </span>
                      )}
                    </div>
                  )
                })}
                {!readOnly && (
                  <div
                    className="flex items-center justify-center cursor-pointer rounded text-primary ml-2 px-2"
                    onClick={openTemplateList}
                  >
                    <PlusOutlined />
                  </div>
                )}
              </>
            }
          />
        </div>

        <TemplateListModal
          ref={templateListModalRef}
          templates={templates}
          categories={templateCategories}
          actionMode="add"
          onAction={handleTemplateSelect}
          title="AI模板"
          hideAdminControls
        />
      </div>
      {/* Main Content Area */}
      {activeTab === 'insight' ? (
        <div
          ref={insightContainerRef}
          className="flex-1 py-2 overflow-hidden"
          style={{ contentVisibility: 'auto', containIntrinsicSize: '500px' }}
        >
          <InsightTabContent
            noVoiceModel={noVoiceModel}
            showInsightPending={showInsightPending}
            isBeingParsed={isBeingParsed}
            stages={stageStatuses}
            insightSummary={insightSummary}
            insightPageJson={insightPageJson}
            insightPageApiDone={insightPageApiDone}
            initialLoadDone={initialLoadDone}
            generating={generating}
            onStartGenerate={readOnly ? undefined : handleStartGenerate}
            onRegenerateStarted={startInsightRegeneration}
          />
        </div>
      ) : activeTab === 'transcript' ? (
        <div className="flex-1 min-h-0 flex flex-col py-4">
          <div className="w-4/5 mx-auto">
            <AudioPlayerBar ref={audioPlayerRef} audioSrc={currentFile?.file_url ?? ''} onTimeUpdate={handleAudioTimeUpdate} />
          </div>
          {/* 转写 */}
          <TranscriptPanel
            transcriptList={transcriptList}
            currentTranscriptId={currentTranscriptId}
            onTranscriptClick={(item) => {
              setCurrentTranscriptId(item.id)
              audioPlayerRef.current?.seekToAndPlay(item.seconds)
            }}
            noVoiceModel={noVoiceModel}
            stages={stageStatuses}
            showTranscriptPending={showTranscriptPending}
            initialLoadDone={initialLoadDone}
            generating={generating}
            onStartGenerate={readOnly ? undefined : handleStartGenerate}
          />
        </div>
      ) : activeTab === 'summary' ? (
        <div className="flex-1 overflow-y-auto" style={{ contentVisibility: 'auto', containIntrinsicSize: '500px' }}>
          <SummaryTabContent
            noVoiceModel={noVoiceModel}
            showSummaryPending={showSummaryPending}
            isBeingParsed={isBeingParsed}
            stages={stageStatuses}
            fileSummaries={fileSummaries}
            initialLoadDone={initialLoadDone}
            generating={generating}
            onStartGenerate={readOnly ? undefined : handleStartGenerate}
          />
        </div>
      ) : activeTab.startsWith('sum-') ? (
        <div className="flex-1 overflow-y-auto">
          <TemplateSummaryTabContent
            activeTab={activeTab}
            fileSummaries={fileSummaries}
            templateTabItems={templateTabItems}
            fileSummariesLoading={fileSummariesLoading}
          />
        </div>
      ) : null }
    </div>
  )
})

export default AudioView
