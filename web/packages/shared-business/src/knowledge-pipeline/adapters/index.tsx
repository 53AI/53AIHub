import { createContext, useContext, ReactNode, useMemo, useState, useEffect, useCallback } from 'react'
import type {
  IDataPipelineAdapter,
  AdapterContextValue,
  PipelineListParams,
  PipelineListResponse,
  PipelineCreateParams,
  PipelineUpdateParams,
  VectorEmbeddingConfig,
  VectorTestResult,
  GraphTemplate,
} from './types'
import type { ParseMethod, Pipeline } from '../types'

// 重命名导出以避免与其他模块冲突
export type {
  IDataPipelineAdapter,
  PipelineListParams,
  PipelineListResponse,
  PipelineCreateParams,
  PipelineUpdateParams,
  ParseMethod,
  VectorEmbeddingConfig,
  VectorTestResult,
  GraphTemplate,
}
export type { AdapterContextValue as PipelineAdapterContextValue } from './types'

const AdapterContext = createContext<AdapterContextValue>({
  adapter: undefined,
  isReady: false,
})

export interface PipelineAdapterProviderProps {
  adapter?: IDataPipelineAdapter
  children: ReactNode
}

/**
 * 适配器 Provider
 * 应用层需要传入实现了 IDataPipelineAdapter 接口的适配器实例
 */
export function PipelineAdapterProvider({ adapter, children }: PipelineAdapterProviderProps) {
  const value = useMemo<AdapterContextValue>(
    () => ({
      adapter,
      isReady: !!adapter,
    }),
    [adapter]
  )

  return <AdapterContext.Provider value={value}>{children}</AdapterContext.Provider>
}

/**
 * 获取适配器上下文
 */
export function usePipelineAdapterContext(): AdapterContextValue {
  return useContext(AdapterContext)
}

/**
 * 获取数据管线适配器
 */
export function usePipelineAdapter(): IDataPipelineAdapter | undefined {
  const { adapter } = useContext(AdapterContext)
  return adapter
}

/**
 * 获取管线列表
 */
export function usePipelines(params?: PipelineListParams) {
  const { adapter, isReady } = useContext(AdapterContext)
  const [data, setData] = useState<PipelineListResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const load = useCallback(() => {
    if (!isReady || !adapter) return

    setLoading(true)
    adapter
      .getPipelines(params)
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [adapter, isReady, params])

  useEffect(() => {
    load()
  }, [load])

  return { data, loading, error, refetch: load }
}

/**
 * 获取单个管线
 */
export function usePipelineData(id: string | number | undefined) {
  const { adapter, isReady } = useContext(AdapterContext)
  const [data, setData] = useState<Pipeline | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!isReady || !adapter || !id) return

    setLoading(true)
    adapter
      .getPipeline(id)
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [adapter, isReady, id])

  return { data, loading, error }
}

/**
 * 获取解析方法列表
 */
export function useParseMethods() {
  const { adapter, isReady } = useContext(AdapterContext)
  const [data, setData] = useState<ParseMethod[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!isReady || !adapter?.getParseMethods) return

    setLoading(true)
    adapter
      .getParseMethods()
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [adapter, isReady])

  return { data, loading, error, refetch: () => setLoading(true) }
}

/**
 * 获取向量嵌入配置
 */
export function useVectorEmbedding() {
  const { adapter, isReady } = useContext(AdapterContext)
  const [data, setData] = useState<VectorEmbeddingConfig | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const load = () => {
    if (!isReady || !adapter?.getVectorEmbedding) return

    setLoading(true)
    adapter
      .getVectorEmbedding()
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [adapter, isReady])

  return { data, loading, error, refetch: load }
}

/**
 * 获取图谱模板列表
 */
export function useGraphTemplates() {
  const { adapter, isReady } = useContext(AdapterContext)
  const [data, setData] = useState<GraphTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const load = () => {
    if (!isReady || !adapter?.getGraphTemplates) return

    setLoading(true)
    adapter
      .getGraphTemplates()
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [adapter, isReady])

  return { data, loading, error, refetch: load }
}
