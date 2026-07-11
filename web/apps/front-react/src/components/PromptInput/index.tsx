import { useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { t } from '@/locales'
import './index.css'

interface PromptInputProps {
  value: string
  onChange?: (value: string) => void
  disabled?: boolean
  showLine?: boolean
  placeholder?: string
  className?: string
  style?: React.CSSProperties
  minHeight?: string
}

export function PromptInput({
  value,
  onChange,
  disabled = false,
  showLine = false,
  placeholder,
  className = '',
  style,
  minHeight
}: PromptInputProps) {
  const extensions = useMemo(() => {
    const exts = [
      markdown({ base: markdownLanguage }),
      EditorView.lineWrapping
    ]
    return exts
  }, [])

  return (
    <div
      className={`prompt-input-wrapper ${showLine ? 'show-line' : 'hide-line'} ${className}`}
      style={style}
    >
      <CodeMirror
        value={value}
        height="auto"
        minHeight={minHeight || 'auto'}
        extensions={extensions}
        onChange={(val) => onChange?.(val)}
        readOnly={disabled}
        placeholder={placeholder || t('common.input_placeholder')}
        className="prompt-codemirror"
        theme="light"
        basicSetup={{
          lineNumbers: showLine,
          foldGutter: false,
          dropCursor: false,
          allowMultipleSelections: false,
          indentOnInput: false,
          bracketMatching: false,
          closeBrackets: false,
          autocompletion: false,
          rectangularSelection: false,
          crosshairCursor: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          highlightSelectionMatches: false
        }}
      />
    </div>
  )
}

export default PromptInput
