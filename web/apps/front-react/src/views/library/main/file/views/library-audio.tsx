import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { message } from 'antd'
import { Tabs } from '@km/shared-components-react'
import { useLibraryStore } from '@/stores/modules/library'
import recordingApi from '@/api/modules/recording'
import ragJobApi from '@/api/modules/rag-job'
import type { FileItem } from '@/api/modules/files/types'
import { useFileParse } from '@/views/recording/hooks/useFileParse'
import { useTemplateTabs } from '@/views/recording/hooks/useTemplateTabs'
import {
  isStageActionable,
  isStageFailed,
  STAGE_STATUS,
} from '@/views/recording/constants/recordingStatus'
import { SummaryTabContent } from '@/views/recording/components/preview/SummaryTabContent'
import { TemplateSummaryTabContent } from '@/views/recording/components/preview/TemplateSummaryTabContent'
import { TranscriptPanel } from '@/views/recording/components/audio/TranscriptPanel'
import { AudioPlayerBar, type AudioPlayerBarHandles } from '@/views/recording/components/audio/AudioPlayerBar'
import type { ParsingStep } from '@/views/recording/components/audio/ParseStatusPlaceholder'

/**
 * LibraryAudioView —— 库视图 mp3 文件展示
 *
 * 顶部外壳（标题 / 收藏 / 分享 / 全屏 / 更多）由 `library/main/file/index.tsx`
 * 顶层 LibraryHeader 统一提供，本组件只渲染 Tab + 内容区。
 *
 * 库视图只显示「纪要 / 转写 / 撰写」三 Tab：
 * - 不显示「洞察」Tab
 * - 不挂 AI 助手（DocumentApp / AssistantBtn）
 * - 不调 useRecordingTemplates hook
 * - 不允许新增模板 / 删除总结 Tab
 * - 允许「开始生成 / 继续生成」（转写失败走 batchRetry，后续步骤失败走 pipeline）
 */
export function LibraryAudioView({ currentFile }: { currentFile: FileItem }) {
  // ── 转写交互
  const audioPlayerRef = useRef<AudioPlayerBarHandles>(null)
  const [currentTranscriptId, setCurrentTranscriptId] = useState('')

  // ── 库视图进度面板只渲染「转写 / 纪要」两步，与隐藏的「洞察」Tab 保持一致
  const libraryVisibleSteps: ReadonlyArray<ParsingStep> = ['transcript', 'summary']

  // ── 解析状态 hook（复用录音侧 useFileParse）
  // skipInsight: 库视图不展示洞察 Tab，不发 insight 相关 API（getInsightPage / filesApi.get 降级）
  const {
    transcriptList,
    fileSummaries,
    fileSummariesLoading,
    stageStatuses,
    initialLoadDone,
    resetFailed,
  } = useFileParse({
    fileId: currentFile?.id,
    // 与录音侧 AudioView 一致：useFileParse 自己拉 parseStatus（mount 时 1 次），
    // 之后若 trans / minutes 任一仍在 loading / 用户点击「开始生成」触发 resetFailed，轮询自动维持；
    // 全部完成或失败后轮询自动停止
    shouldPoll: true,
    initialFileData: currentFile as any,
    skipInsight: true,
  })

  // 提前 lift 出阶段 bag，下面 useCallback + 占位判断都会用
  const meetingMinutesStage = stageStatuses.meetingMinutes
  const transcriptionStage = stageStatuses.transcription
  const transcriptionStatus = transcriptionStage?.status ?? ''

  // ── 「开始生成 / 继续生成」按钮（与录音侧 AudioView 对齐）
  const [generating, setGenerating] = useState(false)
  const handleStartGenerate = useCallback(async () => {
    const fileId = currentFile?.id
    if (!fileId || generating) return
    setGenerating(true)
    try {
      if (isStageFailed(transcriptionStatus)) {
        // 转写失败：覆盖生成（重新转写 + 重新生成全部）
        await ragJobApi.batchRetry({
          run: { related_id: fileId },
          jobs: [
            { step_key: 'document_parsing' },
            { step_key: 'document_chunking' },
            { step_key: 'vector_indexing' },
          ],
        })
      } else {
        // 转写成功但后续步骤失败 → 继续生成（不重新转写）
        // 库视图不展示洞察 Tab，仅关心 meeting_minutes 阶段；
        // insights / insight_page 的状态可忽略
        const result = await recordingApi.pipeline(fileId)
        if (result.meeting_minutes === STAGE_STATUS.Skipped) {
          // 纪要阶段已完成，无需重新生成
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
  }, [currentFile?.id, generating, transcriptionStatus, resetFailed])

  // ── Tab 状态（含模板 Tab 扩展）
  const {
    activeTab,
    setActiveTab,
    tabItems: rawTabItems,
    templateTabItems,
  } = useTemplateTabs(fileSummaries, currentFile?.id, fileSummariesLoading)

  // ── 过滤掉「洞察」Tab：库视图只显示纪要 / 转写 / 撰写
  const tabItems = useMemo(
    () => rawTabItems.filter((it) => it.key !== 'insight'),
    [rawTabItems],
  )

  // ── 如果默认 activeTab 是 'insight'（useTemplateTabs 内部默认值），强制切到纪要
  useEffect(() => {
    if (activeTab === 'insight' && tabItems.length > 0) {
      setActiveTab(tabItems[0].key)
    }
  }, [activeTab, tabItems, setActiveTab])

  // 离开 LibraryAudioView 时清理 store 的 currentFileId
  useEffect(() => {
    return () => {
      useLibraryStore.setState({ currentFileId: '' })
    }
  }, [])

  // 同步 currentFile 到 library store（保持文件元数据最新）
  useEffect(() => {
    const rawData = currentFile as any
    const id = rawData?.id ?? currentFile.id
    if (!id) return
    useLibraryStore.setState((s) => {
      const next = {
        ...rawData,
        id,
        name: currentFile.name,
        icon: currentFile.icon,
        file_ext: currentFile.file_ext,
        file_mime: currentFile.file_mime,
        isfile: currentFile.isfolder === false,
        isfolder: currentFile.isfolder === true,
      }
      const idx = s.files.findIndex((f) => f.id === id)
      const files =
        idx >= 0
          ? s.files.map((f) => (f.id === id ? { ...f, ...next } : f))
          : [next, ...s.files]
      return { files, currentFileId: id }
    })
  }, [
    currentFile.id,
    currentFile.name,
    currentFile.icon,
    currentFile.file_ext,
    currentFile.file_mime,
    currentFile.isfolder,
  ])

  // 切文件时清空 transcript 高亮
  useEffect(() => {
    setCurrentTranscriptId('')
  }, [currentFile.id])

  // ── 转写反向联动：按 currentTime 找出应高亮的转写项
  const transcriptListRef = useRef(transcriptList)
  useEffect(() => {
    transcriptListRef.current = transcriptList
  }, [transcriptList])

  const handleAudioTimeUpdate = (currentTime: number) => {
    const list = transcriptListRef.current
    if (list.length === 0) return
    let activeIdx = -1
    for (let i = 0; i < list.length; i++) {
      if (list[i].seconds <= currentTime) activeIdx = i
      else break
    }
    if (activeIdx < 0) return
    const nextId = list[activeIdx].id
    setCurrentTranscriptId((prev) => (prev === nextId ? prev : nextId))
  }

  // ── stage 占位判断（与录音侧 AudioView 完全对齐：trust status，不查 pipeline 字段）
  // pipeline 字段存在滞后/不可靠情况（processing + pipeline=inactive 也表示后端在生成），
  // 所以仅靠 status ∈ {pending, parsing, processing} 判断「在生成中」
  const isStageActivelyRunning = (
    stage: { status?: string } | undefined,
  ) => {
    if (!stage) return false
    const s = stage.status ?? ''
    return (
      s === STAGE_STATUS.Pending ||
      s === STAGE_STATUS.Parsing ||
      s === STAGE_STATUS.Processing
    )
  }

  // 库视图本地 isBeingParsed：忽略 insights / insight_page（这两个 Tab 已隐藏）
  const isBeingParsedLibrary =
    isStageActivelyRunning(meetingMinutesStage) ||
    isStageActivelyRunning(transcriptionStage)

  // 需要用户触发生成：仅失败态（含 disabled）→ 让用户重试
  const isStageNeedingTrigger = (
    stage: { status?: string } | undefined,
  ) => {
    if (!stage) return false
    return isStageActionable(stage.status ?? '')
  }

  const showSummaryPending = isStageNeedingTrigger(meetingMinutesStage)
  const showTranscriptPending = isStageNeedingTrigger(transcriptionStage)

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-white overflow-hidden">
      <div className="w-4/5 mx-auto relative flex-none">
        {/* Top Tabs —— 库视图不含洞察，仅显示纪要 / 转写 / 撰写 */}
        <div className="py-2.5">
          <Tabs
            variant="underline"
            activeKey={activeTab}
            onChange={(key) => setActiveTab(key)}
            prefixItems={tabItems.map((it) => ({ key: it.key, label: it.label }))}
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
                    </div>
                  )
                })}
              </>
            }
          />
        </div>
      </div>

      {/* Main Content Area */}
      {activeTab === 'summary' ? (
        <div className="flex-1 overflow-y-auto" style={{ contentVisibility: 'auto', containIntrinsicSize: '500px' }}>
          <SummaryTabContent
            noVoiceModel={false}
            showSummaryPending={showSummaryPending}
            isBeingParsed={isBeingParsedLibrary}
            stages={stageStatuses}
            fileSummaries={fileSummaries}
            initialLoadDone={initialLoadDone}
            generating={generating}
            visibleSteps={libraryVisibleSteps}
            onStartGenerate={handleStartGenerate}
          />
        </div>
      ) : activeTab === 'transcript' ? (
        <div className="flex-1 min-h-0 flex flex-col py-4 overflow-hidden">
          <div className="w-4/5 mx-auto flex-none">
            <AudioPlayerBar
              ref={audioPlayerRef}
              audioSrc={currentFile?.file_url ?? ''}
              onTimeUpdate={handleAudioTimeUpdate}
            />
          </div>
          <TranscriptPanel
            transcriptList={transcriptList}
            currentTranscriptId={currentTranscriptId}
            onTranscriptClick={(item) => {
              setCurrentTranscriptId(item.id)
              audioPlayerRef.current?.seekToAndPlay(item.seconds)
            }}
            noVoiceModel={false}
            stages={stageStatuses}
            showTranscriptPending={showTranscriptPending}
            initialLoadDone={initialLoadDone}
            generating={generating}
            visibleSteps={libraryVisibleSteps}
            onStartGenerate={handleStartGenerate}
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
      ) : null}
    </div>
  )
}

export default LibraryAudioView