import { useEffect, useRef, useState } from 'react'
import { CloseOutlined } from '@ant-design/icons'
import { Button, Spin } from 'antd'
import { SidePanel } from '@km/shared-components-react'
import { useRecordingFlutterPanel } from '@/stores/modules/recording-flutter-panel'
import { extractFlutterPath } from './panelPath'
import { record_flutter_url } from '@/utils/config'

/** 面板宽度：375px（手机标准宽度，与 Flutter Web 移动端布局一致） */
const PANEL_WIDTH = 375

/** Flutter Web 站点 origin（postMessage targetOrigin 与消息来源校验） */
const FLUTTER_ORIGIN = (() => {
  try {
    return new URL(record_flutter_url).origin
  } catch {
    return ''
  }
})()

/**
 * 安心录右侧 Flutter Web 面板。
 *
 * 需求：记忆 / 认知 / 关系的「查看详情」「创建」在界面最右侧打开 375px
 * 宽的 iframe，加载 Flutter Web 站点（KM-Record）对应页面。
 *
 * 加载性能两层优化（Flutter Web 整站启动慢，避免每次打开都重载）：
 * 1. 保活：SidePanel 传 keepMounted，关闭只收起不卸载 iframe，
 *    Flutter 应用与已加载数据常驻，重开即显；
 * 2. 站内导航：首次打开设 src 启动 Flutter（登录态 + 目标路径在 URL 上），
 *    之后打开 / 切换目标页不再改 src，改发 km-navigate 让 Flutter 用
 *    go_router 站内跳转（毫秒级）。引擎就绪前（km-ready）的导航先积压，
 *    就绪后补发，避免丢失。
 *
 * 注意：iframe 与主站不同源，登录态随 URL hash 交接给 Flutter
 * （km_token / km_user_id，见 flutterUrl.ts），Flutter 启动时写入自己的
 * 持久化，免登录直接进入对应页面。
 */
export function RecordingFlutterPanel() {
  const url = useRecordingFlutterPanel((s) => s.url)
  const close = useRecordingFlutterPanel((s) => s.close)
  const isOpen = url !== null

  // 面板标题：固定显示 Flutter 应用名（km-ready 携带，来自 Flutter l10n
  // appTitle），避免 Flutter 侧改名后这边残留旧文案。首启 km-ready 到达前
  // 的兜底值，到达后自动覆盖；语言切换导致应用名变化时也会跟随更新。
  const [appTitle, setAppTitle] = useState('二号总裁')

  const iframeRef = useRef<HTMLIFrameElement>(null)
  /** 首次打开的完整 URL：iframe 的 src 只设这一次，之后不再重载 */
  const [bootUrl, setBootUrl] = useState<string | null>(null)
  const hasBootedRef = useRef(false)
  /** Flutter 引擎就绪（收到 km-ready）后才能用 km-navigate 站内导航 */
  const isReadyRef = useRef(false)
  /** 引擎就绪前积压的导航目标，收到 km-ready 后补发 */
  const pendingPathRef = useRef<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // 打开 / 切换目标页：首次设 src 启动 Flutter；之后站内导航
  useEffect(() => {
    if (!url || !FLUTTER_ORIGIN) return
    if (!hasBootedRef.current) {
      hasBootedRef.current = true
      setBootUrl(url)
      setIsLoading(true)
      return
    }
    // hash 段即 Flutter 站内路径（含查询参数）
    const path = extractFlutterPath(url)
    if (isReadyRef.current) {
      iframeRef.current?.contentWindow?.postMessage({ type: 'km-navigate', path }, FLUTTER_ORIGIN)
    } else {
      pendingPathRef.current = path
    }
  }, [url])

  // Flutter → 宿主：km-ready（引擎就绪，补发积压导航）、km-close-panel
  // （Flutter 侧删除了面板正在显示的录音 —— 详情页删除 / 宿主删除同步
  // 时面板正开着该详情，内容已没了，面板请求宿主收起自己）。
  useEffect(() => {
    if (!FLUTTER_ORIGIN) return
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== FLUTTER_ORIGIN) return
      const data = event.data as { type?: string; app?: unknown } | null
      if (data?.type === 'km-close-panel') {
        close()
        return
      }
      if (data?.type !== 'km-ready') return
      isReadyRef.current = true
      setIsLoading(false)
      if (typeof data.app === 'string' && data.app) setAppTitle(data.app)
      const pending = pendingPathRef.current
      if (pending) {
        pendingPathRef.current = null
        iframeRef.current?.contentWindow?.postMessage({ type: 'km-navigate', path: pending }, FLUTTER_ORIGIN)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [close])

  return (
    <SidePanel side="right" width={PANEL_WIDTH} open={isOpen} keepMounted>
      {/* m-2 rounded-2xl：悬浮卡片样式，与 erhao.html 入口 main 卡片同款。
          间距用内层 p-2 包裹而不是 SidePanel 外层 margin —— 关闭收起时
          不占布局空间，main 不会被顶开。 */}
      <div className="h-full p-2 pl-0">
        <div className="flex h-full flex-col rounded-2xl bg- border bg-white overflow-hidden">
          <div className="flex h-[52px] flex-none items-center justify-between gap-2 border-b border-[#E8EAED] px-4">
            <span className="truncate text-sm font-medium text-[#1D1E1F]">{appTitle}</span>
            <Button type="text" size="small" aria-label="关闭" icon={<CloseOutlined />} onClick={close} />
          </div>
          <div className="relative min-h-0 flex-1">
            {isLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white">
                <Spin />
              </div>
            )}
            {bootUrl && (
              <iframe
                ref={iframeRef}
                src={bootUrl}
                title={appTitle}
                data-km-flutter-panel
                className="h-full w-full border-0"
                onLoad={() => {
                  setIsLoading(false)
                  // iframe 重载（如 Flutter 热重启）后新实例尚未绑定导航监听，
                  // 重置就绪标记，后续打开先积压、等新实例的 km-ready 再补发。
                  isReadyRef.current = false
                }}
              />
            )}
          </div>
        </div>
      </div>
    </SidePanel>
  )
}
