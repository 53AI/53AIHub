import { useRef, useEffect, useState, forwardRef, useImperativeHandle, useCallback } from 'react'
import { t } from '@/locales'
import './editor-section.css'

interface EditorSectionProps {
  value?: string
  placeholder?: string
  parser?: (text: string) => string
  formatter?: (text: string) => string
  disabled?: boolean
  split?: boolean
  onFocus?: () => void
  onBlur?: () => void
  onInput?: (data: string) => void
  onSplit?: (data: string[]) => void
  onChange?: (value: string) => void
}

export interface EditorSectionRef {
  insert: (node: Node) => void
}

const defaultParser = (text: string) => text
const defaultFormatter = (text: string) => text

export const EditorSection = forwardRef<EditorSectionRef, EditorSectionProps>(
  (
    {
      value = '',
      placeholder,
      parser = defaultParser,
      formatter = defaultFormatter,
      disabled = false,
      split = true,
      onFocus,
      onBlur,
      onInput,
      onSplit,
      onChange
    },
    ref
  ) => {
    const contentRef = useRef<HTMLDivElement>(null)
    const nodeIdRef = useRef(`textarea_plus-${Math.random()}`)
    const lastSelectionRef = useRef<any>(null)
    const initRef = useRef(false)
    const tooltipRef = useRef<HTMLDivElement | null>(null)

    const defaultPlaceholder = placeholder || t('form.input_placeholder')

    const handleInput = useCallback(() => {
      if (!contentRef.current) return
      const html = formatter(contentRef.current.innerHTML.replace(/<br>/g, '\n'))
      onInput?.(html)
      onChange?.(html)
    }, [formatter, onInput, onChange])

    const insert = useCallback((node: Node) => {
      if (!contentRef.current) return
      let range = lastSelectionRef.current?.range
      if (!range) {
        const selection = window.getSelection()
        selection?.selectAllChildren(contentRef.current)
        selection?.collapseToEnd()
        range = window.getSelection()?.getRangeAt(0)
      }
      const sel = window.getSelection()

      if (range && sel) {
        range.insertNode(node)

        sel.removeAllRanges()
        sel.addRange(range)
        sel.collapseToEnd()

        handleInput()
      }
    }, [handleInput])

    const handleFocus = useCallback(() => {
      onFocus?.()
    }, [onFocus])

    const handleBlur = useCallback(() => {
      onBlur?.()
    }, [onBlur])

    const handleEnter = useCallback(
      (e: React.KeyboardEvent) => {
        if (!split) return
        e.preventDefault()

        const sel = window.getSelection()
        if (!sel) return

        const range = sel.getRangeAt(0)
        const next = range.endContainer.nextSibling

        if (!next) {
          document.execCommand('insertHTML', false, '<br>&zwnj;')
        } else {
          const node = document.createElement('p')
          node.className = 'w-0 h-4 split-mark'
          node.contentEditable = 'false'
          node.id = `split_item_${Math.random()}`
          node.innerHTML = `<span class="split-mark-box flex-center" contenteditable="false"><svg style="fill: currentColor;" t="1708410575385" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="14298" width="20" height="20"><path d="M896 149.333333a61.013333 61.013333 0 0 0-85.333333-4.693333l-323.626667 322.133333-94.506667-94.506666a149.333333 149.333333 0 1 0-51.2 39.68L441.813333 512 341.333333 612.053333a149.333333 149.333333 0 1 0 50.773334 39.68l94.506666-94.506666L810.666667 880.426667a61.013333 61.013333 0 0 0 85.333333-4.693334L533.333333 512z m-548.266667 198.4a99.626667 99.626667 0 1 1 0-140.8 99.626667 99.626667 0 0 1 0 140.8z m0 469.333334a99.626667 99.626667 0 1 1 0-140.8 99.626667 99.626667 0 0 1 0 140.8z" p-id="14299"></path></svg></span><span class="split-mark-line" contenteditable="false"></span>`
          insert(node)
        }
      },
      [split, insert]
    )

    const findParentNode = useCallback((el: HTMLElement | Node | null, className: string): HTMLElement | null => {
      if (!el) return null
      if ((el as HTMLElement).classList && (el as HTMLElement).classList.contains(className)) {
        return el as HTMLElement
      }
      if ((el as HTMLElement).parentNode) {
        return findParentNode((el as HTMLElement).parentNode, className)
      }
      return null
    }, [])

    const pasteHandler = useCallback(
      (e: ClipboardEvent) => {
        if (!contentRef.current) return
        const clipdata = e.clipboardData || (window as any).clipboardData
        let text = clipdata.getData('text')

        text = text.split('\r\n').join('<br>').split('\n').join('<br>')

        document.execCommand('insertHTML', false, text)

        e.preventDefault()
      },
      []
    )

    const selectHandler = useCallback(() => {
      if (!contentRef.current) return
      const selection = window.getSelection()
      if (!selection) return

      const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null
      if (
        range &&
        (range.commonAncestorContainer as any).ownerDocument?.activeElement?.id === nodeIdRef.current
      ) {
        lastSelectionRef.current = {
          range,
          selection,
          offset: selection.focusOffset
        }
      }
    }, [])

    const mouseHandler = useCallback((ev: MouseEvent) => {
      const node = findParentNode(ev.target as Node, 'split-mark')
      if (!node) return
      if (tooltipRef.current) return
      const rect = node.getBoundingClientRect()
      tooltipRef.current = document.createElement('div')
      tooltipRef.current.className = 'split-tooltip'
      tooltipRef.current.innerHTML = t('action.split_slice')
      tooltipRef.current.style.cssText = `left: ${rect.left - 80}px; top: ${rect.top - 6}px; position: fixed;`
      document.body.appendChild(tooltipRef.current)
    }, [findParentNode, t])

    const mouseleaveHandler = useCallback(() => {
      if (tooltipRef.current) {
        tooltipRef.current.remove()
        tooltipRef.current = null
      }
    }, [])

    const clickHandler = useCallback(
      (ev: MouseEvent) => {
        if (!contentRef.current) return
        const node = findParentNode(ev.target as Node, 'split-mark')
        if (node) {
          mouseleaveHandler()
          const outHtml = node.outerHTML
          const contents = contentRef.current.innerHTML.split(outHtml)
          onSplit?.(
            contents.map((item) => {
              const text = item.replace(/<br>/g, '\n').replace(/&nbsp;/g, '')
              return text
            })
          )
        }
      },
      [findParentNode, mouseleaveHandler, onSplit]
    )

    useImperativeHandle(ref, () => ({
      insert
    }))

    // Initialize content
    useEffect(() => {
      if (initRef.current) return
      if (value && contentRef.current) {
        initRef.current = true
        contentRef.current.innerHTML = parser(String(value).replace(/\n/g, '<br>'))
      }
    }, [value, parser])

    // Event listeners
    useEffect(() => {
      const content = contentRef.current
      if (!content) return

      content.addEventListener('paste', pasteHandler)
      content.addEventListener('click', clickHandler)
      content.addEventListener('mousemove', mouseHandler)
      content.addEventListener('mouseleave', mouseleaveHandler)
      document.addEventListener('selectionchange', selectHandler)

      return () => {
        content.removeEventListener('paste', pasteHandler)
        content.removeEventListener('click', clickHandler)
        content.removeEventListener('mousemove', mouseHandler)
        content.removeEventListener('mouseleave', mouseleaveHandler)
        document.removeEventListener('selectionchange', selectHandler)
      }
    }, [pasteHandler, clickHandler, mouseHandler, mouseleaveHandler, selectHandler])

    return (
      <div className="w-full flex h-full relative">
        <div
          id={nodeIdRef.current}
          ref={contentRef}
          className="w-full h-full p-1 text-sm text-[#606266] outline-none relative z-10 break-all editor-section-content"
          contentEditable={!disabled && split}
          data-placeholder={defaultPlaceholder}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onInput={handleInput}
          onKeyPress={handleEnter}
        />
      </div>
    )
  }
)

EditorSection.displayName = 'EditorSection'

export default EditorSection
