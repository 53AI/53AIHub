import React, { useState, useRef, useEffect } from 'react'
import { Input } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { SvgIcon } from '../SvgIcon'

export interface SearchProps {
  value?: string
  placeholder?: string
  text?: string
  size?: 'large' | 'middle' | 'small'
  disabled?: boolean
  className?: string
  mode?: 'collapsed' | 'expanded'
  debounceMs?: number
  onInput?: (value: string) => void
  onChange?: (value: string) => void
  onDebouncedChange?: (value: string) => void
  onFocus?: () => void
}

export const Search: React.FC<SearchProps> = ({
  value,
  placeholder,
  text,
  size = 'middle',
  disabled = false,
  className,
  mode = 'collapsed',
  debounceMs = 800,
  onInput,
  onChange,
  onDebouncedChange,
  onFocus
}) => {
  const [input, setInput] = useState(value || '')
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<any>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (value !== undefined) {
      setInput(value)
    }
  }, [value])

  useEffect(() => {
    if (mode === 'collapsed' && searching && inputRef.current) {
      inputRef.current.focus()
    }
  }, [searching, mode])

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [])

  const handleFocus = () => {
    if (disabled) return
    setSearching(true)
    onFocus?.()
  }

  const handleBlur = () => {
    if (input) return
    setSearching(false)
  }

  const flushDebounced = (val: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    onDebouncedChange?.(val)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setInput(val)
    onInput?.(val)

    if (onDebouncedChange) {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      if (debounceMs > 0) {
        debounceTimerRef.current = setTimeout(() => {
          debounceTimerRef.current = null
          onDebouncedChange(val)
        }, debounceMs)
      } else {
        onDebouncedChange(val)
      }
    }
  }

  const handlePressEnter = () => {
    flushDebounced(input)
    onChange?.(input)
  }

  if (mode === 'expanded' || searching) {
    return (
      <Input
        ref={inputRef}
        value={input}
        onChange={handleInputChange}
        onFocus={onFocus}
        onBlur={mode === 'collapsed' ? handleBlur : undefined}
        onPressEnter={handlePressEnter}
        placeholder={placeholder || '搜索'}
        prefix={<SearchOutlined />}
        size={size}
        allowClear
        disabled={disabled}
        className={`input-with-search ${className || ''}`}
        style={mode === 'collapsed' ? { maxWidth: '230px' } : undefined}
      />
    )
  }

  return (
    <div
      className={`h-8 flex items-center gap-1 ${
        disabled ? 'text-[#999] cursor-not-allowed' : 'cursor-pointer text-[#576D9C]'
      } ${className || ''}`}
      onClick={handleFocus}
    >
      <SvgIcon name="search" size={16} />
      <span className="text-sm">{text || '搜索'}</span>
    </div>
  )
}

export default Search
