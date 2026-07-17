import { render, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AdapterProvider, useAgentFormStore } from '@km/shared-business/agent-create'
import { UseScope } from '@km/shared-business/agent-create'
import { getInitialFormData, getInitialState } from '@km/shared-business/agent-create'

/**
 * 构造一个最小可用的 adapter, 只覆盖 UseScope 用到的字段
 */
function makeAdapter() {
  return {
    t: (k: string) => k,
    isIndependent: false,
    isIndustry: false,
    isEnterprise: true, // 启用 isEnterprise 分支
    GROUP_TYPE: { USER: 'user', INTERNAL_USER: 'internal_user', AGENT: 'agent' },
    GroupSelectComponent: undefined, // 关键: 不提供, 让 UseScope 不渲染 GroupSelect
  } as any
}

beforeEach(() => {
  // 每个 case 之前重置 store
  useAgentFormStore.setState({
    ...getInitialState(),
    form_data: getInitialFormData(),
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('UseScope race condition (isNew 陈旧闭包触发默认值)', () => {
  /**
   * 复现 bug:
   * - store 残留 is_new=true (上一路由"新建"页留下的)
   * - UseScope 挂载, useEffect 看到 isNew=true (闭包)
   * - 同步调用 updateField('scopes', [{...全部成员}])
   * - 父组件 reset() 来不及拦截
   *
   * 修复前: scopes 被覆盖为 [{...全部成员}]
   * 修复后: useEffect 内从 store 实时读 is_new, 发现已为 false → 跳过
   */
  it('does not overwrite scopes when is_new flips to false before effect runs', () => {
    // 1. 模拟 store 残留"新建"状态
    useAgentFormStore.setState({
      ...getInitialState(),
      is_new: true,
      form_data: {
        ...getInitialFormData(),
        scopes: [],
      },
    })

    render(
      <AdapterProvider adapter={makeAdapter()}>
        <UseScope />
      </AdapterProvider>
    )

    // 2. 父组件 reset() 切到"编辑"模式 (清空 store, 重新加载数据)
    act(() => {
      useAgentFormStore.setState({
        ...getInitialState(),
        is_new: false,
        form_data: {
          ...getInitialFormData(),
          scopes: [], // 模拟 API 返回空
        },
      })
    })

    // 3. 关键断言: scopes 仍应为空, 不被错误地写入"全部成员"
    const finalScopes = useAgentFormStore.getState().form_data.scopes
    expect(finalScopes).toEqual([])
  })

  /**
   * 边界: 组件 unmount 后, useEffect 不应再触发
   * (useEffect 的清理函数由 React 自动处理, 不需要手动测)
   *
   * 但有一个隐含场景: 父组件在 useEffect 中调用 reset(),
   * 顺序: 子 useEffect (同 tick) → 父 useEffect
   * 如果子 useEffect 已经同步修改了 store, reset() 会覆盖
   * 但如果 reset() 在子 useEffect 之前, 子 useEffect 看到的是 reset 后的状态
   *
   * 关键看 React 的 effect 调用顺序:
   * - React 保证子组件 useEffect 先于父组件 useEffect
   * - 所以 UseScope 的 useEffect 一定在 page useEffect 之前运行
   * - 这意味着 UseScope 看到的是 reset 之前的状态
   *
   * 这就是为什么需要在 useEffect 内实时读 store, 而不是用闭包 isNew
   */

  /**
   * 回归: 新建模式下, store 初始就是 is_new=true, scopes=[],
   * 应正确应用"全部成员"默认值
   */
  it('applies default 全部成员 when is_new is true (new mode regression)', () => {
    useAgentFormStore.setState({
      ...getInitialState(),
      is_new: true,
      form_data: {
        ...getInitialFormData(),
        scopes: [],
      },
    })

    render(
      <AdapterProvider adapter={makeAdapter()}>
        <UseScope />
      </AdapterProvider>
    )

    const finalScopes = useAgentFormStore.getState().form_data.scopes
    expect(finalScopes).toEqual([
      { scope_type: 'company', target_id: 0 },
    ])
  })

  /**
   * 边界: 编辑模式下, store is_new=false, scopes=[] (API 返回空),
   * 不应被改写
   */
  it('does not overwrite when is_new is false from the start (edit mode)', () => {
    useAgentFormStore.setState({
      ...getInitialState(),
      is_new: false,
      form_data: {
        ...getInitialFormData(),
        scopes: [],
      },
    })

    render(
      <AdapterProvider adapter={makeAdapter()}>
        <UseScope />
      </AdapterProvider>
    )

    const finalScopes = useAgentFormStore.getState().form_data.scopes
    expect(finalScopes).toEqual([])
  })
})
