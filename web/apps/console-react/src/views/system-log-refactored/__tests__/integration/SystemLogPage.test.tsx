/**
 * SystemLogPage 集成测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

import { SystemLogRefactoredPage } from '../../index'
import { useSystemLogStore } from '../../store'
import { factories, resetIdCounter } from '../factories'

// Mock react-router-dom
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

// Mock locales
vi.mock('@/locales', () => ({
  t: (key: string) => key,
}))

// 渲染包装器
function renderWithRouter(ui: React.ReactElement) {
  return render(ui, {
    wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
  })
}

// Mock API
vi.mock('../../api/systemLogApi', () => ({
  systemLogApi: {
    list: vi.fn(),
    actions: vi.fn(),
    modules: vi.fn(),
  },
  getDefaultListParams: () => ({
    offset: 0,
    limit: 10,
    user_id: null,
    start_time: null,
    end_time: null,
    module: undefined,
    action: undefined,
  }),
  transformSystemLogList: vi.fn((items) => items.map((item: any) => ({
    ...item,
    action_time: '2024-01-01 12:00',
  }))),
}))

import { systemLogApi } from '../../api/systemLogApi'

const mockSystemLogApi = systemLogApi as unknown as {
  list: ReturnType<typeof vi.fn>
  actions: ReturnType<typeof vi.fn>
  modules: ReturnType<typeof vi.fn>
}

// Mock antd
vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd')
  return {
    ...actual,
    Table: ({ dataSource, loading, columns, pagination, onChange }: any) => (
      <div data-testid="table" data-loading={loading}>
        <div data-testid="pagination">
          {pagination?.current || 1} / {pagination?.total || 0}
        </div>
        {dataSource?.map((row: any, index: number) => (
          <div key={row.id || index} data-testid={`row-${index}`}>
            {columns?.map((col: any) => (
              <span key={col.key}>{col.render ? col.render(row[col.dataIndex], row) : row[col.dataIndex]}</span>
            ))}
          </div>
        ))}
      </div>
    ),
    Select: ({ placeholder, options, value, onChange, allowClear }: any) => (
      <select
        data-testid={`select-${placeholder}`}
        value={value || ''}
        onChange={(e) => onChange?.(e.target.value ? Number(e.target.value) : undefined)}
      >
        {allowClear && <option value="">全部</option>}
        {options?.map((opt: any) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    ),
    DatePicker: {
      RangePicker: ({ onChange }: any) => (
        <div data-testid="range-picker">
          <button onClick={() => onChange?.([null, null])}>Clear</button>
        </div>
      ),
    },
  }
})

describe('SystemLogRefactoredPage 集成测试', () => {
  beforeEach(() => {
    resetIdCounter()
    vi.clearAllMocks()

    // 设置 mock 返回值
    mockSystemLogApi.list.mockResolvedValue({
      system_logs: factories.systemLogList(10),
      count: 100,
    })
    mockSystemLogApi.actions.mockResolvedValue(factories.actionItemList(5))
    mockSystemLogApi.modules.mockResolvedValue(factories.moduleItemList(5))

    // 重置 store
    useSystemLogStore.setState({
      list: [],
      total: 0,
      actions: [],
      modules: [],
      params: {
        offset: 0,
        limit: 10,
        user_id: null,
        start_time: null,
        end_time: null,
        module: undefined,
        action: undefined,
      },
      dateRange: [null, null],
      loading: false,
    })
  })

  describe('基础渲染', () => {
    it('应该渲染页面标题', async () => {
      await act(async () => {
        renderWithRouter(<SystemLogRefactoredPage />)
      })

      expect(screen.getByText('module.system_log')).toBeInTheDocument()
    })

    it('应该渲染筛选区域', async () => {
      await act(async () => {
        renderWithRouter(<SystemLogRefactoredPage />)
      })

      expect(screen.getByTestId('range-picker')).toBeInTheDocument()
      expect(screen.getByTestId('select-system_log.log_action')).toBeInTheDocument()
      expect(screen.getByTestId('select-system_log.log_module')).toBeInTheDocument()
    })

    it('应该渲染表格', async () => {
      await act(async () => {
        renderWithRouter(<SystemLogRefactoredPage />)
      })

      expect(screen.getByTestId('table')).toBeInTheDocument()
    })
  })

  describe('数据加载', () => {
    it('应该加载日志列表', async () => {
      await act(async () => {
        renderWithRouter(<SystemLogRefactoredPage />)
      })

      await waitFor(() => {
        expect(mockSystemLogApi.list).toHaveBeenCalled()
      })
    })

    it('应该加载操作类型列表', async () => {
      await act(async () => {
        renderWithRouter(<SystemLogRefactoredPage />)
      })

      await waitFor(() => {
        expect(mockSystemLogApi.actions).toHaveBeenCalled()
      })
    })

    it('应该加载模块列表', async () => {
      await act(async () => {
        renderWithRouter(<SystemLogRefactoredPage />)
      })

      await waitFor(() => {
        expect(mockSystemLogApi.modules).toHaveBeenCalled()
      })
    })
  })

  describe('Store 状态管理', () => {
    it('setParams 应该更新参数并重新加载', async () => {
      const store = useSystemLogStore.getState()

      await act(async () => {
        store.setParams({ action: 1 })
      })

      const updatedStore = useSystemLogStore.getState()
      expect(updatedStore.params.action).toBe(1)
      expect(updatedStore.params.offset).toBe(0) // 应该重置页码
    })

    it('resetParams 应该重置所有参数', async () => {
      const store = useSystemLogStore.getState()

      // 先设置一些参数
      await act(async () => {
        store.setParams({ action: 1, module: 2 })
      })

      // 重置
      await act(async () => {
        store.resetParams()
      })

      const updatedStore = useSystemLogStore.getState()
      expect(updatedStore.params.action).toBeUndefined()
      expect(updatedStore.params.module).toBeUndefined()
    })
  })

  describe('Store loadList 错误处理', () => {
    it('loadList 失败后 loading 应该重置为 false', async () => {
      mockSystemLogApi.list.mockRejectedValueOnce(new Error('API Error'))

      const store = useSystemLogStore.getState()

      await act(async () => {
        try {
          await store.loadList()
        } catch {
          // 预期会抛出错误
        }
      })

      const updated = useSystemLogStore.getState()
      expect(updated.loading).toBe(false)
    })
  })

  describe('表格列渲染', () => {
    it('action 映射成功时应该显示文本', async () => {
      const mockData = [
        { id: 1, action_time: Date.now(), action: 1, module: 1, nickname: '用户', content: '操作', ip: '127.0.0.1' },
      ]
      const mockActions = [{ value: 1, text: '登录' }]
      const mockModules = [{ value: 1, text: '用户管理' }]

      mockSystemLogApi.list.mockResolvedValueOnce({ system_logs: mockData, count: 1 })
      mockSystemLogApi.actions.mockResolvedValueOnce(mockActions)
      mockSystemLogApi.modules.mockResolvedValueOnce(mockModules)

      await act(async () => {
        renderWithRouter(<SystemLogRefactoredPage />)
      })

      await waitFor(() => {
        // 在表格行中查找"登录"文本（排除 select 选项）
        const tableRow = screen.getByTestId('row-0')
        expect(tableRow).toHaveTextContent('登录')
      })
    })

    it('action 映射失败时应该显示原始值', async () => {
      const mockData = [
        { id: 1, action_time: Date.now(), action: 999, module: 999, nickname: '用户', content: '操作', ip: '127.0.0.1' },
      ]
      const mockActions = [{ value: 1, text: '登录' }]
      const mockModules = [{ value: 1, text: '用户管理' }]

      mockSystemLogApi.list.mockResolvedValueOnce({ system_logs: mockData, count: 1 })
      mockSystemLogApi.actions.mockResolvedValueOnce(mockActions)
      mockSystemLogApi.modules.mockResolvedValueOnce(mockModules)

      await act(async () => {
        renderWithRouter(<SystemLogRefactoredPage />)
      })

      await waitFor(() => {
        // 在表格行中查找原始数字（action 和 module 都是 999）
        const tableRow = screen.getByTestId('row-0')
        // action 列应该包含 999
        expect(tableRow.textContent).toContain('999')
      })
    })

    it('module 映射成功时应该显示文本', async () => {
      const mockData = [
        { id: 1, action_time: Date.now(), action: 1, module: 1, nickname: '用户', content: '操作', ip: '127.0.0.1' },
      ]
      const mockActions = [{ value: 1, text: '登录' }]
      const mockModules = [{ value: 1, text: '用户管理' }]

      mockSystemLogApi.list.mockResolvedValueOnce({ system_logs: mockData, count: 1 })
      mockSystemLogApi.actions.mockResolvedValueOnce(mockActions)
      mockSystemLogApi.modules.mockResolvedValueOnce(mockModules)

      await act(async () => {
        renderWithRouter(<SystemLogRefactoredPage />)
      })

      await waitFor(() => {
        // 在表格行中查找"用户管理"文本
        const tableRow = screen.getByTestId('row-0')
        expect(tableRow).toHaveTextContent('用户管理')
      })
    })

    it('actions/modules 为空数组时应显示原始值', async () => {
      const mockData = [
        { id: 1, action_time: Date.now(), action: 1, module: 1, nickname: '用户', content: '操作', ip: '127.0.0.1' },
      ]

      mockSystemLogApi.list.mockResolvedValueOnce({ system_logs: mockData, count: 1 })
      mockSystemLogApi.actions.mockResolvedValueOnce([]) // 空数组
      mockSystemLogApi.modules.mockResolvedValueOnce([]) // 空数组

      await act(async () => {
        renderWithRouter(<SystemLogRefactoredPage />)
      })

      await waitFor(() => {
        const tableRow = screen.getByTestId('row-0')
        // 无法映射，显示原始数字
        expect(tableRow.textContent).toContain('1')
      })
    })
  })

  describe('空数据状态', () => {
    it('应该显示分页总数为 0', async () => {
      mockSystemLogApi.list.mockResolvedValueOnce({ system_logs: [], count: 0 })

      await act(async () => {
        renderWithRouter(<SystemLogRefactoredPage />)
      })

      await waitFor(() => {
        const pagination = screen.getByTestId('pagination')
        expect(pagination).toHaveTextContent('1 / 0')
      })
    })

    it('表格应该渲染空数据', async () => {
      mockSystemLogApi.list.mockResolvedValueOnce({ system_logs: [], count: 0 })

      await act(async () => {
        renderWithRouter(<SystemLogRefactoredPage />)
      })

      await waitFor(() => {
        const table = screen.getByTestId('table')
        expect(table).toBeInTheDocument()
        // 确认没有数据行
        expect(screen.queryByTestId('row-0')).not.toBeInTheDocument()
      })
    })
  })
})
