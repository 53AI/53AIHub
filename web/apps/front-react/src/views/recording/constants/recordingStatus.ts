/**
 * 录音解析各阶段 status 取值与判定谓词。
 *
 * 各阶段共享同一组字符串状态值，集中在此处便于：
 * 1. 后端重命名时只改一处；
 * 2. UI 各处对状态的判定保持一致；
 * 3. 类型约束避免拼写错误。
 */

/** 解析阶段 status 字符串取值 */
export const STAGE_STATUS = {
  Completed: 'completed',
  Normal: 'normal',
  Pending: 'pending',
  Parsing: 'parsing',
  Processing: 'processing',
  Failed: 'failed',
  Disabled: 'disabled',
  Skipped: 'skipped',
} as const

export type StageStatusValue = typeof STAGE_STATUS[keyof typeof STAGE_STATUS]

/** 已完成（含旧数据 normal） */
export function isStageDone(status: string): boolean {
  return status === STAGE_STATUS.Completed || status === STAGE_STATUS.Normal
}

/** 解析中：transcription（pending/parsing）与其他阶段（pending/processing）合并 */
export function isStageLoading(status: string): boolean {
  return status === STAGE_STATUS.Pending
    || status === STAGE_STATUS.Parsing
    || status === STAGE_STATUS.Processing
}

/** 未开始（仅 pending） */
export function isStagePending(status: string): boolean {
  return status === STAGE_STATUS.Pending
}

/**
 * 真正"活跃"（parsing 或 processing），已离开 pending 队列。
 *
 * 与 isStageLoading 的区别：loading 包含 pending，用于判断"是否需要展示进度占位"；
 * active 仅包含真正在跑的阶段，用于步骤指示器中"应显示旋转加载"的判定，
 * 避免把"还在队列里等待前一步"的 pending 误标为进行中。
 */
export function isStageActive(status: string): boolean {
  return status === STAGE_STATUS.Parsing || status === STAGE_STATUS.Processing
}

/** 失败：含 disabled（转录阶段专用值，统一视为失败态） */
export function isStageFailed(status: string): boolean {
  return status === STAGE_STATUS.Failed || status === STAGE_STATUS.Disabled
}

/** 严格失败：仅 failed，不含 disabled */
export function isStageFailedOnly(status: string): boolean {
  return status === STAGE_STATUS.Failed
}

/**
 * 阶段是否可由用户操作（点击重试）
 * - failed / disabled → true
 * - 其余状态（含 pending、queue 中）→ false，由后端自动衔接
 */
export function isStageActionable(status: string): boolean {
  return isStageFailed(status)
}