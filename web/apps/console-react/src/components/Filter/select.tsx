import { Dropdown } from '@km/shared-components-react'
import { DownOutlined } from '@ant-design/icons'
import { useMemo, useCallback } from 'react'

interface Option {
  [key: string]: string | number | null
  value: string | number | null
  label: string
}

interface SelectFilterProps {
  options?: Option[]
  value?: string | number | null
  onChange?: (value: string | number | null) => void
  prop?: {
    value: string
    label: string
  }
  showAll?: boolean
  allOption?: {
    value: null
    label: string
  }
}

export function SelectFilter({
  options = [],
  value = '',
  onChange,
  prop = { value: 'value', label: 'label' },
  showAll = false,
  allOption = { value: null, label: '全部' },
}: SelectFilterProps) {
  const t = (window as any).$t || ((key: string) => key)

  // Merged options with "all" option
  const mergedOptions = useMemo<Option[]>(() => {
    if (!showAll) return options
    return [
      {
        [prop.value]: allOption.value,
        [prop.label]: allOption.label,
      } as Option,
      ...options,
    ]
  }, [options, showAll, prop, allOption])

  // Get current label
  const currentLabel = useMemo(() => {
    const option = mergedOptions.find((opt) => opt[prop.value] === value)
    return option ? String(option[prop.label]) : ''
  }, [mergedOptions, value, prop])

  // Handle selection
  const handleSelect = useCallback(
    (key: string) => {
      const selectedValue = key === 'null' ? null : key
      onChange?.(selectedValue as any)
    },
    [onChange]
  )

  // Dropdown menu items
  const menuItems = useMemo(
    () =>
      mergedOptions.map((opt) => ({
        key: String(opt[prop.value] ?? 'null'),
        label: String(opt[prop.label]),
      })),
    [mergedOptions, prop]
  )

  return (
    <Dropdown
      menu={{
        items: menuItems,
        onClick: ({ key }) => handleSelect(key),
      }}
      trigger={['click']}
      placement="bottom"
      popupRender={(menu) => (
        <div style={{ maxHeight: 250, overflow: 'auto' }}>{menu}</div>
      )}
    >
      <div className="!border-none !outline-none h-9 flex items-center px-5 gap-1.5 rounded-2xl bg-[#F6F7F8] text-xs text-primary cursor-pointer">
        {currentLabel}
        <DownOutlined style={{ fontSize: 14, color: '#9EA5B6' }} />
      </div>
    </Dropdown>
  )
}

export default SelectFilter