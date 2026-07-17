import { createContext, useContext, ReactNode, useState, useCallback, useMemo } from 'react'
import type { Pipeline, PipelineNode } from '../types'
import { createNewPipeline } from '../constants'

// Re-export locale
export {
  PipelineProvider,
  usePipeline,
  usePipelineTranslation,
  type SupportedLang,
  type PipelineProviderProps,
} from './locale'

/**
 * 管线配置上下文值
 */
export interface PipelineConfigContextValue {
  /** 当前编辑的管线 */
  pipeline: Pipeline | null
  /** 是否正在编辑 */
  isEditing: boolean
  /** 设置管线 */
  setPipeline: (pipeline: Pipeline | null) => void
  /** 更新管线字段 */
  updatePipeline: (updates: Partial<Pipeline>) => void
  /** 更新管线步骤 */
  updateStep: (stepKey: string, updates: Partial<PipelineNode>) => void
  /** 重置为新建管线 */
  resetToNew: () => void
  /** 开始编辑 */
  startEdit: (pipeline: Pipeline) => void
  /** 取消编辑 */
  cancelEdit: () => void
}

const PipelineConfigContext = createContext<PipelineConfigContextValue | null>(null)

export interface PipelineConfigProviderProps {
  children: ReactNode
  /** 初始管线 */
  initialPipeline?: Pipeline | null
}

/**
 * 管线配置 Provider
 */
export function PipelineConfigProvider({ children, initialPipeline }: PipelineConfigProviderProps) {
  const [pipeline, setPipelineState] = useState<Pipeline | null>(initialPipeline || null)
  const [originalPipeline, setOriginalPipeline] = useState<Pipeline | null>(null)

  const isEditing = useMemo(() => !!pipeline?.id, [pipeline])

  const setPipeline = useCallback((newPipeline: Pipeline | null) => {
    setPipelineState(newPipeline)
    if (newPipeline && newPipeline.id) {
      setOriginalPipeline(newPipeline)
    }
  }, [])

  const updatePipeline = useCallback((updates: Partial<Pipeline>) => {
    setPipelineState((prev) => (prev ? { ...prev, ...updates } : null))
  }, [])

  const updateStep = useCallback((stepKey: string, updates: Partial<PipelineNode>) => {
    setPipelineState((prev) => {
      if (!prev) return null
      return {
        ...prev,
        profile_json: {
          ...prev.profile_json,
          steps: prev.profile_json.steps.map((step) =>
            step.step_key === stepKey ? { ...step, ...updates } : step
          ),
        },
      }
    })
  }, [])

  const resetToNew = useCallback(() => {
    setPipelineState(createNewPipeline())
    setOriginalPipeline(null)
  }, [])

  const startEdit = useCallback((editPipeline: Pipeline) => {
    setPipelineState(editPipeline)
    setOriginalPipeline(editPipeline)
  }, [])

  const cancelEdit = useCallback(() => {
    setPipelineState(originalPipeline)
  }, [originalPipeline])

  const value = useMemo<PipelineConfigContextValue>(
    () => ({
      pipeline,
      isEditing,
      setPipeline,
      updatePipeline,
      updateStep,
      resetToNew,
      startEdit,
      cancelEdit,
    }),
    [pipeline, isEditing, setPipeline, updatePipeline, updateStep, resetToNew, startEdit, cancelEdit]
  )

  return <PipelineConfigContext.Provider value={value}>{children}</PipelineConfigContext.Provider>
}

/**
 * 获取管线配置上下文
 * 注意：这是一个需要 PipelineConfigProvider 的上下文 Hook
 * 如果需要独立的配置管理，请使用 hooks/usePipelineConfig
 */
export function usePipelineConfigContext(): PipelineConfigContextValue {
  const context = useContext(PipelineConfigContext)
  if (!context) {
    throw new Error('usePipelineConfigContext must be used within a PipelineConfigProvider')
  }
  return context
}
