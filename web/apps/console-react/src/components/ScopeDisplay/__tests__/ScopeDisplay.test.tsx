import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ScopeDisplay from '../index'
import { departmentApi } from '@/api/modules/department'
import { userApi } from '@/api/modules/user'
import { groupApi } from '@/api/modules/group'

// Mock APIs
vi.mock('@/api/modules/department', () => ({
  departmentApi: {
    fetch_department_tree: vi.fn(() =>
      Promise.resolve([
        { value: 1, label: '技术部', did: 1, children: [] },
      ])
    ),
  },
  getRootDepartmentData: vi.fn(() =>
    Promise.resolve({ value: 0, label: '全部成员' })
  ),
}))

vi.mock('@/api/modules/user', () => ({
  INTERNAL_USER_STATUS_ALL: 0,
  userApi: {
    fetch_internal_user: vi.fn(() =>
      Promise.resolve({
        list: [
          { user_id: 100, nickname: '张三' },
          { user_id: 101, nickname: '李四' },
        ],
      })
    ),
  },
}))

vi.mock('@/api/modules/group', () => ({
  groupApi: {
    list: vi.fn(() =>
      Promise.resolve([
        { group_id: 10, group_name: '管理员组' },
      ])
    ),
  },
}))

describe('ScopeDisplay', () => {
  it('should render "--" when scopes is undefined', () => {
    render(<ScopeDisplay />)
    expect(screen.getByText('--')).toBeInTheDocument()
  })

  it('should render "--" when scopes is empty array', () => {
    render(<ScopeDisplay scopes={[]} />)
    expect(screen.getByText('--')).toBeInTheDocument()
  })
})

describe('ScopeDisplay Rendering', () => {
  it('should render company scope', async () => {
    render(<ScopeDisplay scopes={[{ scope_type: 'company', target_id: 0 }]} />)

    await waitFor(() => {
      expect(screen.getByText('全部成员')).toBeInTheDocument()
    })
  })

  it('should render department scope', async () => {
    render(<ScopeDisplay scopes={[{ scope_type: 'department', target_id: 1 }]} />)

    await waitFor(() => {
      expect(screen.getByText('技术部')).toBeInTheDocument()
    })
  })

  it('should render user scope', async () => {
    render(<ScopeDisplay scopes={[{ scope_type: 'user', target_id: 100 }]} />)

    await waitFor(() => {
      expect(screen.getByText('张三')).toBeInTheDocument()
    })
  })

  it('should render group scope', async () => {
    render(<ScopeDisplay scopes={[{ scope_type: 'group', target_id: 10 }]} />)

    await waitFor(() => {
      expect(screen.getByText('管理员组')).toBeInTheDocument()
    })
  })

  it('should show +n when more than 3 items in compact mode', async () => {
    const scopes = [
      { scope_type: 'company' as const, target_id: 0 },
      { scope_type: 'department' as const, target_id: 1 },
      { scope_type: 'user' as const, target_id: 100 },
      { scope_type: 'user' as const, target_id: 101 },
    ]

    render(<ScopeDisplay scopes={scopes} compact />)

    await waitFor(() => {
      expect(screen.getByText('+1')).toBeInTheDocument()
    })
  })
})

describe('ScopeDisplay external dictionary (avoids N+1 API calls)', () => {
  beforeEach(() => {
    vi.mocked(departmentApi.fetch_department_tree).mockClear()
    vi.mocked(userApi.fetch_internal_user).mockClear()
    vi.mocked(groupApi.list).mockClear()
  })

  it('does NOT call any API when all three external data sources are provided', async () => {
    const treeData = [{ value: 1, label: '预置部门', did: 1, children: [] }]
    const users = [{ value: 200, label: '外部用户', user_id: 200 }]
    const groups = [{ value: 20, label: '外部分组' }]

    render(
      <ScopeDisplay
        scopes={[
          { scope_type: 'department', target_id: 1 },
          { scope_type: 'user', target_id: 200 },
          { scope_type: 'group', target_id: 20 },
        ]}
        treeData={treeData}
        users={users}
        groups={groups}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('预置部门')).toBeInTheDocument()
      expect(screen.getByText('外部用户')).toBeInTheDocument()
      expect(screen.getByText('外部分组')).toBeInTheDocument()
    })

    expect(departmentApi.fetch_department_tree).not.toHaveBeenCalled()
    expect(userApi.fetch_internal_user).not.toHaveBeenCalled()
    expect(groupApi.list).not.toHaveBeenCalled()
  })

  it('falls back to API call when external data is missing', async () => {
    // 仅提供 treeData,users/groups 走默认加载
    render(
      <ScopeDisplay
        scopes={[{ scope_type: 'user', target_id: 100 }]}
        treeData={[{ value: 1, label: '占位', did: 1, children: [] }]}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('张三')).toBeInTheDocument()
    })

    expect(userApi.fetch_internal_user).toHaveBeenCalledTimes(1)
    expect(groupApi.list).toHaveBeenCalledTimes(1)
  })
})