import { useState, useEffect, useCallback } from 'react'

interface ToolReturn {
  tooltipVisible: boolean
}

export default function useTooltip(): ToolReturn {
  const [tooltipVisible, setTooltipVisible] = useState(false)

  const findParent = useCallback((el: any): boolean => {
    if (el.classList && el.classList.contains('el-popper'))
      return true
    if (el.parentNode)
      return findParent(el.parentNode)
    return false
  }, [])

  const hidePromptTooltip = useCallback((e: MouseEvent) => {
    if (!findParent(e.target))
      setTooltipVisible(false)
  }, [findParent])

  useEffect(() => {
    document.addEventListener('click', hidePromptTooltip)

    return () => {
      document.removeEventListener('click', hidePromptTooltip)
    }
  }, [hidePromptTooltip])

  return {
    tooltipVisible,
  }
}