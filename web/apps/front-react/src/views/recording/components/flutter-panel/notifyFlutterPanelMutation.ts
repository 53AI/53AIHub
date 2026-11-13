import { record_flutter_url } from '@/utils/config'

/**
 * 宿主（KM 前台）→ Flutter Web 面板的写操作同步。
 *
 * 与 `useFlutterPanelMutation`（Flutter→宿主方向）互为镜像：宿主侧的
 * 录音写操作（如预览页「更多 → 删除」）成功后，把变更发给 iframe 里的
 * Flutter 应用，让面板内打开的详情页 / 首页列表同步，两侧「更多」菜单
 * 行为互通。
 *
 * 协议（Flutter 侧 `bindHostCommandListener` 消费）：
 *
 * ```json
 * { "type": "km-recording-mutation", "module": "recording", "action": "delete", "file_id": "…" }
 * ```
 *
 * 面板未打开（iframe 不存在）时消息无处投递，直接跳过——Flutter 侧下次
 * 打开面板会全量重拉，天然拿到最新数据。
 */

/** Flutter Web 面板 iframe 的全局查找 key（见 RecordingFlutterPanel 挂载） */
const PANEL_IFRAME_SELECTOR = 'iframe[data-km-flutter-panel]'

/** 向 Flutter 面板发送录音写操作通知 */
export const notifyFlutterPanelMutation = (
  action: 'create' | 'update' | 'delete',
  fileId: string,
): void => {
  let flutterOrigin = ''
  try {
    flutterOrigin = new URL(record_flutter_url).origin
  } catch {
    return
  }
  const iframe = document.querySelector<HTMLIFrameElement>(PANEL_IFRAME_SELECTOR)
  iframe?.contentWindow?.postMessage(
    { type: 'km-recording-mutation', module: 'recording', action, file_id: fileId },
    flutterOrigin,
  )
}
