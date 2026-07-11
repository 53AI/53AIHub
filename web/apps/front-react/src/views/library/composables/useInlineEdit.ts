import { useRef, useCallback, useEffect } from 'react'
import { useLibraryStore } from '@/stores/modules/library'
import { PERMISSION_TYPE } from '@/components/KMPermission/constant'
import { api_host } from "@/utils/config";
import { enableBeforeUnloadProtection } from '@/utils/before-unload-guard'

/** 文件名最大字符数限制 */
const MAX_FILENAME_LENGTH = 150

interface InlineEditOptions {
  /** 当前文件数据 */
  file: {
    id: string
    name: string
    base_path: string
    isfile?: boolean
    file_ext?: string
  }
  /** 是否为文件（用于处理扩展名） */
  isFile: boolean
  /** 权限值 */
  permission: number
  /** 是否允许多行，默认 false */
  multiline?: boolean
  /** 保存后的回调 */
  onSave?: () => void
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
 * 处理重名，生成唯一名称
 */
const generateUniqueName = (
  newName: string,
  options: InlineEditOptions,
  libraryStore: ReturnType<typeof useLibraryStore>
): string => {
  const siblings = libraryStore.findNodeInBasePath(options.file.base_path, libraryStore.treeFiles)
  const isDuplicate = siblings.some(item => item.id !== options.file.id && item.name === newName)

  if (!isDuplicate) return newName

  // 获取显示名称（去掉扩展名）
  let baseName = newName
  if (options.isFile) {
    const realExt = options.file.file_ext === 'md' ? '' : '.' + options.file.file_ext
    baseName = newName.replace(realExt || '.md', '')
  }

  const pattern = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\((\\d+)\\)$`)
  const numbers: number[] = []

  siblings.forEach(item => {
    let itemName = item.name
    if (options.isFile) {
      const realExt = options.file.file_ext === 'md' ? '' : '.' + options.file.file_ext
      itemName = item.name.replace('.md', '').replace(realExt, '')
    }
    const match = itemName.match(pattern)
    if (match && item.id !== options.file.id) {
      numbers.push(parseInt(match[1], 10))
    }
  })

  const maxNumber = numbers.length > 0 ? Math.max(...numbers) : 0
  const nextNumber = maxNumber + 1
  const uniqueBaseName = `${baseName}(${nextNumber})`

  if (options.isFile) {
    const realExt = options.file.file_ext === 'md' ? '' : '.' + options.file.file_ext
    return `${uniqueBaseName}${realExt}.md`
  }
  return uniqueBaseName
}

/**
 * 执行重命名
 */
const doRename = async (
  newName: string,
  options: InlineEditOptions,
  libraryStore: ReturnType<typeof useLibraryStore>
) => {
  const newPath = `${options.file.base_path}/${newName}`
  await libraryStore.rename(options.file.id, newPath)
  libraryStore.loadFilesAll()
  options.onSave?.()
}

/**
 * Inline Edit Hook
 */
export function useInlineEdit() {
  const elementRef = useRef<HTMLElement | null>(null)
  const originalValueRef = useRef<string>('')
  const optionsRef = useRef<InlineEditOptions | null>(null)
  const libraryStore = useLibraryStore()

  /**
   * 进入编辑模式
   */
  const enterEditMode = useCallback((el: HTMLElement, options: InlineEditOptions) => {
    originalValueRef.current = el.textContent || ''
    optionsRef.current = options
    el.contentEditable = 'plaintext-only'
    el.classList.add('inline-editing')

    // 临时恢复 body 的 user-select
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

    elementRef.current = null
    optionsRef.current = null
  }, [])

  /**
   * 处理点击事件
   */
  const handleClick = useCallback((e: React.MouseEvent<HTMLElement>, options: InlineEditOptions) => {
    if (!canEdit(options.permission)) return
    e.stopPropagation()
    const target = e.currentTarget
    if (target.classList.contains('inline-editing')) return
    enterEditMode(target, options)
  }, [enterEditMode])

  /**
   * 处理 blur 事件
   */
  const handleBlur = useCallback(async (e: React.FocusEvent<HTMLElement>, options: InlineEditOptions) => {
    const target = e.currentTarget
    let trimmedValue = target.textContent?.trim() || ''
    const original = originalValueRef.current

    // 过滤掉 / 字符
    trimmedValue = trimmedValue.replace(/\//g, '')

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

    const uniqueName = generateUniqueName(newName, options, libraryStore)
    await doRename(uniqueName, options, libraryStore)

    exitEditMode(target)
  }, [exitEditMode, libraryStore])

  /**
   * 处理 keydown 事件
   */
  const handleKeydown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    const target = e.currentTarget
    const options = optionsRef.current
    const multiline = options?.multiline ?? false

    if (e.key === 'Escape') {
      target.textContent = originalValueRef.current
      exitEditMode(target)
    } else if (e.key === 'Enter') {
      if (multiline && e.shiftKey) {
        return
      }
      e.preventDefault()
      target.blur()
    } else if (e.key === '/') {
      // 阻止输入 / 字符
      e.preventDefault()
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
    const options = optionsRef.current
    const multiline = options?.multiline ?? false

    e.preventDefault()

    let text = e.clipboardData?.getData('text/plain') || ''

    // 过滤掉 / 字符
    text = text.replace(/\//g, '')

    if (!multiline) {
      text = text.replace(/[\r\n]+/g, ' ').trim()
    }

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

  /**
   * 页面刷新前自动保存
   */
  useEffect(() => {
    const handleBeforeUnload = () => {
      const el = elementRef.current
      const options = optionsRef.current
      if (!el || !options) return

      let trimmedValue = el.textContent?.trim() || ''

      // 过滤掉 / 字符
      trimmedValue = trimmedValue.replace(/\//g, '')

      if (trimmedValue.length > MAX_FILENAME_LENGTH) {
        trimmedValue = trimmedValue.substring(0, MAX_FILENAME_LENGTH)
      }

      if (!trimmedValue) return

      let newName: string
      if (options.isFile) {
        const realExt = options.file.file_ext === 'md' ? '' : '.' + options.file.file_ext
        newName = `${trimmedValue}${realExt}.md`
      } else {
        newName = trimmedValue
      }

      if (newName === options.file.name) return

      const uniqueName = generateUniqueName(newName, options, libraryStore)
      const newPath = `${options.file.base_path}/${uniqueName}`

      const url = `${api_host}/api/files/rename`
      const accessToken = localStorage.getItem('access_token')

      try {
        fetch(url, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
          },
          body: JSON.stringify({
            id: options.file.id,
            path: newPath
          }),
          keepalive: true
        }).catch(err => console.error('自动保存文件名失败:', err))
      } catch (error) {
        console.error('自动保存文件名失败:', error)
      }

      exitEditMode(el)
    }

    // 启用 beforeunload 保护标记
    const disableProtection = enableBeforeUnloadProtection()

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      disableProtection()
    }
  }, [exitEditMode, libraryStore])

  return {
    handleClick,
    handleBlur,
    handleKeydown,
    handlePaste,
    canEdit,
    getDisplayName,
  }
}

export default useInlineEdit
