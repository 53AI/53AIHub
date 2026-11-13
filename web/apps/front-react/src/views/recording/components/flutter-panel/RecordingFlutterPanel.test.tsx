/**
 * Flutter 面板（iframe）宿主侧消息链路集成测试。
 *
 * 覆盖「预览页切换文件时面板跟随切换」的完整时序：
 * 1. 首次 open → iframe 设 src（boot，不重载）
 * 2. Flutter km-ready → isReady 置位
 * 3. 再次 open（切换文件）→ 发 km-navigate（不改 src）
 * 4. 引擎未就绪时 open → 积压，km-ready 后补发
 * 5. boot 期间（未 ready）连续切换 → 只补发最后一个目标
 */
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRecordingFlutterPanel } from '@/stores/modules/recording-flutter-panel'
import { buildFlutterWebUrl } from './flutterUrl'
import { RecordingFlutterPanel } from './RecordingFlutterPanel'

vi.mock('@/utils/config', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    record_flutter_url: 'https://flutter.test/',
    api_host: 'https://api.test',
  }
})

const FLUTTER_ORIGIN = 'https://flutter.test'

/** 模拟 Flutter → 宿主的 postMessage（km-ready 等） */
const dispatchFromFlutter = (data: Record<string, unknown>) => {
  window.dispatchEvent(
    new MessageEvent('message', { data, origin: FLUTTER_ORIGIN }),
  )
}

const getIframe = (): HTMLIFrameElement => {
  const iframe = document.querySelector<HTMLIFrameElement>('iframe[data-km-flutter-panel]')
  if (!iframe) throw new Error('panel iframe not mounted')
  return iframe
}

describe('RecordingFlutterPanel 消息链路', () => {
  beforeEach(() => {
    useRecordingFlutterPanel.getState().close()
    // 交接参数（km_token）取自登录态：jsdom 无真实登录流程，种一个 token
    localStorage.setItem('access_token', 'test-token')
  })

  afterEach(() => {
    cleanup()
    useRecordingFlutterPanel.getState().close()
    localStorage.removeItem('access_token')
    vi.restoreAllMocks()
  })

  it('首次 open 设 iframe src；km-ready 后切换文件发 km-navigate，不改 src', async () => {
    render(<RecordingFlutterPanel />)

    // 首次打开：detail/1 深链（探讨）
    const bootUrl = buildFlutterWebUrl('/recording/detail/1', { discuss: 1, _t: 111 })
    useRecordingFlutterPanel.getState().open(bootUrl)

    await waitFor(() => {
      expect(getIframe().src).toBe(bootUrl)
    })
    const srcAfterBoot = getIframe().src

    // Flutter 引擎就绪
    dispatchFromFlutter({ type: 'km-ready', app: '测试应用' })
    await waitFor(() => {
      expect(document.body.textContent).toContain('测试应用')
    })

    // 切换文件：宿主 effect open detail/2（带 handoff 参数）
    const postMessageSpy = vi.spyOn(
      window,
      'postMessage',
    )
    // iframe.contentWindow 的 postMessage 由面板调用；jsdom 下 spy window.postMessage
    // 不覆盖 iframe 的 contentWindow，改为在 iframe 上 spy
    const iframeSpy = vi.spyOn(getIframe().contentWindow!, 'postMessage')

    useRecordingFlutterPanel
      .getState()
      .open(buildFlutterWebUrl('/recording/detail/2'))

    await waitFor(() => {
      expect(iframeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'km-navigate' }),
        FLUTTER_ORIGIN,
      )
    })

    // km-navigate 的 path 是 hash 段（站内路径 + handoff 参数）
    const call = iframeSpy.mock.calls.find(([msg]) =>
      (msg as { type?: string })?.type === 'km-navigate',
    )
    const path = (call?.[0] as { path?: string })?.path ?? ''
    expect(path.startsWith('/recording/detail/2?')).toBe(true)
    expect(path).toContain('km_token=')

    // src 不变（不重载 iframe）
    expect(getIframe().src).toBe(srcAfterBoot)
    postMessageSpy.mockRestore()
  })

  it('引擎未就绪时切换文件 → 积压，km-ready 后补发最新目标', async () => {
    render(<RecordingFlutterPanel />)

    // 首次打开（boot，引擎未就绪）
    useRecordingFlutterPanel
      .getState()
      .open(buildFlutterWebUrl('/recording/detail/1', { discuss: 1, _t: 111 }))
    await waitFor(() => {
      expect(getIframe().src).toContain('/recording/detail/1')
    })

    // boot 期间连续切换两次（模拟快速点左侧列表）
    useRecordingFlutterPanel.getState().open(buildFlutterWebUrl('/recording/detail/2'))
    useRecordingFlutterPanel.getState().open(buildFlutterWebUrl('/recording/detail/3'))

    // km-ready 到达 → 补发积压（最后一个目标 detail/3）
    const iframeSpy = vi.spyOn(getIframe().contentWindow!, 'postMessage')
    dispatchFromFlutter({ type: 'km-ready', app: '测试应用' })

    await waitFor(() => {
      const calls = iframeSpy.mock.calls.filter(
        ([msg]) => (msg as { type?: string })?.type === 'km-navigate',
      )
      expect(calls.length).toBeGreaterThan(0)
    })
    const paths = iframeSpy.mock.calls
      .filter(([msg]) => (msg as { type?: string })?.type === 'km-navigate')
      .map(([msg]) => (msg as { path?: string }).path)
    // 只补发最后一个目标，且是站内路径
    expect(paths).toEqual([expect.stringContaining('/recording/detail/3')])
  })

  it('km-close-panel（Flutter 删除面板正显示的录音）→ 收起面板', async () => {
    render(<RecordingFlutterPanel />)

    // 打开面板（boot）
    useRecordingFlutterPanel
      .getState()
      .open(buildFlutterWebUrl('/recording/detail/1'))
    await waitFor(() => {
      expect(getIframe().src).toContain('/recording/detail/1')
    })
    expect(useRecordingFlutterPanel.getState().url).not.toBeNull()

    // Flutter 详情页删除该录音 → 请求宿主收起面板
    dispatchFromFlutter({ type: 'km-close-panel' })

    await waitFor(() => {
      expect(useRecordingFlutterPanel.getState().url).toBeNull()
    })
    // keepMounted：iframe 不卸载（保活，重开即显）
    expect(getIframe()).toBeTruthy()
  })

  it('非 Flutter 来源的 km-close-panel 忽略', async () => {
    render(<RecordingFlutterPanel />)

    useRecordingFlutterPanel
      .getState()
      .open(buildFlutterWebUrl('/recording/detail/1'))
    await waitFor(() => {
      expect(getIframe().src).toContain('/recording/detail/1')
    })

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'km-close-panel' },
        origin: 'https://evil.example.com',
      }),
    )

    // 同步断言：面板未收起
    expect(useRecordingFlutterPanel.getState().url).not.toBeNull()
  })
})
