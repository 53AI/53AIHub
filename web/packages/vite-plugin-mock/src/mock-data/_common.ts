import type { MockRoute } from '../router'

const ok = (data: any) => ({ code: 0, message: 'ok', data })

const now = Math.floor(Date.now() / 1000)

export const mockVersion = () => ok({ version: 'v1.0.0-mock' })

export const mockEnvConfig = () => ok({ api_host: '', kk_base_url: '' })

export const mockEnterprisesCurrent = () => ({
  id: 1,
  display_name: 'Mock Enterprise',
  domain: 'http://localhost:5173',
  logo: '',
  ico: '',
  banner: '',
  slogan: 'AI Knowledge Management',
  description: 'Mock enterprise for development',
  copyright: '© 2025 Mock Enterprise',
  keywords: 'AI,Knowledge,Agent',
  language: 'Zh',
  timezone: 'UTC+8',
  template_type: 'default',
  layout_type: '1',
  type: 'enterprise',
  status: 1,
  created_time: now,
  updated_time: now,
})

export const mockEnterpriseFeatures = () => ({
  features: ['knowledge_base', 'agent', 'workflow', 'prompt_management'],
})

export const mockIsSaas = () => ok({ is_saas: false })

export const mockCheckAccount = () => ok({
  exists: true,
  related_id: 1,
  source: 'enterprise',
  type: 'username',
})

export const mockLogin = () => ok({
  access_token: 'mock-access-token-' + Date.now(),
  user_id: 1,
})

export const mockSaasLogin = () => ok({
  access_token: 'mock-access-token-' + Date.now(),
  user_id: 1,
  username: 'admin',
  nickname: 'Admin',
  is_new_user: false,
})

export const mockLogout = () => ok(null)

export const mockRegister = () => ok({ user_id: 1 })

export const mockResetPassword = () => ok(null)

// ==================== 图形验证码（人机校验）====================
// 对齐后端 /api/captcha 契约：4 位防混淆字符、5 分钟有效、阅后即焚。
// mock 用 SVG 占位图代替 PNG，图片里直接画出答案，方便本地联调。

const CAPTCHA_TTL = 5 * 60 * 1000
const CAPTCHA_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

const captchaStore = new Map<string, { code: string; expire: number }>()

function randomCaptchaCode(length = 4): string {
  let code = ''
  for (let i = 0; i < length; i++) {
    code += CAPTCHA_CHARS[Math.floor(Math.random() * CAPTCHA_CHARS.length)]
  }
  return code
}

function buildCaptchaImage(code: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="112" height="40" viewBox="0 0 112 40">` +
    `<rect width="112" height="40" fill="#F5F6F7"/>` +
    `<path d="M4 30 L108 10 M4 12 L108 28" stroke="#D8DCE0" stroke-width="1" fill="none"/>` +
    `<text x="56" y="28" font-family="monospace" font-size="22" font-weight="700" ` +
    `letter-spacing="5" text-anchor="middle" fill="#1D1E1F">${code}</text>` +
    `</svg>`
  return `data:image/svg+xml;base64,${btoa(svg)}`
}

function purgeExpiredCaptcha(): void {
  const nowMs = Date.now()
  for (const [key, value] of captchaStore) {
    if (value.expire <= nowMs) captchaStore.delete(key)
  }
}

export const mockCaptcha = () => {
  purgeExpiredCaptcha()

  const code = randomCaptchaCode()
  const captcha_id = `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`
  captchaStore.set(captcha_id, { code, expire: Date.now() + CAPTCHA_TTL })

  return ok({ captcha_id, image_base64: buildCaptchaImage(code) })
}

/** 灰度行为对齐后端：未携带验证码放行；携带了则核验，且本次调用后立即作废 */
export const mockSmsSendcode = (_req: unknown, _params: unknown, body: any) => {
  const captchaId = body?.captcha_id
  if (typeof captchaId === 'string' && captchaId) {
    const record = captchaStore.get(captchaId)
    captchaStore.delete(captchaId)

    const answer = String(body?.captcha_answer ?? '').trim().toLowerCase()
    if (!record || record.expire <= Date.now() || record.code.toLowerCase() !== answer) {
      return { __status: 400, __body: { code: 400, message: 'invalid or expired captcha', data: null } }
    }
  }

  return ok({})
}

export const mockSmsStatus = () => ok({ enabled: false })

export const mockSmsVerify = () => ok({ verified: true })

export const mockEmailSendVerification = () => ok({})

export const mockResponseCodes = () => ok({
  codes: [
    { code: 0, message: 'ok' },
    { code: 1, message: 'ParamError' },
    { code: 2, message: 'DBError' },
    { code: 5, message: 'AuthFailed' },
    { code: 7, message: 'UnauthorizedError' },
  ],
})

export const commonRoutes: MockRoute[] = [
  { method: 'GET', path: '/api/version', handler: mockVersion },
  { method: 'GET', path: '/api/env-config', handler: mockEnvConfig },
  { method: 'GET', path: '/api/enterprises/current', handler: mockEnterprisesCurrent },
  { method: 'GET', path: '/api/enterprises/features', handler: mockEnterpriseFeatures },
  { method: 'GET', path: '/api/enterprises/is_saas', handler: mockIsSaas },
  { method: 'POST', path: '/api/check_account', handler: mockCheckAccount },
  { method: 'POST', path: '/api/login', handler: mockLogin },
  { method: 'POST', path: '/api/logout', handler: mockLogout },
  { method: 'POST', path: '/api/register', handler: mockRegister },
  { method: 'POST', path: '/api/reset_password', handler: mockResetPassword },
  { method: 'POST', path: '/api/saas/auth/check_account', handler: mockCheckAccount },
  { method: 'POST', path: '/api/saas/auth/login', handler: mockSaasLogin },
  { method: 'POST', path: '/api/saas/auth/logout', handler: mockLogout },
  { method: 'POST', path: '/api/saas/auth/sms_login', handler: mockSaasLogin },
  { method: 'POST', path: '/api/saas/auth/reset_password', handler: mockResetPassword },
  { method: 'GET', path: '/api/captcha', handler: mockCaptcha },
  { method: 'GET', path: '/api/sms/captcha', handler: mockCaptcha },
  { method: 'POST', path: '/api/sms/sendcode', handler: mockSmsSendcode },
  { method: 'GET', path: '/api/sms/status', handler: mockSmsStatus },
  { method: 'GET', path: '/api/sms/verify', handler: mockSmsVerify },
  { method: 'POST', path: '/api/sms_login', handler: mockSaasLogin },
  { method: 'POST', path: '/api/email/send_verification', handler: mockEmailSendVerification },
  { method: 'POST', path: '/api/email/send_test', handler: mockEmailSendVerification },
  { method: 'GET', path: '/api/response_codes', handler: mockResponseCodes },
  { method: 'POST', path: '/api/auth/sso_login', handler: mockSaasLogin },
]
