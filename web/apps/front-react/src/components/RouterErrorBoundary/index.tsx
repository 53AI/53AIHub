import { ErrorFallback } from '@km/shared-components-react'
import { isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { isChunkLoadError } from '@km/shared-utils'

/**
 * 应用级路由错误边界（data router 版）。
 *
 * 挂到各顶级路由的 errorElement 上。当某条动态 import / 渲染异常一路
 * 没有被下游兜住时（例如没走 lazyWithSuspense 兜底、或运行时抛错），
 * React Router 默认会显示 "Unexpected Application Error!"。
 * 这个组件把丑报错替换成带"刷新"按钮的友好页面，并判定是"页面资源已更新"
 * (chunk 失效) 还是普通渲染错误；具体展示复用共享的 <ErrorFallback />。
 */
export function RouterErrorBoundary() {
  const error = useRouteError()
  const routeResponse = isRouteErrorResponse(error)
  const chunkError = !routeResponse && error instanceof Error && isChunkLoadError(error)

  return (
    <ErrorFallback
      kind={chunkError ? 'update' : 'render'}
      status={routeResponse ? error.status : undefined}
    />
  )
}