import { useEffect, useRef } from 'react'
import { useRecordingFlutterPanel } from '@/stores/modules/recording-flutter-panel'

/**
 * 安心录 Flutter 面板「打开 → 关闭」时触发一次回调。
 *
 * 面板内的 Flutter 页面可能发生创建 / 编辑 / 删除，React 侧数据无法感知，
 * 调用方在面板关闭时统一刷新兜底。
 */
export function useFlutterPanelClosed(handler: () => void): void {
  const isOpen = useRecordingFlutterPanel((s) => s.url !== null)
  // handler 用最新引用执行，避免调用方为绕过闭包把它写进依赖数组
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (wasOpenRef.current && !isOpen) handlerRef.current()
    wasOpenRef.current = isOpen
  }, [isOpen])
}
