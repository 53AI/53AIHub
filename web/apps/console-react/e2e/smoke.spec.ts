import { test, expect } from '@playwright/test'
import { setupAuth, navigateTo, selectors, buttonPatterns } from './utils'

// 冒烟基线：验证 agent 模块在真实后端起服务后能落地渲染、关键入口可开。
// 与同目录 system-log/toolbox 统一走 utils 的 setupAuth（真实 JWT）+ navigateTo。
// 只做无副作用、选择器稳定的断言；深度的 创建→编辑→删除 边界逐步扩。
test.use({ locale: 'zh-CN', viewport: { width: 1920, height: 1080 } })

test.describe('冒烟 · agent 模块', () => {
  test.beforeEach(async ({ context, page }) => {
    await setupAuth(context)
    await navigateTo(page, '/console-react/#/agent')
  })

  test('agent 列表页能落地渲染', async ({ page }) => {
    await expect(page.locator('.ant-table')).toBeVisible({ timeout: 15_000 })
    // 新建入口（filterBar 的 primary 按钮）存在
    await expect(page.locator('button.ant-btn-primary').first()).toBeVisible()
  })

  test('新建入口能打开创建弹窗并取消', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: buttonPatterns.add })
    await expect(addBtn).toBeVisible({ timeout: 15_000 })
    await addBtn.click()
    await expect(page.locator(selectors.modal)).toBeVisible()
    // 取消关闭
    await page.keyboard.press('Escape')
    await expect(page.locator(selectors.modal)).toBeHidden()
  })
})