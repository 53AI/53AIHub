import { useCallback, useState } from 'react'
import { isOfficeFile, getOfficeFileType } from '@km/shared-utils'
import { cacheManager as cache } from '@km/shared-utils'
import service from '@/api/config'

export type OfficeViewerType = 'preview' | 'editor'
export type ShowType = 'wps' | 'web'

export interface WpsStatus {
  app_id: string
  is_configured: boolean
}

export interface UseOfficeViewerReturn {
  officeType: ShowType
  wpsStatus: WpsStatus
  officeLoading: boolean
  checkOfficeViewer: (params: {
    file_ext: string
    library_id: string
    type: OfficeViewerType
  }) => Promise<void>
  getOfficeViewerSetting: (params: { library_id: string }) => Promise<{ preview: Record<string, string>; editor: Record<string, string> }>
}

/**
 * Office 文件查看器选择 Hook
 * 根据文件类型和设置决定使用 WPS 还是 Web 预览/编辑
 */
export function useOfficeViewer(): UseOfficeViewerReturn {
  const [wpsStatus, setWpsStatus] = useState<WpsStatus>({
    app_id: '',
    is_configured: false,
  })
  const [officeLoading, setOfficeLoading] = useState(false)
  const [officeType, setOfficeType] = useState<ShowType>('web')

  const getOfficeViewerSetting = useCallback(
    async (params: { library_id: string }) => {
      const setting = await cache.getOrFetch(
        'document_js_sdk_setting',
        async () => {
          const res = await service.get('/api/settings/key/document_js_sdk_setting', {
            params: { library_id: params.library_id },
          })
          const body = (res as { data?: { value?: string } })?.data
          return body ?? null
        },
      )
      const raw = (setting as { value?: string } | null)?.value ?? ''
      return JSON.parse(raw || '{ "preview": {}, "editor": {} }') as {
        preview: Record<string, string>
        editor: Record<string, string>
      }
    },
    [],
  )

  const checkOfficeViewer = useCallback(
    async (params: { file_ext: string; library_id: string; type: OfficeViewerType }) => {
      if (!isOfficeFile(params.file_ext)) {
        setOfficeLoading(false)
        return
      }

      setOfficeLoading(true)

      try {
        const status = await cache.getOrFetch('wps_status', async () => {
          const res = await service.get('/api/platform-settings/wps/status')
          return (res as { data?: WpsStatus })?.data ?? res
        }) as WpsStatus
        setWpsStatus(prev => ({ ...prev, app_id: status?.app_id ?? '', is_configured: status?.is_configured ?? false }))

        const setting = await getOfficeViewerSetting(params)
        const fileType = getOfficeFileType(params.file_ext)
        const config = params.type === 'preview' ? setting.preview : setting.editor
        const viewerType = config?.[fileType]

        if (status?.is_configured && viewerType === 'wps') {
          setOfficeType('wps')
        } else {
          setOfficeType('web')
        }
      } catch (error) {
        console.error('检查 Office 文件查看器失败:', error)
        setOfficeType('web')
      } finally {
        setOfficeLoading(false)
      }
    },
    [getOfficeViewerSetting],
  )

  return {
    officeType,
    wpsStatus,
    officeLoading,
    getOfficeViewerSetting,
    checkOfficeViewer,
  }
}
