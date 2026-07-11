/**
 * E2E 测试 fixtures
 * 提供测试所需的公共配置和数据
 */
import { test as base } from '@playwright/test'

// 认证状态
const AUTH_STATE = {
  access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlaWQiOjE0NywiZXhwIjoxNzc1MjA1NjYwLCJ1c2VyX2lkIjoyNDR9.yOn_9Xl_-gfooi1iOWiQpaRrHsi-ppdzILsI6Buve0s',
  site_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3NzUyMDU2NDEsInVzZXJfaWQiOjJ9.XuFRWo26ce8T0ikht_sIVfCIXnz8bem4MdwEGXgxfOM',
  user_info: JSON.stringify({
    access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlaWQiOjE0NywiZXhwIjoxNzc1MjA1NjYwLCJ1c2VyX2lkIjoyNDR9.yOn_9Xl_-gfooi1iOWiQpaRrHsi-ppdzILsI6Buve0s',
    user_id: 244,
    eid: '58aQZn',
    is_new_user: false,
    nickname: '张政',
    username: '13826467721',
    role: 10,
    status: 1,
    type: 2,
    mobile: '13826467721',
    group_ids: [480],
  }),
}

// 扩展 fixtures
export const test = base.extend<{
  /** 已认证的页面 */
  authenticatedPage: typeof base.page
}>({
  authenticatedPage: async ({ page }, use) => {
    // 注入认证 cookies 和 localStorage
    await page.context().addCookies([
      {
        name: 'access_token',
        value: AUTH_STATE.access_token,
        domain: 'kmapitest.53ai.com',
        path: '/',
      },
      {
        name: 'site_token',
        value: AUTH_STATE.site_token,
        domain: 'kmapitest.53ai.com',
        path: '/',
      },
    ])

    // 访问页面并注入 localStorage
    await page.goto('/')
    await page.evaluate((userInfo) => {
      localStorage.setItem('user_info', userInfo)
    }, AUTH_STATE.user_info)

    await use(page)
  },
})

export { expect } from '@playwright/test'

// 测试数据工厂
export const createTestTool = (overrides = {}) => ({
  name: `Test Tool ${Date.now()}`,
  url: 'https://example.com',
  description: 'Test description',
  ...overrides,
})
