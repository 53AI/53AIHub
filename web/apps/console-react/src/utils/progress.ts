/**
 * 虚拟进度条工具
 * 用于在异步操作中展示平滑的进度动画
 */

import { useState, useCallback, useRef } from 'react'

/**
 * 进度控制器接口
 */
export interface ProgressController {
  /** 停止进度 */
  stop: () => void
  /** 快速完成到指定百分比 */
  completePhase: (targetPercentage: number) => void
}

/**
 * 虚拟进度条选项
 */
export interface VirtualProgressOptions {
  /** 开始百分比 */
  startPercent?: number
  /** 结束百分比（不会超过此值） */
  endPercent: number
  /** 基础间隔时间(ms)，默认100ms */
  baseInterval?: number
  /** 进度变化回调 */
  onProgress?: (percent: number) => void
  /** 阶段完成回调 */
  onComplete?: () => void
}

/**
 * 虚拟进度条算法 - 退避式递增
 * 进度条速度前快后慢，营造真实的加载体验
 *
 * @example
 * // 基本用法
 * const controller = startVirtualProgress({
 *   endPercent: 90,
 *   onProgress: (p) => console.log(p),
 *   onComplete: () => console.log('done')
 * })
 *
 * // 停止进度
 * controller.stop()
 *
 * // 快速完成到100%
 * controller.completePhase(100)
 */
export const startVirtualProgress = (
  options: VirtualProgressOptions
): ProgressController => {
  const {
    startPercent = 0,
    endPercent,
    baseInterval = 100,
    onProgress,
    onComplete
  } = options

  let currentPercent = startPercent
  let interval = baseInterval
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const tick = () => {
    if (stopped || currentPercent >= endPercent) {
      if (currentPercent >= endPercent) {
        onProgress?.(endPercent)
        onComplete?.()
      }
      return
    }

    // 退避算法：剩余越多增量越大，接近目标时增量越小
    const remaining = endPercent - currentPercent
    const increment = Math.max(1, Math.floor(remaining * 0.08 + Math.random() * 2))

    currentPercent = Math.min(endPercent, currentPercent + increment)
    onProgress?.(currentPercent)

    // 退避：间隔逐渐增加（前快后慢）
    interval = Math.min(800, baseInterval + (endPercent - remaining) * 8)

    timer = setTimeout(tick, interval)
  }

  timer = setTimeout(tick, interval)

  return {
    stop: () => {
      stopped = true
      if (timer) clearTimeout(timer)
    },
    completePhase: (targetPercentage: number) => {
      stopped = true
      if (timer) clearTimeout(timer)
      // 快速推进到目标百分比
      const fastTimer = setInterval(() => {
        if (currentPercent >= targetPercentage) {
          clearInterval(fastTimer)
          onComplete?.()
          return
        }
        currentPercent = Math.min(targetPercentage, currentPercent + 5)
        onProgress?.(currentPercent)
      }, 30)
    }
  }
}

/**
 * 创建响应式虚拟进度 Hook
 * 返回百分比状态和控制器，适用于 React 组件
 *
 * @example
 * const { percentage, start, stop, complete, reset } = useVirtualProgress()
 * start(0, 90, { onComplete: () => {} })
 */
export const useVirtualProgress = () => {
  const [percentage, setPercentage] = useState(0)
  const currentControllerRef = useRef<ProgressController | null>(null)

  const start = useCallback((
    startPercent: number,
    endPercent: number,
    options?: Omit<VirtualProgressOptions, 'startPercent' | 'endPercent'>
  ): ProgressController => {
    // 停止之前的进度
    currentControllerRef.current?.stop()

    currentControllerRef.current = startVirtualProgress({
      startPercent,
      endPercent,
      ...options,
      onProgress: (p) => {
        setPercentage(p)
        options?.onProgress?.(p)
      },
      onComplete: options?.onComplete
    })

    return currentControllerRef.current
  }, [])

  const stop = useCallback(() => {
    currentControllerRef.current?.stop()
  }, [])

  const complete = useCallback((targetPercentage: number) => {
    currentControllerRef.current?.completePhase(targetPercentage)
  }, [])

  const reset = useCallback(() => {
    stop()
    setPercentage(0)
  }, [stop])

  return {
    percentage,
    controller: currentControllerRef.current,
    start,
    stop,
    complete,
    reset
  }
}

/**
 * 多阶段虚拟进度
 * 适用于有多个连续阶段的异步操作
 *
 * @example
 * const pipeline = createProgressPipeline([
 *   { name: 'fetching', endPercent: 50, baseInterval: 80 },
 *   { name: 'scanning', endPercent: 90, baseInterval: 150 }
 * ], {
 *   onProgress: (stage, percent) => console.log(stage, percent)
 * })
 *
 * pipeline.start()
 * pipeline.next() // 进入下一阶段
 * pipeline.complete() // 快速完成到100%
 */
export interface ProgressStage {
  /** 阶段名称 */
  name: string
  /** 阶段结束百分比 */
  endPercent: number
  /** 基础间隔时间 */
  baseInterval?: number
}

export const createProgressPipeline = (
  stages: ProgressStage[],
  options?: {
    onProgress?: (stage: string, percent: number) => void
    onComplete?: () => void
  }
) => {
  let currentStageIndex = 0
  let currentController: ProgressController | null = null

  const startStage = (index: number) => {
    if (index >= stages.length) return

    const stage = stages[index]
    const startPercent = index === 0 ? 0 : stages[index - 1].endPercent

    currentController = startVirtualProgress({
      startPercent,
      endPercent: stage.endPercent,
      baseInterval: stage.baseInterval,
      onProgress: (p) => options?.onProgress?.(stage.name, p),
      onComplete: () => {
        if (index === stages.length - 1) {
          options?.onComplete?.()
        }
      }
    })
  }

  return {
    start: () => startStage(0),
    next: () => {
      currentController?.stop()
      currentStageIndex++
      startStage(currentStageIndex)
    },
    complete: (targetPercent: number = 100) => {
      currentController?.completePhase(targetPercent)
    },
    stop: () => {
      currentController?.stop()
    },
    get currentStage() {
      return stages[currentStageIndex]?.name
    }
  }
}
