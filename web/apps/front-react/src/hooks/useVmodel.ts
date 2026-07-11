import { useState, useCallback } from 'react'

/**
 * useVmodel - React 版本的 v-model 封装
 * 用于双向绑定状态
 *
 * @example
 * ```tsx
 * // 基础用法
 * const [value, setValue] = useVModel(defaultValue)
 *
 * // 作为受控组件
 * const [value, setValue] = useVModel(props.value, props.onChange)
 * ```
 */
export function useVModel<T>(
  initialValue: T | (() => T)
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(initialValue)

  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    setState(value)
  }, [])

  return [state, setValue]
}

/**
 * useVModelWithOnChange - 带 onChange 回调的 v-model 封装
 *
 * @example
 * ```tsx
 * const [value, setValue] = useVModelWithOnChange(defaultValue, (newValue) => {
 *   console.log('Value changed:', newValue)
 * })
 * ```
 */
export function useVModelWithOnChange<T>(
  initialValue: T | (() => T),
  onChange?: (value: T) => void
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(initialValue)

  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    setState((prev) => {
      const newValue = value instanceof Function ? value(prev) : value
      onChange?.(newValue)
      return newValue
    })
  }, [onChange])

  return [state, setValue]
}

/**
 * useControllableValue - 受控/非受控兼容的值管理
 * 当传入 value 时为受控模式，否则为非受控模式
 *
 * @example
 * ```tsx
 * // 非受控模式
 * const [value, setValue] = useControllableValue({ defaultValue: 'init' })
 *
 * // 受控模式
 * const [value, setValue] = useControllableValue({
 *   value: props.value,
 *   onChange: props.onChange
 * })
 * ```
 */
export function useControllableValue<T>(
  options: {
    value?: T
    defaultValue?: T | (() => T)
    onChange?: (value: T) => void
  }
): [T, (value: T | ((prev: T) => T)) => void] {
  const { value, defaultValue, onChange } = options

  const isControlled = value !== undefined
  const [internalState, setInternalState] = useState<T>(() => {
    if (isControlled) return value!
    return defaultValue instanceof Function ? defaultValue() : (defaultValue as T)
  })

  const currentValue = isControlled ? value! : internalState

  const setValue = useCallback((newValue: T | ((prev: T) => T)) => {
    if (!isControlled) {
      setInternalState(newValue)
    }
    if (onChange) {
      const actualValue = newValue instanceof Function ? newValue(currentValue) : newValue
      onChange(actualValue)
    }
  }, [isControlled, onChange, currentValue])

  return [currentValue, setValue]
}

export default useVModel