import { useEffect, useRef, useState, useMemo, Fragment } from 'react'
import { Button, Select, InputNumber, Switch, Form } from 'antd'
import { SettingOutlined, CheckOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons'
import { t } from '@/locales'
import { getSimpleParserConfigs, PARSER_BUSINESS_OPTIONS } from '@/constants/parser'
import platformSettingsApi from '@/api/modules/platform-settings'
import { transformPlatformSetting } from '@/api/modules/platform-settings/transform'
import type { PlatformSetting } from '@/api/modules/platform-settings/types'

interface ParseConfigProps {
  config: {
    engine?: string
    enable_smart_match?: boolean
    [key: string]: any
  }
  onUpdateConfig?: (config: ParseConfigProps['config']) => void
}

export function ParseConfig({ config, onUpdateConfig }: ParseConfigProps) {
  // Helper function to update config
  const updateConfig = (patch: Partial<ParseConfigProps['config']>) => {
    onUpdateConfig?.({
      ...config,
      ...patch,
    })
  }

  const parserConfigs = getSimpleParserConfigs()
  const [settingsMap, setSettingsMap] = useState<Record<string, PlatformSetting | null>>({})
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const activeMethodOptions = useMemo(() => {
    return PARSER_BUSINESS_OPTIONS[config.engine || ''] || []
  }, [config.engine])

  // 初始化废弃字段（兼容保留）
  useEffect(() => {
    if (config.enable_smart_match === undefined) {
      updateConfig({ enable_smart_match: false })
    }
  }, [config])

  // Initialize default values when engine changes
  useEffect(() => {
    if (!config.engine) return
    const options = PARSER_BUSINESS_OPTIONS[config.engine] || []
    const updates: Record<string, any> = {}
    let hasUpdates = false
    options.forEach(opt => {
      if (config[opt.key] === undefined && opt.defaultValue !== undefined) {
        updates[opt.key] = opt.defaultValue
        hasUpdates = true
      }
    })
    if (hasUpdates) {
      updateConfig(updates)
    }
  }, [config.engine])

  const loadAllParserSettings = async () => {
    const res = await platformSettingsApi.find()
    const newSettingsMap: Record<string, PlatformSetting | null> = {}
    res.forEach(item => {
      if (parserConfigs.find(pc => pc.key === item.platform_key)) {
        newSettingsMap[item.platform_key] = transformPlatformSetting(item)
      }
    })
    setSettingsMap(newSettingsMap)
    // 数据加载完成后更新滚动按钮状态
    setTimeout(updateScrollButtons, 0)
  }

  useEffect(() => {
    loadAllParserSettings()
  }, [])

  const parseMethods = useMemo(() => {
    return parserConfigs
      .filter(pc => pc.key === 'markitdown' || settingsMap[pc.key])
      .map(pc => ({
        key: pc.key === 'markitdown' ? 'markitdown' : pc.key,
        name: pc.name,
        desc: pc.desc || t('data_pipeline.parse_default_desc'),
        icon: pc.icon,
        detailedDesc: pc.detailedDesc,
      }))
  }, [settingsMap])

  // 是否显示导航按钮（超过2个时显示）
  const showNavigation = parseMethods.length > 2

  // 更新滚动按钮状态
  const updateScrollButtons = () => {
    if (!scrollContainerRef.current) return

    const container = scrollContainerRef.current
    const scrollLeft = container.scrollLeft
    const scrollWidth = container.scrollWidth
    const clientWidth = container.clientWidth

    setCanScrollLeft(scrollLeft > 0)
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 1)
  }

  // 监听解析方法列表变化
  useEffect(() => {
    setTimeout(updateScrollButtons, 0)
  }, [parseMethods.length])

  // 左滚动
  const handleScrollLeft = () => {
    if (!scrollContainerRef.current) return
    const container = scrollContainerRef.current
    const itemWidth = 229 + 16 // 卡片宽度 + gap
    container.scrollBy({ left: -itemWidth * 2, behavior: 'smooth' })
    setTimeout(updateScrollButtons, 300)
  }

  // 右滚动
  const handleScrollRight = () => {
    if (!scrollContainerRef.current) return
    const container = scrollContainerRef.current
    const itemWidth = 229 + 16 // 卡片宽度 + gap
    container.scrollBy({ left: itemWidth * 2, behavior: 'smooth' })
    setTimeout(updateScrollButtons, 300)
  }

  // 监听容器滚动
  const handleScroll = () => {
    updateScrollButtons()
  }

  const activeMethodInfo = parseMethods.find(m => m.key === config.engine)

  const getMethodName = (key: string) => {
    return parseMethods.find(m => m.key === key)?.name || key
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
      {/* 解析方法选择区域 */}
      <div className="relative">
        {/* 左箭头按钮 */}
        {showNavigation && (
          <Button
            disabled={!canScrollLeft}
            className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 z-10 w-10 h-10 rounded-full bg-white shadow-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            icon={<LeftOutlined className="text-gray-600" />}
            onClick={handleScrollLeft}
          />
        )}

        {/* 滚动容器 */}
        <div
          ref={scrollContainerRef}
          className="p-2 flex gap-4 overflow-x-hidden scroll-smooth"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          onScroll={handleScroll}
        >
          {parseMethods.map(method => (
            <div
              key={method.key}
              className="flex-shrink-0 w-[229px] p-4 rounded-xl outline outline-1 outline-offset-[-1px] transition-all cursor-pointer relative"
              style={{
                outlineColor: config.engine === method.key ? '#2563EB' : '#E6E8EBFF',
                ringWidth: config.engine === method.key ? '4px' : undefined,
              }}
              onClick={() => updateConfig({ engine: method.key })}
            >
              {config.engine === method.key && (
                <div className="absolute top-0 right-0">
                  <div className="w-0 h-0 border-t-[30px] border-t-[#2563EB] border-l-[30px] border-l-transparent rounded-tr-xl"></div>
                  <CheckOutlined className="absolute top-1 right-1 text-white" style={{ fontSize: 10 }} />
                </div>
              )}
              <div className="w-[50px] h-[50px] mb-4 rounded overflow-hidden">
                <img src={method.icon} className="w-full h-full object-cover" alt={method.name} />
              </div>
              <div className="text-base font-semibold text-primary mb-1">{method.name}</div>
              <div className="text-sm text-disabled leading-normal">{method.desc}</div>
            </div>
          ))}
        </div>

        {/* 右箭头按钮 */}
        {showNavigation && (
          <Button
            disabled={!canScrollRight}
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 z-10 w-10 h-10 rounded-full bg-white shadow-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            icon={<RightOutlined className="text-gray-600" />}
            onClick={handleScrollRight}
          />
        )}
      </div>

      {/* 具体方法配置 */}
      {config.engine && (
        <div className="bg-gray-50/50 rounded-2xl p-6 border border-gray-100 space-y-6">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-700">
            <SettingOutlined className="text-brand" />
            <span>{getMethodName(config.engine)}{t('data_pipeline.parse_config_suffix')}</span>
          </div>

          {/* Info Box */}
          <div className="bg-[#F0F4FF] p-4 rounded-xl flex items-start gap-3">
            <p className="text-xs text-placeholder leading-relaxed">
              {activeMethodInfo?.detailedDesc}
            </p>
          </div>

          {config.engine !== 'markitdown' && false && (
            <>
              {activeMethodOptions.length > 0 && (
                <Form layout="vertical">
                  <div className="grid grid-cols-2 gap-5">
                    {activeMethodOptions.map(opt => (
                      <Fragment key={opt.key}>
                        {/* 开关类型占满一行 */}
                        {opt.type === 'switch' && (
                          <div
                            className="col-span-2 p-5 rounded-xl flex items-center justify-between bg-white border border-[#E6E8EB]"
                          >
                            <div>
                              <div className="text-sm font-bold text-gray-700">{opt.label}</div>
                              {opt.desc && <p className="text-xs text-gray-400 mt-1">{opt.desc}</p>}
                            </div>
                            <Switch
                              checked={config[opt.key]}
                              onChange={(checked) => updateConfig({ [opt.key]: checked })}
                            />
                          </div>
                        )}

                        {/* Select */}
                        {opt.type === 'select' && (
                          <Form.Item key={opt.key} label={opt.label} className="!mb-0">
                            <label className="block text-xs font-bold text-gray-400 uppercase mb-2">{opt.label}</label>
                            <Select
                              value={config[opt.key]}
                              onChange={(value) => updateConfig({ [opt.key]: value })}
                              className="w-full"
                              mode={opt.multiple ? 'multiple' : undefined}
                              options={opt.options?.map(o => ({ label: o.label, value: o.value as string }))}
                            />
                          </Form.Item>
                        )}

                        {/* Number */}
                        {opt.type === 'number' && (
                          <Form.Item key={opt.key} label={opt.label} className="!mb-0">
                            <label className="block text-xs font-bold text-gray-400 uppercase mb-2">{opt.label}</label>
                            <InputNumber
                              value={config[opt.key]}
                              onChange={(value) => updateConfig({ [opt.key]: value })}
                              min={opt.min}
                              max={opt.max}
                              className="w-full"
                              controls={false}
                              placeholder={opt.placeholder}
                            />
                          </Form.Item>
                        )}

                        {/* Default Input */}
                        {opt.type === 'input' && (
                          <Form.Item key={opt.key} label={opt.label} className="!mb-0">
                            <label className="block text-xs font-bold text-gray-400 uppercase mb-2">{opt.label}</label>
                            <input
                              value={config[opt.key]}
                              onChange={e => updateConfig({ [opt.key]: e.target.value })}
                              className="w-full border rounded px-3 py-2"
                              placeholder={opt.placeholder}
                            />
                          </Form.Item>
                        )}
                      </Fragment>
                    ))}
                  </div>
                </Form>
              )}

              {/* Fallback for generic engines without specific config */}
              {activeMethodOptions.length === 0 && (
                <div className="space-y-4 mt-6 pt-4 border-t border-gray-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-gray-700">{t('data_pipeline.parse_scan_enhance')}</div>
                      <p className="text-xs text-gray-400 mt-1">{t('data_pipeline.parse_scan_enhance_desc')}</p>
                    </div>
                    <Switch
                      checked={config.scan_enhance}
                      onChange={(checked) => updateConfig({ scan_enhance: checked })}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default ParseConfig
