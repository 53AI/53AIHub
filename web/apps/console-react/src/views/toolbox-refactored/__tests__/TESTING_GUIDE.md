# 测试完整指南

> 本文档补充 `toolbox-refactored` 模块的测试策略和最佳实践。

## 一、测试数据工厂

### 1.1 基本用法

```tsx
import { factories, scenarios, resetIdCounter } from '../factories'

beforeEach(() => {
  resetIdCounter() // 每个 test 前重置 ID 计数器
})

it('创建单个工具', () => {
  const item = factories.aiLinkItem({ name: 'ChatGPT' })
  expect(item.name).toBe('ChatGPT')
})

it('创建批量数据', () => {
  const items = factories.aiLinkList(10, { group_id: 1 })
  expect(items).toHaveLength(10)
  expect(items.every(item => item.group_id === 1)).toBe(true)
})

it('使用预设场景', () => {
  const { groups, items, groupOptions } = scenarios.standard()
  expect(groups).toHaveLength(2)
  expect(items).toHaveLength(6)
})
```

### 1.2 工厂方法列表

| 方法 | 说明 | 参数 |
|------|------|------|
| `aiLinkItem(overrides)` | 创建单个工具项 | 部分覆盖默认值 |
| `aiLinkList(count, overrides)` | 创建工具列表 | 数量 + 覆盖值 |
| `groupOption(overrides)` | 创建分组选项 | 部分覆盖默认值 |
| `groupOptionList(count, childrenPerGroup)` | 创建分组列表 | 分组数 + 每组工具数 |
| `rawGroupOption(overrides)` | 创建原始分组选项 | 部分覆盖默认值 |
| `sharedAccountItem(overrides)` | 创建共享账号项 | 部分覆盖默认值 |
| `sortItem(overrides)` | 创建排序项 | 部分覆盖默认值 |
| `aiLinkDetail(overrides)` | 创建工具详情 | 部分覆盖默认值 |
| `scenario(options)` | 创建完整测试场景 | 分组数 + 每组工具数 |

### 1.3 预设场景

| 场景 | 说明 | 数据量 |
|------|------|--------|
| `scenarios.empty()` | 空数据 | 0 条 |
| `scenarios.minimal()` | 最小数据 | 1 分组 1 工具 |
| `scenarios.standard()` | 标准数据 | 2 分组 6 工具 |
| `scenarios.large()` | 大数据量 | 5 分组 100 工具 |
| `scenarios.xlarge()` | 超大数据量 | 10 分组 1000 工具 |

---

## 二、MSW (Mock Service Worker) 集成

### 2.1 为什么使用 MSW

| 对比项 | vi.mock | MSW |
|--------|---------|-----|
| Mock 级别 | 函数级别 | 网络请求级别 |
| 真实性 | 不发起网络 | 模拟真实网络请求 |
| 调试 | 难以调试网络问题 | 可在 DevTools 查看请求 |
| 适用场景 | 单元测试 | 单元测试 + 集成测试 + E2E |

### 2.2 基本配置

```tsx
// vitest.setup.ts
import { server } from './mocks/server'
import { resetDataStore } from './mocks/handlers'

beforeAll(() => server.listen())
afterEach(() => {
  server.resetHandlers()
  resetDataStore()
})
afterAll(() => server.close())
```

### 2.3 自定义响应

```tsx
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'

it('处理错误响应', async () => {
  server.use(
    http.get('/api/ai-link/list', () => {
      return HttpResponse.json(
        { error: 'Internal Server Error' },
        { status: 500 }
      )
    })
  )

  // 测试代码...
})
```

### 2.4 错误场景 Handlers

```tsx
import { errorHandlers } from '../mocks/handlers'

it('网络错误场景', async () => {
  server.use(errorHandlers.networkError)
  // 测试代码...
})

it('超时场景', async () => {
  server.use(errorHandlers.timeout)
  // 测试代码...
})
```

---

## 三、组件测试

### 3.1 测试原则

1. **测试行为，而非实现**：测试用户能看到和操作的
2. **使用可访问性查询**：优先 `getByRole`、`getByLabelText`
3. **模拟用户交互**：使用 `@testing-library/user-event`

### 3.2 测试结构

```tsx
describe('ComponentName', () => {
  describe('渲染', () => {
    it('应该显示标题', () => {})
    it('应该显示内容', () => {})
  })

  describe('交互', () => {
    it('点击按钮应触发回调', async () => {})
  })

  describe('边界情况', () => {
    it('空数据时应显示空状态', () => {})
    it('长文本应被截断', () => {})
  })

  describe('可访问性', () => {
    it('应该支持键盘导航', async () => {})
    it('应该有正确的 ARIA 属性', () => {})
  })

  describe('快照测试', () => {
    it('默认状态快照', () => {})
  })
})
```

### 3.3 最佳实践

```tsx
// ✅ 好的做法：使用 userEvent
const user = userEvent.setup()
await user.click(button)
await user.type(input, 'text')

// ❌ 避免：使用 fireEvent
fireEvent.click(button) // 不模拟真实用户行为

// ✅ 好的做法：使用可访问性查询
screen.getByRole('button', { name: '添加' })
screen.getByLabelText('搜索')

// ❌ 避免：使用 test-id 优先
screen.getByTestId('add-button') // 仅作为后备
```

---

## 四、错误处理测试

### 4.1 错误场景清单

| 场景 | Handler | 预期行为 |
|------|---------|---------|
| 网络错误 | `HttpResponse.error()` | 显示错误提示，不崩溃 |
| 500 错误 | `status: 500` | 显示错误提示 |
| 401 认证失败 | `status: 401` | 跳转登录或提示 |
| 404 资源不存在 | `status: 404` | 显示空状态或错误 |
| 请求超时 | `delay(30000)` | 显示超时提示 |
| 数据格式错误 | 返回非预期格式 | 优雅降级 |

### 4.2 测试示例

```tsx
describe('错误处理', () => {
  it('网络错误时应正确处理', async () => {
    server.use(
      http.get('/api/ai-link/list', () => {
        return HttpResponse.error()
      })
    )

    await act(async () => {
      render(<ToolboxRefactoredPage />)
    })

    // 验证不会崩溃
    const store = useToolboxStore.getState()
    expect(store.loading).toBe(false)
  })
})
```

---

## 五、性能测试

### 5.1 性能基准

| 数据量 | 渲染时间要求 | 内存增长要求 |
|--------|-------------|-------------|
| 100 条 | < 500ms | < 10MB |
| 500 条 | < 1000ms | < 30MB |
| 1000 条 | < 2000ms | < 100MB |

### 5.2 测量方法

```tsx
async function measureRenderTime(callback: () => Promise<void>): Promise<number> {
  const start = performance.now()
  await callback()
  const end = performance.now()
  return end - start
}

it('1000 条数据渲染时间应 < 2000ms', async () => {
  const renderTime = await measureRenderTime(async () => {
    await act(async () => {
      render(<ToolboxRefactoredPage />)
    })
  })

  expect(renderTime).toBeLessThan(2000)
})
```

### 5.3 内存测量

```tsx
it('不应导致内存溢出', async () => {
  const initialMemory = process.memoryUsage()?.heapUsed || 0

  // ...渲染组件...

  const finalMemory = process.memoryUsage()?.heapUsed || 0
  const memoryIncrease = finalMemory - initialMemory

  expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024) // 100MB
})
```

---

## 六、可访问性测试

### 6.1 WCAG 2.1 检查清单

| 检查项 | 级别 | 测试方法 |
|--------|------|---------|
| 键盘导航 | A | Tab/Enter/Arrow 键测试 |
| 焦点可见 | AA | 焦点样式检查 |
| 颜色对比度 | AA | 工具检查（如 axe） |
| ARIA 属性 | A | 属性存在性检查 |
| 语义化 HTML | A | role/heading 检查 |
| 屏幕阅读器 | A | aria-live 检查 |

### 6.2 测试示例

```tsx
describe('可访问性', () => {
  it('应该支持键盘导航', async () => {
    const user = userEvent.setup()

    await act(async () => {
      render(<ToolboxRefactoredPage />)
    })

    // Tab 导航
    await user.tab()
    expect(screen.getByRole('tablist')).toHaveFocus()
  })

  it('加载状态应该有 aria-busy', async () => {
    await act(async () => {
      render(<ToolboxRefactoredPage />)
    })

    const spin = screen.getByTestId('spin')
    expect(spin).toHaveAttribute('aria-busy')
  })

  it('按钮应该有 accessible name', () => {
    const button = screen.getByRole('button', { name: '添加' })
    expect(button).toBeInTheDocument()
  })
})
```

### 6.3 axe-core 集成（推荐）

```bash
pnpm add -D jest-axe
```

```tsx
import { axe } from 'jest-axe'

it('不应有 a11y 违规', async () => {
  const { container } = render(<ToolboxRefactoredPage />)
  const results = await axe(container)

  expect(results).toHaveNoViolations()
})
```

---

## 七、E2E 测试运行指南

### 7.1 环境准备

```bash
# 安装 Playwright
pnpm add -D @playwright/test

# 安装浏览器
npx playwright install chromium

# 安装可选依赖（用于认证）
pnpm add -D playwright-msw
```

### 7.2 认证方案

#### 方案一：使用测试账号（推荐）

```ts
// e2e/auth.ts
import { Page } from '@playwright/test'

export async function login(page: Page, credentials: {
  username: string
  password: string
}) {
  await page.goto('/#/login')
  await page.fill('input[name="username"]', credentials.username)
  await page.fill('input[name="password"]', credentials.password)
  await page.click('button[type="submit"]')

  // 等待登录完成
  await page.waitForURL(/#\/index/)
}

// e2e/fixtures/auth.ts
import { test as base } from '@playwright/test'

export const test = base.extend({
  authenticatedPage: async ({ page }, use) => {
    await login(page, {
      username: process.env.TEST_USERNAME!,
      password: process.env.TEST_PASSWORD!,
    })
    await use(page)
  },
})
```

#### 方案二：直接注入 Token

```ts
// e2e/fixtures/auth.ts
import { test as base } from '@playwright/test'

const AUTH_STATE = {
  access_token: process.env.TEST_ACCESS_TOKEN!,
  site_token: process.env.TEST_SITE_TOKEN!,
}

export const test = base.extend({
  authenticatedPage: async ({ page }, use) => {
    await page.goto('/')
    await page.evaluate((auth) => {
      localStorage.setItem('access_token', auth.access_token)
      localStorage.setItem('site_token', auth.site_token)
    }, AUTH_STATE)
    await page.reload()
    await use(page)
  },
})
```

#### 方案三：使用 Playwright Storage State

```ts
// playwright.config.ts
export default defineConfig({
  use: {
    storageState: 'e2e/.auth/user.json',
  },
})

// e2e/auth.setup.ts
import { test as setup, expect } from '@playwright/test'

setup('authenticate', async ({ page }) => {
  await page.goto('/#/login')
  await page.fill('input[name="username"]', 'test@example.com')
  await page.fill('input[name="password"]', 'password')
  await page.click('button[type="submit"]')

  await expect(page).toHaveURL(/#\/index/)

  // 保存认证状态
  await page.context().storageState({ path: 'e2e/.auth/user.json' })
})
```

### 7.3 运行测试

```bash
# 运行所有 E2E 测试
pnpm test:e2e

# 运行特定文件
npx playwright test toolbox.spec.ts

# UI 模式调试
pnpm test:e2e:ui

# 查看测试报告
npx playwright show-report
```

### 7.4 CI/CD 集成

```yaml
# .github/workflows/e2e.yml
name: E2E Tests

on:
  push:
    branches: [main, dev]
  pull_request:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v2
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - run: pnpm install

      - run: npx playwright install --with-deps chromium

      - name: Run E2E tests
        env:
          TEST_USERNAME: ${{ secrets.TEST_USERNAME }}
          TEST_PASSWORD: ${{ secrets.TEST_PASSWORD }}
        run: pnpm test:e2e

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30
```

### 7.5 调试技巧

```ts
// 调试模式
test('调试测试', async ({ page }) => {
  await page.pause() // 暂停执行，打开 Inspector

  // 截图
  await page.screenshot({ path: 'debug.png' })

  // 录制视频（在 config 中配置）
  // video: 'on-first-retry'

  // 打印控制台日志
  page.on('console', msg => console.log(msg.text()))
})
```

---

## 八、测试命令速查

```bash
# 单元测试
pnpm test                          # 运行所有测试
pnpm test:run                      # 运行一次（不监听）
pnpm test:coverage                 # 生成覆盖率报告
pnpm test -- --filter toolbox      # 运行特定模块

# E2E 测试
pnpm test:e2e                      # 运行 E2E 测试
pnpm test:e2e:ui                   # UI 模式
pnpm test:e2e:debug                # 调试模式
npx playwright codegen             # 录制测试

# 类型检查
pnpm type-check                    # TypeScript 检查

# 代码质量
pnpm lint                          # Biome 检查
pnpm lint:fix                      # 自动修复
```

---

## 九、常见问题

### Q1: 测试中如何 mock Zustand store？

```tsx
import { useToolboxStore } from '../store'

beforeEach(() => {
  useToolboxStore.setState({
    // 初始状态
    loading: false,
    list: [],
  })
})
```

### Q2: 如何测试异步操作？

```tsx
import { act, waitFor } from '@testing-library/react'

it('异步操作', async () => {
  await act(async () => {
    render(<Component />)
  })

  await waitFor(() => {
    expect(screen.getByText('结果')).toBeInTheDocument()
  })
})
```

### Q3: 如何测试 React Router 导航？

```tsx
const mockNavigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

it('导航测试', async () => {
  await user.click(screen.getByText('跳转'))
  expect(mockNavigate).toHaveBeenCalledWith('/target')
})
```

### Q4: E2E 测试如何处理动态数据？

```tsx
// 使用时间戳生成唯一数据
const TEST_TOOL = {
  name: `E2E测试工具_${Date.now()}`,
}

// 测试后清理
test.afterEach(async ({ page }) => {
  // 删除测试数据
  await page.request.delete(`/api/ai-link/${testId}`)
})
```
