/**
 * useFlutterPanelMutation（Flutter→宿主写操作上报）协议边界回归测试。
 *
 * 核心回归点：线上载荷的文件 id 是 snake_case `file_id`（与
 * notifyFlutterPanelMutation 的 React→Flutter 方向一致），hook 必须归一化
 * 为 camelCase `fileId` 再回调 —— 曾因直接透传原始载荷导致
 * `mutation.fileId` 永远 undefined，recording 模块的 fileId 判断全部失效
 * （Flutter 关联发言人后的转写刷新、删除当前预览文件的退回被静默丢弃）。
 */
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFlutterPanelMutation } from './useFlutterPanelMutation'

vi.mock('@/utils/config', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    record_flutter_url: 'https://flutter.test/',
  }
})

const FLUTTER_ORIGIN = 'https://flutter.test'

/** 模拟 Flutter 面板（iframe）向宿主 postMessage */
const dispatchFromFlutter = (data: Record<string, unknown>, origin = FLUTTER_ORIGIN) => {
  window.dispatchEvent(new MessageEvent('message', { data, origin }))
}

describe('useFlutterPanelMutation', () => {
  afterEach(() => {
    cleanup()
  })

  it('归一化 file_id → fileId（snake_case 线上协议 → camelCase 回调类型）', () => {
    const handler = vi.fn()
    renderHook(() => useFlutterPanelMutation(handler))

    dispatchFromFlutter({
      type: 'km-recording-mutation',
      module: 'recording',
      action: 'update',
      file_id: 'f-123',
    })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({
      type: 'km-recording-mutation',
      module: 'recording',
      action: 'update',
      fileId: 'f-123',
    })
  })

  it('memory / cognition 模块无 file_id 时 fileId 为 undefined', () => {
    const handler = vi.fn()
    renderHook(() => useFlutterPanelMutation(handler))

    dispatchFromFlutter({
      type: 'km-recording-mutation',
      module: 'memory',
      action: 'create',
    })

    expect(handler).toHaveBeenCalledWith({
      type: 'km-recording-mutation',
      module: 'memory',
      action: 'create',
      fileId: undefined,
    })
  })

  it('归一化 scope=action_items（面板内事项变更 → 宿主重拉 Dock 计数）', () => {
    const handler = vi.fn()
    renderHook(() => useFlutterPanelMutation(handler))

    dispatchFromFlutter({
      type: 'km-recording-mutation',
      module: 'recording',
      action: 'update',
      file_id: 'f-123',
      scope: 'action_items',
    })

    expect(handler).toHaveBeenCalledWith({
      type: 'km-recording-mutation',
      module: 'recording',
      action: 'update',
      fileId: 'f-123',
      scope: 'action_items',
    })
  })

  it('scope 越界值归一化为 undefined', () => {
    const handler = vi.fn()
    renderHook(() => useFlutterPanelMutation(handler))

    dispatchFromFlutter({
      type: 'km-recording-mutation',
      module: 'recording',
      action: 'update',
      file_id: 'f-123',
      scope: 'unknown-scope',
    })

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'f-123', scope: undefined }),
    )
  })

  it('非 Flutter 来源（origin 不匹配）的消息忽略', () => {
    const handler = vi.fn()
    renderHook(() => useFlutterPanelMutation(handler))

    dispatchFromFlutter(
      {
        type: 'km-recording-mutation',
        module: 'recording',
        action: 'delete',
        file_id: 'f-123',
      },
      'https://evil.example.com',
    )

    expect(handler).not.toHaveBeenCalled()
  })

  it('协议结构不合法（module / action 越界）的消息忽略', () => {
    const handler = vi.fn()
    renderHook(() => useFlutterPanelMutation(handler))

    dispatchFromFlutter({
      type: 'km-recording-mutation',
      module: 'recording',
      action: 'upsert',
      file_id: 'f-123',
    })

    expect(handler).not.toHaveBeenCalled()
  })
})
