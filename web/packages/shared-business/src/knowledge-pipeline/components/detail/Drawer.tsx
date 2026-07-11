import { useRef } from 'react'
import { Drawer as AntDrawer, Button } from 'antd'
import { CloseOutlined } from '@ant-design/icons'
import { SvgIcon } from '@km/shared-components-react'
import { usePipelineTranslation } from '../../context'
import type { Pipeline } from '../../types'
import { Editor, type EditorRef } from './Editor'

export interface PipelineDetailProps {
  open: boolean
  pipeline: Pipeline
  onChange: (pipeline: Pipeline) => void
  onClose: () => void
  onSave: (pipeline: Pipeline) => void
  onEditBasic?: (pipeline: Pipeline) => void
  /** Drawer width in pixels. Defaults to 1200 */
  width?: number
}

export function Drawer({
  open,
  pipeline,
  onChange,
  onClose,
  onSave,
  onEditBasic,
  width = 1200,
}: PipelineDetailProps) {
  const { t } = usePipelineTranslation()
  const editorRef = useRef<EditorRef>(null)

  const handleSave = () => {
    if (editorRef.current?.validate()) {
      onSave(pipeline)
    }
  }

  return (
    <AntDrawer
      open={open}
      onClose={onClose}
      closable={false}
      styles={{
        wrapper: { width },
        body: { padding: 0, display: 'flex', flexDirection: 'column' },
      }}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button type="primary" onClick={handleSave}>
            {t('action.save')}
          </Button>
        </div>
      }
    >
      {/* Header */}
      <div className="p-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3 px-2">
          <div className="flex-none w-8 h-8 rounded flex items-center justify-center">
            {pipeline.icon && (
              <img
                src={pipeline.icon}
                className="size-8 object-contain"
                alt="logo"
              />
            )}
          </div>
          <h2 className="font-bold text-gray-800 text-lg">
            {pipeline.name}
          </h2>
          {pipeline.id && onEditBasic && (
            <Button type="link" onClick={() => onEditBasic(pipeline)}>
              <SvgIcon name="edit" size={18} />
            </Button>
          )}
        </div>
        <button
          className="text-gray-400 hover:text-gray-600 p-1 transition-colors"
          onClick={onClose}
        >
          <CloseOutlined style={{ fontSize: 24 }} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <Editor
          ref={editorRef}
          pipeline={pipeline}
          onChange={onChange}
        />
      </div>
    </AntDrawer>
  )
}

export default Drawer