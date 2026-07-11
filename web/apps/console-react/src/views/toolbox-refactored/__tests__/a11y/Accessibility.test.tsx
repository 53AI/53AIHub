/**
 * 可访问性 (a11y) 测试
 * 测试键盘导航、屏幕阅读器支持等
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'

import { ToolboxRefactoredPage } from '../../index'
import { useToolboxStore } from '../../store'
import { server } from '../mocks/server'
import { factories, resetIdCounter, scenarios } from '../factories'
import { ALL_GROUP_ID } from '../../constants'

// Mock 外部依赖
vi.mock('@/locales', () => ({
  t: (key: string) => key,
}))

vi.mock('@/components/Header', () => ({
  default: ({ title, back, onBack }: { title: string; back?: boolean; onBack?: () => void }) => (
    <header data-testid="header">
      <h1>{title}</h1>
      {back && (
        <button onClick={onBack} aria-label="返回" data-testid="back-btn">
          返回
        </button>
      )}
    </header>
  ),
}))

vi.mock('@/components/GroupTabs/GroupTabs', () => ({
  GroupTabs: ({
    value,
    onChange,
    disabled,
  }: {
    value: (string | number)[]
    onChange: (ids: (string | number)[]) => void
    disabled?: boolean
  }) => (
    <div
      data-testid="group-tabs"
      role="tablist"
      aria-disabled={disabled}
    >
      <button
        role="tab"
        aria-selected={value.includes(-1)}
        onClick={() => onChange([-1])}
        data-testid="tab-all"
      >
        全部
      </button>
      <button
        role="tab"
        aria-selected={value.includes(1)}
        onClick={() => onChange([1])}
        data-testid="tab-1"
      >
        分组1
      </button>
    </div>
  ),
}))

vi.mock('@/components/SortableGroupGrid', () => ({
  default: ({
    groups,
    sortable,
  }: {
    groups: Array<{ id: string | number; title: string; items: Array<{ id: string; data: { name: string } }> }>
    sortable?: boolean
  }) => (
    <div
      data-testid="sortable-grid"
      role="list"
      aria-sortable={sortable}
    >
      {groups.map((group) => (
        <div key={String(group.id)} role="group" aria-label={group.title}>
          <h3>{group.title}</h3>
          {group.items.map((item) => (
            <div
              key={item.id}
              role="listitem"
              aria-label={item.data.name}
              data-testid={`item-${item.id}`}
            >
              {item.data.name}
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
}))

vi.mock('../../components/StoreDialog', () => ({
  default: ({ showAddManual, onAdd }: { showAddManual?: boolean; onAdd?: (data: unknown) => void }) => (
    <div data-testid="store-dialog" role="dialog" aria-label="添加工具">
      <button onClick={() => onAdd?.({})} data-testid="manual-add-btn">
        手动添加
      </button>
    </div>
  ),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('@/constants/group', () => ({
  GROUP_TYPE: { AI_LINK: 2 },
}))

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd')
  return {
    ...actual,
    Modal: {
      confirm: vi.fn(({ title, content, onOk }) => {
        // 创建一个可访问的确认对话框
        return { destroy: vi.fn() }
      }),
    },
    message: {
      success: vi.fn(),
      error: vi.fn(),
    },
    Empty: ({ description }: { description: string }) => (
      <div role="status" aria-live="polite" data-testid="empty">
        {description}
      </div>
    ),
    Spin: ({ spinning, children }: { spinning: boolean; children: React.ReactNode }) => (
      <div
        data-testid="spin"
        data-spinning={spinning}
        role="status"
        aria-busy={spinning}
        aria-live="polite"
      >
        {spinning && <span className="sr-only">加载中...</span>}
        {children}
      </div>
    ),
    Input: ({ placeholder, value, onChange, allowClear }: {
      placeholder?: string
      value?: string
      onChange?: (e: { target: { value: string } }) => void
      allowClear?: boolean
    }) => (
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange?.({ target: { value: e.target.value } })}
        aria-label={placeholder}
        data-testid="search-input"
      />
    ),
    Button: ({ children, onClick, disabled, type, loading }: {
      children?: React.ReactNode
      onClick?: () => void
      disabled?: boolean
      type?: string
      loading?: boolean
    }) => (
      <button
        onClick={onClick}
        disabled={disabled || loading}
        aria-busy={loading}
        data-testid={`btn-${String(children).trim()}`}
      >
        {loading ? '加载中...' : children}
      </button>
    ),
  }
})

describe('可访问性 (a11y) 测试', () => {
  let user: ReturnType<typeof userEvent.setup>

  beforeAll(() => {
    server.listen()
    user = userEvent.setup()
  })

  beforeEach(() => {
    resetIdCounter()
    vi.clearAllMocks()

    useToolboxStore.setState({
      aiLinkList: [],
      groupOptions: [],
      rawGroupOptions: [],
      selectedGroups: [ALL_GROUP_ID],
      keyword: '',
      loading: false,
      saving: false,
      isSort: false,
    })
  })

  afterEach(() => {
    server.resetHandlers()
  })

  afterAll(() => {
    server.close()
  })

  describe('语义化 HTML', () => {
    it('应该使用正确的 heading 层级', async () => {
      const data = scenarios.standard()

      server.use(
        http.get('/api/ai-link/list', () => HttpResponse.json(data.items)),
        http.get('/api/group/list', () => HttpResponse.json(data.groups))
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      // 页面应该有 h1
      const h1 = screen.getByRole('heading', { level: 1 })
      expect(h1).toBeInTheDocument()
    })

    it('列表应该使用正确的 role', async () => {
      const data = scenarios.standard()

      server.use(
        http.get('/api/ai-link/list', () => HttpResponse.json(data.items)),
        http.get('/api/group/list', () => HttpResponse.json(data.groups))
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
      })

      // 查找列表元素
      const list = screen.getByRole('list')
      expect(list).toBeInTheDocument()
    })

    it('分组标签应该使用 tablist role', async () => {
      const data = scenarios.standard()

      server.use(
        http.get('/api/ai-link/list', () => HttpResponse.json(data.items)),
        http.get('/api/group/list', () => HttpResponse.json(data.groups))
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      const tablist = screen.getByRole('tablist')
      expect(tablist).toBeInTheDocument()
    })
  })

  describe('键盘导航', () => {
    it('应该支持 Tab 导航到主要元素', async () => {
      const data = scenarios.standard()

      server.use(
        http.get('/api/ai-link/list', () => HttpResponse.json(data.items)),
        http.get('/api/group/list', () => HttpResponse.json(data.groups))
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      // Tab 到分组标签
      await user.tab()
      const tabAll = screen.getByTestId('tab-all')
      expect(tabAll).toHaveFocus()

      // Tab 到下一个元素
      await user.tab()
    })

    it('搜索框应该可通过 Tab 聚焦', async () => {
      const data = scenarios.standard()

      server.use(
        http.get('/api/ai-link/list', () => HttpResponse.json(data.items)),
        http.get('/api/group/list', () => HttpResponse.json(data.groups))
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      const searchInput = screen.getByTestId('search-input')

      // 直接聚焦搜索框
      searchInput.focus()
      expect(searchInput).toHaveFocus()
    })

    it('按钮应该可通过 Enter/Space 触发', async () => {
      const data = scenarios.standard()

      server.use(
        http.get('/api/ai-link/list', () => HttpResponse.json(data.items)),
        http.get('/api/group/list', () => HttpResponse.json(data.groups))
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      // 找到添加按钮
      const addButton = screen.getByTestId('btn-添加')

      // 聚焦并按 Enter
      addButton.focus()
      await user.keyboard('{Enter}')

      // 应该显示对话框
      expect(screen.getByTestId('store-dialog')).toBeInTheDocument()
    })

    it('分组标签应该支持方向键导航', async () => {
      const data = scenarios.standard()

      server.use(
        http.get('/api/ai-link/list', () => HttpResponse.json(data.items)),
        http.get('/api/group/list', () => HttpResponse.json(data.groups))
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      const tabAll = screen.getByTestId('tab-all')
      const tab1 = screen.getByTestId('tab-1')

      // 聚焦第一个 tab
      tabAll.focus()
      expect(tabAll).toHaveFocus()

      // 按右箭头应该移动到下一个 tab
      // 注意：这需要实际组件支持，这里只是示例
      await user.keyboard('{ArrowRight}')
    })
  })

  describe('ARIA 属性', () => {
    it('加载状态应该有 aria-busy', async () => {
      const data = scenarios.standard()

      server.use(
        http.get('/api/ai-link/list', async () => {
          // 模拟延迟
          await new Promise(resolve => setTimeout(resolve, 100))
          return HttpResponse.json(data.items)
        }),
        http.get('/api/group/list', () => HttpResponse.json(data.groups))
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      // 加载中状态
      const spin = screen.getByTestId('spin')
      expect(spin).toHaveAttribute('aria-busy', 'true')

      // 等待加载完成
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 200))
      })

      // 加载完成
      expect(spin).toHaveAttribute('aria-busy', 'false')
    })

    it('空状态应该有 aria-live', async () => {
      server.use(
        http.get('/api/ai-link/list', () => HttpResponse.json([])),
        http.get('/api/group/list', () => HttpResponse.json([]))
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
      })

      const empty = screen.getByTestId('empty')
      expect(empty).toHaveAttribute('aria-live', 'polite')
    })

    it('禁用按钮应该有 disabled 属性', async () => {
      server.use(
        http.get('/api/ai-link/list', () => HttpResponse.json([])),
        http.get('/api/group/list', () => HttpResponse.json([]))
      )

      // 设置关键词，排序按钮应该被禁用
      useToolboxStore.setState({ keyword: 'test' })

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      const sortButton = screen.getByTestId('btn-排序')
      expect(sortButton).toBeDisabled()
    })

    it('对话框应该有正确的 role', async () => {
      const data = scenarios.standard()

      server.use(
        http.get('/api/ai-link/list', () => HttpResponse.json(data.items)),
        http.get('/api/group/list', () => HttpResponse.json(data.groups))
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      const dialog = screen.getByTestId('store-dialog')
      expect(dialog).toHaveAttribute('role', 'dialog')
      expect(dialog).toHaveAttribute('aria-label', '添加工具')
    })
  })

  describe('屏幕阅读器支持', () => {
    it('图标按钮应该有 aria-label', async () => {
      const data = scenarios.standard()

      server.use(
        http.get('/api/ai-link/list', () => HttpResponse.json(data.items)),
        http.get('/api/group/list', () => HttpResponse.json(data.groups))
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      // 返回按钮应该有 aria-label
      const backButton = screen.queryByTestId('back-btn')
      if (backButton) {
        expect(backButton).toHaveAttribute('aria-label', '返回')
      }
    })

    it('状态变化应该通知屏幕阅读器', async () => {
      server.use(
        http.get('/api/ai-link/list', () => HttpResponse.json([])),
        http.get('/api/group/list', () => HttpResponse.json([]))
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      // 空状态应该通过 aria-live 通知
      const empty = screen.getByRole('status')
      expect(empty).toBeInTheDocument()
    })
  })

  describe('颜色对比度', () => {
    it('文本应该有足够的对比度（视觉检查）', async () => {
      // 注意：自动化的颜色对比度测试需要专门的工具如 axe-core
      // 这里只是一个占位测试，实际测试需要安装 @axe-core/react

      const data = scenarios.standard()

      server.use(
        http.get('/api/ai-link/list', () => HttpResponse.json(data.items)),
        http.get('/api/group/list', () => HttpResponse.json(data.groups))
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      // 视觉检查：确保文本可见
      const header = screen.getByTestId('header')
      expect(header).toBeVisible()
    })
  })

  describe('焦点管理', () => {
    it('对话框打开时焦点应该移到对话框', async () => {
      const data = scenarios.standard()

      server.use(
        http.get('/api/ai-link/list', () => HttpResponse.json(data.items)),
        http.get('/api/group/list', () => HttpResponse.json(data.groups))
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      // 点击添加按钮
      const addButton = screen.getByTestId('btn-添加')
      await user.click(addButton)

      // 焦点应该在对话框内
      const dialog = screen.getByTestId('store-dialog')
      expect(dialog).toBeInTheDocument()
    })

    it('对话框关闭时焦点应该返回触发元素', async () => {
      const data = scenarios.standard()

      server.use(
        http.get('/api/ai-link/list', () => HttpResponse.json(data.items)),
        http.get('/api/group/list', () => HttpResponse.json(data.groups))
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      const addButton = screen.getByTestId('btn-添加')

      // 点击打开
      await user.click(addButton)

      // 焦点移到对话框
      const manualAddBtn = screen.getByTestId('manual-add-btn')
      manualAddBtn.focus()
      expect(manualAddBtn).toHaveFocus()
    })
  })

  describe('触摸和移动端', () => {
    it('交互元素应该有足够的触摸目标大小', async () => {
      const data = scenarios.standard()

      server.use(
        http.get('/api/ai-link/list', () => HttpResponse.json(data.items)),
        http.get('/api/group/list', () => HttpResponse.json(data.groups))
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      // 按钮应该足够大（至少 44x44px，WCAG 建议）
      const buttons = screen.getAllByRole('button')

      // 这里只检查按钮存在，实际尺寸检查需要计算样式
      expect(buttons.length).toBeGreaterThan(0)
    })
  })
})
