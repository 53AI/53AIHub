import { render, act, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DeptMemberPicker } from '../index'
import { loadScopeDictionary } from '@/hooks/useScopeDictionary'

// Mock 共享字典加载器(DeptMemberPicker 内部走 loadScopeDictionary)
vi.mock('@/hooks/useScopeDictionary', () => ({
  loadScopeDictionary: vi.fn(() =>
    Promise.resolve({
      treeData: [
        {
          value: 0,
          label: '全部成员',
          did: 0,
          children: [
            { value: 5, label: '研发部', did: 5, children: [] },
            { value: 6, label: '产品部', did: 6, children: [] },
          ],
        },
      ],
      users: [],
      groups: [],
    })
  ),
  useScopeDictionary: () => null,
  invalidateScopeDictionary: () => {},
}))

vi.mock('@/api/modules/department', () => ({
  departmentApi: {
    fetch_department_tree: vi.fn(() => Promise.resolve([])),
  },
  getRootDepartmentData: vi.fn(() =>
    Promise.resolve({ value: 0, label: '全部成员' })
  ),
}))

vi.mock('@/api/modules/user', () => ({
  INTERNAL_USER_STATUS_ALL: 0,
  userApi: {
    fetch_internal_user: vi.fn(() => Promise.resolve({ list: [] })),
  },
}))

vi.mock('@/api/modules/group', () => ({
  groupApi: {
    list: vi.fn(() => Promise.resolve([])),
  },
}))

vi.mock('@/locales', () => ({ t: (k: string) => k }))

async function flushMicrotasksOnly() {
  await act(async () => {
    for (let i = 0; i < 10; i++) {
      await Promise.resolve()
    }
  })
}

describe('DeptMemberPicker department mode (tree in modal)', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  /**
   * 复现 UserInternalEditDrawer 的 bug:
   * type="department" 时 init 只在 ["general","user"] 分支里 setTreeData,
   * department 类型永远不设置 treeData → 点"修改"打开弹窗后部门树为空
   */
  it('renders department tree inside the picker modal for type="department"', async () => {
    render(
      <DeptMemberPicker
        type="department"
        value={[{ name: '研发部', label: '研发部', value: 5 }]}
        onChange={vi.fn()}
      />
    )

    // 等待字典加载完成
    await flushMicrotasksOnly()

    // 点击"修改"按钮打开选择弹窗
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'action_modify' }))
    })

    // 弹窗内的部门树应显示部门 (修复前 treeData=[], 树为空)
    expect(await screen.findByText('研发部', { selector: 'div' })).toBeInTheDocument()
    expect(await screen.findByText('产品部', { selector: 'div' })).toBeInTheDocument()
  })

  it('still merges users into tree for type="user"', async () => {
    vi.mocked(loadScopeDictionary).mockReturnValueOnce(
      Promise.resolve({
        treeData: [
          {
            value: 0,
            label: '全部成员',
            did: 0,
            children: [{ value: 5, label: '研发部', did: 5, children: [] }],
          },
        ],
        users: [
          {
            value: 9,
            nickname: '张三',
            user_id: 9,
            dept_id_list: [],
            children: [],
          } as any,
        ],
        groups: [],
      }) as any
    )

    render(
      <DeptMemberPicker
        type="user"
        value={[]}
        onChange={vi.fn()}
      />
    )

    await flushMicrotasksOnly()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'action_add' }))
    })

    // 用户模式下树里应同时有部门和成员
    expect(await screen.findByText('研发部', { selector: 'div' })).toBeInTheDocument()
    expect(await screen.findByText('张三', { selector: 'div' })).toBeInTheDocument()
  })
})
