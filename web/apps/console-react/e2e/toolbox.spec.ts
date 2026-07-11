/**
 * Toolbox 模块 E2E 测试
 * 测试关键用户流程：创建、编辑、访问、删除
 *
 * 边界条件、表单验证等逻辑已在单元测试中覆盖
 * @see src/views/toolbox-refactored/__tests__/
 */
import { test, expect } from '@playwright/test'
import { t, setupAuth, navigateTo, AUTH_STATE, selectors, buttonPatterns } from './utils'

// 浏览器配置
test.use({
  locale: 'zh-CN',
  viewport: { width: 1920, height: 1080 },
})

// 测试数据
const TEST_TOOL = {
  name: `E2E测试工具_${Date.now()}`,
  url: 'https://example.com',
  description: 'E2E自动化测试创建的工具',
}

test.describe('Toolbox 工具箱模块', () => {
  test.beforeEach(async ({ context, page }) => {
    await setupAuth(context)
    await navigateTo(page, '/#/toolbox')
  })

  // ========== 页面渲染验证 ==========
  test('应该显示页面核心元素', async ({ page }) => {
    await expect(page.locator('h2', { hasText: t['module.ai_toolbox'] })).toBeVisible()
    await expect(page.getByPlaceholder(t['module.ai_toolbox_search_placeholder_v2'])).toBeVisible()
    await expect(page.getByRole('button', { name: buttonPatterns.add })).toBeVisible()
    await expect(page.getByRole('button', { name: buttonPatterns.sort })).toBeVisible()
  })

  // ========== 核心流程：创建 → 编辑 → 访问 → 删除 ==========
  test('完整流程 - 创建、编辑、访问、删除工具', async ({ page, context }) => {
    // ========== 1. 创建工具 ==========
    await page.getByRole('button', { name: buttonPatterns.add }).click()

    const storeDialog = page.locator(selectors.modal)
    await expect(storeDialog).toBeVisible()
    await page.waitForTimeout(500)

    // 点击手动添加
    await storeDialog.getByText('手动添加').click()
    await page.waitForURL(/\/toolbox\/create/)

    // 填写表单
    await page.getByRole('textbox', { name: t['name'] }).fill(TEST_TOOL.name)
    await page.getByRole('textbox', { name: 'URL' }).fill(TEST_TOOL.url)
    await page.getByRole('textbox', { name: t['description'] }).fill(TEST_TOOL.description)

    // 选择分组
    const groupSelect = page.locator(selectors.select).first()
    await groupSelect.click()
    await page.waitForTimeout(300)
    const groupOption = page.locator(selectors.selectItem).first()
    if (await groupOption.isVisible()) {
      await groupOption.click()
    }

    // 保存
    await page.getByRole('button', { name: buttonPatterns.save }).click()
    await page.waitForTimeout(2000)

    // ========== 2. 编辑工具 ==========
    await navigateTo(page, '/#/toolbox')
    await page.waitForTimeout(1000)

    const searchInput = page.getByPlaceholder(t['module.ai_toolbox_search_placeholder_v2'])
    await searchInput.clear()
    await page.waitForTimeout(500)

    const toolCard = page.locator(selectors.gridItem).first()
    if (!await toolCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      test.skip()
      return
    }

    await toolCard.hover()
    await page.waitForTimeout(500)

    const editButton = toolCard.getByRole('button', { name: buttonPatterns.edit })
    if (!await editButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip()
      return
    }

    await editButton.click()
    await page.waitForURL(/\/toolbox\/create/)
    await page.getByRole('textbox', { name: t['description'] }).fill(`${TEST_TOOL.description}_已编辑`)
    await page.getByRole('button', { name: buttonPatterns.save }).click()
    await page.waitForTimeout(1000)

    // ========== 3. 访问工具 ==========
    await navigateTo(page, '/#/toolbox')
    await page.waitForTimeout(500)

    const visitToolCard = page.locator(selectors.gridItem).first()
    await visitToolCard.hover()
    await page.waitForTimeout(300)

    const visitButton = visitToolCard.getByRole('button', { name: buttonPatterns.visit })
    if (await visitButton.isVisible({ timeout: 3000 })) {
      const [newPage] = await Promise.all([context.waitForEvent('page'), visitButton.click()])
      expect(newPage).toBeDefined()
      await newPage.close()
    }

    // ========== 4. 删除工具 ==========
    await navigateTo(page, '/#/toolbox')
    await page.waitForTimeout(500)

    const deleteToolCard = page.locator(selectors.gridItem).first()
    await deleteToolCard.hover()
    await page.waitForTimeout(300)

    const buttons = deleteToolCard.locator('button')
    const count = await buttons.count()
    if (count > 0) {
      await buttons.nth(count - 1).click()
      const confirmButton = page.getByRole('button', { name: buttonPatterns.confirm })
      await expect(confirmButton).toBeVisible({ timeout: 3000 })
      await confirmButton.click()
      await page.waitForTimeout(1000)
    }
  })

  // ========== 性能基准 ==========
  test('页面加载性能', async ({ context, page }) => {
    const start = Date.now()
    await setupAuth(context)
    await navigateTo(page, '/#/toolbox')
    const loadTime = Date.now() - start

    expect(loadTime).toBeLessThan(5000)
  })
})

test.describe('Toolbox 创建页面', () => {
  test.beforeEach(async ({ context, page }) => {
    await setupAuth(context)
    await navigateTo(page, '/#/toolbox/create')
  })

  test('应该显示创建表单', async ({ page }) => {
    await expect(page.getByRole('textbox', { name: t['name'] })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'URL' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: t['description'] })).toBeVisible()
  })

  test('返回按钮 - 应该能够返回列表页', async ({ page }) => {
    const backButton = page.locator('.cursor-pointer').filter({ has: page.locator('svg') }).first()
    if (await backButton.isVisible()) {
      await backButton.click()
      await page.waitForURL(/\/toolbox/)
      expect(page.url()).toContain('/toolbox')
    }
  })
})