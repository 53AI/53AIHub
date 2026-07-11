import React, { Suspense, useMemo } from 'react'
import { Spin } from 'antd'

export interface LazyPageProps {
  loader: () => Promise<any>
}

export function LazyPage({ loader }: LazyPageProps) {
  const LazyComponent = useMemo(() => React.lazy(async () => {
    try {
      const component = await loader()
      return typeof component === 'function' || (typeof component === 'object' && component !== null && !component.default)
        ? { default: component }
        : component
    } catch (error) {
      console.error('Failed to load component', error)
      return { default: () => <div>Failed to load</div> }
    }
  }), [loader])

  return (
    <Suspense fallback={
      <div className="w-full h-full flex items-center justify-center min-h-[200px]">
        <Spin size="large" />
      </div>
    }>
      <LazyComponent />
    </Suspense>
  )
}

export default LazyPage
