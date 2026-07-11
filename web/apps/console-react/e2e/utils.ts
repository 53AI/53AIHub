/**
 * E2E 测试共享工具
 */
import type { Page, BrowserContext } from '@playwright/test'
import { getZhMessages } from './i18n'

// 导出语言包
export const t = getZhMessages()

// 认证状态
export const AUTH_STATE = {
  access_token: process.env.E2E_ACCESS_TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlaWQiOjE0NywiZXhwIjoxNzc4ODE3OTM2LCJ1c2VyX2lkIjoyNDR9.uJKUKTJinepVyU3WBZXl9ocC6OerkLVK01VBK-dahn4',
  site_token: process.env.E2E_SITE_TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3NzgwNjMyNjEsInVzZXJfaWQiOjJ9.u-dq0Od01NG6KiM-RnOgfyY26R6ApntjbGA8oWyrCOg',
  user_info: process.env.E2E_USER_INFO || JSON.stringify({
    access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlaWQiOjE0NywiZXhwIjoxNzc4ODE3OTM2LCJ1c2VyX2lkIjoyNDR9.uJKUKTJinepVyU3WBZXl9ocC6OerkLVK01VBK-dahn4',
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

// 注入认证状态
export async function setupAuth(context: BrowserContext) {
  await context.addInitScript((auth) => {
    localStorage.setItem('access_token', auth.access_token)
    localStorage.setItem('site_token', auth.site_token)
    localStorage.setItem('user_info', auth.user_info)
    localStorage.setItem('default_lang', 'zh-cn')
  }, AUTH_STATE)
}

// 导航到页面
export async function navigateTo(page: Page, path: string) {
  await page.goto(path)
  await page.waitForLoadState('domcontentloaded')
  // 等待页面内容加载
  await page.waitForTimeout(1000)
}

// 常用选择器
export const selectors = {
  modal: '.ant-modal',
  modalClose: '.ant-modal-close',
  modalVisible: '.ant-modal:visible',
  formError: '.ant-form-item-explain-error',
  grid: '.grid',
  gridItem: '.grid > div > div[role="button"]',
  emptyState: '.ant-empty-description',
  select: '.ant-select',
  selectDropdown: '.ant-select-dropdown',
  selectItem: '.ant-select-dropdown .ant-select-item',
}

// 常用按钮正则
export const buttonPatterns = {
  add: /添\s*加/,
  edit: /编\s*辑/,
  save: /保\s*存/,
  cancel: /取\s*消/,
  confirm: /确\s*定/,
  visit: /访\s*问/,
  sort: /排\s*序/,
}
