import { useState, useCallback } from 'react'
import type { Pipeline, PipelineStep } from '../types'
import { createNewPipeline } from '../constants'

export interface UsePipelineConfigOptions {
  /** Initial pipeline data */
  initialPipeline?: Pipeline | null
  /** Callback when pipeline changes */
  onChange?: (pipeline: Pipeline) => void
}

export interface UsePipelineConfigReturn {
  /** Current pipeline state */
  pipeline: Pipeline | null
  /** Set pipeline directly */
  setPipeline: (pipeline: Pipeline | null) => void
  /** Update a specific step's config */
  updateStepConfig: (stepKey: string, config: Record<string, any>) => void
  /** Update a specific step's run mode */
  updateStepRunMode: (stepKey: string, runMode: 'auto' | 'manual' | 'skip') => void
  /** Update pipeline basic info (name, icon) */
  updateBasicInfo: (info: { name?: string; icon?: string }) => void
  /** Reset pipeline to default */
  resetPipeline: () => void
  /** Create a new pipeline */
  createNew: () => void
  /** Get a specific step by key */
  getStep: (stepKey: string) => PipelineStep | undefined
  /** Get all visible steps */
  getVisibleSteps: () => PipelineStep[]
}

/**
 * Hook for managing pipeline configuration state
 */
export function usePipelineConfig(options: UsePipelineConfigOptions = {}): UsePipelineConfigReturn {
  const { initialPipeline, onChange } = options

  // 只有当 initialPipeline 为 undefined 时才创建新 pipeline
  // null 表示"未选择"，应该保留 null 状态
  const [pipeline, setPipelineState] = useState<Pipeline | null>(() => {
    if (initialPipeline === undefined) {
      return createNewPipeline()
    }
    return initialPipeline
  })

  const setPipeline = useCallback(
    (newPipeline: Pipeline | null) => {
      setPipelineState(newPipeline)
      if (newPipeline && onChange) {
        onChange(newPipeline)
      }
    },
    [onChange]
  )

  const updateStepConfig = useCallback(
    (stepKey: string, config: Record<string, any>) => {
      if (!pipeline) return

      const newSteps = pipeline.profile_json.steps.map((step) =>
        step.step_key === stepKey ? { ...step, config } : step
      )

      const updatedPipeline = {
        ...pipeline,
        profile_json: {
          ...pipeline.profile_json,
          steps: newSteps,
        },
      }

      setPipelineState(updatedPipeline)
      if (onChange) {
        onChange(updatedPipeline)
      }
    },
    [pipeline, onChange]
  )

  const updateStepRunMode = useCallback(
    (stepKey: string, runMode: 'auto' | 'manual' | 'skip') => {
      if (!pipeline) return

      const newSteps = pipeline.profile_json.steps.map((step) =>
        step.step_key === stepKey ? { ...step, run_mode: runMode } : step
      )

      const updatedPipeline = {
        ...pipeline,
        profile_json: {
          ...pipeline.profile_json,
          steps: newSteps,
        },
      }

      setPipelineState(updatedPipeline)
      if (onChange) {
        onChange(updatedPipeline)
      }
    },
    [pipeline, onChange]
  )

  const updateBasicInfo = useCallback(
    (info: { name?: string; icon?: string }) => {
      if (!pipeline) return

      const updatedPipeline = {
        ...pipeline,
        ...info,
      }

      setPipelineState(updatedPipeline)
      if (onChange) {
        onChange(updatedPipeline)
      }
    },
    [pipeline, onChange]
  )

  const resetPipeline = useCallback(() => {
    const newPipeline = createNewPipeline()
    setPipelineState(newPipeline)
    if (onChange) {
      onChange(newPipeline)
    }
  }, [onChange])

  const createNew = useCallback(() => {
    const newPipeline = createNewPipeline()
    setPipelineState(newPipeline)
    if (onChange) {
      onChange(newPipeline)
    }
  }, [onChange])

  const getStep = useCallback(
    (stepKey: string): PipelineStep | undefined => {
      return pipeline?.profile_json.steps.find((step) => step.step_key === stepKey)
    },
    [pipeline]
  )

  const getVisibleSteps = useCallback((): PipelineStep[] => {
    const visibleKeys = [
      'document_parsing',
      'summary_generation',
      'document_chunking',
      'vector_indexing',
      'graph_generation',
    ]
    return (
      pipeline?.profile_json.steps.filter((step) => visibleKeys.includes(step.step_key)) || []
    )
  }, [pipeline])

  return {
    pipeline,
    setPipeline,
    updateStepConfig,
    updateStepRunMode,
    updateBasicInfo,
    resetPipeline,
    createNew,
    getStep,
    getVisibleSteps,
  }
}

export default usePipelineConfig
