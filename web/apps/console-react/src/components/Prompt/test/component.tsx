import { NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import { DownOutlined } from '@ant-design/icons'
import { Dropdown } from '@km/shared-components-react'
import { useCallback, useState } from 'react'

const creatorOptions = [
  { label: '小红书文案', key: '小红书文案' },
  { label: '广告文案', key: '广告文案' },
  { label: '抖音脚本', key: '抖音脚本' },
  { label: '品牌故事', key: '品牌故事' },
]

export default function LinkComponent({ node, updateAttributes }: NodeViewProps) {
  const { value, defaultValue, type } = node.attrs
  const [editValue, setEditValue] = useState(value || '')

  const handleInput = useCallback(
    (e: React.FormEvent<HTMLSpanElement>) => {
      const newContent = e.currentTarget.innerText.trim()
      if (newContent === '') {
        e.currentTarget.innerText = ''
      }
      setEditValue(newContent)
      updateAttributes({ value: newContent })
    },
    [updateAttributes]
  )

  const handleBlur = useCallback(
    (e: React.FormEvent<HTMLSpanElement>) => {
      handleInput(e)
    },
    [handleInput]
  )

  const handleCommand = useCallback(
    (command: string) => {
      updateAttributes({ value: command })
      setEditValue(command)
    },
    [updateAttributes]
  )

  const handleWrapperClick = useCallback(() => {
    const el = document.getElementById(`link-edit-${editValue}`)
    el?.focus()
  }, [editValue])

  return (
    <NodeViewWrapper as="span" className="mx-1">
      <span
        className="py-px px-1 rounded bg-[#F1F5FD] text-sm text-[#91B1F5] outline-none cursor-pointer"
        onClick={handleWrapperClick}
      >
        <span
          id={`link-edit-${editValue}`}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onBlur={handleBlur}
          data-placeholder={defaultValue}
          className={`outline-none ${!value ? 'empty' : ''}`}
          style={{
            minWidth: '10px',
            display: 'inline-block',
          }}
        >
          {value}
        </span>
        {type === 'creator' && (
          <Dropdown
            menu={{
              items: creatorOptions,
              onClick: ({ key }) => handleCommand(key),
            }}
            trigger={['click']}
          >
            <DownOutlined style={{ fontSize: 12, color: '#92B1F5', marginLeft: 4 }} />
          </Dropdown>
        )}
      </span>
      <style>{`
        [data-placeholder]:empty::before {
          content: attr(data-placeholder);
          color: #91B1F5;
          pointer-events: none;
        }
        [data-placeholder]:empty {
          display: inline-block;
        }
        .ProseMirror-selectednode {
          outline: none;
        }
      `}</style>
    </NodeViewWrapper>
  )
}