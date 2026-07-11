import { useCallback } from 'react'

export interface UseVmodelOptions<T> {
  value: T
  onChange?: (value: T) => void
  key?: string
}

/**
 * React 版 v-model 风格：受控值 + 回写
 * 用法：const [value, setValue] = useVmodel({ value: props.modelValue, onChange: props['onUpdate:modelValue'] })
 */
export function useVmodel<T>(options: UseVmodelOptions<T>): [T, (v: T) => void] {
  const { value, onChange } = options
  const setValue = useCallback(
    (v: T) => {
      onChange?.(v)
    },
    [onChange],
  )
  return [value, setValue]
}

export default useVmodel
