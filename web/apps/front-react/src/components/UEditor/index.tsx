import { useRef, useState, useEffect, forwardRef, useImperativeHandle } from 'react'
import { getPublicPath } from '@/utils/config'

export interface UEditorRef {
  setValue: (value: string) => Promise<void>
  /** 静默设置值，不触发 onChange 回调 */
  setValueSilent: (value: string) => Promise<void>
  getHtml: () => Promise<string>
  getRawHtml: () => Promise<string>
}

interface UEditorProps {
  className?: string
  onChange?: () => void
}

export const UEditor = forwardRef<UEditorRef, UEditorProps>(({ className, onChange }, ref) => {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  // 用于标记是否在静默设置值期间，不触发 onChange
  const silentRef = useRef(false)

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const data = e.data || {}
      const action = data.action || ''
      if (action === 'ueditor-ready') {
        setReady(true)
      } else if (action === 'ueditor-contentChange') {
        // 如果在静默设置期间，不触发 onChange
        if (!silentRef.current) {
          onChange?.()
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [onChange])

  const getReady = () =>
    new Promise<void>((resolve) => {
      if (ready) return resolve()

      const handleReady = (e: MessageEvent) => {
        const data = e.data || {}
        const action = data.action || ''
        if (action === 'ueditor-ready') {
          setReady(true)
          window.removeEventListener('message', handleReady)
          resolve()
        }
      }

      window.addEventListener('message', handleReady)
    })

  useImperativeHandle(ref, () => ({
    async setValue(value: string) {
      await getReady()
      iframeRef.current?.contentWindow?.postMessage({ action: 'setValue', value }, '*')
    },
    async setValueSilent(value: string) {
      await getReady()
      // 设置静默标记
      silentRef.current = true
      iframeRef.current?.contentWindow?.postMessage({ action: 'setValue', value }, '*')
      // 等待一段时间确保 setValue 完成后再恢复
      // UEditor setContent 是同步的，但 postMessage 是异步的
      // 等待一个短暂的时间让 iframe 处理消息并触发可能的 contentChange
      await new Promise(resolve => setTimeout(resolve, 100))
      silentRef.current = false
    },
    async getHtml() {
      await getReady()
      return new Promise((resolve) => {
        iframeRef.current?.contentWindow?.postMessage({ action: 'getHtml' }, '*')

        const handleGetHtml = (e: MessageEvent) => {
          const data = e.data || {}
          const action = data.action || ''
          if (action === 'getHtml') {
            window.removeEventListener('message', handleGetHtml)
            resolve(data.value)
          }
        }

        window.addEventListener('message', handleGetHtml)
      })
    },
    async getRawHtml() {
      await getReady()
      return new Promise((resolve) => {
        iframeRef.current?.contentWindow?.postMessage({ action: 'getRawHtml' }, '*')

        const handleGetRawHtml = (e: MessageEvent) => {
          const data = e.data || {}
          const action = data.action || ''
          if (action === 'getRawHtml') {
            window.removeEventListener('message', handleGetRawHtml)
            resolve(data.value)
          }
        }

        window.addEventListener('message', handleGetRawHtml)
      })
    },
  }))

  return (
    <iframe
      ref={iframeRef}
      className={`w-full h-full ${className || ''}`}
      src={getPublicPath('/UEditor/index.html')}
      title="UEditor"
    />
  )
})

export default UEditor
