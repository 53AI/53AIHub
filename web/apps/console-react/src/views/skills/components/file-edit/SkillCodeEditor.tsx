import { useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'
// 独立语言包
import { python } from '@codemirror/lang-python'
import { json } from '@codemirror/lang-json'
import { javascript } from '@codemirror/lang-javascript'
import { markdown } from '@codemirror/lang-markdown'
import { html } from '@codemirror/lang-html'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { php } from '@codemirror/lang-php'
// legacy-modes 支持更多语言
import { StreamLanguage } from '@codemirror/language'
import { java, cpp, c } from '@codemirror/legacy-modes/mode/clike'
import { go } from '@codemirror/legacy-modes/mode/go'
import { rust } from '@codemirror/legacy-modes/mode/rust'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { vb } from '@codemirror/legacy-modes/mode/vb'

const LANGUAGE_EXTENSIONS: Record<string, any> = {
  // 独立语言包
  python: python(),
  json: json(),
  javascript: javascript(),
  typescript: javascript({ jsx: false, typescript: true }),
  markdown: markdown(),
  html: html(),
  yaml: yaml(),
  sql: sql(),
  xml: xml(),
  // legacy-modes
  java: StreamLanguage.define(java),
  cpp: StreamLanguage.define(cpp),
  c: StreamLanguage.define(c),
  go: StreamLanguage.define(go),
  rust: StreamLanguage.define(rust),
  php: php(),
  shell: StreamLanguage.define(shell),
  powershell: StreamLanguage.define(powerShell),
  properties: StreamLanguage.define(properties),
  toml: StreamLanguage.define(toml),
  batchfile: StreamLanguage.define(vb),
  text: [],
}

interface SkillCodeEditorProps {
  content: string
  language?: string
  editable?: boolean
  onChange?: (value: string) => void
}

export function SkillCodeEditor({
  content,
  language = 'text',
  editable = true,
  onChange,
}: SkillCodeEditorProps) {
  const extensions = useMemo(() => {
    const langExtension = LANGUAGE_EXTENSIONS[language] || []
    return [
      EditorView.lineWrapping,
      langExtension,
      EditorView.theme({
        '&': { backgroundColor: '#fff' },
        '.cm-content': { fontFamily: 'Consolas, Monaco, "Courier New", monospace' },
        '.cm-gutters': { backgroundColor: '#f7f7f7', border: 'none' },
      }),
    ]
  }, [language])

  return (
    <CodeMirror
      value={content}
      height="100%"
      extensions={extensions}
      onChange={(value) => onChange?.(value)}
      readOnly={!editable}
      theme="light"
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        dropCursor: false,
        allowMultipleSelections: false,
        indentOnInput: true,
        bracketMatching: true,
        closeBrackets: true,
        autocompletion: false,
        rectangularSelection: false,
        crosshairCursor: false,
        highlightActiveLine: true,
        highlightActiveLineGutter: true,
        highlightSelectionMatches: false,
      }}
      className="h-full"
    />
  )
}

export default SkillCodeEditor
