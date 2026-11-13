import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Checkbox, Empty, Input, Modal, message } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import type { StageStatusBag, TranscriptItem } from '../../hooks/useFileParse'
import { ParsingPlaceholder, ParsingUnavailable, PendingPlaceholder, InsightLoadingPlaceholder, hasStageFailed, type ParsingStep } from './ParseStatusPlaceholder'
import { isStageLoading } from '../../constants/recordingStatus'
import { TranscriptSpeakerAvatar, isBoundSpeaker, speakerTone } from './TranscriptSpeakerAvatar'

interface TranscriptPanelProps {
  /** 转写列表 */
  transcriptList: TranscriptItem[]
  /** 当前选中的转写项 ID */
  currentTranscriptId: string
  /** 点击转写项回调 */
  onTranscriptClick: (item: TranscriptItem) => void
  /** 无语音模型 */
  noVoiceModel: boolean
  /** 各阶段完整 stage 状态包（含 status/error_type 等） */
  stages: StageStatusBag
  /** 是否显示转写等待触发 */
  showTranscriptPending: boolean
  /** 首次加载（切文件）是否已完成 — 未完成时一律展示 loading */
  initialLoadDone: boolean
  /** 是否正在生成 */
  generating: boolean
  /** 开始生成回调；只读模式（分享页）下不传，按钮会被隐藏 */
  onStartGenerate?: () => void
  /**
   * 点击某行的「关联」按钮：在右侧 Flutter 面板打开该说话人的关联抽屉
   * （参数为该行说话人）。不传（分享页等只读场景）时不渲染行内关联按钮。
   */
  onOpenSpeakerBind?: (speaker: string) => void
  /**
   * 限制 ParsingPlaceholder 渲染的步骤集合；
   * 库视图等不展示洞察 Tab 的场景可传 `['transcript','summary']`，
   * 避免进度面板与 Tab 列表展示不一致。不传时走 ParsingPlaceholder 默认全量行为。
   */
  visibleSteps?: ReadonlyArray<ParsingStep>
}

export function TranscriptPanel({
  transcriptList,
  currentTranscriptId,
  onTranscriptClick,
  noVoiceModel,
  stages,
  showTranscriptPending,
  initialLoadDone,
  generating,
  onStartGenerate,
  onOpenSpeakerBind,
  visibleSteps,
}: TranscriptPanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // 重命名说话人弹窗
  const [renameTarget, setRenameTarget] = useState<TranscriptItem | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [syncAll, setSyncAll] = useState(false)

  const openRename = (item: TranscriptItem) => (e: MouseEvent) => {
    return false
    e.stopPropagation()
    setRenameValue(item.speaker || '')
    setSyncAll(false)
    setRenameTarget(item)
  }

  const handleRenameConfirm = () => {
    const next = renameValue.trim()
    if (!next) {
      message.warning('名称不能为空')
      return
    }
    // TODO: 后端接口待接入；当前仅前端模拟
    const oldName = renameTarget?.speaker || '该说话人'
    message.success(`已重命名为「${next}」${syncAll ? `，已同步「${oldName}」的全部发言` : ''}`)
    setRenameTarget(null)
  }

  // 音频反向联动：currentTranscriptId 变化时把对应项滚到可视区域
  // 用 block: 'nearest' 避免在用户主动滚动时被强制拉走；未变化或无 ID 时不触发
  useEffect(() => {
    if (!currentTranscriptId) return
    const container = scrollContainerRef.current
    if (!container) return
    const activeEl = container.querySelector(`[data-transcript-id="${currentTranscriptId}"]`)
    if (activeEl && 'scrollIntoView' in activeEl) {
      (activeEl as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [currentTranscriptId])

  return (
    <div ref={scrollContainerRef} className="flex-1 overflow-y-auto" style={{ contentVisibility: 'auto', containIntrinsicSize: '500px' }}>
      <div className="max-w-[1200px] mx-auto">
        {(() => {
          if (noVoiceModel) return <ParsingUnavailable />
          // 切换文件瞬间转写列表为空，先展示 loading
          if (!initialLoadDone) return <InsightLoadingPlaceholder />
          const transStatus = stages.transcription?.status ?? ''
          const transLoading = isStageLoading(transStatus)
          // 转写已有内容 → 优先展示内容（即使后置阶段失败也不盖掉）
          if (transcriptList.length > 0) {
            return (
              <div className="py-4 flex flex-col">
                {transcriptList.map((item) => {
                  const speakerLabel = item.speaker || ''
                  const isActive = currentTranscriptId === item.id
                  const nameColor = isBoundSpeaker(item) ? '' : speakerTone(item).name
                  return (
                    <div
                      key={item.id}
                      data-transcript-id={item.id}
                      className={`group cursor-pointer px-4 py-3 rounded-xl transition-colors duration-200 hover:bg-[#F0F3FA] ${isActive ? 'bg-[#F0F3FA]' : ''}`}
                      onClick={() => onTranscriptClick(item)}
                    >
                      {/* 头像颜色与分享页同源，绑定后仍使用人员头像。 */}
                      <div className="flex items-start gap-3">
                        <span
                          className="shrink-0 inline-flex cursor-pointer"
                          onClick={openRename(item)}
                        >
                          <TranscriptSpeakerAvatar item={item} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center mb-1.5 text-sm text-[#1D1E1F]">
                            <span className={`select-none cursor-pointer hover:text-[#2563EB] ${nameColor}`} onClick={openRename(item)}>
                              {speakerLabel}
                            </span>
                            <span className="select-none mx-2">|</span>
                            <span className="text-[13px] font-mono mr-2 select-none">{item.time}</span>
                            {isActive && (
                              <span className="ml-2 w-6 h-[18px] bg-[#E6EDFF] rounded inline-flex items-center justify-center">
                                <SvgIcon name="align-bottom-two-filled" color="#2563EB" size={14} />
                              </span>
                            )}
                            {/* 关联：对齐 Flutter 行内「🔗 关联」按钮，hover 本行才
                                出现（group-hover），点击在右侧 Flutter 面板打开该
                                说话人的关联抽屉；stopPropagation 避免触发整行跳播。 */}
                            {onOpenSpeakerBind && (
                              <span
                                className="ml-2 inline-flex cursor-pointer items-center gap-0.5 rounded text-[12.5px] font-medium text-[#2563EB] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onOpenSpeakerBind(item.speaker || '')
                                }}
                              >
                                <SvgIcon name="link-two" size={14} />
                                关联
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-[#4F5052] leading-[1.85] whitespace-pre-wrap break-words text-justify">
                            {item.content}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          }
          // 转写阶段失败 → 展示错误态（仅看本阶段，不被后置阶段拖累）
          if (hasStageFailed(stages, ['transcription'])) {
            return (
              <div className="flex flex-col items-center justify-center h-[76vh] ">
                <ParsingPlaceholder stages={stages} visibleSteps={visibleSteps} onStart={onStartGenerate} loading={generating} />
              </div>
            )
          }
          if (showTranscriptPending) {
            return (
              <div className="flex flex-col items-center justify-center h-[76vh] ">
                <PendingPlaceholder activeStep="transcript" onStart={onStartGenerate} loading={generating} />
              </div>
              )
          }

          if (transLoading) {
            return (
              <div className="flex flex-col items-center justify-center h-[76vh] ">
                <ParsingPlaceholder stages={stages} visibleSteps={visibleSteps} />
              </div>
              )
          }
          return (
            <div className="flex flex-col items-center justify-center h-[76vh] ">
              <Empty description="暂无文字稿" />
            </div>
          )
        })()}
      </div>

      {/* 重命名说话人 */}
      <Modal
        title="重命名"
        open={!!renameTarget}
        onOk={handleRenameConfirm}
        onCancel={() => setRenameTarget(null)}
        okText="确定"
        cancelText="取消"
        destroyOnClose
      >
        <Input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value.slice(0, 50))}
          maxLength={50}
          showCount
          placeholder="请输入说话人名称"
          autoFocus
        />
        <Checkbox
          className="mt-3"
          checked={syncAll}
          onChange={(e) => setSyncAll(e.target.checked)}
        >
          同步至所有 {renameTarget?.speaker || '该说话人'}
        </Checkbox>
      </Modal>
    </div>
  )
}

export default TranscriptPanel
