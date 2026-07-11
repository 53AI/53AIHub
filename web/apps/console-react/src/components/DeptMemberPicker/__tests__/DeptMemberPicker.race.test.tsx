import { render, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DeptMemberPicker } from '../index'

// Mock APIs (匹配 ScopeDisplay 测试的 mock pattern)
vi.mock('@/api/modules/department', () => ({
  departmentApi: {
    fetch_department_tree: vi.fn(() =>
      Promise.resolve([{ value: 0, label: '全部成员', did: 0, children: [] }])
    ),
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

/**
 * 工具函数: 只 flush microtask chain, 不触发任何 timer
 * 用 fake timers 时, microtask 仍然正常处理, 我们需要让 init useEffect 的
 * async chain (多个 await) 跑完, 但 setTimeout 不触发
 */
async function flushMicrotasksOnly() {
  await act(async () => {
    // 多次 await Promise.resolve() 让所有 microtask boundary 都跑完
    // init useEffect 里有 ~5 个 await
    for (let i = 0; i < 10; i++) {
      await Promise.resolve()
    }
  })
}

describe('DeptMemberPicker race condition (edit mode default 全部成员 override)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  /**
   * 复现 bug:
   * - 编辑模式下, store 残留 is_new=true (来自上一路由"新建"页)
   * - 首次渲染 defaultFirstValue=true, 组件挂载后启动异步 fetch
   * - 异步完成时条件满足 → 调度 setTimeout(..., 0) 准备写入"全部成员"
   * - 父组件 reset() 后 defaultFirstValue 翻转为 false
   * - 此时 setTimeout 仍待触发
   *
   * 修复前: setTimeout 仍触发, onChange 被覆盖为 "全部成员"
   * 修复后: setTimeout 触发前 re-check defaultFirstValue, 发现已为 false → 跳过
   */
  it('does not overwrite when defaultFirstValue flips to false before timer fires', async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <DeptMemberPicker
        type="scope"
        simpleValue
        value={[]}
        defaultFirstValue={true}
        onChange={onChange}
      />
    )

    // 让 init useEffect 的 async chain 跑完, setTimeout 入队但不触发
    await flushMicrotasksOnly()

    // 模拟父组件 reset() 后: isNew=false → defaultFirstValue=false
    rerender(
      <DeptMemberPicker
        type="scope"
        simpleValue
        value={[]}
        defaultFirstValue={false}
        onChange={onChange}
      />
    )

    // 让 rerender 后的 ref 同步 effect 跑完
    await flushMicrotasksOnly()

    // 现在推进 timer, setTimeout 触发, 回调内 re-check 应发现 defaultFirstValue=false
    await act(async () => {
      vi.runAllTimers()
    })

    // 关键断言: onChange 不应被覆盖为"全部成员"
    expect(onChange).not.toHaveBeenCalledWith([
      { scope_type: 'company', target_id: 0 },
    ])
  })

  /**
   * 边界: 组件 unmount 时清理 in-flight timer
   * 修复前: unmount 后 setTimeout 仍触发 → 幽灵调用 onChange
   * 修复后: unmount cleanup 清空 pendingTimersRef
   */
  it('does not call onChange after unmount', async () => {
    const onChange = vi.fn()
    const { unmount } = render(
      <DeptMemberPicker
        type="scope"
        simpleValue
        value={[]}
        defaultFirstValue={true}
        onChange={onChange}
      />
    )

    // 让 setTimeout 入队但不触发
    await flushMicrotasksOnly()

    unmount()

    // unmount 后推进 timer
    await act(async () => {
      vi.runAllTimers()
    })

    expect(onChange).not.toHaveBeenCalled()
  })

  /**
   * 回归测试: 新建模式下 defaultFirstValue=true 且 value=[] 时,
   * 默认全公司仍应被正确应用
   */
  it('applies default 全部成员 in new mode (regression)', async () => {
    const onChange = vi.fn()
    render(
      <DeptMemberPicker
        type="scope"
        simpleValue
        value={[]}
        defaultFirstValue={true}
        onChange={onChange}
      />
    )

    // 先让 microtask chain 跑完 (init useEffect 的多个 await)
    await flushMicrotasksOnly()
    // 再触发 timer
    await act(async () => {
      vi.runAllTimers()
    })

    expect(onChange).toHaveBeenCalledWith([
      { scope_type: 'company', target_id: 0 },
    ])
  })

  /**
   * 边界: value 已被外部填入时, setTimeout 触发前应 re-check 不覆盖
   * 模拟场景: 编辑模式 API 返回非空 scopes, 但 setTimeout 已从某次调度入队
   */
  it('does not overwrite when value is populated before timer fires', async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <DeptMemberPicker
        type="scope"
        simpleValue
        value={[]}
        defaultFirstValue={true}
        onChange={onChange}
      />
    )

    // 让 setTimeout 入队
    await flushMicrotasksOnly()

    // 模拟 API 加载完成, value 变成非空
    rerender(
      <DeptMemberPicker
        type="scope"
        simpleValue
        value={[{ scope_type: 'department', target_id: 5 }]}
        defaultFirstValue={true}
        onChange={onChange}
      />
    )

    await flushMicrotasksOnly()

    // 推进 timer, setTimeout 触发, 回调内 re-check 应发现 value 不为空
    await act(async () => {
      vi.runAllTimers()
    })

    // 关键断言: onChange 不应被覆盖为"全部成员"
    expect(onChange).not.toHaveBeenCalledWith([
      { scope_type: 'company', target_id: 0 },
    ])
  })
})
