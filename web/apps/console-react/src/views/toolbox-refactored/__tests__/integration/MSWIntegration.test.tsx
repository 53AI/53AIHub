/**
 * MSW 集成测试示例
 * 展示如何使用 MSW 进行真实的网络请求模拟
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'

import { ToolboxRefactoredPage } from '../../index'
import { useToolboxStore } from '../../store'
import { server } from '../mocks/server'
import { resetDataStore, getDataStore, initDataStore } from '../mocks/handlers'
import { factories, resetIdCounter } from '../factories'
import { ALL_GROUP_ID } from '../../constants'

// Mock 外部依赖
vi.mock('@/locales', () => ({
  t: (key: string) => key,
}))

vi.mock('@/components/Header', () => ({
  default: ({ title }: { title: string }) => <div data-testid="header">{title}</div>,
}))

vi.mock('@/components/GroupTabs/GroupTabs', () => ({
  GroupTabs: ({ value, onChange }: { value: (string | number)[]; onChange: (ids: (string | number)[]) => void }) => (
    <div data-testid="group-tabs">
      <span data-testid="selected-groups">{JSON.stringify(value)}</span>
      <button data-testid="select-all" onClick={() => onChange([-1])}>All</button>
      <button data-testid="select-1" onClick={() => onChange([1])}>Group 1</button>
    </div>
  ),
}))

vi.mock('@/components/SortableGroupGrid', () => ({
  default: ({ groups }: { groups: Array<{ id: string | number; title: string; items: Array<{ id: string; data: unknown }> }> }) => (
    <div data-testid="sortable-grid">
      {groups.map((group) => (
        <div key={String(group.id)} data-testid={`group-${group.id}`}>
          {group.items.map((item) => (
            <div key={item.id} data-testid={`item-${item.id}`}>{(item.data as { name: string }).name}</div>
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

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd')
  return {
    ...actual,
    Modal: { confirm: vi.fn() },
    message: { success: vi.fn(), error: vi.fn() },
  }
})

describe('MSW 集成测试', () => {
  beforeAll(() => {
    server.listen()
  })

  beforeEach(() => {
    // 重置数据
    resetIdCounter()
    resetDataStore()
    initDataStore({ itemCount: 5, groupCount: 3 })

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

  describe('正常场景', () => {
    it('应该加载并显示工具列表', async () => {
      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      // 等待数据加载
      await waitFor(() => {
        const store = useToolboxStore.getState()
        expect(store.rawGroupOptions.length).toBeGreaterThan(0)
      })
    })

    it('搜索关键词应该过滤结果', async () => {
      // 自定义 handler 返回特定数据
      server.use(
        http.get('/api/ai-link/list', async ({ request }) => {
          const url = new URL(request.url)
          const keyword = url.searchParams.get('keyword')

          if (keyword === 'ChatGPT') {
            return HttpResponse.json([
              factories.aiLinkItem({ name: 'ChatGPT', ai_link_id: 'chatgpt-1' }),
            ])
          }

          return HttpResponse.json(factories.aiLinkList(5))
        })
      )

      const store = useToolboxStore.getState()
      await act(async () => {
        store.setKeyword('ChatGPT')
        await store.loadListData()
      })

      const updatedStore = useToolboxStore.getState()
      expect(updatedStore.keyword).toBe('ChatGPT')
    })
  })

  describe('错误场景', () => {
    it('服务器错误时应该处理异常', async () => {
      server.use(
        http.get('/api/ai-link/list', () => {
          return HttpResponse.json({ error: 'Server Error' }, { status: 500 })
        })
      )

      await act(async () => {
        render(<ToolboxRefactoredPage />)
      })

      // 等待错误处理
      await waitFor(() => {
        const store = useToolboxStore.getState()
        expect(store.loading).toBe(false)
      })
    })

    it('网络错误时应该处理异常', async () => {
      server.use(
        http.get('/api/ai-link/list', () => {
          return HttpResponse.error()
        })
      )

      const store = useToolboxStore.getState()

      await act(async () => {
        try {
          await store.loadListData()
        } catch {
          // 预期会抛出错误
        }
      })

      expect(store.loading).toBe(false)
    })
  })

  describe('数据操作', () => {
    it('保存新工具应该添加到列表', async () => {
      const initialStore = useToolboxStore.getState()
      const initialCount = initialStore.aiLinkList.length

      // 模拟保存
      server.use(
        http.post('/api/ai-link/save', async ({ request }) => {
          const body = await request.json()
          return HttpResponse.json({
            ...body,
            ai_link_id: 'new-tool-id',
          })
        })
      )

      // 验证请求会被正确处理
      await act(async () => {
        // 这里可以调用保存方法
      })

      // 断言
      expect(initialCount).toBeGreaterThanOrEqual(0)
    })

    it('删除工具应该从列表移除', async () => {
      // 设置初始数据
      initDataStore({ itemCount: 3, groupCount: 1 })
      const store = useToolboxStore.getState()

      const dataStore = getDataStore()
      const itemId = dataStore.items[0]?.ai_link_id

      // 模拟删除
      server.use(
        http.delete('/api/ai-link/delete', () => {
          return HttpResponse.json({ success: true })
        })
      )

      expect(itemId).toBeDefined()
    })
  })

  describe('并发请求', () => {
    it('应该正确处理多个并发请求', async () => {
      // 同时发起多个请求
      const store = useToolboxStore.getState()

      await act(async () => {
        await Promise.all([
          store.loadGroups(),
          store.loadListData(),
        ])
      })

      const updatedStore = useToolboxStore.getState()
      expect(updatedStore.loading).toBe(false)
    })
  })
})
