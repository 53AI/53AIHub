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

export const mockSmsSendcode = () => ok({})

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
  { method: 'POST', path: '/api/sms/sendcode', handler: mockSmsSendcode },
  { method: 'GET', path: '/api/sms/status', handler: mockSmsStatus },
  { method: 'GET', path: '/api/sms/verify', handler: mockSmsVerify },
  { method: 'POST', path: '/api/sms_login', handler: mockSaasLogin },
  { method: 'POST', path: '/api/email/send_verification', handler: mockEmailSendVerification },
  { method: 'POST', path: '/api/email/send_test', handler: mockEmailSendVerification },
  { method: 'GET', path: '/api/response_codes', handler: mockResponseCodes },
  { method: 'POST', path: '/api/auth/sso_login', handler: mockSaasLogin },
]
