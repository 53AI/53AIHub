import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import { t } from '@/locales'
import { useFileMode } from '@/hooks/useFileMode'
import filesApi from '@/api/modules/files'
import { debounce } from '@/utils'

interface FileEditBtnProps {
  fileId: string
  fileExt: string
  fileMime?: string
  libraryId?: string
  onEdit: () => void
  children?: React.ReactNode
}

/**
 * 文件编辑按钮组件
 * 检测文件是否可编辑，添加文件锁后触发编辑
 */
export function FileEditBtn({
  fileId,
  fileExt,
  fileMime,
  libraryId = '',
  onEdit,
  children
}: FileEditBtnProps) {
  const [showEditBtn, setShowEditBtn] = useState(false)
  const [editMessage, setEditMessage] = useState('')
  const [showEditMessage, setShowEditMessage] = useState(false)
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { getFileExt, getFileSetting } = useFileMode()

  const showEditMessageWithTimer = useCallback((msg: string) => {
    setEditMessage(msg)
    setShowEditMessage(true)
    if (lockTimerRef.current) {
      clearTimeout(lockTimerRef.current)
    }
    lockTimerRef.current = setTimeout(() => {
      lockTimerRef.current = null
      setShowEditMessage(false)
    }, 3000)
  }, [])

  const handleEdit = useCallback(async () => {
    try {
      const res = await filesApi.lock(fileId, { action: 'add' })
      if (res.success) {
        onEdit()
      } else {
        showEditMessageWithTimer(res.message)
      }
    } catch (error: unknown) {
      const err = error as { response?: { data?: { data?: { message?: string } } } }
      showEditMessageWithTimer(err?.response?.data?.data?.message || t('mine.add_lock_failed'))
    }
  }, [fileId, onEdit, showEditMessageWithTimer, t])

  const debouncedHandleEdit = useCallback(debounce(handleEdit, 300), [handleEdit])

  useEffect(() => {
    const init = async () => {
      // 音频/视频文件不可编辑
      const audioVideoExts = ['mp3', 'mp4', 'm4a', 'wav', 'flac', 'ogg', 'aac', 'wma', 'webm', 'mov', 'avi', 'mkv']
      if (audioVideoExts.includes(fileExt.toLowerCase())) {
        setShowEditBtn(false)
        return
      }

      // md/txt 文件可编辑
      if (fileExt === 'md' || fileExt === 'txt') {
        setShowEditBtn(true)
        return
      }

      // 其他文件根据配置判断
      if (!libraryId) {
        setShowEditBtn(false)
        return
      }

      const ext = await getFileExt(fileExt)
      const setting = await getFileSetting(libraryId)
      const way = setting.editor?.[ext] || 'default'
      setShowEditBtn(way !== 'default')
    }

    init()

    return () => {
      if (lockTimerRef.current) {
        clearTimeout(lockTimerRef.current)
      }
    }
  }, [fileExt, libraryId, getFileExt, getFileSetting])

  if (!showEditBtn) {
    return null
  }

  return (
    <div className="inline-flex relative">
      <div className="inline-flex items-center" onClick={debouncedHandleEdit}>
        {children || <Button type="primary">{t("mine.edit_btn")}</Button>}
      </div>
      {showEditMessage && (
        <div className="h-full px-2 flex items-center absolute top-10 right-0 z-10 bg-white rounded-md border shadow-lg">
          <SvgIcon name="warning" className="mr-1 text-[#F0A105]" />
          <span className="flex-1 truncate text-sm text-[#1D1E1F] whitespace-nowrap">
            {editMessage}
          </span>
        </div>
      )}
    </div>
  )
}

export default FileEditBtn