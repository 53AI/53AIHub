import { useEffect, useRef } from 'react'
import { record_flutter_url } from '@/utils/config'

/** Flutter Web 面板（iframe）上报的写操作消息 */
export type FlutterPanelMutation = {
  type: 'km-recording-mutation'
  /** memory=实体记忆；cognition=认知与领域；recording=录音文件级变更（删除 / 总结模块新增） */
  module: 'memory' | 'cognition' | 'recording'
  action: 'create' | 'update' | 'delete'
  /** recording 模块必带：变更针对的录音文件 id */
  fileId?: string
  /**
   * 变更内容范围（仅 recording + update 有意义），宿主据此决定重拉哪块：
   * - `transcript`（缺省）= 转写 markdown 被重写（如关联发言人）；
   * - `action_items` = 提议 / 行动 / 成果数量变化（Dock 三入口计数）。
   */
  scope?: 'transcript' | 'action_items'
}

/**
 * 监听 Flutter Web 面板（iframe）内的增 / 改 / 删，实时刷新本页数据。
 *
 * Flutter 侧（KM-Record `notifyHostMutation`）在写操作成功后向宿主
 * postMessage；本 hook 校验消息来源（origin 必须是 Flutter Web 站点）与
 * 协议结构后回调。线上载荷的文件 id 字段是 snake_case `file_id`（双向
 * 协议一致），本 hook 归一化为 camelCase `fileId` 再回调。页面按 module 过滤自己关心的模块：
 * - 记忆 / 关系页 → `module === 'memory'`
 * - 认知页 → `module === 'cognition'`
 * - 录音布局（列表 + 预览页）→ `module === 'recording'`，按 action 分发：
 *   delete → 列表移除 + 预览页退回；create → 预览页重拉 fileSummaries。
 */
export function useFlutterPanelMutation(handler: (mutation: FlutterPanelMutation) => void): void {
  // handler 用最新引用执行，避免调用方为绕过闭包把它写进依赖数组
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    // 配置异常（非法 URL）时收不到合法来源的消息，直接不监听
    let flutterOrigin = ''
    try {
      flutterOrigin = new URL(record_flutter_url).origin
    } catch {
      return
    }

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== flutterOrigin) return
      const data = event.data as
        | (Partial<FlutterPanelMutation> & { file_id?: unknown; scope?: unknown })
        | null
      if (
        !data ||
        data.type !== 'km-recording-mutation' ||
        (data.module !== 'memory' && data.module !== 'cognition' && data.module !== 'recording') ||
        (data.action !== 'create' && data.action !== 'update' && data.action !== 'delete')
      ) {
        return
      }
      // 协议边界归一化：线上载荷是 snake_case `file_id`（与
      // notifyFlutterPanelMutation 的 React→Flutter 方向一致），本 hook
      // 对外暴露 camelCase `fileId`。直接透传会让消费方的 `mutation.fileId`
      // 永远是 undefined —— recording 模块的 fileId 判断全部失效，消息被
      // 静默丢弃（关联发言人后的转写刷新、删除当前预览文件的退回都中过招）。
      handlerRef.current({
        type: 'km-recording-mutation',
        module: data.module,
        action: data.action,
        fileId: typeof data.file_id === 'string' ? data.file_id : undefined,
        scope:
          data.scope === 'action_items' || data.scope === 'transcript'
            ? data.scope
            : undefined,
      })
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])
}
