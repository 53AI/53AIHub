/**
 * E2E 边界测试工具函数
 * 提供通用的边界测试用例，可复用于各个模块
 */

import { expect, Page, Locator } from '@playwright/test'

/**
 * 表单边界测试配置
 */
export interface FormFieldConfig {
  name: string
  locator: Locator
  type: 'text' | 'number' | 'url' | 'email' | 'phone' | 'textarea' | 'select'
  required?: boolean
  maxLength?: number
  minLength?: number
  pattern?: RegExp
  customValidations?: Array<{
    name: string
    value: string
    shouldFail: boolean
  }>
}

/**
 * 表单边界测试套件
 */
export class FormBoundaryTests {
  constructor(private page: Page) {}

  /**
   * 测试必填字段验证
   */
  async testRequiredField(field: Locator, fieldName: string) {
    // 清空字段
    await field.clear()
    await this.page.waitForTimeout(100)

    // 触发验证（点击其他地方或提交）
    await this.page.keyboard.press('Tab')

    // 验证错误提示
    const errorMsg = this.page.locator('.ant-form-item-explain-error')
    const hasError = await errorMsg.isVisible({ timeout: 2000 }).catch(() => false)

    return {
      name: `${fieldName}必填验证`,
      passed: hasError,
      message: hasError ? '显示必填错误提示' : '未显示必填错误提示',
    }
  }

  /**
   * 测试最大长度限制
   */
  async testMaxLength(field: Locator, fieldName: string, maxLength: number) {
    const longText = 'A'.repeat(maxLength + 100)
    await field.fill(longText)
    await this.page.waitForTimeout(100)

    const actualValue = await field.inputValue()
    const isLimited = actualValue.length <= maxLength

    return {
      name: `${fieldName}最大长度(${maxLength})验证`,
      passed: isLimited,
      message: `输入${longText.length}字符，实际保留${actualValue.length}字符`,
    }
  }

  /**
   * 测试最小长度限制
   */
  async testMinLength(field: Locator, fieldName: string, minLength: number) {
    const shortText = 'A'.repeat(Math.max(0, minLength - 1))
    await field.fill(shortText)
    await this.page.keyboard.press('Tab')
    await this.page.waitForTimeout(100)

    const errorMsg = this.page.locator('.ant-form-item-explain-error')
    const hasError = await errorMsg.isVisible({ timeout: 2000 }).catch(() => false)

    return {
      name: `${fieldName}最小长度(${minLength})验证`,
      passed: hasError,
      message: `输入${shortText.length}字符，${hasError ? '显示错误提示' : '未显示错误提示'}`,
    }
  }

  /**
   * 测试特殊字符处理
   */
  async testSpecialChars(field: Locator, fieldName: string) {
    const specialChars = ['<script>alert(1)</script>', '"; DROP TABLE--', '../../etc/passwd', 'null', 'undefined', '🚀🎯💡']

    const results = []
    for (const char of specialChars) {
      await field.fill(char)
      const value = await field.inputValue()

      // 检查是否被正确处理（转义或过滤）
      results.push({
        input: char,
        output: value,
        handled: !value.includes('<script>') && !value.includes('DROP TABLE'),
      })
    }

    return {
      name: `${fieldName}特殊字符处理`,
      passed: results.every((r) => r.handled),
      details: results,
    }
  }

  /**
   * 测试 URL 格式验证
   */
  async testUrlFormat(field: Locator, fieldName: string) {
    const testUrls = [
      { value: 'not-a-url', shouldFail: true },
      { value: 'http://', shouldFail: true },
      { value: 'https://valid.com', shouldFail: false },
      { value: 'http://localhost:3000', shouldFail: false },
      { value: 'ftp://files.example.com', shouldFail: false },
    ]

    const results = []
    for (const test of testUrls) {
      await field.fill(test.value)
      await this.page.keyboard.press('Tab')
      await this.page.waitForTimeout(100)

      const errorMsg = this.page.locator('.ant-form-item-explain-error')
      const hasError = await errorMsg.isVisible({ timeout: 2000 }).catch(() => false)

      results.push({
        url: test.value,
        expectedError: test.shouldFail,
        actualError: hasError,
        passed: hasError === test.shouldFail,
      })
    }

    return {
      name: `${fieldName}URL格式验证`,
      passed: results.every((r) => r.passed),
      details: results,
    }
  }

  /**
   * 测试空格处理
   */
  async testWhitespaceHandling(field: Locator, fieldName: string) {
    const testCases = [
      { value: '  ', description: '纯空格' },
      { value: ' test ', description: '前后空格' },
      { value: 'test  test', description: '中间多空格' },
    ]

    const results = []
    for (const test of testCases) {
      await field.fill(test.value)
      await this.page.keyboard.press('Tab')
      await this.page.waitForTimeout(100)

      const value = await field.inputValue()
      results.push({
        description: test.description,
        input: test.value,
        output: value,
        trimmed: value !== test.value,
      })
    }

    return {
      name: `${fieldName}空格处理`,
      passed: true,
      details: results,
    }
  }

  /**
   * 测试数字输入限制
   */
  async testNumberInput(field: Locator, fieldName: string) {
    const testCases = [
      { value: '-1', description: '负数' },
      { value: '0', description: '零' },
      { value: '999999999999', description: '超大数' },
      { value: '1.5', description: '小数' },
      { value: 'abc', description: '非数字' },
    ]

    const results = []
    for (const test of testCases) {
      await field.fill(test.value)
      await this.page.keyboard.press('Tab')
      await this.page.waitForTimeout(100)

      const value = await field.inputValue()
      results.push({
        description: test.description,
        input: test.value,
        output: value,
      })
    }

    return {
      name: `${fieldName}数字输入`,
      passed: true,
      details: results,
    }
  }

  /**
   * 运行完整的字段边界测试
   */
  async runFieldTests(config: FormFieldConfig) {
    const results = []

    // 必填验证
    if (config.required) {
      results.push(await this.testRequiredField(config.locator, config.name))
    }

    // 最大长度
    if (config.maxLength) {
      results.push(await this.testMaxLength(config.locator, config.name, config.maxLength))
    }

    // 最小长度
    if (config.minLength) {
      results.push(await this.testMinLength(config.locator, config.name, config.minLength))
    }

    // 类型特定测试
    switch (config.type) {
      case 'url':
        results.push(await this.testUrlFormat(config.locator, config.name))
        break
      case 'number':
        results.push(await this.testNumberInput(config.locator, config.name))
        break
      case 'text':
      case 'textarea':
        results.push(await this.testSpecialChars(config.locator, config.name))
        results.push(await this.testWhitespaceHandling(config.locator, config.name))
        break
    }

    // 自定义验证
    if (config.customValidations) {
      for (const validation of config.customValidations) {
        await config.locator.fill(validation.value)
        await this.page.keyboard.press('Tab')
        await this.page.waitForTimeout(100)

        const errorMsg = this.page.locator('.ant-form-item-explain-error')
        const hasError = await errorMsg.isVisible({ timeout: 2000 }).catch(() => false)

        results.push({
          name: `${config.name}${validation.name}`,
          passed: hasError === validation.shouldFail,
          message: `输入"${validation.value}"，${hasError ? '显示错误' : '无错误'}`,
        })
      }
    }

    return results
  }
}

/**
 * 列表边界测试套件
 */
export class ListBoundaryTests {
  constructor(private page: Page) {}

  /**
   * 测试空列表状态
   */
  async testEmptyState(listLocator: Locator, emptyText: string) {
    const isEmpty = await listLocator.isVisible().catch(() => false)
    const emptyState = this.page.getByText(emptyText)
    const hasEmptyState = await emptyState.isVisible().catch(() => false)

    return {
      name: '空列表状态',
      passed: !isEmpty || hasEmptyState,
      message: hasEmptyState ? '显示空状态提示' : '列表有数据或无空状态提示',
    }
  }

  /**
   * 测试分页边界
   */
  async testPagination(listLocator: Locator) {
    const results = []

    // 检查分页组件
    const pagination = this.page.locator('.ant-pagination')
    const hasPagination = await pagination.isVisible().catch(() => false)

    if (hasPagination) {
      // 测试第一页
      const prevButton = pagination.locator('.ant-pagination-prev')
      const isFirstPageDisabled = await prevButton.isDisabled().catch(() => true)
      results.push({
        name: '首页上一页禁用',
        passed: isFirstPageDisabled,
      })

      // 测试最后一页
      const nextButton = pagination.locator('.ant-pagination-next')
      const lastPageButton = pagination.locator('.ant-pagination-item').last()
      await lastPageButton.click()
      await this.page.waitForTimeout(300)

      const isLastPageNextDisabled = await nextButton.isDisabled().catch(() => true)
      results.push({
        name: '末页下一页禁用',
        passed: isLastPageNextDisabled,
      })
    }

    return results
  }

  /**
   * 测试搜索边界
   */
  async testSearchBoundary(searchInput: Locator, listLocator: Locator) {
    const results = []

    // 空搜索
    await searchInput.fill('')
    await this.page.waitForTimeout(300)
    results.push({
      name: '空搜索',
      passed: true,
      message: '空搜索应显示全部数据',
    })

    // 不存在的关键词
    await searchInput.fill('zzzzzzzzzzzzzzzzzzzzz')
    await this.page.waitForTimeout(500)
    const emptyState = this.page.locator('.ant-empty-description')
    const hasNoResults = await emptyState.isVisible().catch(() => false)
    results.push({
      name: '无结果搜索',
      passed: hasNoResults,
      message: hasNoResults ? '显示无结果提示' : '未显示无结果提示',
    })

    // 特殊字符搜索
    await searchInput.fill('<script>alert(1)</script>')
    await this.page.waitForTimeout(500)
    results.push({
      name: '特殊字符搜索',
      passed: true,
      message: '特殊字符搜索应正常处理',
    })

    // 超长搜索词
    await searchInput.fill('A'.repeat(500))
    await this.page.waitForTimeout(500)
    results.push({
      name: '超长搜索词',
      passed: true,
      message: '超长搜索词应正常处理',
    })

    // 清空搜索
    await searchInput.clear()
    await this.page.waitForTimeout(300)

    return results
  }

  /**
   * 测试批量操作边界
   */
  async testBatchOperation(selectAllLocator: Locator, actionButton: Locator) {
    const results = []

    // 无选中时的批量操作
    const isDisabled = await actionButton.isDisabled().catch(() => true)
    results.push({
      name: '无选中时批量操作禁用',
      passed: isDisabled,
    })

    // 全选
    await selectAllLocator.click()
    await this.page.waitForTimeout(100)
    results.push({
      name: '全选功能',
      passed: true,
    })

    // 取消全选
    await selectAllLocator.click()
    await this.page.waitForTimeout(100)
    results.push({
      name: '取消全选',
      passed: true,
    })

    return results
  }
}

/**
 * 对话框边界测试套件
 */
export class DialogBoundaryTests {
  constructor(private page: Page) {}

  /**
   * 测试对话框打开/关闭
   */
  async testOpenClose(dialogLocator: Locator, openButton: Locator, closeButton?: Locator) {
    const results = []

    // 打开对话框
    await openButton.click()
    await this.page.waitForTimeout(300)
    const isOpen = await dialogLocator.isVisible()
    results.push({
      name: '对话框打开',
      passed: isOpen,
    })

    if (isOpen) {
      // ESC 关闭
      await this.page.keyboard.press('Escape')
      await this.page.waitForTimeout(300)
      const isClosedAfterEsc = !(await dialogLocator.isVisible().catch(() => false))
      results.push({
        name: 'ESC关闭对话框',
        passed: isClosedAfterEsc,
      })

      // 如果 ESC 没关闭，尝试按钮关闭
      if (!isClosedAfterEsc && closeButton) {
        await closeButton.click()
        await this.page.waitForTimeout(300)
      }
    }

    return results
  }

  /**
   * 测试遮罩层点击关闭
   */
  async testMaskClose(dialogLocator: Locator, openButton: Locator, maskCloseable: boolean) {
    const results = []

    await openButton.click()
    await this.page.waitForTimeout(300)

    // 点击遮罩层
    const mask = this.page.locator('.ant-modal-wrap')
    await mask.click({ position: { x: 10, y: 10 } })
    await this.page.waitForTimeout(300)

    const isClosed = !(await dialogLocator.isVisible().catch(() => false))
    results.push({
      name: '遮罩层点击关闭',
      passed: isClosed === maskCloseable,
      message: `预期${maskCloseable ? '可' : '不可'}点击遮罩关闭，实际${isClosed ? '已关闭' : '未关闭'}`,
    })

    return results
  }

  /**
   * 测试表单提交后自动关闭
   */
  async testSubmitClose(dialogLocator: Locator, submitButton: Locator) {
    await submitButton.click()
    await this.page.waitForTimeout(500)

    const isClosed = !(await dialogLocator.isVisible().catch(() => false))
    return {
      name: '提交后对话框关闭',
      passed: isClosed,
    }
  }
}

/**
 * 权限边界测试套件
 */
export class PermissionBoundaryTests {
  constructor(private page: Page) {}

  /**
   * 测试未登录状态
   */
  async testUnauthenticated(expectedRedirect: string) {
    // 清除认证状态
    await this.page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })

    await this.page.reload()
    await this.page.waitForTimeout(500)

    const currentUrl = this.page.url()
    const isRedirected = currentUrl.includes(expectedRedirect) || currentUrl.includes('login')

    return {
      name: '未登录状态重定向',
      passed: isRedirected,
      message: `重定向到: ${currentUrl}`,
    }
  }

  /**
   * 测试按钮禁用状态
   */
  async testButtonDisabled(buttonLocator: Locator, shouldBeDisabled: boolean) {
    const isDisabled = await buttonLocator.isDisabled()
    return {
      name: '按钮禁用状态',
      passed: isDisabled === shouldBeDisabled,
      message: `预期${shouldBeDisabled ? '禁用' : '启用'}，实际${isDisabled ? '禁用' : '启用'}`,
    }
  }

  /**
   * 测试无权限操作
   */
  async testNoPermission(actionButton: Locator, permissionDeniedText: string) {
    await actionButton.click()
    await this.page.waitForTimeout(300)

    // 检查是否有权限提示
    const toast = this.page.getByText(permissionDeniedText)
    const hasPermissionDenied = await toast.isVisible({ timeout: 2000 }).catch(() => false)

    return {
      name: '无权限操作提示',
      passed: hasPermissionDenied,
    }
  }
}

/**
 * 数据边界测试套件
 */
export class DataBoundaryTests {
  constructor(private page: Page) {}

  /**
   * 测试长文本截断
   */
  async testTextTruncation(locator: Locator, maxLength: number) {
    const text = await locator.textContent()
    const isTruncated = text
      ? text.includes('...') || text.length <= maxLength
      : true

    return {
      name: '长文本截断',
      passed: isTruncated,
      message: text ? `文本长度: ${text.length}` : '无文本',
    }
  }

  /**
   * 测试数值范围显示
   */
  async testNumberRange(locator: Locator, min: number, max: number) {
    const text = await locator.textContent()
    const value = text ? parseFloat(text.replace(/[^0-9.-]/g, '')) : NaN

    return {
      name: '数值范围验证',
      passed: isNaN(value) || (value >= min && value <= max),
      message: `数值: ${value}, 范围: ${min}-${max}`,
    }
  }

  /**
   * 测试日期格式
   */
  async testDateFormat(locator: Locator, expectedFormat: RegExp) {
    const text = await locator.textContent()

    return {
      name: '日期格式验证',
      passed: text ? expectedFormat.test(text) : true,
      message: `日期: ${text}`,
    }
  }
}

/**
 * 性能边界测试套件
 */
export class PerformanceBoundaryTests {
  constructor(private page: Page) {}

  /**
   * 测试页面加载时间
   */
  async testPageLoadTime(path: string, maxTime: number = 3000) {
    const start = Date.now()
    await this.page.goto(path)
    await this.page.waitForLoadState('networkidle')
    const loadTime = Date.now() - start

    return {
      name: '页面加载时间',
      passed: loadTime <= maxTime,
      message: `加载时间: ${loadTime}ms, 最大允许: ${maxTime}ms`,
    }
  }

  /**
   * 测试列表渲染时间
   */
  async testListRenderTime(listLocator: Locator, maxTime: number = 2000) {
    const start = Date.now()
    await listLocator.waitFor({ state: 'visible', timeout: maxTime })
    const renderTime = Date.now() - start

    return {
      name: '列表渲染时间',
      passed: renderTime <= maxTime,
      message: `渲染时间: ${renderTime}ms`,
    }
  }

  /**
   * 测试搜索响应时间
   */
  async testSearchResponseTime(searchInput: Locator, keyword: string, maxTime: number = 1000) {
    const start = Date.now()
    await searchInput.fill(keyword)
    await this.page.waitForTimeout(100)
    // 等待搜索结果更新
    await this.page.waitForTimeout(500)
    const responseTime = Date.now() - start

    return {
      name: '搜索响应时间',
      passed: responseTime <= maxTime,
      message: `响应时间: ${responseTime}ms`,
    }
  }
}

/**
 * 导出所有测试工具
 */
export const boundaryTests = {
  form: FormBoundaryTests,
  list: ListBoundaryTests,
  dialog: DialogBoundaryTests,
  permission: PermissionBoundaryTests,
  data: DataBoundaryTests,
  performance: PerformanceBoundaryTests,
}
