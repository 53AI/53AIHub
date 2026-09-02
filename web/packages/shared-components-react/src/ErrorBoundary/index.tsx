import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from 'antd'
import { forceReload, isChunkLoadError } from '@km/shared-utils'

/**
 * 应用级错误兜底展示页。
 *
 * 纯展示组件，不依赖路由上下文，供两类入口复用：
 * - front-react 的 data router errorElement（通过 useRouteError 判定后传入 props）
 * - console-react 的 React 错误边界（componentDidCatch 后传入 props）
 *
 * 只渲染"页面资源已更新(chunk 失效)"或"普通渲染错误"两种文案，
 * 并提供一个统一走 shared-utils `forceReload` 的刷新按钮。
 */
export interface ErrorFallbackProps {
  /** update = 页面资源已更新（chunk 失效，建议刷新加载新版本）；render = 普通渲染错误 */
  kind: 'update' | 'render'
  /** 可选：HTTP/路由错误状态码（如 404/500） */
  status?: number
}

export function ErrorFallback({ kind, status }: ErrorFallbackProps) {
  const isUpdate = kind === 'update'
  const title = isUpdate ? '页面资源已更新' : '页面加载出错了'
  const description = isUpdate
    ? '检测到页面文件已更新，请点击下方按钮刷新加载最新版本。'
    : '暂时无法接着渲染当前页面，请尝试刷新。'

  return (
    <div
      style={{
        width: '100%',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
        background: '#f5f6f8',
        color: '#1d1e1f',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <h1 style={{ fontSize: 22, margin: 0 }}>{title}</h1>
      <p style={{ margin: 0, color: '#6b7280', textAlign: 'center' }}>{description}</p>
      {status != null && <p style={{ margin: 0, color: '#6b7280' }}>错误码：{status}</p>}
      <Button type="primary" onClick={forceReload}>
        立即刷新
      </Button>
    </div>
  )
}

/**
 * 错误边界（class 组件）。
 *
 * 供声明式路由（`<HashRouter>/<Routes>`）使用——react-router 声明式 API
 * 下没有 data router 的 `errorElement`，需要用 React 自身错误边界捕获
 * 子组件渲染期抛出的错误（含懒加载失败），避免整棵路由子树被卸载成白屏。
 * 将它包在 `<Suspense><Routes>...</Routes></Suspense>` 外层即可。
 */
interface AppErrorBoundaryProps {
  children: ReactNode
  /** 可选：自定义 fallback；缺省使用共享的 <ErrorFallback /> */
  fallback?: ReactNode
}

interface AppErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // chunk 失效路径已由各 app 的 lazyWithCatch / setupChunkErrorHandler 处理，
    // 这里只记录，不重复触发副作用（避免在渲染错误边界里再引发刷新而丢状态）。
    if (error instanceof Error) console.error('[AppErrorBoundary] 捕获到渲染错误:', error, info)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    if (this.props.fallback) return this.props.fallback
    const chunkError = this.state.error != null && isChunkLoadError(this.state.error)
    return <ErrorFallback kind={chunkError ? 'update' : 'render'} />
  }
}