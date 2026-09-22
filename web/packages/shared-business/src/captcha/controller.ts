/**
 * 图形验证码（人机校验）命令式控制器
 *
 * 用于在「发送短信验证码」前强制人机校验，见《短信验证码图形人机校验-前端对接文档》。
 * 调用方只需 `await runWithCaptcha(attempt)`，弹窗由 `<CaptchaModal />` 全局挂载（App 根部）渲染。
 *
 * 两条与后端约定强相关的规则：
 * 1. 「阅后即焚」：服务端对每个 captcha_id 只校验一次（无论对错），所以每次打开弹窗、
 *    以及每次校验失败都会重新拉取 GET /api/captcha，调用方严禁缓存 CaptchaResult 复用；
 * 2. 「报错不关弹窗」：POST /api/sms/sendcode 失败时弹窗保持打开，用户可直接重新输入，
 *    不必经历「关窗 - 重开 - 重新看图」的跳变。
 */

/** 一次图形验证码校验的结果 */
export interface CaptchaResult {
  /** 从 GET /api/captcha 获取的唯一凭据 ID */
  captcha_id: string
  /** 用户输入的 4 位字符 */
  captcha_answer: string
}

/** 用户主动关闭弹窗（或弹窗未挂载）时的拒绝标识 */
export const CAPTCHA_CANCELED = 'captcha-canceled'

/** 图形验证码有效期，与后端 Redis TTL 保持一致（文档：5 分钟） */
export const CAPTCHA_TTL_MS = 5 * 60 * 1000

/** 判断是否为「用户取消校验」导致的失败，调用方据此静默处理 */
export function isCaptchaCanceled(error: unknown): boolean {
  return error === CAPTCHA_CANCELED
}

/** 判断接口失败是否由图形验证码引起（答案错误 / 已过期 / 未携带） */
export function isCaptchaError(error: unknown): boolean {
  const typed = error as { response?: { data?: { message?: string } }; message?: string }
  const message: string = typed?.response?.data?.message || typed?.message || ''
  return /captcha/i.test(message)
}

/** 弹窗内需要提示的失败类型 */
export type CaptchaFailReason = 'captcha' | 'other'

/** 弹窗需要向控制器提供的能力，由 <CaptchaModal /> 挂载时注册 */
export interface CaptchaModalHandlers {
  /** 打开弹窗并重置内部状态（同时拉取一张新图） */
  open: () => void
  /** 关闭弹窗并清空内部状态 */
  close: () => void
  /**
   * 保持弹窗打开并提示失败：
   * - 'captcha'：图形验证码错误/过期，需换一张新图并清空输入
   * - 'other'：其他发送失败，保留原图与输入，用户可直接重试
   */
  fail: (reason: CaptchaFailReason) => void
  /** 同步「正在发送」加载态 */
  setSubmitting: (submitting: boolean) => void
}

interface PendingTask {
  attempt: (captcha: CaptchaResult) => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  submitting: boolean
}

let pending: PendingTask | null = null
let handlers: CaptchaModalHandlers | null = null

/** 由 <CaptchaModal /> 在挂载/卸载时注册与注销弹窗能力 */
export function registerCaptchaModal(next: CaptchaModalHandlers | null): void {
  handlers = next
}

/** 放弃当前等待中的校验（用于卸载、或新的请求覆盖旧的请求） */
export function rejectPendingCaptcha(reason: unknown = CAPTCHA_CANCELED): void {
  if (!pending) return
  const current = pending
  pending = null
  current.reject(reason)
}

/**
 * 打开图形验证码弹窗，完成人机校验并执行 attempt（通常是发送短信请求）。
 *
 * 弹窗会一直保持打开，直到 attempt 成功（自动关闭并 resolve）或用户主动取消
 * （以 CAPTCHA_CANCELED 拒绝）。attempt 抛出的错误不会向外传递——接口报错时
 * 弹窗只做提示与换图，由用户决定继续重试还是取消。
 */
export function runWithCaptcha<T>(attempt: (captcha: CaptchaResult) => Promise<T>): Promise<T> {
  // 上一次校验若仍未结束，先取消，避免 Promise 悬挂
  rejectPendingCaptcha()

  if (!handlers) return Promise.reject(CAPTCHA_CANCELED)

  return new Promise<T>((resolve, reject) => {
    pending = {
      attempt: attempt as (captcha: CaptchaResult) => Promise<unknown>,
      resolve: resolve as (value: unknown) => void,
      reject,
      submitting: false
    }
    handlers?.open()
  })
}

/** 由弹窗在用户点击「确认」时调用：执行 attempt，并按结果决定弹窗去留 */
export async function submitCaptcha(captcha: CaptchaResult): Promise<void> {
  const task = pending
  if (!task || task.submitting || !handlers) return

  task.submitting = true
  handlers.setSubmitting(true)

  try {
    const result = await task.attempt(captcha)
    if (pending !== task) return
    pending = null
    handlers.close()
    task.resolve(result)
  } catch (error) {
    // 已被取消或替换：不再操作弹窗
    if (pending !== task) return
    task.submitting = false
    handlers.setSubmitting(false)
    // 接口报错时弹窗不关闭，只刷新图片/提示，等用户再次输入
    handlers.fail(isCaptchaError(error) ? 'captcha' : 'other')
  }
}
