import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { CheckOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import { SvgIcon } from '@km/shared-components-react'
import { usePipelineTranslation } from '../../context'
import { usePipelineAdapter } from '../../adapters'

export interface ParseMethod {
  key: string
  name: string
  desc: string
  icon: string
  detailedDesc?: string
}

export interface ParseConfigProps {
  config: {
    engine?: string
    enable_smart_match?: boolean
    [key: string]: any
  }
  onChange: (config: ParseConfigProps['config']) => void
  /** 自定义解析方法列表（可选，优先级高于适配器） */
  parseMethods?: ParseMethod[]
  /** i18n namespace prefix. Defaults to 'data_pipeline' */
  i18nPrefix?: string
  /** 导航阈值 - 超过此数量显示箭头。默认 2 */
  navigationThreshold?: number
}

export function ParseConfig({
  config,
  onChange,
  parseMethods: providedParseMethods,
  i18nPrefix = 'data_pipeline',
  navigationThreshold = 2,
}: ParseConfigProps) {
  const { t } = usePipelineTranslation()
  const tKey = (key: string) => `${i18nPrefix}.${key}`
  const adapter = usePipelineAdapter()

  const [parseMethods, setParseMethods] = useState<ParseMethod[]>(providedParseMethods || [])
  const [isLoading, setIsLoading] = useState(!providedParseMethods)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const initializedRef = useRef(false)

  const updateConfig = (patch: Partial<ParseConfigProps['config']>) => {
    onChange({ ...config, ...patch })
  }

  // 从适配器加载解析方法
  const loadParseMethods = useCallback(async () => {
    if (!adapter?.getParseMethods) return

    setIsLoading(true)
    try {
      const methods = await adapter.getParseMethods()
      setParseMethods(methods)
      setTimeout(updateScrollButtons, 0)
    } catch (error) {
      console.error('Failed to load parser settings:', error)
    } finally {
      setIsLoading(false)
    }
  }, [adapter])

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true
    if (!providedParseMethods && adapter?.getParseMethods) {
      loadParseMethods()
    }
  }, [loadParseMethods, providedParseMethods, adapter])

  // 自动选择默认引擎
  useEffect(() => {
    if (isLoading || parseMethods.length === 0) return
    const engineExists = parseMethods.some((m) => m.key === config.engine)
    if (!engineExists) {
      updateConfig({ engine: parseMethods[0].key })
    }
  }, [parseMethods, config.engine, isLoading])

  const showNavigation = useMemo(() => parseMethods.length > navigationThreshold, [parseMethods.length, navigationThreshold])

  const updateScrollButtons = useCallback(() => {
    if (!scrollContainerRef.current) return
    const container = scrollContainerRef.current
    const scrollLeftPos = container.scrollLeft
    const scrollWidth = container.scrollWidth
    const clientWidth = container.clientWidth
    setCanScrollLeft(scrollLeftPos > 0)
    setCanScrollRight(scrollLeftPos < scrollWidth - clientWidth - 1)
  }, [])

  useEffect(() => {
    updateScrollButtons()
  }, [parseMethods.length, updateScrollButtons])

  // 滚动到选中的 engine
  useEffect(() => {
    if (isLoading || parseMethods.length === 0 || !config.engine || !scrollContainerRef.current) return

    const selectedIndex = parseMethods.findIndex((m) => m.key === config.engine)
    if (selectedIndex === -1) return

    const container = scrollContainerRef.current
    const itemWidth = 229 + 16 // card width + gap
    const targetScrollLeft = selectedIndex * itemWidth

    // 延迟执行确保 DOM 已渲染
    const timer = setTimeout(() => {
      container.scrollTo({ left: targetScrollLeft, behavior: 'smooth' })
      setTimeout(updateScrollButtons, 350)
    }, 100)

    return () => clearTimeout(timer)
  }, [isLoading, parseMethods, config.engine, updateScrollButtons])

  const scrollLeft = () => {
    if (!scrollContainerRef.current) return
    const container = scrollContainerRef.current
    const itemWidth = 229 + 16
    container.scrollBy({ left: -itemWidth * 2, behavior: 'smooth' })
    setTimeout(updateScrollButtons, 300)
  }

  const scrollRight = () => {
    if (!scrollContainerRef.current) return
    const container = scrollContainerRef.current
    const itemWidth = 229 + 16
    container.scrollBy({ left: itemWidth * 2, behavior: 'smooth' })
    setTimeout(updateScrollButtons, 300)
  }

  const handleScroll = () => {
    updateScrollButtons()
  }

  const activeMethodInfo = useMemo(() => {
    return parseMethods.find((m) => m.key === config.engine)
  }, [parseMethods, config.engine])

  const getMethodName = (key: string) => {
    return parseMethods.find((m) => m.key === key)?.name || key
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
            onClick={scrollLeft}
          />
        )}

        {/* 滚动容器 */}
        <div
          ref={scrollContainerRef}
          className="p-2 flex gap-4 overflow-x-hidden scroll-smooth"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          onScroll={handleScroll}
        >
          {isLoading ? (
            <div className="flex items-center justify-center w-full py-8">
              <div className="text-gray-400">{t(tKey('loading'))}</div>
            </div>
          ) : parseMethods.length === 0 ? (
            <div className="flex items-center justify-center w-full py-8">
              <div className="text-gray-400">{t(tKey('no_parse_methods'))}</div>
            </div>
          ) : (
            parseMethods.map((method) => (
              <div
                key={method.key}
                className={`flex-shrink-0 w-[229px] p-4 rounded-xl outline outline-1 outline-offset-[-1px] transition-all cursor-pointer relative ${
                  config.engine === method.key
                    ? 'outline-[#2563EB] ring-4 outline-2 ring-blue-50'
                    : 'outline-[#E6E8EBFF] hover:border-gray-200'
                }`}
                onClick={() => updateConfig({ engine: method.key })}
              >
                {config.engine === method.key && (
                  <div className="absolute top-0 right-0">
                    <div className="w-0 h-0 border-t-[30px] border-t-[#2563EB] border-l-[30px] border-l-transparent rounded-tr-xl" />
                    <CheckOutlined className="absolute top-1 right-1 text-white" style={{ fontSize: 10 }} />
                  </div>
                )}
                <div className="w-[50px] h-[50px] mb-4 rounded overflow-hidden">
                  <img src={method.icon} className="w-full h-full object-cover" alt={method.name} />
                </div>
                <div className="text-base font-semibold text-gray-800 mb-1">{method.name}</div>
                <div className="text-sm text-gray-400 leading-normal">{method.desc}</div>
              </div>
            ))
          )}
        </div>

        {/* 右箭头按钮 */}
        {showNavigation && (
          <Button
            disabled={!canScrollRight}
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 z-10 w-10 h-10 rounded-full bg-white shadow-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            icon={<RightOutlined className="text-gray-600" />}
            onClick={scrollRight}
          />
        )}
      </div>

      {/* 具体方法配置 */}
      {config.engine && activeMethodInfo && (
        <div className="bg-gray-50/50 rounded-2xl p-6 border border-gray-100 space-y-6">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-700">
            <SvgIcon name="settings" className="text-[#2563EB]" />
            <span>{config.engine === 'voice_model' ? '语音解析' : getMethodName(config.engine)}{t(tKey('parse_config_suffix'))}</span>
          </div>

          {/* Info Box */}
          <div className="bg-[#F0F4FF] p-4 rounded-xl flex items-start gap-3">
            <p className="text-xs text-gray-400 leading-relaxed">
              {activeMethodInfo.detailedDesc || t(tKey('parse_default_desc'))}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export default ParseConfig