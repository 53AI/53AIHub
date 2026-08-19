import { useMemo } from 'react'
import { Button, Spin } from 'antd';
import { CheckCircleFilled, CloseCircleFilled, InfoCircleOutlined, LoadingOutlined, CloseOutlined } from "@ant-design/icons";
import { SvgIcon } from '@km/shared-components-react';
import type { ParseStageErrorType } from '@/api/modules/recording/types';
import type { StageStatusBag } from '../../hooks/useFileParse';
import {
  STAGE_STATUS,
  isStageDone,
  isStageLoading,
  isStageActive,
  isStageFailedOnly,
  isStagePending,
} from '../../constants/recordingStatus';

export type ParsingStep = 'transcript' | 'summary' | 'insight'

export const PARSING_STEPS: { key: ParsingStep; label: string }[] = [
  { key: 'transcript', label: '生成录音转写' },
  { key: 'summary', label: '生成录音纪要' },
  { key: 'insight', label: '生成录音洞察' },
]

/** 默认全部阶段对应的 stage key —— 不传 visibleSteps 时的最大集合 */
const ALL_STAGE_KEYS: ReadonlyArray<keyof StageStatusBag> = ['transcription', 'meetingMinutes', 'insights', 'insightPage']

/** ParsingStep → 它代表的 stage key 集合（insight = insights + insightPage 合并显示） */
function stageKeysForStep(step: ParsingStep): ReadonlyArray<keyof StageStatusBag> {
  if (step === 'transcript') return ['transcription']
  if (step === 'summary') return ['meetingMinutes']
  return ['insights', 'insightPage']
}

const STEP_TITLES: Record<ParsingStep, { parsing: string; pending: string; label: string, failedText: string }> = {
  transcript: { parsing: '生成录音转写中', pending: '是否生成录音转写？', label: '录音转写', failedText: '录音转写生成失败' },
  summary: { parsing: '生成录音纪要中', pending: '是否生成录音纪要？', label: '录音纪要', failedText: '录音纪要生成失败' },
  insight: { parsing: '生成录音洞察中', pending: '是否生成录音洞察？', label: '录音洞察', failedText: '录音洞察生成失败' },
}

/** error_type → 用户提示文案 */
const ERROR_TYPE_MESSAGES: Record<ParseStageErrorType, string> = {
  insufficient_balance: '模型不可用，请检查 API key 的可用性',
  api_key_invalid: 'API Key 无效，请检查配置',
  timeout: '请求超时，请重试',
  asr_failed: '语音识别失败，请重试',
  model_unavailable: '模型暂时不可用，请稍后重试',
}

export function getErrorTypeMessage(errorType?: ParseStageErrorType | string | null): string | null {
  if (!errorType) return null
  return ERROR_TYPE_MESSAGES[errorType as ParseStageErrorType] ?? null
}

/** 仅取 stage.status，便于在内部统一处理字符串状态 */
function getStageStatus(stage: { status?: string } | undefined): string {
  return stage?.status ?? ''
}

/**
 * 取当前激活的 step（按 visibleSteps 顺序，先失败、再加载中、再未完成）。
 * 不传 visibleSteps 时检查全部 4 个 stage key，等同于默认全量行为。
 * 让标题与进度列表共用同一收口，避免库视图进度面板错误展示 insight 步骤。
 */
function getActiveStep(
  statuses: StageStatusBag,
  visibleSteps: ReadonlyArray<ParsingStep> = PARSING_STEPS.map((s) => s.key),
): ParsingStep {
  // 失败阶段优先展示，让 title 与 error 来自同一阶段
  for (const step of visibleSteps) {
    if (stageKeysForStep(step).some((k) => isStageFailedOnly(getStageStatus(statuses[k])))) return step
  }
  // 加载中阶段（processing/parsing/pending 含义上一致：都在排队或执行中）
  for (const step of visibleSteps) {
    if (stageKeysForStep(step).some((k) => isStageLoading(getStageStatus(statuses[k])))) return step
  }
  // 未完成（pending / 还未拉到的）
  for (const step of visibleSteps) {
    if (stageKeysForStep(step).some((k) => !isStageDone(getStageStatus(statuses[k])))) return step
  }
  // 全部可见步骤都已完成 → 默认返回最后一个步骤作为占位文案，避免越界到不可见 step
  return visibleSteps[visibleSteps.length - 1]
}

/**
 * 重新解析占位组件
 */
export function PendingPlaceholder({ activeStep, onStart, loading }: { activeStep: ParsingStep; onStart?: () => void; loading?: boolean }) {
  const title = STEP_TITLES[activeStep].pending
  const label = STEP_TITLES[activeStep].label
  return (
    <div className="flex flex-col items-center justify-center h-full px-8">
      <div className="flex-none size-[60px] rounded-full border border-[#D1E0FF] bg-[#E3ECFF] flex items-center justify-center mb-4">
        <SvgIcon name="online-meeting" size={30} color="#2563EB" />
      </div>
      <h3 className="text-base font-medium text-primary mb-4">{title}</h3>
      <p className="text-sm text-secondary mb-4">预计需要1-3分钟生成{label}，请耐心等待</p>
      <div className="flex items-center gap-1 text-sm text-[#6B7280] mb-6">
        <InfoCircleOutlined />
        <span>退出页面不会中断分析</span>
      </div>
      {onStart && (
        <Button
          type="primary"
          icon={<SvgIcon name="explore" size={16} color="#fff" />}
          onClick={onStart}
          style={{ padding: '10px 20px', fontSize: '14px' }}
          size="large"
          loading={loading}
        >
          开始生成
        </Button>
      )}
    </div>
  )
}

/**
 * 检查 statuses 中是否有任一阶段失败 —— 仅 ParsingPlaceholder 内部使用。
 * 不传 allowedKeys 时扫描全部 4 个 stage key，保持默认全量行为（向后兼容）。
 */
export function hasFailedStatus(
  statuses: StageStatusBag,
  allowedKeys: ReadonlyArray<keyof StageStatusBag> = ALL_STAGE_KEYS,
): boolean {
  return hasStageFailed(statuses, allowedKeys)
}

/**
 * 检查指定阶段中是否有任一失败 —— Tab 应只关心自己的阶段，
 * 否则后置阶段（如 insight）失败会把前置阶段已有的内容（转写/纪要）盖掉。
 */
export function hasStageFailed(
  statuses: StageStatusBag,
  keys: ReadonlyArray<keyof StageStatusBag>,
): boolean {
  return keys.some((key) => isStageFailedOnly(getStageStatus(statuses[key])))
}

/** 取当前激活步骤对应的失败阶段（用于读取 error_type）。按 visibleSteps → stageKey 顺序查，与 getActiveStep 保持一致 */
function getActiveFailedStage(
  statuses: StageStatusBag,
  allowedKeys: ReadonlyArray<keyof StageStatusBag> = ALL_STAGE_KEYS,
) {
  for (const step of PARSING_STEPS.map((s) => s.key)) {
    for (const k of stageKeysForStep(step)) {
      if (!allowedKeys.includes(k)) continue
      if (isStageFailedOnly(getStageStatus(statuses[k]))) return statuses[k]
    }
  }
  return undefined
}

/**
 * 解析中占位组件 - 根据接口返回的解析状态显示各步骤进度
 *
 * 失败态会在底部追加"开始生成"按钮，便于用户重新触发失败步骤的补跑。
 */
export function ParsingPlaceholder({
  stages,
  onStart,
  loading,
  visibleSteps,
}: {
  stages: StageStatusBag
  /** 失败时点击按钮触发的回调（重新生成） */
  onStart?: () => void
  /** 按钮 loading 态（避免重复点击） */
  loading?: boolean
  /**
   * 限制展示的步骤；不传时按 PARSING_STEPS 全量渲染（向后兼容）。
   * 库视图等不展示洞察 Tab 的场景可传 `['transcript','summary']`，
   * 让标题与进度列表都不再提及 insight。
   */
  visibleSteps?: ReadonlyArray<ParsingStep>
}) {
  const stepsToRender = visibleSteps ?? PARSING_STEPS.map((s) => s.key)
  const allowedKeys = useMemo(
    () => stepsToRender.flatMap(stageKeysForStep),
    [stepsToRender],
  )
  const activeStep = getActiveStep(stages, stepsToRender)
  const failed = hasFailedStatus(stages, allowedKeys)
  const title = failed ? STEP_TITLES[activeStep].failedText : STEP_TITLES[activeStep].parsing
  // 失败时，从激活的失败阶段读取 error_type，映射为用户提示文案
  const errorMessage = failed ? getErrorTypeMessage(getActiveFailedStage(stages, allowedKeys)?.error_type) : null

  function getStatus (step: ParsingStep) {
    const insightCombined = (() => {
      const ins = getStageStatus(stages.insights)
      const page = getStageStatus(stages.insightPage)
      if (isStageFailedOnly(ins) || isStageFailedOnly(page)) return STAGE_STATUS.Failed
      // 仅当任一阶段真正在跑（parsing/processing）时合并为 Parsing；
      // 两个都是 pending（仅入队）时合并为 Pending，避免被当作"进行中"
      if (isStageActive(ins) || isStageActive(page)) return STAGE_STATUS.Parsing
      if (isStageDone(ins) && isStageDone(page)) return STAGE_STATUS.Completed
      return STAGE_STATUS.Pending
    })()

    const status = step === 'transcript'
      ? getStageStatus(stages.transcription)
      : step === 'summary'
      ? getStageStatus(stages.meetingMinutes)
      : insightCombined

    return status
  }

  /** 获取某一步骤的展示状态 */
  function getStepStatus(step: ParsingStep): { icon: React.ReactNode; textColor: string } {
    // "insight" 步骤 = insights + insight_page 的合并状态：
    // 任一失败 → failed；任一在 processing → parsing；
    // 两者都完成 → completed；其他（insights 完成但 insight_page 还在 pending，或两者都 pending）→ pending
    let status = getStatus(step)

    const prevIndex = PARSING_STEPS.findIndex(item => item.key == step)
    const prevStep = PARSING_STEPS[prevIndex - 1]

    if (isStagePending(status) && prevStep && isStageDone(getStatus(prevStep.key))) {
      status = STAGE_STATUS.Processing
    }

    if (isStageFailedOnly(status)) {
      return {
        icon: <CloseCircleFilled style={{ fontSize: 16, color: '#EF4444' }} />,
        textColor: 'text-[#EF4444]',
      }
    }
    if (isStageDone(status)) {
      return {
        icon: <CheckCircleFilled style={{ fontSize: 16, color: '#22C55E' }} />,
        textColor: 'text-primary',
      }
    }
    // 真正在跑（parsing/processing）→ 旋转加载；
    // 上面 pending + prevStep done 的"队列等待"升级也走这一分支。
    // 单纯的 pending（不在队列中或前一步未完成）→ 走默认空圆圈。
    if (isStageActive(status)) {
      return {
        icon: <LoadingOutlined style={{ fontSize: 16, color: '#2563EB' }} />,
        textColor: 'text-[#2563EB]',
      }
    }
    return {
      icon: <div className="size-4 rounded-full border-2 border-[#E5E6EB]" />,
      textColor: 'text-primary',
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-full px-8">
      <div className="flex-none size-[60px] rounded-full border border-[#D1E0FF] bg-[#E3ECFF] flex items-center justify-center mb-4">
          <SvgIcon name="online-meeting" size={24} color="#2563EB" />
      </div>
      <h3 className="text-base font-medium text-primary mb-4">{title}</h3>
      {failed && errorMessage ? (
        <p className="text-sm text-[#EF4444] mb-4 text-center">{errorMessage}</p>
      ) : (
        <p className="text-sm text-secondary mb-4">预计需要1-3分钟后生成AI决策，请耐心等待</p>
      )}
      <div className="flex items-center gap-1 text-sm text-[#6B7280] mb-6">
        <InfoCircleOutlined />
        <span>退出页面不会中断分析</span>
      </div>
      <div className="flex flex-col items-start gap-6">
        <div className="flex items-center gap-2">
          <CheckCircleFilled style={{ fontSize: 16, color: '#22C55E' }} />
          <span className="text-sm text-primary">上传录音文件</span>
        </div>
        {stepsToRender.map((key) => {
          const step = PARSING_STEPS.find((s) => s.key === key)!
          const { icon, textColor } = getStepStatus(step.key)
          return (
            <div key={step.key} className="flex items-center gap-2">
              {icon}
              <span className={`text-sm ${textColor}`}>
                {step.label}
              </span>
            </div>
          )
        })}
      </div>
      {failed && onStart && (
        <Button
          type="primary"
          icon={<SvgIcon name="explore" size={16} color="#fff" />}
          onClick={onStart}
          style={{ padding: '10px 20px', fontSize: '14px', marginTop: 24 }}
          size="large"
          loading={loading}
        >
          开始生成
        </Button>
      )}
    </div>
  )
}

/**
 * 洞察加载中占位组件 - 简单的居中 Spin
 */
export function InsightLoadingPlaceholder() {
  return (
    <div className="flex items-center justify-center h-full">
      <Spin size="large" />
    </div>
  )
}

/**
 * 模板生成中占位组件 - 与 ParsingPlaceholder 视觉一致，但只有一个步骤
 */
export function TemplateParsingPlaceholder({ templateName }: { templateName: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-8">
      <div className="flex-none size-[60px] rounded-full border border-[#D1E0FF] bg-[#E3ECFF] flex items-center justify-center mb-4">
        <SvgIcon name="online-meeting" size={24} color="#2563EB" />
      </div>
      <h3 className="text-base font-medium text-primary mb-4">生成{templateName}中</h3>
      <p className="text-sm text-secondary mb-4">
        预计需要1-3分钟生成{templateName}，请耐心等待
      </p>
      <div className="flex items-center gap-1 text-sm text-[#6B7280] mb-6">
        <InfoCircleOutlined />
        <span>退出页面不会中断分析</span>
      </div>
      <div className="flex flex-col items-start gap-6">
        <div className="flex items-center gap-2">
          <LoadingOutlined style={{ fontSize: 16, color: '#2563EB' }} />
          <span className="text-sm text-[#2563EB]">生成{templateName}</span>
        </div>
      </div>
    </div>
  )
}

/**
 * 音频解析不可用占位 - 无语音模型时展示
 */
export function ParsingUnavailable() {
  return (
    <div className="flex flex-col items-center justify-center h-full">
      <div className="flex-none size-[60px] rounded-full border border-[#eb8b8b] bg-[#fef2f2] flex items-center justify-center mb-6">
        <CloseOutlined style={{ fontSize: 20, color: '#ef4444' }} />
      </div>
      <h3 className="text-base font-medium text-[#1D1E1F] mb-2">音频解析不可用</h3>
      <p className="text-[#999999] text-sm mb-8 text-center max-w-sm">
        语音模型未配置，请重新联系管理员登录管理后台-能力中心-大模型接入重新配置
      </p>
    </div>
  )
}