import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import { wpsApi } from '@/api/modules/wps'

declare global {
  interface Window {
    WebOfficeSDK: {
      init: (config: any) => IWps
      OfficeType: {
        Writer: string
        Spreadsheet: string
        Presentation: string
        Pdf: string
      }
    }
  }
}

interface IWps {
  ready: () => void
  destroy: () => void
  save: () => void
}

export interface WpsOfficeRef {
  save: () => void
}

export interface WpsOfficeProps {
  fileId?: string
  fileExt?: string
  appId?: string
  readonly?: boolean
}

export const WpsOffice = forwardRef<WpsOfficeRef, WpsOfficeProps>(
  ({ fileId = '', fileExt = '', appId = '', readonly = false }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const wpsInstance = useRef<IWps | null>(null)

    // Initialize WPS Office
    const initWpsOffice = async () => {
      try {
        const { ticket } = await wpsApi.ticket()

        const data: any = {
          officeType: '',
          appId,
          fileId,
          token: localStorage.getItem('access_token'),
          mount: containerRef.current,
          mode: readonly ? 'simple' : 'nomal',
          customArgs: {
            tk: ticket,
          },
        }

        if (readonly) {
          data.customArgs.readonly = true
        }

        // Determine office type by file extension
        if (['docx', 'doc'].includes(fileExt)) {
          data.officeType = window.WebOfficeSDK.OfficeType.Writer
        } else if (['xlsx', 'xls'].includes(fileExt)) {
          data.officeType = window.WebOfficeSDK.OfficeType.Spreadsheet
        } else if (['pptx', 'ppt'].includes(fileExt)) {
          data.officeType = window.WebOfficeSDK.OfficeType.Presentation
        } else if (['pdf'].includes(fileExt)) {
          data.officeType = window.WebOfficeSDK.OfficeType.Pdf
        }

        wpsInstance.current = window.WebOfficeSDK.init(data)
        wpsInstance.current.ready()
      } catch (error) {
        console.error('Failed to initialize WPS Office:', error)
      }
    }

    // Load WPS script and initialize
    useEffect(() => {
      let script: HTMLScriptElement | null = null

      const loadWps = async () => {
        // Load WPS WebOffice SDK script
        script = document.createElement('script')
        script.src = 'https://solution.wps.cn/weboffice/v2/wps-jssdk.js'
        script.async = true
        script.onload = () => {
          initWpsOffice()
        }
        document.head.appendChild(script)
      }

      loadWps()

      // Cleanup on unmount
      return () => {
        if (wpsInstance.current) {
          wpsInstance.current.destroy()
          wpsInstance.current = null
        }
        if (script && script.parentNode) {
          script.parentNode.removeChild(script)
        }
      }
    }, [fileId, fileExt, appId, readonly])

    // Expose save method
    useImperativeHandle(ref, () => ({
      save: () => {
        if (wpsInstance.current) {
          wpsInstance.current.save()
        }
      },
    }))

    return <div ref={containerRef} className="w-full h-full" />
  }
)

WpsOffice.displayName = 'WpsOffice'

export default WpsOffice
