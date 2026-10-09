import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { PermissionSelector } from '../selector'
import { PERMISSION_TYPE } from '../constant'

/**
 * 回归测试：menuItems 的 useMemo 此前未将 handleSelect（闭包了 onChange/onSelect）
 * 纳入依赖，导致父组件重渲染（回调引用更新）而 value 未变化时，
 * 菜单项点击仍调用过期的旧回调。
 *
 * 实际触发场景：添加成员弹窗中先选择 Wiki 权限（行对象被替换），
 * 再修改知识库权限时，过期回调携带旧行对象、按引用匹配失败，更新被静默丢弃。
 */
describe('PermissionSelector 闭包过期回归', () => {
  const openMenuAndClick = async (optionText: string) => {
    // 点击触发按钮展开下拉菜单
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })
    // 点击菜单项（弹出层挂载在 body 下的 portal 中）
    const option = await screen.findByText(optionText)
    await act(async () => {
      fireEvent.click(option)
    })
  }

  it('value 不变而 onChange 引用更新后，点击菜单应调用最新的 onChange', async () => {
    const onChangeOld = vi.fn()
    const onChangeNew = vi.fn()

    const { rerender } = render(
      <PermissionSelector value={PERMISSION_TYPE.viewer} onChange={onChangeOld} none />,
    )

    // 第一次选择：应调用初始 onChange
    await openMenuAndClick('可管理')
    expect(onChangeOld).toHaveBeenCalledWith(PERMISSION_TYPE.manage)
    expect(onChangeNew).not.toHaveBeenCalled()

    // 模拟父组件重渲染：value 未变（仍是 viewer），但传入了新的 onChange 闭包
    // （对应 MemberSelector 中另一权限维度更新导致行对象被替换的场景）
    rerender(
      <PermissionSelector value={PERMISSION_TYPE.viewer} onChange={onChangeNew} none />,
    )

    onChangeOld.mockClear()
    await openMenuAndClick('可管理')

    // 修复前：菜单 onClick 闭包住旧 handleSelect，仍调用 onChangeOld（过期回调）
    expect(onChangeNew).toHaveBeenCalledWith(PERMISSION_TYPE.manage)
    expect(onChangeOld).not.toHaveBeenCalled()
  })

  it('value 不变而 onSelect 引用更新后，点击菜单应调用最新的 onSelect', async () => {
    const onSelectOld = vi.fn()
    const onSelectNew = vi.fn()

    const { rerender } = render(
      <PermissionSelector value={PERMISSION_TYPE.viewer} onSelect={onSelectOld} none />,
    )

    await openMenuAndClick('可查看/导出')
    expect(onSelectOld).toHaveBeenCalledWith(PERMISSION_TYPE.view_and_export)

    rerender(
      <PermissionSelector value={PERMISSION_TYPE.viewer} onSelect={onSelectNew} none />,
    )

    onSelectOld.mockClear()
    await openMenuAndClick('可查看/导出')

    expect(onSelectNew).toHaveBeenCalledWith(PERMISSION_TYPE.view_and_export)
    expect(onSelectOld).not.toHaveBeenCalled()
  })
})
