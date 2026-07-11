import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import { getRealPath } from '@/utils/config'

export interface UEditorRef {
  setValue: (value: string) => Promise<void>
  getHtml: () => Promise<string>
}

export interface UEditorProps {
  className?: string
}

export const UEditor = forwardRef<UEditorRef, UEditorProps>(({ className }, ref) => {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const readyRef = useRef(false)

  // Wait for ready - 匹配 Vue 版本的 getReady 逻辑
  const getReady = () =>
    new Promise<void>((resolve) => {
      if (readyRef.current) return resolve()
      const handleReady = (e: MessageEvent) => {
        const data = e.data || {}
        const action = data.action || ''
        if (action === 'ueditor-ready') {
          readyRef.current = true
          window.removeEventListener('message', handleReady)
          resolve()
        }
      }
      window.addEventListener('message', handleReady)
    })

  // Listen for ready message - 匹配 Vue 版本的 onMounted
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const data = e.data || {}
      const action = data.action || ''
      if (action === 'ueditor-ready') {
        readyRef.current = true
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  // Set editor content - 匹配 Vue 版本
  const setValue = async (value: string) => {
    await getReady()
    iframeRef.current?.contentWindow?.postMessage({ action: 'setValue', value }, '*')
  }

  // Get HTML content - 匹配 Vue 版本
  const getHtml = async (): Promise<string> => {
    await getReady()
    return new Promise((resolve) => {
      iframeRef.current?.contentWindow?.postMessage({ action: 'getHtml' }, '*')
      const handleGetHtml = (e: MessageEvent) => {
        const data = e.data || {}
        const action = data.action || ''
        if (action === 'getHtml') {
          window.removeEventListener('message', handleGetHtml)
          resolve(data.value || '')
        }
      }
      window.addEventListener('message', handleGetHtml)
    })
  }

  useImperativeHandle(ref, () => ({
    setValue,
    getHtml,
  }))

  // 匹配 Vue 版本: :src="$getRealPath({ url: '/UEditor/index.html' })"
  // getRealPath 函数会添加 base_path 前缀
  return (
    <iframe
      ref={iframeRef}
      className={`w-full h-full ${className || ''}`}
      src={getRealPath('/UEditor/index.html')}
    />
  )
})

UEditor.displayName = 'UEditor'

export default UEditor
