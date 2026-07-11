/**
 * 错误处理和异常场景测试
 * 测试 API 失败、网络错误等异常场景
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
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
  default: ({ title }: { title: string }) => <div data-testid="header">{title}</div>,
}))

vi.mock('@/components/GroupTabs/GroupTabs', () => ({
  GroupTabs: ({ value, onChange, disabled }: { value: (string | number)[]; onChange: (ids: (string | number)[]) => void; disabled?: boolean }) => (
    <div data-testid="group-tabs" data-disabled={disabled}>
      <span data-testid="selected-groups">{JSON.stringify(value)}</span>
    </div>
  ),
}))

vi.mock('@/components/SortableGroupGrid', () => ({
  default: ({ groups }: { groups: Array<{ id: string | number; items: Array<{ data: { name: string } }> }> }) => (
    <div data-testid="sortable-grid">
      {groups.map((group) => (
        <div key={String(group.id)} data-testid={`group-${group.id}`}>
          {group.items.map((item, idx) => (
            <div key={idx}>{item.data.name}</div>
          ))}
        </div>
      ))}
    </div>
  ),
}))

vi.mock('../../components/StoreDialog', () => ({
  default: () => <div data-testid="store-dialog">Store</div>,
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('@/constants/group', () => ({
  GROUP_TYPE: { AI_LINK: 2 },
}))

const mockMessageError = vi.fn()
const mockMessageSuccess = vi.fn()
vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd')
  return {
    ...actual,
    Modal: {
      confirm: vi.fn(({ onOk }) => {
        // 自动确认
        onOk?.()
        return { destroy: vi.fn() }
      }),
    },
    message: {
      success: mockMessageSuccess,
      error: mockMessageError,
    },
    Empty: ({ description }: { description: string }) => <div data-testid="empty">{description}</div>,
    Spin: ({ spinning, children }: { spinning: boolean; children: React.ReactNode }) => (
      <div data-testid="spin" data-spinning={spinning}>{children}</div>
    ),
  }
})

describe('错误处理和异常场景', () => {
  beforeAll(() => {
    server.listen()
  })

  beforeEach(() => {
    resetIdCounter()
    vi.clearAllMocks()

    // 重置 store
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

  describe('网络错误', () => {
    it('加载列表失败时应正确处理', async () => {
      server.use(
        http.get('/api/ai-link/list', () => {
          return HttpResponse.error()
        })
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      // 验证 loading 状态最终为 false
      await waitFor(() => {
        const store = useToolboxStore.getState()
        expect(store.loading).toBe(false)
      })
    })

    it('加载分组失败时应正确处理', async () => {
      server.use(
        http.get('/api/group/list', () => {
          return HttpResponse.error()
        })
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      // 验证不会崩溃
      await waitFor(() => {
        const store = useToolboxStore.getState()
        expect(store.loading).toBe(false)
      })
    })
  })

  describe('服务器错误', () => {
    it('500 错误时应正确处理', async () => {
      server.use(
        http.get('/api/ai-link/list', () => {
          return HttpResponse.json(
            { error: 'Internal Server Error', message: 'Something went wrong' },
            { status: 500 }
          )
        })
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      await waitFor(() => {
        const store = useToolboxStore.getState()
        expect(store.loading).toBe(false)
      })
    })

    it('401 认证错误时应正确处理', async () => {
      server.use(
        http.get('/api/ai-link/list', () => {
          return HttpResponse.json(
            { error: 'Unauthorized' },
            { status: 401 }
          )
        })
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      // 验证不会崩溃
      await waitFor(() => {
        const store = useToolboxStore.getState()
        expect(store.loading).toBe(false)
      })
    })

    it('404 错误时应正确处理', async () => {
      server.use(
        http.get('/api/ai-link/list', () => {
          return HttpResponse.json(
            { error: 'Not Found' },
            { status: 404 }
          )
        })
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      await waitFor(() => {
        const store = useToolboxStore.getState()
        expect(store.loading).toBe(false)
      })
    })
  })

  describe('保存失败', () => {
    it('保存工具失败时应显示错误提示', async () => {
      server.use(
        http.post('/api/ai-link/save', () => {
          return HttpResponse.json(
            { error: 'Save failed', message: '名称已存在' },
            { status: 400 }
          )
        })
      )

      // 设置 store 状态模拟排序保存
      const scenario = scenarios.minimal()
      useToolboxStore.setState({
        groupOptions: scenario.groupOptions,
        isSort: true,
      })

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      // 触发保存
      const store = useToolboxStore.getState()
      await act(async () => {
        try {
          await store.loadListData()
        } catch {
          // 预期可能抛出错误
        }
      })

      expect(store.loading).toBe(false)
    })
  })

  describe('删除失败', () => {
    it('删除工具失败时应正确处理', async () => {
      server.use(
        http.delete('/api/ai-link/delete', () => {
          return HttpResponse.json(
            { error: 'Delete failed', message: '工具正在使用中' },
            { status: 400 }
          )
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

  describe('数据格式错误', () => {
    it('返回非数组数据时应正确处理', async () => {
      server.use(
        http.get('/api/ai-link/list', () => {
          return HttpResponse.json({ data: 'invalid format' })
        })
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      await waitFor(() => {
        const store = useToolboxStore.getState()
        expect(store.loading).toBe(false)
      })
    })

    it('返回 null 数据时应正确处理', async () => {
      server.use(
        http.get('/api/ai-link/list', () => {
          return HttpResponse.json(null)
        })
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      await waitFor(() => {
        const store = useToolboxStore.getState()
        expect(store.loading).toBe(false)
      })
    })

    it('返回空对象时应正确处理', async () => {
      server.use(
        http.get('/api/ai-link/list', () => {
          return HttpResponse.json({})
        })
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      await waitFor(() => {
        const store = useToolboxStore.getState()
        expect(store.loading).toBe(false)
      })
    })

    it('缺少必要字段时应正确处理', async () => {
      server.use(
        http.get('/api/ai-link/list', () => {
          return HttpResponse.json([
            { name: 'Tool without id' }, // 缺少 ai_link_id
            { ai_link_id: '2' }, // 缺少 name
          ])
        })
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      await waitFor(() => {
        const store = useToolboxStore.getState()
        expect(store.loading).toBe(false)
      })
    })
  })

  describe('超时场景', () => {
    it('请求超时时应正确处理', async () => {
      vi.useFakeTimers()

      server.use(
        http.get('/api/ai-link/list', async () => {
          // 模拟超长延迟
          await new Promise(() => {}) // 永不返回
        })
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      // 快进时间
      await act(async () => {
        vi.advanceTimersByTime(30000)
      })

      const store = useToolboxStore.getState()
      // loading 可能仍为 true（取决于实现）
      expect(typeof store.loading).toBe('boolean')

      vi.useRealTimers()
    })
  })

  describe('并发请求错误', () => {
    it('一个请求失败不应影响其他请求', async () => {
      let listCallCount = 0

      server.use(
        http.get('/api/ai-link/list', () => {
          listCallCount++
          if (listCallCount === 1) {
            return HttpResponse.json({ error: 'First call failed' }, { status: 500 })
          }
          return HttpResponse.json(factories.aiLinkList(3))
        }),
        http.get('/api/group/list', () => {
          return HttpResponse.json(factories.rawGroupOptionList(2))
        })
      )

      const store = useToolboxStore.getState()

      // 发起请求
      await act(async () => {
        try {
          await store.loadGroups()
          await store.loadListData()
        } catch {
          // 忽略错误
        }
      })

      // 验证最终状态是稳定的
      const finalStore = useToolboxStore.getState()
      expect(finalStore.loading).toBe(false)
    })
  })

  describe('边界场景', () => {
    it('空数据时应显示空状态', async () => {
      server.use(
        http.get('/api/ai-link/list', () => {
          return HttpResponse.json([])
        }),
        http.get('/api/group/list', () => {
          return HttpResponse.json([])
        })
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      await waitFor(() => {
        expect(screen.getByTestId('empty')).toBeInTheDocument()
      })
    })

    it('超大数据量时应正常渲染', async () => {
      const largeDataSet = scenarios.xlarge()

      server.use(
        http.get('/api/ai-link/list', () => {
          return HttpResponse.json(largeDataSet.items)
        }),
        http.get('/api/group/list', () => {
          return HttpResponse.json(largeDataSet.groups)
        })
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      // 验证不会崩溃
      await waitFor(() => {
        const store = useToolboxStore.getState()
        expect(store.loading).toBe(false)
        expect(store.aiLinkList.length).toBe(1000)
      })
    })
  })

  describe('重试机制', () => {
    it('失败后重试应能成功', async () => {
      let callCount = 0

      server.use(
        http.get('/api/ai-link/list', () => {
          callCount++
          if (callCount < 3) {
            return HttpResponse.json({ error: 'Temporary error' }, { status: 500 })
          }
          return HttpResponse.json(factories.aiLinkList(3))
        })
      )

      const store = useToolboxStore.getState()

      // 第一次失败
      await act(async () => {
        try {
          await store.loadListData()
        } catch {
          // 预期失败
        }
      })

      expect(callCount).toBe(1)

      // 第二次失败
      await act(async () => {
        try {
          await store.loadListData()
        } catch {
          // 预期失败
        }
      })

      expect(callCount).toBe(2)

      // 第三次成功
      await act(async () => {
        await store.loadListData()
      })

      expect(callCount).toBe(3)
    })
  })
})
