import { useState, useEffect, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react'
import SelectPlus from '@/components/SelectPlus'
import { loadModels } from './index'

interface ModelOption {
  value: string
  label: string
  icon?: string
  vision?: boolean
}

interface ChannelOption {
  value: string
  label: string
  icon?: string
  options: ModelOption[]
}

interface ModelSelectProps {
  value?: string
  defaultValue?: string
  valueKey?: string
  type?: string
  mode?: string
  clearable?: boolean
  onChange?: (value: string, option: ChannelOption | ModelOption) => void
}

export interface ModelSelectRef {
  reset: () => void
}

export const ModelSelect = forwardRef<ModelSelectRef, ModelSelectProps>(
  (
    {
      value: propValue,
      defaultValue = '',
      valueKey = 'value',
      type,
      mode,
      clearable,
      onChange,
    },
    ref
  ) => {
    const [options, setOptions] = useState<ChannelOption[]>([])
    const [internalValue, setInternalValue] = useState(defaultValue)

    const value = propValue !== undefined ? propValue : internalValue

    const findUseModel = useCallback(
      (modelValue: string) => {
        const optionsFlat = options.map((item) => item.options).flat()
        return optionsFlat.find((item) => item.value === modelValue)
      },
      [options]
    )

    let fetchPromise: Promise<any> | null = null

    const loadChannelOptions = async () => {
      if (!fetchPromise) {
        fetchPromise = loadModels(type, mode)
        const modelList = await fetchPromise
        setOptions(
          modelList.map((item: any) => ({
            ...item,
            options: item.options.map((option: any) => ({
              ...option,
              value: option[valueKey],
            })),
          }))
        )
      }
      return fetchPromise
    }

    useEffect(() => {
      const init = async () => {
        await loadChannelOptions()
        if (value) {
          const option = findUseModel(value)
          if (!option) {
            setInternalValue('')
          }
        }
      }
      init()
    }, [value, findUseModel])

    const handleChange = (newValue: string, option: ChannelOption | ModelOption) => {
      setInternalValue(newValue)
      onChange?.(newValue, option)
    }

    useImperativeHandle(ref, () => ({
      reset() {
        setInternalValue('')
      },
    }))

    return (
      <SelectPlus
        value={value}
        onChange={handleChange}
        options={options}
        useI18n={false}
        clearable={clearable}
      />
    )
  }
)

export default ModelSelect
