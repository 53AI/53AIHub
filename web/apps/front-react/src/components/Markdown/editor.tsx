import { useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react'
import { t } from '@/locales'
import loadLib from '@/utils/loadLib'
import { API_HOST } from '@/api/host'
import './editor.css'

interface EditConfig {
  name: string
  value: string
  type: 'ir' | 'sv' | 'wysiwyg'
  mode: 'editor' | 'both'
}

interface MarkdownEditorProps {
  value?: string
  onChange?: (value: string) => void
  height?: string
  className?: string
}

export interface MarkdownEditorRef {
  setEditMode: (type: string, mode: string) => void
  getValue: () => string
}

const EDIT_MODES: EditConfig[] = [
  {
    name: t('common.rendering'),
    value: 'edit-one',
    type: 'ir',
    mode: 'editor',
  },
  {
    name: t('common.source'),
    value: 'code',
    type: 'sv',
    mode: 'editor',
  },
]

export const MarkdownEditor = forwardRef<MarkdownEditorRef, MarkdownEditorProps>(
  ({ value = '', onChange, height = '500px', className }, ref) => {
    const vditorRef = useRef<HTMLDivElement>(null)
    const vditorInstance = useRef<any>(null)
    const [loading, setLoading] = useState(false)
    const [type, setType] = useState<string>('wysiwyg')
    const [mode, setMode] = useState<string>('')
    const [previewVisible, setPreviewVisible] = useState(false)

    const getUploadConfig = useCallback(
      () => ({
        url: `${API_HOST}/api/upload`,
        multiple: false,
        fieldName: 'file',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('access_token')}`,
        },
        filename(name: string) {
          return name.replace(/[:/\\?*|"<>]/g, '').replace(/\s/g, '_')
        },
        format(files: File[], response: string) {
          const result = JSON.parse(response)
          return JSON.stringify({
            msg: '',
            code: 0,
            data: {
              errFiles: [],
              succMap: {
                [`${files[0].name}`]: `${API_HOST}/api/preview/${result.data.preview_key}`,
              },
            },
          })
        },
      }),
      []
    )

    const setVditor = useCallback(async () => {
      if (vditorInstance.current) {
        vditorInstance.current.destroy()
      }

      setLoading(true)

      try {
        await loadLib('vditor')

        const Vditor = (window as any).Vditor

        const options: any = {
          height,
          cache: { enable: false },
          cdn: window.$getPublicPath('/js/vditor'),
          toolbar: [
            'undo',
            'redo',
            '|',
            {
              name: 'insert',
              toolbar: [
                'image',
                'upload',
                'table',
                'link',
                'video',
                'code',
                'inline-code',
                'line',
                'insert-before',
                'insert-after',
                '-',
                'echarts',
                'math',
                'mermaid',
                'mindmap',
                'mermaid-sequence',
                'mermaid-gantt',
              ],
            },
            '|',
            'headings',
            'bold',
            'italic',
            'strike',
            '|',
            'list',
            'ordered-list',
            'outdent',
            'indent',
            '|',
            'quote',
            '|',
            'edit-mode',
            'fullscreen',
          ],
          after: () => {
            vditorInstance.current?.setValue(value)
          },
          input: (val: string) => {
            onChange?.(val)
          },
          upload: getUploadConfig(),
          image: {
            accept: 'image/*',
            ...getUploadConfig(),
          },
          video: {
            accept: 'video/*',
            ...getUploadConfig(),
          },
          mode: type,
          preview: {
            mode: mode,
            actions: [],
            math: {
              engine: 'MathJax',
              inlineDigit: true,
            },
          },
        }

        setTimeout(() => {
          if (vditorRef.current) {
            vditorInstance.current = new Vditor(vditorRef.current, options)
          }
        }, 100)
      } catch (error) {
        console.error('Failed to initialize Vditor:', error)
      }
    }, [height, value, onChange, type, mode, getUploadConfig])

    const handleEditMode = useCallback((item: EditConfig) => {
      setType(item.type)
      setMode(item.mode)
      vditorInstance.current?.setEditMode(item.type, item.mode)
    }, [])

    const handlePreview = useCallback(() => {
      setPreviewVisible((prev) => !prev)
      const newMode = !previewVisible ? 'both' : 'editor'
      setMode(newMode)
      vditorInstance.current?.setEditMode(type, newMode)
    }, [previewVisible, type])

    // Sync external value changes
    useEffect(() => {
      if (vditorInstance.current && value !== vditorInstance.current.getValue()) {
        vditorInstance.current.setValue(value)
      }
    }, [value])

    useEffect(() => {
      setVditor()
      return () => {
        if (vditorInstance.current) {
          vditorInstance.current.destroy()
          vditorInstance.current = null
        }
      }
    }, [])

    useImperativeHandle(ref, () => ({
      setEditMode(editType: string, editMode: string) {
        vditorInstance.current?.setEditMode(editType, editMode)
      },
      getValue() {
        return vditorInstance.current?.getValue() || ''
      },
    }))

    return (
      <div
        className={`flex flex-col ${className || ''}`}
        style={{ height }}
      >
        <div
          ref={vditorRef}
          className="w-full flex-1 vditor-custom"
        />
        {/* Bottom bar hidden to match Vue version (v-if="false") */}
        {false && (
          <div className="flex-none px-4 h-10 flex items-center justify-between gap-2 border-t">
            <div className="flex items-center gap-1.5">
              {EDIT_MODES.map((item) => (
                <div
                  key={item.value}
                  className={`w-[94px] h-6 flex items-center justify-center gap-1.5 cursor-pointer ${
                    item.type === type ? 'text-[#2563EB] bg-[#EEF3FE] shadow' : 'text-[#4F5052]'
                  }`}
                  onClick={() => handleEditMode(item)}
                >
                  <span className="text-sm">{item.name}</span>
                </div>
              ))}
            </div>
            <div
              className={`w-[94px] h-6 flex items-center justify-center gap-1.5 cursor-pointer ${
                previewVisible ? 'text-[#2563EB] bg-[#EEF3FE] shadow' : 'text-[#4F5052]'
              }`}
              onClick={handlePreview}
            >
              <span className="text-sm">Column</span>
            </div>
          </div>
        )}
      </div>
    )
  }
)

MarkdownEditor.displayName = 'MarkdownEditor'

export default MarkdownEditor
