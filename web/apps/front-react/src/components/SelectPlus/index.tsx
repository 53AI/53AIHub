import { useMemo } from 'react'
import { Select } from 'antd'
import type { SelectProps } from 'antd'
import { t } from '@/locales'
import './index.css'

interface OptionItem {
  value: string
  label: string
  icon?: string | React.ReactNode
}

interface GroupOptionItem extends OptionItem {
  options?: OptionItem[]
}

interface SelectPlusProps extends Omit<SelectProps, 'options' | 'onChange'> {
  value?: string
  onChange?: (value: string, option: GroupOptionItem | OptionItem) => void
  iconType?: 'image' | 'svg' | 'icon'
  options?: GroupOptionItem[]
  filterable?: boolean
  useI18n?: boolean
}

export function SelectPlus({
  value,
  onChange,
  iconType = 'image',
  options = [],
  filterable = true,
  useI18n = true,
  size = 'large',
  ...restProps
}: SelectPlusProps) {
  const getLabel = (label: string) => {
    if (!useI18n) return label
    return t(label)
  }

  const selectedOption = useMemo<GroupOptionItem | OptionItem>(() => {
    let option: GroupOptionItem | OptionItem = { value: '', label: '' }

    options.forEach((item) => {
      if (item.options) {
        item.options.forEach((row) => {
          if (row.value === value) {
            option = row
          }
        })
      } else {
        if (item.value === value) {
          option = item
        }
      }
    })

    return option
  }, [options, value])

  const handleChange = (newValue: string) => {
    onChange?.(newValue, selectedOption)
  }

  const renderIcon = (icon?: string | React.ReactNode) => {
    if (!icon) return null

    if (iconType === 'image' && typeof icon === 'string') {
      return (
        <div className="select-plus-icon">
          <img src={icon} alt="" className="select-plus-icon-img" />
        </div>
      )
    }

    return (
      <div className="select-plus-icon">
        {icon}
      </div>
    )
  }

  const selectOptions = useMemo(() => {
    return options.map((item) => {
      if (item.options) {
        return {
          label: getLabel(item.label),
          options: item.options.map((row) => ({
            value: row.value,
            label: (
              <div className="select-plus-option">
                {renderIcon(row.icon)}
                <span className="select-plus-option-label">{getLabel(row.label)}</span>
              </div>
            ),
          })),
        }
      }

      return {
        value: item.value,
        label: (
          <div className="select-plus-option">
            {renderIcon(item.icon)}
            <span className="select-plus-option-label">{getLabel(item.label)}</span>
          </div>
        ),
      }
    })
  }, [options, iconType, useI18n])

  return (
    <Select
      {...restProps}
      value={value}
      onChange={handleChange}
      options={selectOptions}
      showSearch={filterable}
      size={size}
      suffixIcon={selectedOption.icon ? renderIcon(selectedOption.icon) : undefined}
    />
  )
}

export default SelectPlus
