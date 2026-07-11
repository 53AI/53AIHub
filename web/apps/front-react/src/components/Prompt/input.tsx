import { useState, useEffect, forwardRef, useImperativeHandle, useRef } from 'react'
import './input.css'

interface PromptInputProps {
  value?: string
  defaultValue?: string
  placeholder?: string
  disabled?: boolean
  showLine?: boolean
  showToken?: boolean
  wordWrap?: boolean
  onChange?: (value: string) => void
  onFocus?: () => void
  onBlur?: () => void
  style?: React.CSSProperties
  className?: string
}

export interface PromptInputRef {
  showTooltip: () => void
  insertContent: (content: string) => void
  forceUpdate: (text?: string) => void
  scrollToBottom: () => void
}

export const PromptInput = forwardRef<PromptInputRef, PromptInputProps>(
  (
    {
      value: controlledValue,
      defaultValue = '',
      placeholder = '',
      disabled = false,
      showLine = false,
      showToken = false,
      wordWrap = true,
      onChange,
      onFocus,
      onBlur,
      style,
      className = ''
    },
    ref
  ) => {
    const [internalValue, setInternalValue] = useState(defaultValue)
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    const value = controlledValue !== undefined ? controlledValue : internalValue

    useEffect(() => {
      if (controlledValue !== undefined) {
        setInternalValue(controlledValue)
      }
    }, [controlledValue])

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      setInternalValue(newValue)
      onChange?.(newValue)
    }

    const insertContent = (content: string) => {
      const textarea = textareaRef.current
      if (!textarea) return

      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const newValue = value.substring(0, start) + content + value.substring(end)
      setInternalValue(newValue)
      onChange?.(newValue)

      // Set cursor position after inserted content
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + content.length
        textarea.focus()
      }, 0)
    }

    const scrollToBottom = () => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.scrollTop = textarea.scrollHeight
    }

    useImperativeHandle(ref, () => ({
      showTooltip: () => {
        // Placeholder for tooltip functionality
        console.log('showTooltip not implemented')
      },
      insertContent,
      forceUpdate: (text = '') => {
        setInternalValue(text)
        onChange?.(text)
      },
      scrollToBottom
    }))

    return (
      <div className={`prompt-input-wrapper ${className}`} style={style}>
        <textarea
          ref={textareaRef}
          className={`prompt-input ${showLine ? 'with-line-numbers' : ''}`}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={handleChange}
          onFocus={onFocus}
          onBlur={onBlur}
          style={{
            whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
            overflowWrap: wordWrap ? 'break-word' : 'normal'
          }}
        />
        {showToken && (
          <div className="token-counter">
            {value.trim() ? value.split(/\s+/).length : 0} 个词
          </div>
        )}
      </div>
    )
  }
)

PromptInput.displayName = 'PromptInput'

export default PromptInput
