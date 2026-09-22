/**
 * 图形验证码（人机校验）共享模块
 *
 * 提供三样东西：
 * 1. <CaptchaModal />：全局弹窗组件，App 根部挂载一次；
 * 2. runWithCaptcha() / isCaptchaCanceled()：业务侧在发送短信前唤起人机校验；
 * 3. captchaMessages / createCaptchaT()：文案包，供应用合并或独立使用。
 */
export { CaptchaModal } from './CaptchaModal'
export type { CaptchaModalProps, CaptchaImageData } from './CaptchaModal'
export { captchaMessages, createCaptchaT } from './locales'
export type { CaptchaLang } from './locales'
export {
  runWithCaptcha,
  isCaptchaCanceled,
  isCaptchaError,
  CAPTCHA_CANCELED,
  CAPTCHA_TTL_MS,
  registerCaptchaModal,
  rejectPendingCaptcha,
  submitCaptcha
} from './controller'
export type { CaptchaResult, CaptchaFailReason, CaptchaModalHandlers } from './controller'
