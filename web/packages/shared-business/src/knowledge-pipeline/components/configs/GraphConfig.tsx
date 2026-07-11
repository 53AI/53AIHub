import { useState, useEffect, useCallback } from 'react'
import { Empty, Switch } from 'antd'
import { CheckOutlined } from '@ant-design/icons'
import { SvgIcon } from '@km/shared-components-react'
import { usePipelineTranslation } from '../../context'
import { usePipelineAdapter } from '../../adapters'

export interface GraphTemplate {
  id: string
  name: string
  logo?: string
  description?: string
  entity_types?: string[]
  relation_types?: string[]
}

export interface GraphConfigData {
  graph_template_id?: string
  enable_smart_match?: boolean
  enable_smart_generation?: boolean
}

export interface GraphConfigProps {
  config: GraphConfigData
  onChange: (config: GraphConfigData) => void
  /** 自定义图谱模板列表（可选，优先级高于适配器） */
  templates?: GraphTemplate[]
  /** 默认图谱 logo URL */
  defaultLogo?: string
  /** i18n namespace prefix. Defaults to 'data_pipeline' */
  i18nPrefix?: string
}

// 解析数组字段
const safeParseArray = <T,>(value: unknown): T[] => {
  if (Array.isArray(value)) return value as T[]
  if (typeof value === 'string') {
    const raw = value.trim()
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as T[]) : []
    } catch {
      return []
    }
  }
  return []
}

// 分割预览
const splitPreview = (
  value: unknown,
  maxShown = 2,
  field?: 'name' | 'predicate'
): { shown: string[]; more: number } => {
  const list = safeParseArray<unknown>(value)
    .map((item) => {
      if (field && typeof item === 'object' && item !== null) {
        const fieldValue = (item as Record<string, unknown>)[field]
        return typeof fieldValue === 'string' ? fieldValue : ''
      }
      return typeof item === 'string' ? item : ''
    })
    .filter(Boolean)
  const shown = list.slice(0, maxShown)
  const more = Math.max(0, list.length - shown.length)
  return { shown, more }
}

export function GraphConfig({
  config,
  onChange,
  templates: providedTemplates,
  defaultLogo = '/images/library/graph-icon.png',
  i18nPrefix = 'data_pipeline',
}: GraphConfigProps) {
  const { t } = usePipelineTranslation()
  const tKey = (key: string) => `${i18nPrefix}.${key}`
  const adapter = usePipelineAdapter()

  const [templates, setTemplates] = useState<GraphTemplate[]>(providedTemplates || [])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(!providedTemplates)

  const isSmartMatchEnabled = Boolean(config?.enable_smart_match)
  const isSmartGenerateEnabled = Boolean(config?.enable_smart_generation)

  const updateConfig = (patch: Partial<GraphConfigData>) => {
    onChange({ ...config, ...patch })
  }

  const selectTemplate = async (id: string, opts?: { syncConfig?: boolean }) => {
    if (!id) return
    setSelectedTemplateId(id)
    if (opts?.syncConfig !== false) {
      updateConfig({ graph_template_id: id, enable_smart_match: false })
    }
  }

  const handleTemplateCardClick = (id: string) => {
    if (isSmartMatchEnabled) return
    selectTemplate(id)
  }

  const handleSmartMatchChange = (isEnabled: boolean) => {
    if (isEnabled) {
      setSelectedTemplateId(null)
      updateConfig({
        enable_smart_match: true,
        graph_template_id: '',
        enable_smart_generation: config?.enable_smart_generation ?? true,
      })
      return
    }

    const firstTemplateId = templates[0]?.id || ''
    setSelectedTemplateId(firstTemplateId || null)
    updateConfig({
      enable_smart_match: false,
      graph_template_id: firstTemplateId,
      enable_smart_generation: false,
    })
  }

  const handleSmartGenerateChange = (value: boolean) => {
    updateConfig({ enable_smart_generation: value })
  }

  const syncSelectionFromConfig = useCallback(async () => {
    if (isSmartMatchEnabled) {
      setSelectedTemplateId(null)
      return
    }

    const id = config?.graph_template_id || null
    if (!id) {
      if (templates.length) {
        await selectTemplate(templates[0].id)
        return
      }
      setSelectedTemplateId(null)
      return
    }

    if (templates.some((t) => t.id === id)) {
      setSelectedTemplateId(id)
      return
    }

    if (templates.length) {
      await selectTemplate(templates[0].id)
      return
    }

    setSelectedTemplateId(null)
    updateConfig({ graph_template_id: '' })
  }, [isSmartMatchEnabled, config?.graph_template_id, templates])

  const fetchTemplates = useCallback(async () => {
    if (!adapter?.getGraphTemplates) return

    setIsLoadingTemplates(true)
    try {
      const items = await adapter.getGraphTemplates()
      setTemplates(items.map(item => ({
        ...item,
        logo: item.logo || defaultLogo,
      })))
    } catch (error) {
      console.error('Failed to load graph templates:', error)
    } finally {
      setIsLoadingTemplates(false)
    }
  }, [adapter, defaultLogo])

  useEffect(() => {
    if (!providedTemplates && adapter?.getGraphTemplates) {
      fetchTemplates()
    }
  }, [providedTemplates, adapter, fetchTemplates])

  useEffect(() => {
    if (!isLoadingTemplates && templates.length > 0) {
      syncSelectionFromConfig()
    }
  }, [templates, isLoadingTemplates, syncSelectionFromConfig])

  return (
    <div className="flex flex-col justify-start relative w-full">
      <div className="flex flex-col justify-start">
        {/* 智能匹配开关 */}
        <div className="flex items-center gap-2 mb-5">
          <span className="text-base text-gray-800">{t(tKey('graph_smart_match'))}</span>
          <Switch
            checked={isSmartMatchEnabled}
            onChange={handleSmartMatchChange}
          />
          <span className="text-sm text-gray-400">
            {isSmartMatchEnabled ? t(tKey('graph_smart_match_on_desc')) : t(tKey('graph_smart_match_off_desc'))}
          </span>
        </div>

        {/* 模板列表 */}
        {!isLoadingTemplates && templates.length === 0 ? (
          <Empty description={t(tKey('graph_no_templates'))} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 transition-opacity">
            {isLoadingTemplates ? (
              // Loading skeletons
              [...Array(4)].map((_, idx) => (
                <div
                  key={`template-loading-${idx}`}
                  className="flex flex-col bg-white border border-[#E8EEFA] rounded-xl p-4"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <div className="size-7 rounded-lg bg-slate-100 animate-pulse"></div>
                    <div className="h-5 bg-slate-100 rounded w-1/2 animate-pulse"></div>
                  </div>
                  <div className="space-y-2 mb-4">
                    <div className="h-4 bg-slate-100 rounded w-full animate-pulse"></div>
                    <div className="h-4 bg-slate-100 rounded w-4/5 animate-pulse"></div>
                  </div>
                  <div className="flex gap-2">
                    <div className="h-6 w-16 bg-slate-100 rounded animate-pulse"></div>
                    <div className="h-6 w-14 bg-slate-100 rounded animate-pulse"></div>
                  </div>
                </div>
              ))
            ) : (
              templates.map((item) => {
                const isSelected = item.id === selectedTemplateId && !isSmartMatchEnabled
                const entities = splitPreview(item.entity_types, 2, 'name')
                return (
                  <div
                    key={item.id}
                    className={`flex flex-col bg-white border rounded-xl p-4 transition-all cursor-pointer relative ${
                      isSelected
                        ? 'border-[#2563EB] shadow-[0_0_0_2px_rgba(37,99,235,0.08)]'
                        : 'border-[#E8EEFA]'
                    } ${isSmartMatchEnabled ? 'cursor-not-allowed' : 'hover:border-[#C6D4F7]'}`}
                    onClick={() => handleTemplateCardClick(item.id)}
                  >
                    {isSelected && (
                      <div className="absolute top-0 right-0">
                        <div className="w-0 h-0 border-t-[30px] border-t-[#2563EB] border-l-[30px] border-l-transparent rounded-tr-xl"></div>
                        <CheckOutlined className="absolute top-1 right-1 text-white" style={{ fontSize: 10 }} />
                      </div>
                    )}

                    <div className="flex items-center gap-2 mb-3">
                      <div className="size-7 rounded-lg bg-[#EBF1FF] overflow-hidden flex items-center justify-center">
                        <img src={item.logo || defaultLogo} className="size-full object-cover" alt={item.name} />
                      </div>
                      <h3 className="flex-1 text-base font-medium text-gray-800 truncate" title={item.name}>
                        {item.name}
                      </h3>
                    </div>
                    <p className="text-sm text-gray-400 mb-4 min-h-[20px] line-clamp-1" title={item.description}>
                      {item.description || t(tKey('graph_no_description'))}
                    </p>
                    <div className="flex items-center overflow-hidden">
                      <div className="flex items-center text-gray-400 gap-1 mr-3 shrink-0">
                        <SvgIcon name="application-two" size={16} />
                        <span className="text-xs">{t(tKey('graph_entity_types'))}</span>
                      </div>
                      {entities.shown.length > 0 ? (
                        <div className="flex items-center gap-2 overflow-hidden flex-1">
                          {entities.shown.map((name, idx) => (
                            <span
                              key={`${item.id}-entity-${name}-${idx}`}
                              className="px-2 py-1 bg-[#F7F7F8] text-gray-600 text-xs rounded whitespace-nowrap max-w-[80px] truncate"
                            >
                              {name}
                            </span>
                          ))}
                          {entities.more > 0 && (
                            <span className="px-2 py-1 bg-[#F7F7F8] text-blue-600 text-xs rounded shrink-0">
                              +{entities.more}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="text-xs text-gray-400">{t(tKey('graph_no_tags'))}</div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* 智能匹配开启时显示智能生成选项 */}
        {isSmartMatchEnabled && (
          <>
            <div className="mt-5 flex items-center gap-2">
              <SvgIcon name="trending-down" size={16} />
              <span className="text-sm text-gray-600">{t(tKey('graph_smart_fallback'))}</span>
            </div>
            <div className="mt-2 border border-[#E6E8EB] rounded-xl bg-white px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="size-10 rounded-md bg-[#EBF1FF] flex items-center justify-center">
                    <SvgIcon name="globe" size={16} className="text-blue-600" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-base text-gray-800">{t(tKey('graph_smart_generation'))}</span>
                    <span className="text-sm text-gray-400">{t(tKey('graph_smart_generation_desc'))}</span>
                  </div>
                </div>
                <Switch
                  checked={isSmartGenerateEnabled}
                  onChange={handleSmartGenerateChange}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default GraphConfig
