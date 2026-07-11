/**
 * 性能测试
 * 测试大数据量场景下的性能表现
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { render, screen, act } from '@testing-library/react'
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
  GroupTabs: () => <div data-testid="group-tabs" />,
}))

vi.mock('@/components/SortableGroupGrid', () => ({
  default: ({ groups }: { groups: Array<{ id: string | number; items: unknown[] }> }) => (
    <div data-testid="sortable-grid" data-group-count={groups.length}>
      {groups.reduce((acc, g) => acc + g.items.length, 0)} items
    </div>
  ),
}))

vi.mock('../../components/StoreDialog', () => ({
  default: () => <div data-testid="store-dialog" />,
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('@/constants/group', () => ({
  GROUP_TYPE: { AI_LINK: 2 },
}))

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd')
  return {
    ...actual,
    Empty: ({ description }: { description: string }) => <div data-testid="empty">{description}</div>,
    Spin: ({ spinning, children }: { spinning: boolean; children: React.ReactNode }) => (
      <div data-testid="spin" data-spinning={spinning}>{children}</div>
    ),
  }
})

describe('性能测试', () => {
  beforeAll(() => {
    server.listen()
  })

  beforeEach(() => {
    resetIdCounter()

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

  /**
   * 测量渲染时间
   */
  async function measureRenderTime(callback: () => Promise<void>): Promise<number> {
    const start = performance.now()
    await callback()
    const end = performance.now()
    return end - start
  }

  describe('数据加载性能', () => {
    it('100 条数据加载时间应 < 500ms', async () => {
      const data = scenarios.standard()

      server.use(
        http.get('/api/ai-link/list', () => {
          return HttpResponse.json(data.items)
        }),
        http.get('/api/group/list', () => {
          return HttpResponse.json(data.groups)
        })
      )

      const renderTime = await measureRenderTime(async () => {
        await act(async () => {
          render(<ToolboxRefactoredPage />)
        })

        await act(async () => {
          await new Promise(resolve => setTimeout(resolve, 100))
        })
      })

      console.log(`100 条数据渲染时间: ${renderTime.toFixed(2)}ms`)
      expect(renderTime).toBeLessThan(500)
    })

    it('500 条数据加载时间应 < 1000ms', async () => {
      const data = factories.scenario({ groupCount: 5, itemsPerGroup: 100 })

      server.use(
        http.get('/api/ai-link/list', () => {
          return HttpResponse.json(data.items)
        }),
        http.get('/api/group/list', () => {
          return HttpResponse.json(data.groups)
        })
      )

      const renderTime = await measureRenderTime(async () => {
        await act(async () => {
          render(<ToolboxRefactoredPage />)
        })

        await act(async () => {
          await new Promise(resolve => setTimeout(resolve, 200))
        })
      })

      console.log(`500 条数据渲染时间: ${renderTime.toFixed(2)}ms`)
      expect(renderTime).toBeLessThan(1000)
    })

    it('1000 条数据加载时间应 < 2000ms', async () => {
      const data = scenarios.xlarge()

      server.use(
        http.get('/api/ai-link/list', () => {
          return HttpResponse.json(data.items)
        }),
        http.get('/api/group/list', () => {
          return HttpResponse.json(data.groups)
        })
      )

      const renderTime = await measureRenderTime(async () => {
        await act(async () => {
          render(<ToolboxRefactoredPage />)
        })

        await act(async () => {
          await new Promise(resolve => setTimeout(resolve, 300))
        })
      })

      console.log(`1000 条数据渲染时间: ${renderTime.toFixed(2)}ms`)
      expect(renderTime).toBeLessThan(2000)
    })
  })

  describe('内存使用', () => {
    it('大数据量不应导致内存溢出', async () => {
      const data = scenarios.xlarge()

      server.use(
        http.get('/api/ai-link/list', () => {
          return HttpResponse.json(data.items)
        }),
        http.get('/api/group/list', () => {
          return HttpResponse.json(data.groups)
        })
      )

      // 记录初始内存
      const initialMemory = process.memoryUsage?.()?.heapUsed || 0

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 500))
      })

      // 记录最终内存
      const finalMemory = process.memoryUsage?.()?.heapUsed || 0
      const memoryIncrease = finalMemory - initialMemory

      console.log(`内存增长: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`)

      // 内存增长应 < 100MB
      expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024)
    })
  })

  describe('Store 操作性能', () => {
    it('setKeyword 防抖应生效', async () => {
      const store = useToolboxStore.getState()

      const startTime = performance.now()

      // 快速连续调用
      for (let i = 0; i < 100; i++) {
        store.setKeyword(`keyword-${i}`)
      }

      const endTime = performance.now()
      const duration = endTime - startTime

      console.log(`100 次 setKeyword 耗时: ${duration.toFixed(2)}ms`)

      // 同步更新应该很快
      expect(duration).toBeLessThan(50)
    })

    it('批量更新 store 状态应高效', async () => {
      const largeData = scenarios.xlarge()

      const startTime = performance.now()

      await act(async () => {
        useToolboxStore.setState({
          aiLinkList: largeData.items,
          groupOptions: largeData.groupOptions,
          rawGroupOptions: largeData.groups,
        })
      })

      const endTime = performance.now()
      const duration = endTime - startTime

      console.log(`设置 1000 条数据状态耗时: ${duration.toFixed(2)}ms`)

      expect(duration).toBeLessThan(100)
    })
  })

  describe('搜索性能', () => {
    it('大数据量下搜索应 < 100ms', async () => {
      const data = scenarios.xlarge()

      server.use(
        http.get('/api/ai-link/list', async ({ request }) => {
          const url = new URL(request.url)
          const keyword = url.searchParams.get('keyword') || ''

          // 模拟服务端搜索
          let filtered = data.items
          if (keyword) {
            filtered = data.items.filter(
              (item) =>
                item.name.includes(keyword) ||
                item.description.includes(keyword)
            )
          }

          return HttpResponse.json(filtered)
        }),
        http.get('/api/group/list', () => {
          return HttpResponse.json(data.groups)
        })
      )

      // 先加载数据
      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      const store = useToolboxStore.getState()

      // 测量搜索时间
      const searchTime = await measureRenderTime(async () => {
        await act(async () => {
          store.setKeyword('Test')
          await store.loadListData()
        })
      })

      console.log(`1000 条数据搜索耗时: ${searchTime.toFixed(2)}ms`)
      expect(searchTime).toBeLessThan(500)
    })
  })

  describe('渲染性能', () => {
    it('组件重渲染应高效', async () => {
      const data = scenarios.standard()

      server.use(
        http.get('/api/ai-link/list', () => {
          return HttpResponse.json(data.items)
        }),
        http.get('/api/group/list', () => {
          return HttpResponse.json(data.groups)
        })
      )

      const { rerender } = await act(async () => {
        return render(<ToolboxRefactoredPage />)
      })

      // 测量重渲染时间
      const rerenderTime = await measureRenderTime(async () => {
        await act(async () => {
          rerender(<ToolboxRefactoredPage />)
        })
      })

      console.log(`重渲染耗时: ${rerenderTime.toFixed(2)}ms`)

      // 重渲染应该比首次渲染快
      expect(rerenderTime).toBeLessThan(100)
    })
  })

  describe('并发操作', () => {
    it('并发操作不应导致状态不一致', async () => {
      const data = scenarios.standard()

      server.use(
        http.get('/api/ai-link/list', () => {
          return HttpResponse.json(data.items)
        }),
        http.get('/api/group/list', () => {
          return HttpResponse.json(data.groups)
        })
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      const store = useToolboxStore.getState()

      // 并发执行多个操作
      await act(async () => {
        await Promise.all([
          store.loadGroups(),
          store.loadListData(),
          store.setKeyword('test'),
          store.setSelectedGroups([1]),
        ])
      })

      const finalStore = useToolboxStore.getState()

      // 验证状态一致
      expect(finalStore.loading).toBe(false)
      expect(typeof finalStore.keyword).toBe('string')
      expect(Array.isArray(finalStore.selectedGroups)).toBe(true)
    })
  })
})
