import { useState } from 'react'
import { CloseOutlined } from '@ant-design/icons'
import { InputPlus } from '../InputPlus'
import { message } from 'antd'
import './index.css'

interface TagsGroupProps {
  value?: string[]
  onChange?: (value: string[]) => void
  repeatDisabled?: boolean
}

export function TagsGroup({
  value = [],
  onChange,
  repeatDisabled = false,
}: TagsGroupProps) {
  const handleRemove = (index: number) => {
    if (index < 0) return
    const list = [...value]
    list.splice(index, 1)
    onChange?.(list)
  }

  const handleAdd = (newValue: string) => {
    if (!newValue) return
    const list = [...value]
    list.push(newValue)
    onChange?.(list)
  }

  const beforeConfirmHandler = (inputValue: string): boolean => {
    if (repeatDisabled && value.includes(inputValue)) {
      message.warning(`【${inputValue}】已存在，请重新填写`)
      return false
    }
    return true
  }

  return (
    <div className="tags-group">
      {value.map((tagName, tagIndex) => (
        <div key={tagIndex} className="tag-item">
          <span className="tag-text">{tagName}</span>
          <CloseOutlined
            className="tag-close"
            onClick={() => handleRemove(tagIndex)}
          />
        </div>
      ))}
      <InputPlus
        beforeConfirm={beforeConfirmHandler}
        onConfirm={handleAdd}
        reference={
          <div className="tag-add-btn">
            + 添加
          </div>
        }
      />
    </div>
  )
}

export default TagsGroup
