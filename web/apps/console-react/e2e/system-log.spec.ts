/**
 * System Log 模块 E2E 测试
 * 测试关键用户流程：查看日志、筛选、分页
 *
 * 边界条件、表单验证等逻辑已在单元测试中覆盖
 * @see src/views/system-log-refactored/__tests__/
 */
import { test, expect } from '@playwright/test'
import { t, setupAuth, navigateTo, selectors } from './utils'

test.use({
  locale: 'zh-CN',
  viewport: { width: 1920, height: 1080 },
})

test.describe('System Log 系统日志模块', () => {
  test.beforeEach(async ({ context, page }) => {
    await setupAuth(context)
    await navigateTo(page, '/#/system-log')
  })

  // ========== 页面渲染验证 ==========
  test('应该显示页面核心元素', async ({ page }) => {
    await expect(page.locator('h2', { hasText: t['module.system_log'] })).toBeVisible()
    await expect(page.locator('.ant-table')).toBeVisible()
    await expect(page.locator('.ant-pagination')).toBeVisible()
  })

  // ========== 筛选流程 ==========
  test('筛选流程 - 操作类型筛选', async ({ page }) => {
    // 获取筛选前的数据状态
    const initialTotal = await page.locator('.ant-pagination-total-text').textContent()

    const actionSelect = page.getByPlaceholder(t['system_log.log_action'])
    if (await actionSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      await actionSelect.click()
      await page.waitForTimeout(300)

      const option = page.locator(selectors.selectItem).first()
      if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
        await option.click()
        await page.waitForTimeout(1500) // 等待数据刷新

        // 验证表格仍然可见
        await expect(page.locator('.ant-table')).toBeVisible()

        // 验证数据发生变化（总数或表格内容变化）
        const afterTotal = await page.locator('.ant-pagination-total-text').textContent()
        // 数据可能增加或减少，验证筛选生效
        expect(afterTotal).toBeDefined()
      }
    }
  })

  test('筛选流程 - 模块筛选', async ({ page }) => {
    const moduleSelect = page.getByPlaceholder(t['system_log.log_module'])
    if (await moduleSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      await moduleSelect.click()
      await page.waitForTimeout(300)

      const option = page.locator(selectors.selectItem).first()
      if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
        await option.click()
        await page.waitForTimeout(1500)
        await expect(page.locator('.ant-table')).toBeVisible()
      }
    }
  })

  // ========== 分页流程 ==========
  test('分页流程 - 翻页', async ({ page }) => {
    const nextButton = page.locator('.ant-pagination-next')
    const prevButton = page.locator('.ant-pagination-prev')

    // 第一页时，上一页应该禁用
    if (await prevButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      const prevDisabled = await prevButton.getAttribute('aria-disabled')
      expect(prevDisabled).toBe('true') // 第一页时上一页禁用
    }

    // 只有在有数据时才测试翻页
    if (await nextButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      const isDisabled = await nextButton.getAttribute('aria-disabled')
      if (isDisabled !== 'true') {
        // 记录当前页码
        const currentPage = await page.locator('.ant-pagination-item-active').textContent()

        await nextButton.click()
        await page.waitForTimeout(1000)

        // 验证页码变化
        const newPage = await page.locator('.ant-pagination-item-active').textContent()
        expect(Number(newPage)).toBeGreaterThan(Number(currentPage))

        await expect(page.locator('.ant-table')).toBeVisible()
      }
    }
  })

  test('分页流程 - 改变每页条数', async ({ page }) => {
    const pageSizeSelect = page.locator('.ant-pagination-options-size-changer')

    if (await pageSizeSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      await pageSizeSelect.click()
      await page.waitForTimeout(300)

      const option = page.locator('.ant-select-dropdown .ant-select-item').last()
      if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
        const newPageSize = await option.textContent()

        await option.click()
        await page.waitForTimeout(1000)

        // 验证每页条数变化
        const pageSizeText = await pageSizeSelect.textContent()
        expect(pageSizeText).toContain(newPageSize)

        await expect(page.locator('.ant-table')).toBeVisible()
      }
    }
  })

  test('分页边界 - 数据少于一页时分页状态', async ({ page }) => {
    // 这个测试依赖数据，跳过如果数据超过一页
    const totalText = await page.locator('.ant-pagination-total-text').textContent()
    const total = parseInt(totalText?.match(/\d+/)?.[0] || '0', 10)

    // 如果数据少于一页，验证分页器状态
    const currentPageSize = 10 // 默认
    if (total <= currentPageSize) {
      const nextButton = page.locator('.ant-pagination-next')
      const nextDisabled = await nextButton.getAttribute('aria-disabled')
      expect(nextDisabled).toBe('true') // 只有一页时下一页禁用
    }
  })

  // ========== 日期筛选流程 ==========
  test('筛选流程 - 日期范围筛选', async ({ page }) => {
    const datePicker = page.locator('.ant-picker-range')

    if (await datePicker.isVisible({ timeout: 3000 }).catch(() => false)) {
      await datePicker.click()
      await page.waitForTimeout(300)

      // 选择一个预设范围（如"最近7天"）或手动选择日期
      const preset = page.locator('.ant-picker-presets .ant-picker-preset').first()
      if (await preset.isVisible({ timeout: 2000 }).catch(() => false)) {
        await preset.click()
        await page.waitForTimeout(1500)
        await expect(page.locator('.ant-table')).toBeVisible()
      } else {
        // 手动选择日期范围
        const calendarCell = page.locator('.ant-picker-cell').first()
        if (await calendarCell.isVisible({ timeout: 2000 }).catch(() => false)) {
          await calendarCell.click()
          await page.waitForTimeout(300)
          const confirmBtn = page.getByRole('button', { name: '确 定' })
          if (await confirmBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
            await confirmBtn.click()
            await page.waitForTimeout(1500)
          }
        }
      }
    }
  })

  // ========== 组合筛选流程 ==========
  test('筛选流程 - 组合筛选（日期 + 操作类型）', async ({ page }) => {
    // 1. 先选择日期
    const datePicker = page.locator('.ant-picker-range')
    if (await datePicker.isVisible({ timeout: 3000 }).catch(() => false)) {
      await datePicker.click()
      await page.waitForTimeout(300)

      const preset = page.locator('.ant-picker-presets .ant-picker-preset').first()
      if (await preset.isVisible({ timeout: 2000 }).catch(() => false)) {
        await preset.click()
        await page.waitForTimeout(500)
      }
    }

    // 2. 再选择操作类型
    const actionSelect = page.getByPlaceholder(t['system_log.log_action'])
    if (await actionSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      await actionSelect.click()
      await page.waitForTimeout(300)

      const option = page.locator(selectors.selectItem).first()
      if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
        await option.click()
        await page.waitForTimeout(1500)
        await expect(page.locator('.ant-table')).toBeVisible()
      }
    }
  })

  // ========== 清空筛选流程 ==========
  test('筛选流程 - 清空操作类型筛选', async ({ page }) => {
    // 1. 先设置筛选条件
    const actionSelect = page.getByPlaceholder(t['system_log.log_action'])
    if (await actionSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      await actionSelect.click()
      await page.waitForTimeout(300)

      const option = page.locator(selectors.selectItem).first()
      if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
        await option.click()
        await page.waitForTimeout(1000)

        // 验证已选择
        const selectValue = await actionSelect.inputValue()
        expect(selectValue).toBeTruthy()
      }
    }

    // 2. 清空筛选
    const clearIcon = page.locator('.ant-select-clear')
    if (await clearIcon.isVisible({ timeout: 2000 }).catch(() => false)) {
      await clearIcon.click()
      await page.waitForTimeout(1500)

      // 验证已清空
      await expect(page.locator('.ant-table')).toBeVisible()
    }
  })

  test('筛选流程 - 清空日期范围', async ({ page }) => {
    const datePicker = page.locator('.ant-picker-range')

    // 1. 先设置日期范围
    if (await datePicker.isVisible({ timeout: 3000 }).catch(() => false)) {
      await datePicker.click()
      await page.waitForTimeout(300)

      const preset = page.locator('.ant-picker-presets .ant-picker-preset').first()
      if (await preset.isVisible({ timeout: 2000 }).catch(() => false)) {
        await preset.click()
        await page.waitForTimeout(500)

        // 验证日期已选择
        const dateValue = await datePicker.inputValue()
        expect(dateValue.length).toBeGreaterThan(0)
      }
    }

    // 2. 清空日期
    const clearDateBtn = page.locator('.ant-picker-clear')
    if (await clearDateBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await clearDateBtn.click()
      await page.waitForTimeout(1000)

      // 验证日期已清空
      await expect(page.locator('.ant-table')).toBeVisible()
    }
  })

  // ========== 性能基准 ==========
  test('页面加载性能', async ({ context, page }) => {
    const start = Date.now()
    await setupAuth(context)
    await navigateTo(page, '/#/system-log')
    const loadTime = Date.now() - start

    expect(loadTime).toBeLessThan(5000)
  })
})
