import { useEffect, useState } from 'react'

const EL_POPPER_CLASS = 'el-popper'

function findParent(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false
  if (el.classList?.contains(EL_POPPER_CLASS)) return true
  if (el.parentNode) return findParent(el.parentNode as HTMLElement)
  return false
}

export interface UseTooltipReturn {
  tooltipVisible: boolean
  setTooltipVisible: (v: boolean) => void
}

/**
 * 点击非 tooltip 浮层时关闭 tooltip 的 React Hook
 * 与原 console useTooltip 行为一致
 */
export function useTooltip(): UseTooltipReturn {
  const [tooltipVisible, setTooltipVisible] = useState(false)

  useEffect(() => {
    const hidePromptTooltip = (e: MouseEvent) => {
      if (!findParent(e.target as HTMLElement)) setTooltipVisible(false)
    }
    document.addEventListener('click', hidePromptTooltip)
    return () => document.removeEventListener('click', hidePromptTooltip)
  }, [])

  return { tooltipVisible, setTooltipVisible }
}

export default useTooltip
