import { create } from 'zustand'

/**
 * 安心录右侧 Flutter Web 面板状态。
 *
 * 记忆 / 认知 / 关系页面的「查看」「创建」入口不再走 React 抽屉 / 弹窗，
 * 而是打开本面板加载 Flutter Web 站点（KM-Record）的对应页面。
 * 面板挂在 RecordingView 布局层（界面最右侧、宽 375px），任何子页面
 * 通过本 store 打开 / 关闭，URL 由调用方用 buildFlutterWebUrl 拼接。
 *
 * 面板标题不在这里维护：固定显示 Flutter 应用名（km-ready 消息上报，
 * 见 RecordingFlutterPanel），避免两边文案不同步。
 */
type RecordingFlutterPanelStore = {
  /** 当前加载的 Flutter Web 完整 URL；null 表示面板关闭 */
  url: string | null
  /** 打开面板并加载指定 URL */
  open: (url: string) => void
  /** 关闭面板 */
  close: () => void
}

export const useRecordingFlutterPanel = create<RecordingFlutterPanelStore>((set) => ({
  url: null,
  open: (url) => set({ url }),
  close: () => set({ url: null }),
}))
