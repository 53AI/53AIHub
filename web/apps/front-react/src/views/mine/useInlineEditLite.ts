import { useRef, useCallback } from 'react'
import { PERMISSION_TYPE } from '@/components/KMPermission/constant'

/** 文件名最大字符数限制 */
const MAX_FILENAME_LENGTH = 150

export interface InlineEditFile {
  id: string
  name: string
  file_ext?: string
}

export interface InlineEditLiteOptions {
  /** 当前文件数据 */
  file: InlineEditFile
  /** 是否为文件（用于处理扩展名） */
  isFile: boolean
  /** 权限值 */
  permission: number
  /** 重命名函数 */
  onRename: (fileId: string, newName: string) => Promise<void>
  /** 保存后的回调 */
  onSave?: () => void
  /** 检查重名函数（可选，不传则不检测重名） */
  checkDuplicate?: (name: string) => boolean
}

/**
 * 检查是否有编辑权限
 */
export const canEdit = (permission: number) => permission >= PERMISSION_TYPE.edit_knowledge

/**
 * 获取显示名称（文件去掉扩展名）
 */
export const getDisplayName = (name: string, isFile: boolean, fileExt?: string) => {
  if (!isFile) return name
  const realExt = fileExt === 'md' ? '' : '.' + fileExt
  return name.replace(realExt || '.md', '')
}

/**
 * 构建完整路径，保留父目录
 * @param originalPath 原始完整路径，如 "/ai-generated/test.md"
 * @param newName 新文件名，如 "new.md"
 * @returns 新的完整路径，如 "/ai-generated/new.md"
 */
export const buildNewPath = (originalPath: string, newName: string): string => {
  const fullPath = originalPath || ''
  const basePath = fullPath.startsWith('/') ? fullPath.substring(1) : fullPath
  const parentDir = basePath.includes('/') ? basePath.substring(0, basePath.lastIndexOf('/')) : ''
  return parentDir ? `/${parentDir}/${newName}` : `/${newName}`
}

/**
 * 从完整路径提取文件名
 * @param path 完整路径，如 "/ai-generated/test.md"
 * @returns 文件名，如 "test.md"
 */
export const extractFileName = (path: string): string => {
  return path.split('/').pop() || path
}

/**
 * Inline Edit Lite Hook - 不依赖 libraryStore，适合独立页面使用
 */
export function useInlineEditLite() {
  const elementRef = useRef<HTMLElement | null>(null)
  const originalValueRef = useRef<string>('')
  const optionsRef = useRef<InlineEditLiteOptions | null>(null)

  /**
   * 进入编辑模式
   */
  const enterEditMode = useCallback((el: HTMLElement, options: InlineEditLiteOptions) => {
    originalValueRef.current = el.textContent || ''
    optionsRef.current = options
    el.contentEditable = 'plaintext-only'
    el.classList.add('inline-editing')

    const originalUserSelect = document.body.style.userSelect
    document.body.style.userSelect = ''

    el.focus()

    // 将光标移动到文本末尾
    const range = document.createRange()
    const selection = window.getSelection()
    if (el.childNodes.length > 0) {
      range.setStartAfter(el.lastChild!)
      range.collapse(true)
    } else {
      range.selectNodeContents(el)
      range.collapse(true)
    }
    selection?.removeAllRanges()
    selection?.addRange(range)

    el.scrollLeft = el.scrollWidth
    ;(el as any)._originalBodyUserSelect = originalUserSelect
    elementRef.current = el
  }, [])

  /**
   * 退出编辑模式
   */
  const exitEditMode = useCallback((el: HTMLElement) => {
    // 先清空 ref，防止 contentEditable 变化触发 blur 时重复执行
    elementRef.current = null
    optionsRef.current = null

    try {
      const range = document.createRange()
      const selection = window.getSelection()
      if (el.firstChild) {
        range.setStart(el.firstChild, 0)
      } else {
        range.setStart(el, 0)
      }
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
    } catch (_) {}
    el.scrollLeft = 0
    el.contentEditable = 'false'
    el.classList.remove('inline-editing')

    const originalUserSelect = (el as any)._originalBodyUserSelect
    if (originalUserSelect !== undefined) {
      document.body.style.userSelect = originalUserSelect
      delete (el as any)._originalBodyUserSelect
    }
  }, [])

  /**
   * 处理点击事件
   */
  const handleClick = useCallback((e: React.MouseEvent<HTMLElement>, options: InlineEditLiteOptions) => {
    if (!canEdit(options.permission)) return
    e.stopPropagation()
    const target = e.currentTarget
    if (target.classList.contains('inline-editing')) return
    enterEditMode(target, options)
  }, [enterEditMode])

  /**
   * 处理 blur 事件
   */
  const handleBlur = useCallback(async (e: React.FocusEvent<HTMLElement>) => {
    const target = e.currentTarget
    const options = optionsRef.current
    if (!options) return

    let trimmedValue = target.textContent?.trim() || ''
    const original = originalValueRef.current

    // 限制最大字符数
    if (trimmedValue.length > MAX_FILENAME_LENGTH) {
      trimmedValue = trimmedValue.substring(0, MAX_FILENAME_LENGTH)
    }

    // 如果为空，恢复原值
    if (!trimmedValue) {
      target.textContent = original
      exitEditMode(target)
      return
    }

    // 计算新文件名
    let newName: string
    if (options.isFile) {
      const realExt = options.file.file_ext === 'md' ? '' : '.' + options.file.file_ext
      newName = `${trimmedValue}${realExt}.md`
    } else {
      newName = trimmedValue
    }

    // 如果没变化，直接退出
    if (newName === options.file.name) {
      exitEditMode(target)
      return
    }

    // 检查重名
    if (options.checkDuplicate?.(newName)) {
      // 生成唯一名称
      const baseName = options.isFile ? trimmedValue : newName
      const pattern = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\((\\d+)\\)$`)
      // 这里简化处理，直接加 (1)
      if (options.isFile) {
        const realExt = options.file.file_ext === 'md' ? '' : '.' + options.file.file_ext
        newName = `${baseName}(1)${realExt}.md`
      } else {
        newName = `${newName}(1)`
      }
    }

    try {
      await options.onRename(options.file.id, newName)
      options.onSave?.()
    } catch (error) {
      console.error('重命名失败:', error)
      target.textContent = original
    }

    exitEditMode(target)
  }, [exitEditMode])

  /**
   * 处理 keydown 事件
   */
  const handleKeydown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    const target = e.currentTarget

    if (e.key === 'Escape') {
      target.textContent = originalValueRef.current
      exitEditMode(target)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      target.blur()
    } else if (
      !e.ctrlKey &&
      !e.metaKey &&
      e.key.length === 1 &&
      (target.textContent?.length || 0) >= MAX_FILENAME_LENGTH
    ) {
      e.preventDefault()
    }
  }, [exitEditMode])

  /**
   * 处理粘贴事件
   */
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLElement>) => {
    const target = e.currentTarget

    e.preventDefault()

    let text = e.clipboardData?.getData('text/plain') || ''
    text = text.replace(/[\r\n]+/g, ' ').trim()

    const currentLength = target.textContent?.length || 0
    const maxPasteLength = MAX_FILENAME_LENGTH - currentLength
    if (text.length > maxPasteLength) {
      text = text.substring(0, maxPasteLength)
    }

    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)
      range.deleteContents()
      range.insertNode(document.createTextNode(text))

      range.setStartAfter(range.endContainer)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    }
  }, [])

  return {
    handleClick,
    handleBlur,
    handleKeydown,
    handlePaste,
    canEdit,
    getDisplayName,
  }
}

export default useInlineEditLite
