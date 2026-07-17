import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { Pipeline, PipelineNode } from '../types'
import { createNewPipeline } from '../constants'

/**
 * 管线 Store 状态
 */
export interface PipelineState {
  /** 管线列表 */
  pipelines: Pipeline[]
  /** 当前选中的管线 */
  currentPipeline: Pipeline | null
  /** 加载状态 */
  loading: boolean
  /** 错误信息 */
  error: string | null
}

/**
 * 管线 Store Actions
 */
export interface PipelineActions {
  /** 设置管线列表 */
  setPipelines: (pipelines: Pipeline[]) => void
  /** 添加管线 */
  addPipeline: (pipeline: Pipeline) => void
  /** 更新管线 */
  updatePipeline: (id: string | number, updates: Partial<Pipeline>) => void
  /** 删除管线 */
  removePipeline: (id: string | number) => void
  /** 设置当前管线 */
  setCurrentPipeline: (pipeline: Pipeline | null) => void
  /** 更新当前管线 */
  updateCurrentPipeline: (updates: Partial<Pipeline>) => void
  /** 更新当前管线步骤 */
  updateCurrentStep: (stepKey: string, updates: Partial<PipelineNode>) => void
  /** 创建新管线 */
  createNew: () => void
  /** 设置加载状态 */
  setLoading: (loading: boolean) => void
  /** 设置错误 */
  setError: (error: string | null) => void
  /** 重置状态 */
  reset: () => void
}

export type PipelineStore = PipelineState & PipelineActions

const initialState: PipelineState = {
  pipelines: [],
  currentPipeline: null,
  loading: false,
  error: null,
}

export const usePipelineStore = create<PipelineStore>()(
  devtools(
    (set) => ({
      ...initialState,

      setPipelines: (pipelines) => set({ pipelines }),

      addPipeline: (pipeline) =>
        set((state) => ({
          pipelines: [pipeline, ...state.pipelines],
        })),

      updatePipeline: (id, updates) =>
        set((state) => ({
          pipelines: state.pipelines.map((p) => (p.id === id ? { ...p, ...updates } : p)),
        })),

      removePipeline: (id) =>
        set((state) => ({
          pipelines: state.pipelines.filter((p) => p.id !== id),
          currentPipeline: state.currentPipeline?.id === id ? null : state.currentPipeline,
        })),

      setCurrentPipeline: (pipeline) => set({ currentPipeline: pipeline }),

      updateCurrentPipeline: (updates) =>
        set((state) => ({
          currentPipeline: state.currentPipeline ? { ...state.currentPipeline, ...updates } : null,
        })),

      updateCurrentStep: (stepKey, updates) =>
        set((state) => {
          if (!state.currentPipeline) return state
          return {
            currentPipeline: {
              ...state.currentPipeline,
              profile_json: {
                ...state.currentPipeline.profile_json,
                steps: state.currentPipeline.profile_json.steps.map((step) =>
                  step.step_key === stepKey ? { ...step, ...updates } : step
                ),
              },
            },
          }
        }),

      createNew: () => set({ currentPipeline: createNewPipeline() }),

      setLoading: (loading) => set({ loading }),

      setError: (error) => set({ error }),

      reset: () => set(initialState),
    }),
    { name: 'pipeline-store' }
  )
)
