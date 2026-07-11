import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import { Input, message } from 'antd'
import { CheckOutlined, CloseOutlined } from '@ant-design/icons'
import './index.css'

interface InputPlusProps {
  value?: string
  onChange?: (value: string) => void
  onConfirm?: (value: string) => void
  onCancel?: () => void
  placeholder?: string
  maxlength?: number
  showWordLimit?: boolean
  cancelClearable?: boolean
  beforeConfirm?: (value: string) => boolean | Promise<boolean>
  reference?: React.ReactNode
}

export interface InputPlusRef {
  show: () => void
  hide: () => void
}

export const InputPlus = forwardRef<InputPlusRef, InputPlusProps>(
  (
    {
      value = '',
      onChange,
      onConfirm,
      onCancel,
      placeholder = '请输入',
      maxlength,
      showWordLimit = false,
      cancelClearable = true,
      beforeConfirm,
      reference,
    },
    ref
  ) => {
    const [visible, setVisible] = useState(!reference)
    const [inputValue, setInputValue] = useState(value)
    const inputRef = useRef<any>(null)

    const isNullString = !inputValue.trim()

    useEffect(() => {
      setInputValue(value)
    }, [value])

    useEffect(() => {
      if (visible && inputRef.current) {
        inputRef.current.focus()
      }
    }, [visible])

    useImperativeHandle(ref, () => ({
      show: () => setVisible(true),
      hide: () => {
        setInputValue('')
        setVisible(false)
      },
    }))

    const handleConfirm = async () => {
      const trimmedValue = inputValue.trim()

      if (beforeConfirm) {
        const canConfirm = await beforeConfirm(trimmedValue)
        if (!canConfirm) return
      }

      if (isNullString) return

      onChange?.(trimmedValue)
      onConfirm?.(trimmedValue)
      setInputValue('')
      if (reference) {
        setVisible(false)
      }
    }

    const handleCancel = () => {
      onCancel?.()
      setInputValue('')
      if (cancelClearable) {
        onChange?.('')
      }
      if (reference) {
        setVisible(false)
      }
    }

    const handleKeyPress = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleConfirm()
      }
    }

    if (!visible && reference) {
      return (
        <div className="reference-btn" onClick={() => setVisible(true)}>
          {reference}
        </div>
      )
    }

    return (
      <div className="input-plus">
        <Input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={placeholder}
          maxLength={maxlength}
          showCount={showWordLimit}
          style={{ width: 160 }}
          autoFocus
        />
        <CheckOutlined
          className={`input-plus-icon ${isNullString ? 'disabled' : 'clickable'}`}
          onClick={isNullString ? undefined : handleConfirm}
        />
        <CloseOutlined
          className="input-plus-icon clickable cancel"
          onClick={handleCancel}
        />
      </div>
    )
  }
)

InputPlus.displayName = 'InputPlus'

export default InputPlus
