import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Radio, Checkbox, Select, InputNumber, Tag, Switch } from 'antd'
import { Dropdown } from '@km/shared-components-react'
import { CheckOutlined, DownOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { SvgIcon } from '@km/shared-components-react'
import { getPublicPath } from '@/utils/config'
import { t } from '@/locales'
import './ChunkConfig.css'

interface ChunkConfigProps {
  config: {
    chunk_type?: string
    enable_smart_match?: boolean
    match_preference_prompt?: string
    parent_chunk?: {
      mode?: string
      strategy?: string
      identifier_level?: string
      max_length?: number
      append_filename?: boolean
      append_title?: boolean
      append_subtitle?: boolean
    }
    child_chunk?: {
      mode?: string
      strategy?: string
      identifier_level?: string
      max_length?: number
    }
    index_enhancement?: {
      metadata_injection?: {
        append_filename?: boolean
        append_title?: boolean
        append_subtitle?: boolean
      }
      generative_enhancement?: {
        generate_summary?: boolean
        generate_faq?: boolean
      }
    }
    [key: string]: any
  }
  onChange?: (config: ChunkConfigProps['config']) => void
}

// Constants
const CONFIG = {
  maxLength: { min: 50, max: 50000 },
  headerList: [
    { type: 'h1', label: '一级标题（H1）' },
    { type: 'h2', label: '二级标题（H2）' },
    { type: 'h3', label: '三级标题（H3）' },
    { type: 'h4', label: '四级标题（H4）' },
    { type: 'h5', label: '五级标题（H5）' },
  ],
  commonList: [
    { label: '1 个换行符（\\n）', value: '\\n' },
    { label: '2 个换行符（\\n\\n）', value: '\\n\\n' },
    { label: '句号（。）', value: '。' },
    { label: '感叹号（！）', value: '！' },
    { label: '问号（？）', value: '？' },
    { label: '分号（；）', value: '；' },
    { label: '分割线（---）', value: '---' },
  ],
}

const CHUNK_TYPE = {
  CUSTOM: 'custom',
  NONE: 'none',
  DEFAULT: 'default',
}

const SPLIT_TYPE = {
  HEADING: 'heading',
  CUSTOM: 'custom',
}

const CHUNK_MODE = {
  LENGTH: 'length',
  IDENTIFIER: 'identifier',
}

const chunkTypes = [
  {
    key: 'default',
    name: '通用文档',
    desc: '多格式文档，智能分段并清洗数据',
    icon: getPublicPath('/images/split/default.png'),
  },
  {
    key: 'data_table',
    name: '数据表格',
    desc: '识别表格结构，分段计算其清洗数据',
    icon: getPublicPath('/images/split/data_table.png'),
  },
  {
    key: 'qa',
    name: '百问百答',
    desc: '聚焦问答类结构，拆分问题与答案',
    icon: getPublicPath('/images/split/qa.png'),
  },
]

// Escape map for special characters
const ESCAPE_MAP: Record<string, string> = {
  '\n': '\\n',
  '\n\n': '\\n\\n',
  '\r\n': '\\r\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\b': '\\b',
  '\f': '\\f',
  '\v': '\\v',
}

const REVERSE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(ESCAPE_MAP).map(([k, v]) => [v, k])
)

const formatDisplayValue = (value: string) => ESCAPE_MAP[value] ?? value
const parseInputValue = (input: string) => REVERSE_MAP[input] ?? input

export function ChunkConfig({ config, onChange }: ChunkConfigProps) {
  const updateConfig = (patch: Partial<ChunkConfigProps['config']>) => {
    onChange?.({
      ...config,
      ...patch,
    })
  }

  // Internal state for chunking rules
  const [internalState, setInternalState] = useState({
    knowledge_chunking_type: CHUNK_TYPE.DEFAULT,
    knowledge_chunking_rule: [SPLIT_TYPE.HEADING] as string[],
    knowledge_chunking_head: CONFIG.headerList[0].type,
    knowledge_chunking_input: [] as string[],
    index_chunking_type: CHUNK_TYPE.DEFAULT,
    index_chunking_rule: [SPLIT_TYPE.HEADING] as string[],
    index_chunking_head: CONFIG.headerList[0].type,
    index_chunking_input: [] as string[],
  })

  // Track if initialized
  const initializedRef = useRef(false)

  // Initialize config structure (matches Vue's initConfig)
  const initConfig = useCallback(() => {
    if (!config.parent_chunk) {
      config.parent_chunk = {
        mode: 'custom',
        strategy: CHUNK_MODE.IDENTIFIER,
        identifier_level: 'h2',
        max_length: 2048,
        append_filename: true,
        append_title: true,
        append_subtitle: true,
      }
    }
    if (!config.child_chunk) {
      config.child_chunk = {
        mode: 'custom',
        strategy: CHUNK_MODE.LENGTH,
        identifier_level: 'h3',
        max_length: 512,
      }
    }
    if (!config.index_enhancement) {
      config.index_enhancement = {
        metadata_injection: {
          append_filename: true,
          append_title: true,
          append_subtitle: true,
        },
        generative_enhancement: {
          generate_summary: true,
          generate_faq: true,
        },
      }
    }
    if (!config.chunk_type) {
      config.chunk_type = 'default'
    }
    // Initialize smart match fields
    if (config.enable_smart_match === undefined) {
      config.enable_smart_match = false
    }
    if (config.match_preference_prompt === undefined) {
      config.match_preference_prompt = ''
    }

    // Parse identifier_level to internalState
    const parseRule = (prefix: 'knowledge' | 'index') => {
      const targetConfig = prefix === 'knowledge' ? config.parent_chunk : config.child_chunk
      const rule = targetConfig.identifier_level

      if (!rule) return

      // Always set to CUSTOM if there's a rule
      setInternalState(prev => ({
        ...prev,
        [`${prefix}_chunking_type`]: CHUNK_TYPE.CUSTOM,
      }))

      const parts = rule.split(',')
      const headers = CONFIG.headerList.map(h => h.type)
      const newRules: string[] = []

      if (headers.includes(parts[0])) {
        setInternalState(prev => ({
          ...prev,
          [`${prefix}_chunking_head`]: parts[0],
          [`${prefix}_chunking_input`]: parts.slice(1).map(formatDisplayValue),
        }))
        newRules.push(SPLIT_TYPE.HEADING)
      } else {
        setInternalState(prev => ({
          ...prev,
          [`${prefix}_chunking_input`]: parts.map(formatDisplayValue),
        }))
      }

      if (parts.slice(1).length > 0 || (!headers.includes(parts[0]) && parts.length > 0)) {
        newRules.push(SPLIT_TYPE.CUSTOM)
      }

      if (newRules.length > 0) {
        setInternalState(prev => ({
          ...prev,
          [`${prefix}_chunking_rule`]: newRules,
        }))
      }
    }

    parseRule('knowledge')
    parseRule('index')
  }, [config])

  // Initialize from config prop (only once)
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true
    initConfig()
  }, [initConfig])

  // Sync internalState to config (matches Vue's syncToConfig)
  useEffect(() => {
    const syncToConfig = (prefix: 'knowledge' | 'index') => {
      const type = internalState[`${prefix}_chunking_type` as keyof typeof internalState] as string
      const targetConfig = prefix === 'knowledge' ? config.parent_chunk : config.child_chunk

      if (type === CHUNK_TYPE.NONE) {
        targetConfig.identifier_level = ''
      } else if (type === CHUNK_TYPE.DEFAULT) {
        // Keep existing value
      } else {
        const rules = internalState[`${prefix}_chunking_rule` as keyof typeof internalState] as string[]
        const parts: string[] = []
        if (rules.includes(SPLIT_TYPE.HEADING)) {
          parts.push(internalState[`${prefix}_chunking_head` as keyof typeof internalState] as string)
        }
        if (rules.includes(SPLIT_TYPE.CUSTOM)) {
          const inputs = internalState[`${prefix}_chunking_input` as keyof typeof internalState] as string[]
          parts.push(...inputs.map(parseInputValue))
        }
        targetConfig.identifier_level = parts.join(',')
      }
    }

    syncToConfig('knowledge')
    syncToConfig('index')
  }, [internalState, config.parent_chunk, config.child_chunk])

  // Update chunk type
  const handleChunkTypeChange = useCallback((chunkType: string) => {
    updateConfig({ chunk_type: chunkType })
  }, [config, onChange])

  // Handle smart match toggle
  const handleSmartMatchChange = useCallback((checked: boolean) => {
    updateConfig({
      enable_smart_match: checked,
      chunk_type: 'default',
      match_preference_prompt: '',
    })
  }, [config, onChange])

  // Update chunk mode
  const handleChangeChunkMode = useCallback((type: 'knowledge' | 'index', value: string) => {
    const typeKey = type === 'knowledge' ? 'knowledge_chunking_type' : 'index_chunking_type'
    if ((internalState[typeKey] as string) === CHUNK_TYPE.DEFAULT) return

    const targetConfig = type === 'knowledge' ? config.parent_chunk : config.child_chunk
    targetConfig.strategy = value
    onChange?.(config)
  }, [internalState, config, onChange])

  // Handle max length blur (matches Vue's handleBlurMaxLength)
  const handleBlurMaxLength = useCallback((type: 'knowledge' | 'index') => {
    if (type === 'knowledge') {
      config.parent_chunk.max_length = Math.max(
        Math.min(config.parent_chunk.max_length, CONFIG.maxLength.max),
        CONFIG.maxLength.min
      )
      // Sync child max length
      config.child_chunk.max_length = Math.max(
        Math.min(config.child_chunk.max_length, config.parent_chunk.max_length),
        CONFIG.maxLength.min
      )
    } else {
      config.child_chunk.max_length = Math.max(
        Math.min(config.child_chunk.max_length, config.parent_chunk.max_length),
        CONFIG.maxLength.min
      )
    }
    onChange?.(config)
  }, [config, onChange])

  const knowledgeCommonList = useMemo(() => {
    const list = internalState.knowledge_chunking_input.filter(
      item => !CONFIG.commonList.some(common => common.value === item)
    )
    return CONFIG.commonList.concat(list.map(item => ({ label: item, value: item })))
  }, [internalState.knowledge_chunking_input])

  const indexCommonList = useMemo(() => {
    const list = internalState.index_chunking_input.filter(
      item => !CONFIG.commonList.some(common => common.value === item)
    )
    return CONFIG.commonList.concat(list.map(item => ({ label: item, value: item })))
  }, [internalState.index_chunking_input])

  const getHeadingLabel = (type: 'knowledge' | 'index') => {
    const headKey = `${type}_chunking_head` as keyof typeof internalState
    const headValue = internalState[headKey] as string
    return CONFIG.headerList.find(item => item.type === headValue)?.label || CONFIG.headerList[0].label
  }

  const handleChangeHeading = (type: 'knowledge' | 'index', value: string) => {
    setInternalState(prev => ({
      ...prev,
      [`${type}_chunking_head`]: value,
    }))
  }

  const renderHeadingDropdown = (type: 'knowledge' | 'index') => {
    const menuItems: MenuProps['items'] = CONFIG.headerList.map(item => ({
      key: item.type,
      label: item.label,
      onClick: () => handleChangeHeading(type, item.type),
    }))

    return (
      <Dropdown menu={{ items: menuItems }} trigger={['click']}>
        <div className="flex items-center gap-1 text-sm text-[#4F5052] cursor-pointer">
          {getHeadingLabel(type)}
          <DownOutlined style={{ fontSize: 10 }} />
        </div>
      </Dropdown>
    )
  }

  const renderChunkingSection = (type: 'knowledge' | 'index', title: string, icon: string) => {
    const typeKey = type === 'knowledge' ? 'knowledge' : 'index'
    const chunkingType = internalState[`${typeKey}_chunking_type` as keyof typeof internalState] as string
    const chunkingRule = internalState[`${typeKey}_chunking_rule` as keyof typeof internalState] as string[]
    const chunkingInput = internalState[`${typeKey}_chunking_input` as keyof typeof internalState] as string[]
    const targetConfig = type === 'knowledge' ? config.parent_chunk : config.child_chunk
    const commonList = type === 'knowledge' ? knowledgeCommonList : indexCommonList
    const showConfig = [CHUNK_TYPE.CUSTOM, CHUNK_TYPE.DEFAULT].includes(chunkingType)
    const isDisabled = chunkingType === CHUNK_TYPE.DEFAULT

    return (
      <div className="border rounded">
        <div className="h-12 flex items-center gap-2 px-5 border-b">
          <SvgIcon name={icon} size={16} />
          <h4 className="text-sm text-[#1D1E1F]">{title}</h4>
        </div>
        <div className="py-5 px-10 flex flex-col gap-4">
          <div className="flex items-center">
            <Radio.Group
              value={chunkingType}
              onChange={e => setInternalState(prev => ({
                ...prev,
                [`${typeKey}_chunking_type`]: e.target.value,
              }))}
            >
              <Radio value={CHUNK_TYPE.DEFAULT}>默认</Radio>
              <Radio value={CHUNK_TYPE.CUSTOM}>自定义拆分</Radio>
              <Radio value={CHUNK_TYPE.NONE}>整篇</Radio>
            </Radio.Group>
          </div>

          {showConfig && (
            <>
              <div className="flex items-center gap-2">
                <div
                  className={`w-[212px] h-9 px-3 border rounded flex items-center gap-1.5 ${
                    targetConfig.strategy === CHUNK_MODE.LENGTH ? 'border-[#2563EB]' : ''
                  } ${!isDisabled ? 'cursor-pointer' : ''}`}
                  onClick={() => handleChangeChunkMode(type, CHUNK_MODE.LENGTH)}
                >
                  <div className="size-5 rounded bg-[#E0EAFF] flex items-center justify-center text-[#2563EB]">
                    <SvgIcon name="list-numbers" size={14} />
                  </div>
                  <span className="flex-1 text-sm text-[#1D1E1F]">长度优先</span>
                  <Radio
                    checked={targetConfig.strategy === CHUNK_MODE.LENGTH}
                    disabled={isDisabled}
                  />
                </div>
                <div
                  className={`w-[212px] h-9 px-3 border rounded flex items-center gap-1.5 ${
                    targetConfig.strategy === CHUNK_MODE.IDENTIFIER ? 'border-[#2563EB]' : ''
                  } ${!isDisabled ? 'cursor-pointer' : ''}`}
                  onClick={() => handleChangeChunkMode(type, CHUNK_MODE.IDENTIFIER)}
                >
                  <div className="size-5 rounded bg-[#FFF1D6] flex items-center justify-center text-[#F0A105]">#</div>
                  <span className="flex-1 text-sm text-[#1D1E1F]">标识符优先</span>
                  <Radio
                    checked={targetConfig.strategy === CHUNK_MODE.IDENTIFIER}
                    disabled={isDisabled}
                  />
                </div>
              </div>

              <div className="p-4 bg-[#F8F9FA] rounded-md space-y-3">
                <div className="flex items-center">
                  <div className="flex-none w-20 text-sm text-[#4F5052]">标识符</div>
                  <div className="flex items-center flex-wrap">
                    <Checkbox
                      checked={chunkingRule.includes(SPLIT_TYPE.HEADING)}
                      onChange={e => {
                        const newRules = e.target.checked
                          ? [...chunkingRule, SPLIT_TYPE.HEADING]
                          : chunkingRule.filter(r => r !== SPLIT_TYPE.HEADING)
                        setInternalState(prev => ({
                          ...prev,
                          [`${typeKey}_chunking_rule`]: newRules,
                        }))
                      }}
                      disabled={isDisabled}
                    />
                    <div className="flex items-center mr-5 ml-2">
                      {renderHeadingDropdown(type)}
                    </div>
                    <Checkbox
                      checked={chunkingRule.includes(SPLIT_TYPE.CUSTOM)}
                      onChange={e => {
                        const newRules = e.target.checked
                          ? [...chunkingRule, SPLIT_TYPE.CUSTOM]
                          : chunkingRule.filter(r => r !== SPLIT_TYPE.CUSTOM)
                        setInternalState(prev => ({
                          ...prev,
                          [`${typeKey}_chunking_rule`]: newRules,
                        }))
                      }}
                      disabled={isDisabled}
                    />
                    <div className="flex items-center gap-2 ml-2">
                      <span className="text-sm text-[#4F5052] whitespace-nowrap">指定标识符</span>
                      <Select
                        mode="tags"
                        value={chunkingInput}
                        onChange={val => setInternalState(prev => ({
                          ...prev,
                          [`${typeKey}_chunking_input`]: val,
                        }))}
                        options={commonList.map(item => ({ label: item.label, value: item.value }))}
                        className="w-48"
                        disabled={isDisabled}
                        showSearch
                        filterOption={(input, option) =>
                          (option?.label as string)?.toLowerCase().includes(input.toLowerCase()) ||
                          (option?.value as string)?.toLowerCase().includes(input.toLowerCase())
                        }
                        maxTagCount={1}
                        suffixIcon={null}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center">
                  <div className="flex-none w-20 text-sm text-[#4F5052]">长度</div>
                  <InputNumber
                    value={targetConfig.max_length}
                    onChange={val => {
                      targetConfig.max_length = val ?? 0
                    }}
                    onBlur={() => handleBlurMaxLength(type)}
                    min={type === 'knowledge' ? CONFIG.maxLength.min : 0}
                    max={type === 'knowledge' ? CONFIG.maxLength.max : 1000000}
                    controls={false}
                    className="!w-32"
                    disabled={isDisabled}
                  />
                </div>

                {/* 召回语料 - only for knowledge */}
                {type === 'knowledge' && (
                  <div className="flex items-center">
                    <div className="flex-none w-20 text-sm text-[#4F5052]">召回语料</div>
                    <div className="flex gap-4">
                      <Checkbox
                        checked={config.parent_chunk?.append_filename}
                        onChange={e => {
                          config.parent_chunk.append_filename = e.target.checked
                          onChange?.(config)
                        }}
                        disabled={isDisabled}
                      >
                        叠加文件名
                      </Checkbox>
                      <Checkbox
                        checked={config.parent_chunk?.append_title}
                        onChange={e => {
                          config.parent_chunk.append_title = e.target.checked
                          config.parent_chunk.append_subtitle = e.target.checked
                          onChange?.(config)
                        }}
                        disabled={isDisabled}
                      >
                        叠加标题及子标题
                      </Checkbox>
                    </div>
                  </div>
                )}
              </div>

              {/* 索引增强 - only for index */}
              {type === 'index' && (
                <div className="p-4 bg-[#F8F9FA] rounded-md space-y-3">
                  <div className="text-sm text-[#1D1E1F] font-semibold">索引增强</div>
                  <div className="flex items-center">
                    <div className="flex-none w-20 text-sm text-[#4F5052]">默认索引</div>
                    <div className="flex gap-4">
                      <Checkbox
                        checked={config.index_enhancement?.metadata_injection?.append_filename}
                        onChange={e => {
                          config.index_enhancement.metadata_injection.append_filename = e.target.checked
                          onChange?.(config)
                        }}
                        disabled={isDisabled}
                      >
                        叠加文件名
                      </Checkbox>
                      <Checkbox
                        checked={config.index_enhancement?.metadata_injection?.append_title}
                        onChange={e => {
                          config.index_enhancement.metadata_injection.append_title = e.target.checked
                          config.index_enhancement.metadata_injection.append_subtitle = e.target.checked
                          onChange?.(config)
                        }}
                        disabled={isDisabled}
                      >
                        叠加标题及子标题
                      </Checkbox>
                    </div>
                  </div>
                  <div className="flex items-center">
                    <div className="flex-none w-20 text-sm text-[#4F5052]">自动生成</div>
                    <div className="flex gap-4">
                      <Checkbox
                        checked={config.index_enhancement?.generative_enhancement?.generate_summary}
                        onChange={e => {
                          config.index_enhancement.generative_enhancement.generate_summary = e.target.checked
                          onChange?.(config)
                        }}
                        disabled={isDisabled}
                      >
                        内容概要
                      </Checkbox>
                      <Checkbox
                        checked={config.index_enhancement?.generative_enhancement?.generate_faq}
                        onChange={e => {
                          config.index_enhancement.generative_enhancement.generate_faq = e.target.checked
                          onChange?.(config)
                        }}
                        disabled={isDisabled}
                      >
                        常见问法
                      </Checkbox>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  const isSmartMatchEnabled = Boolean(config.enable_smart_match)

  return (
    <div className="chunk-config-container space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
      {/* 智能匹配开关 */}
      <div className="flex items-center gap-2 mb-5">
        <span className="text-base text-[#1D1E1F]">智能匹配</span>
        <Switch
          checked={isSmartMatchEnabled}
          onChange={handleSmartMatchChange}
        />
        <span className="text-sm text-[#9A9A9A]">
          {isSmartMatchEnabled ? '智能选择拆分规则' : '手动选择拆分规则'}
        </span>
      </div>

      {/* chunk_type 卡片 */}
      <div className="grid grid-cols-3 gap-4 transition-opacity">
        {chunkTypes.map(chunkType => {
          const isSelected = config.chunk_type === chunkType.key && !isSmartMatchEnabled
          return (
            <div
              key={chunkType.key}
              className={`p-4 rounded-xl outline outline-1 outline-offset-[-1px] transition-all cursor-pointer relative ${
                isSelected
                  ? 'outline-[#2563EB] ring-4 outline-2 ring-blue-50'
                  : 'outline-[#E6E8EBFF]'
              } ${isSmartMatchEnabled ? 'cursor-not-allowed' : 'hover:border-gray-200'}`}
              onClick={() => {
                if (isSmartMatchEnabled) return
                handleChunkTypeChange(chunkType.key)
              }}
            >
              {isSelected && (
                <div className="absolute top-0 right-0">
                  <div className="w-0 h-0 border-t-[30px] border-t-[#2563EB] border-l-[30px] border-l-transparent rounded-tr-xl" />
                  <CheckOutlined className="absolute top-1 right-1 text-white" style={{ fontSize: 10 }} />
                </div>
              )}
              <div className="w-10 h-10 mb-4 rounded overflow-hidden bg-gray-50 flex items-center justify-center">
                <img src={chunkType.icon} className="size-8 object-contain" alt={chunkType.name} />
              </div>
              <div className="text-base font-semibold text-[#1D1E1F] mb-1">{chunkType.name}</div>
              <div className="text-sm text-[#9A9A9A] leading-normal">{chunkType.desc}</div>
            </div>
          )
        })}
      </div>

      {config.chunk_type === 'default' && !isSmartMatchEnabled && (
        <div className="space-y-4">
          {renderChunkingSection('knowledge', '知识点', 'notebook-one')}
          {renderChunkingSection('index', '检索块', 'layers')}
        </div>
      )}
    </div>
  )
}

export default ChunkConfig
