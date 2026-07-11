import { useState, useCallback, useRef } from 'react'
import settingApi from '@/api/modules/setting'
import platformSettingsApi from '@/api/modules/platform-settings'
import chunkSettingApi from '@/api/modules/chunk-setting'

export type ViewerType = 'preview' | 'editor'
export type Mode = 'wps' | 'default' | 'baidu_editor' | 'kk' | 'web'

export interface WpsStatus {
  app_id: string
  is_configured: boolean
}

// 简单的内存缓存
const cache = new Map<string, { data: unknown; timestamp: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5分钟

const getFromCache = <T>(key: string): T | null => {
  const cached = cache.get(key)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data as T
  }
  return null
}

const setCache = (key: string, data: unknown) => {
  cache.set(key, { data, timestamp: Date.now() })
}

/**
 * 判断是否为 Office 文件
 */
const isOfficeFile = (fileExt: string): boolean => {
  const officeExtensions = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf']
  return officeExtensions.includes(fileExt.toLowerCase())
}

/**
 * Office 文件查看器选择 Hook
 * 根据文件类型和设置决定使用 WPS 还是 Web 预览/编辑
 */
export function useFileMode() {
  const [wpsStatus, setWpsStatus] = useState<WpsStatus>({
    app_id: '',
    is_configured: false
  })
  const [officeLoading, setOfficeLoading] = useState(false)
  const [officeType, setOfficeType] = useState<Mode>('default')

  const getExtMap = useCallback(async () => {
    const cacheKey = 'extension_map'
    const cached = getFromCache<any>(cacheKey)
    if (cached) return cached

    try {
      const extensionMap = await chunkSettingApi.extensionMap.get()
      setCache(cacheKey, extensionMap)
      return extensionMap
    } catch (error) {
      console.error('获取扩展映射失败:', error)
      return {}
    }
  }, [])

  const getFileSetting = useCallback(async (libraryId: string) => {
    const cacheKey = `document_js_sdk_setting_${libraryId}`
    const cached = getFromCache<any>(cacheKey)
    if (cached) return cached

    try {
      const setting = await settingApi.get('document_js_sdk_setting', {
        library_id: libraryId
      })
      const parsed = JSON.parse(setting?.value || '{ "preview": {}, "editor": {} }')
      setCache(cacheKey, parsed)
      return parsed
    } catch (error) {
      console.error('获取文档设置失败:', error)
      return { preview: {}, editor: {} }
    }
  }, [])

  const getFileExt = useCallback(
    async (fileExt: string) => {
      const extensionMap = await getExtMap()
      const maps = extensionMap?.document_extension_map || {}
      const extensionType = Object.keys(maps).reduce((acc: string, key: string) => {
        if ((maps as Record<string, string[]>)[key]?.includes(fileExt)) {
          acc = key
        }
        return acc
      }, '')
      return extensionType || fileExt
    },
    [getExtMap]
  )

  /**
   * 检查并设置 Office 文件查看器类型
   * @param params 参数
   * @param params.file_ext 文件扩展名
   * @param params.library_id 库ID
   * @param params.type 查看器类型：'preview' 预览 或 'editor' 编辑
   * @returns 确定的查看器类型
   */
  const checkFileMode = useCallback(
    async (params: { file_ext: string; library_id: string; type: ViewerType }): Promise<Mode> => {
      setOfficeLoading(true)
      try {
        const setting = await getFileSetting(params.library_id)
        const fileExt = await getFileExt(params.file_ext)
        const isPreview = params.type === 'preview'
        const config = isPreview ? setting.preview : setting.editor
        const type = config[fileExt]

        if (isOfficeFile(params.file_ext)) {
          // 获取 WPS 状态
          if (type === 'wps') {
            const status = await platformSettingsApi.status('wps')
            setWpsStatus({
              app_id: status.app_id,
              is_configured: status.is_configured
            })

            if (status.is_configured) {
              setOfficeType('wps')
              return 'wps'
            }
          }
          if (isPreview) {
            setOfficeType('kk')
            return 'kk'
          }
        }
        const finalType = type || 'default'
        setOfficeType(finalType)
        return finalType
      } catch (error) {
        console.error('检查 Office 文件查看器失败:', error)
        setOfficeType('default')
        return 'default'
      } finally {
        setOfficeLoading(false)
      }
    },
    [getFileSetting, getFileExt]
  )

  return {
    officeType,
    wpsStatus,
    officeLoading,
    getFileSetting,
    checkFileMode,
    getExtMap,
    getFileExt
  }
}

export default useFileMode
