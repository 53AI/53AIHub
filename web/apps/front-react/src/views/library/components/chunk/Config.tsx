import { useState, useMemo, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import { Radio, Checkbox, Select, InputNumber, message } from 'antd'
import { Dropdown } from '@km/shared-components-react'
import { DownOutlined } from '@ant-design/icons'
import { cacheManager, deepCopy } from '@km/shared-utils'
import { SvgIcon } from '@km/shared-components-react'
import { t } from '@/locales'
import chunkSettingApi from '@/api/modules/chunk-setting'
import { CHUNK_SETTING_DEFAULT } from '@/constants/chunk'

// Constants
const CHUNK_TYPE = {
  CUSTOM: 'custom',
  NONE: 'none',
  DEFAULT: 'default'
} as const

const SPLIT_TYPE = {
  HEADING: 'heading',
  CUSTOM: 'custom'
} as const

const GENERATION = {
  MANUAL: 'manual',
  AI: 'ai'
} as const

const CHUNK_MODE = {
  LENGTH: 'length_first',
  IDENTIFIER: 'identifier_first'
} as const

const CONFIG = {
  maxLength: { min: 50, max: 50000 },
  headerList: [
    { type: 'h1', label: '一级标题（H1）' },
    { type: 'h2', label: '二级标题（H2）' },
    { type: 'h3', label: '三级标题（H3）' },
    { type: 'h4', label: '四级标题（H4）' },
    { type: 'h5', label: '五级标题（H5）' }
  ],
  commonList: [
    { label: '1 个换行符（\\n）', value: '\\n' },
    { label: '2 个换行符（\\n\\n）', value: '\\n\\n' },
    { label: '句号（。）', value: '。' },
    { label: '感叹号（！）', value: '！' },
    { label: '问号（？）', value: '？' },
    { label: '分号（；）', value: '；' },
    { label: '分割线（---）', value: '---' }
  ]
}

interface Setting {
  knowledge_chunking_type: string
  knowledge_chunking_rule: string[]
  knowledge_chunking_head: string
  knowledge_chunking_input: string[]
  index_chunking_type: string
  index_chunking_head: string
  index_chunking_rule: string[]
  index_chunking_input: string[]
  chunking_config: {
    knowledge_chunking: {
      chunk_mode: string
      max_length: number
      split_rule: string
      include_filename: boolean
      include_title: boolean
      is_system_default: boolean
    }
    index_chunking: {
      chunk_mode: string
      max_length: number
      split_rule: string
      include_filename: boolean
      include_title: boolean
      is_system_default: boolean
    }
    content_summary: {
      generation_method: string
    }
    common_questions: {
      generation_method: string
    }
  }
}

const ESCAPE_MAP: Record<string, string> = {
  '\n': '\\n',
  '\n\n': '\\n\\n',
  '\r\n': '\\r\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\b': '\\b',
  '\f': '\\f',
  '\v': '\\v'
}

const REVERSE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(ESCAPE_MAP).map(([k, v]) => [v, k])
)

const formatDisplayValue = (value: string) => ESCAPE_MAP[value] ?? value
const parseInputValue = (input: string) => REVERSE_MAP[input] ?? input

const getExtraSetting = (): Omit<Setting, 'chunking_config'> => ({
  knowledge_chunking_type: CHUNK_TYPE.CUSTOM,
  knowledge_chunking_rule: ['heading'],
  knowledge_chunking_head: CONFIG.headerList[0].type,
  knowledge_chunking_input: [],
  index_chunking_type: CHUNK_TYPE.CUSTOM,
  index_chunking_head: CONFIG.headerList[0].type,
  index_chunking_rule: ['heading'],
  index_chunking_input: []
})

const setSplitRule = (config: Setting, prefix: 'knowledge_chunking' | 'index_chunking') => {
  const splitRule = config.chunking_config[prefix].split_rule
  if (splitRule) {
    const rules = splitRule.split(',')
    const headers = CONFIG.headerList.map(item => item.type)
    if (headers.includes(rules[0])) {
      (config as any)[`${prefix}_head`] = rules[0]
      ;(config as any)[`${prefix}_input`] = rules.slice(1).map(formatDisplayValue)
    } else {
      ;(config as any)[`${prefix}_input`] = rules.map(formatDisplayValue)
      ;(config as any)[`${prefix}_rule`] = []
    }
    if ((config as any)[`${prefix}_input`].length === 0) {
      ;(config as any)[`${prefix}_input`] = [CONFIG.commonList[0].value]
    } else {
      ;(config as any)[`${prefix}_rule`].push(SPLIT_TYPE.CUSTOM)
    }
  } else {
    ;(config as any)[`${prefix}_type`] = CHUNK_TYPE.NONE
  }
  if (!config.chunking_config[prefix].chunk_mode) {
    config.chunking_config[prefix].chunk_mode = CHUNK_MODE.LENGTH
  }
}

const fieldMap = {
  knowledge: [
    'knowledge_chunking_head',
    'knowledge_chunking_input',
    'knowledge_chunking_rule',
    'chunking_config.knowledge_chunking',
  ],
  index: [
    'index_chunking_head',
    'index_chunking_input',
    'index_chunking_rule',
    'chunking_config.index_chunking',
    'chunking_config.content_summary',
    'chunking_config.common_questions',
  ],
}

const isConfigEqual = (config: Setting, defaultConfig: Setting | null, type: 'knowledge' | 'index'): boolean => {
  if (!defaultConfig) return false

  const fields = fieldMap[type]
  for (const field of fields) {
    const [key, subKey] = field.split('.')
    if (subKey) {
      const configObj = (config as any)[key]
      const defaultObj = (defaultConfig as any)[key]
      const configValue = configObj[subKey]
      const defaultValue = defaultObj[subKey]
      if (JSON.stringify(configValue) !== JSON.stringify(defaultValue)) {
        return false
      }
    } else {
      const configValue = (config as any)[key]
      const defaultValue = (defaultConfig as any)[key]
      if (Array.isArray(configValue) && Array.isArray(defaultValue)) {
        if (JSON.stringify(configValue) !== JSON.stringify(defaultValue)) {
          return false
        }
      } else if (JSON.stringify(configValue) !== JSON.stringify(defaultValue)) {
        return false
      }
    }
  }
  return true
}

export interface ChunkConfigRef {
  getChunkConfig: () => { chunking_config: Setting['chunking_config'] } | undefined
  setChunkConfig: (config: Setting) => Promise<void>
}

const ChunkConfig = forwardRef<ChunkConfigRef>((_, ref) => {
  const [defaultConfig, setDefaultConfig] = useState<Setting | null>(null)
  const [customConfig, setCustomConfig] = useState<Setting | null>(null)
  const [setting, setSetting] = useState<Setting>(() => ({
    ...deepCopy(CHUNK_SETTING_DEFAULT),
    ...getExtraSetting()
  }) as Setting)

  const knowledgeCommonList = useMemo(() => {
    const list = setting.knowledge_chunking_input.filter(
      (item) => !CONFIG.commonList.some((common) => common.value === item)
    )
    return CONFIG.commonList.concat(list.map((item) => ({ label: item, value: item })))
  }, [setting.knowledge_chunking_input])

  const indexCommonList = useMemo(() => {
    const list = setting.index_chunking_input.filter(
      (item) => !CONFIG.commonList.some((common) => common.value === item)
    )
    return CONFIG.commonList.concat(list.map((item) => ({ label: item, value: item })))
  }, [setting.index_chunking_input])

  const getHeadingLabel = (type: 'knowledge' | 'index') => {
    const chunkHead = type === 'knowledge' ? 'knowledge_chunking_head' : 'index_chunking_head'
    const label = CONFIG.headerList.find((item) => item.type === setting[chunkHead])?.label
    return label || CONFIG.headerList[0].label
  }

  const handleChangeHeading = (type: 'knowledge' | 'index', value: string) => {
    const chunkHead = type === 'knowledge' ? 'knowledge_chunking_head' : 'index_chunking_head'
    setSetting((prev) => ({ ...prev, [chunkHead]: value }))
  }

  const handleChangeChunkMode = (type: 'knowledge' | 'index', value: string) => {
    const chunkType = type + '_chunking_type'
    if (setting[chunkType as keyof Setting] === CHUNK_TYPE.DEFAULT) return

    setSetting((prev) => {
      const newConfig = { ...prev }
      const config =
        type === 'knowledge'
          ? newConfig.chunking_config.knowledge_chunking
          : newConfig.chunking_config.index_chunking
      config.chunk_mode = value
      return newConfig
    })
  }

  const handleBlurMaxLength = (type: 'knowledge' | 'index') => {
    setSetting((prev) => {
      const newConfig = { ...prev }
      const config =
        type === 'knowledge'
          ? newConfig.chunking_config.knowledge_chunking
          : newConfig.chunking_config.index_chunking

      if (type === 'knowledge') {
        config.max_length = Math.max(
          Math.min(config.max_length, CONFIG.maxLength.max),
          CONFIG.maxLength.min
        )
        const indexConfig = newConfig.chunking_config.index_chunking
        indexConfig.max_length = Math.max(
          Math.min(indexConfig.max_length, config.max_length),
          CONFIG.maxLength.min
        )
      } else {
        const knowledgeConfig = newConfig.chunking_config.knowledge_chunking
        config.max_length = Math.max(
          Math.min(config.max_length, knowledgeConfig.max_length),
          CONFIG.maxLength.min
        )
      }
      return newConfig
    })
  }

  const loadDefaultConfig = useCallback(async () => {
    if (defaultConfig) return defaultConfig

    const data = await cacheManager.getOrFetch('default_chunk_setting', () =>
      chunkSettingApi.default.get()
    )
    const config = {
      ...deepCopy(data),
      ...getExtraSetting()
    } as Setting
    setSplitRule(config, 'knowledge_chunking')
    setSplitRule(config, 'index_chunking')
    setDefaultConfig(config)
    return config
  }, [defaultConfig])

  const handleTypeChange = useCallback(async (type: 'knowledge' | 'index', newType: string) => {
    if (newType === CHUNK_TYPE.DEFAULT) {
      // 保存当前配置到 customConfig
      setCustomConfig(deepCopy(setting))

      // 加载默认配置并应用
      const defaultCfg = await loadDefaultConfig()
      const newSetting = { ...setting } as any

      fieldMap[type].forEach(field => {
        const [key, subKey] = field.split('.')
        if (subKey) {
          const settingObj = newSetting[key] as Record<string, any>
          const defaultObj = (defaultCfg as any)[key] as Record<string, any>
          settingObj[subKey] = deepCopy(defaultObj[subKey])
        } else {
          newSetting[key] = deepCopy((defaultCfg as any)[key])
        }
      })

      setSetting(newSetting)
    } else {
      // 从 customConfig 恢复
      if (!customConfig) return

      const newSetting = { ...setting } as any
      fieldMap[type].forEach(field => {
        const [key, subKey] = field.split('.')
        if (subKey) {
          const settingObj = newSetting[key] as Record<string, any>
          const customObj = (customConfig as any)[key] as Record<string, any>
          settingObj[subKey] = deepCopy(customObj[subKey])
        } else {
          newSetting[key] = deepCopy((customConfig as any)[key])
        }
      })

      setSetting(newSetting)
    }
  }, [setting, customConfig, loadDefaultConfig])

  const getChunkConfig = () => {
    const data = deepCopy({ chunking_config: { ...setting.chunking_config } })

    const processSplitRule = (type: 'knowledge' | 'index') => {
      const chunkType = type === 'knowledge' ? 'knowledge_chunking_type' : 'index_chunking_type'
      const chunkInput = type === 'knowledge' ? 'knowledge_chunking_input' : 'index_chunking_input'
      const chunkHead = type === 'knowledge' ? 'knowledge_chunking_head' : 'index_chunking_head'
      const chunkRule = type === 'knowledge' ? 'knowledge_chunking_rule' : 'index_chunking_rule'
      const config = type === 'knowledge' ? data.chunking_config.knowledge_chunking : data.chunking_config.index_chunking

      if (setting[chunkType as keyof Setting] === CHUNK_TYPE.NONE) {
        config.split_rule = ''
      } else {
        const split_rule: string[] = []
        if ((setting[chunkRule as keyof Setting] as string[]).includes(SPLIT_TYPE.HEADING)) {
          split_rule.push(setting[chunkHead as keyof Setting] as string)
        }
        if (
          (setting[chunkRule as keyof Setting] as string[]).includes(SPLIT_TYPE.CUSTOM) &&
          (setting[chunkInput as keyof Setting] as string[]).length > 0
        ) {
          split_rule.push(
            ...(setting[chunkInput as keyof Setting] as string[]).map(parseInputValue)
          )
        }
        config.split_rule = split_rule.join(',')
      }
    }

    processSplitRule('knowledge')
    processSplitRule('index')

    if (setting.knowledge_chunking_type === CHUNK_TYPE.CUSTOM) {
      if (data.chunking_config.knowledge_chunking.split_rule === '') {
        message.error('知识点拆分规则不能为空')
        return undefined
      }
    }
    if (setting.index_chunking_type === CHUNK_TYPE.CUSTOM) {
      if (data.chunking_config.index_chunking.split_rule === '') {
        message.error('索引块拆分规则不能为空')
        return undefined
      }
    }

    data.chunking_config.index_chunking.is_system_default = false
    data.chunking_config.knowledge_chunking.is_system_default = false

    return data
  }

  const setChunkConfig = useCallback(async (config: Setting) => {
    // 加载默认配置
    const defaultCfg = await loadDefaultConfig()

    // 创建新配置，合并额外设置
    const newConfig = {
      ...deepCopy(config),
      ...getExtraSetting()
    } as Setting

    // 解析 split_rule 字符串为表单状态
    setSplitRule(newConfig, 'knowledge_chunking')
    setSplitRule(newConfig, 'index_chunking')

    // 判断配置是否与默认配置相同，如果是则设置为 DEFAULT 类型
    if (isConfigEqual(config, defaultCfg, 'knowledge')) {
      newConfig.knowledge_chunking_type = CHUNK_TYPE.DEFAULT
    }
    if (isConfigEqual(config, defaultCfg, 'index')) {
      newConfig.index_chunking_type = CHUNK_TYPE.DEFAULT
    }

    setSetting(newConfig)
  }, [loadDefaultConfig])

  useImperativeHandle(ref, () => ({
    getChunkConfig,
    setChunkConfig
  }))

  return (
    <div className="flex flex-col">
      {/* Knowledge Section */}
      <div className="border rounded">
        <div className="h-12 flex items-center gap-2 px-5 border-b">
          <SvgIcon name="notebook-one" width="16px" height="16px" />
          <h4 className="text-sm text-[#1D1E1F]">知识点</h4>
        </div>
        <div className="p-5 flex flex-col gap-4">
          <Radio.Group
            value={setting.knowledge_chunking_type}
            onChange={(e) => handleTypeChange('knowledge', e.target.value)}
          >
            <Radio value={CHUNK_TYPE.DEFAULT}>默认</Radio>
            <Radio value={CHUNK_TYPE.CUSTOM}>自定义拆分</Radio>
            <Radio value={CHUNK_TYPE.NONE}>整篇</Radio>
          </Radio.Group>

          {[CHUNK_TYPE.CUSTOM, CHUNK_TYPE.DEFAULT].includes(setting.knowledge_chunking_type) && (
            <div className="flex items-center gap-2">
              <div
                className={`w-[212px] h-9 px-3 border rounded flex items-center gap-1.5 ${
                  setting.knowledge_chunking_type !== CHUNK_TYPE.DEFAULT &&
                  setting.chunking_config.knowledge_chunking.chunk_mode === CHUNK_MODE.LENGTH
                    ? 'border-[#2563EB]'
                    : ''
                } ${setting.knowledge_chunking_type !== CHUNK_TYPE.DEFAULT ? 'cursor-pointer' : ''}`}
                onClick={() => handleChangeChunkMode('knowledge', CHUNK_MODE.LENGTH)}
              >
                <div className="size-5 rounded bg-[#E0EAFF] flex items-center justify-center text-[#2563EB]">
                  <SvgIcon name="list-numbers" width="14px" />
                </div>
                <span className="flex-1 text-sm text-[#1D1E1F]">长度优先</span>
                <Radio
                  checked={setting.chunking_config.knowledge_chunking.chunk_mode === CHUNK_MODE.LENGTH}
                />
              </div>
              <div
                className={`w-[212px] h-9 px-3 border rounded flex items-center gap-1.5 ${
                  setting.knowledge_chunking_type !== CHUNK_TYPE.DEFAULT &&
                  setting.chunking_config.knowledge_chunking.chunk_mode === CHUNK_MODE.IDENTIFIER
                    ? 'border-[#2563EB]'
                    : ''
                } ${setting.knowledge_chunking_type !== CHUNK_TYPE.DEFAULT ? 'cursor-pointer' : ''}`}
                onClick={() => handleChangeChunkMode('knowledge', CHUNK_MODE.IDENTIFIER)}
              >
                <div className="size-5 rounded bg-[#FFF1D6] flex-center text-[#F0A105]">#</div>
                <span className="flex-1 text-sm text-[#1D1E1F]">标识符优先</span>
                <Radio
                  checked={setting.chunking_config.knowledge_chunking.chunk_mode === CHUNK_MODE.IDENTIFIER}
                />
              </div>
            </div>
          )}

          <div className="p-4 bg-[#F8F9FA] rounded-md">
            {[CHUNK_TYPE.CUSTOM, CHUNK_TYPE.DEFAULT].includes(setting.knowledge_chunking_type) && (
              <div className="space-y-3 mb-3">
                <div className="flex items-center">
                  <div className="flex-none w-20 text-sm text-[#4F5052]">标识符</div>
                  <Checkbox.Group
                    value={setting.knowledge_chunking_rule}
                    onChange={(values) =>
                      setSetting((prev) => ({ ...prev, knowledge_chunking_rule: values as string[] }))
                    }
                    disabled={setting.knowledge_chunking_type === CHUNK_TYPE.DEFAULT}
                  >
                    <Checkbox value={SPLIT_TYPE.HEADING} />
                    <Dropdown
                      menu={{
                        items: CONFIG.headerList.map((item) => ({
                          key: item.type,
                          label: item.label
                        })),
                        onClick: ({ key }) => handleChangeHeading('knowledge', key)
                      }}
                    >
                      <div className="flex items-center gap-1 mr-5 cursor-pointer">
                        {getHeadingLabel('knowledge')}
                        <DownOutlined />
                      </div>
                    </Dropdown>
                    <Checkbox value={SPLIT_TYPE.CUSTOM} />
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-[#4F5052] whitespace-nowrap">指定标识符</span>
                      <Select
                        mode="multiple"
                        value={setting.knowledge_chunking_input}
                        onChange={(values) =>
                          setSetting((prev) => ({ ...prev, knowledge_chunking_input: values }))
                        }
                        options={knowledgeCommonList.map((item) => ({
                          label: item.label,
                          value: item.value
                        }))}
                        className="w-52"
                        disabled={setting.knowledge_chunking_type === CHUNK_TYPE.DEFAULT}
                      />
                    </div>
                  </Checkbox.Group>
                </div>
                <div className="flex items-center">
                  <div className="flex-none w-20 text-sm text-[#4F5052]">长度</div>
                  <InputNumber
                    value={setting.chunking_config.knowledge_chunking.max_length}
                    onChange={(value) =>
                      setSetting((prev) => ({
                        ...prev,
                        chunking_config: {
                          ...prev.chunking_config,
                          knowledge_chunking: {
                            ...prev.chunking_config.knowledge_chunking,
                            max_length: value || 0
                          }
                        }
                      }))
                    }
                    min={CONFIG.maxLength.min}
                    max={CONFIG.maxLength.max}
                    controls={false}
                    disabled={setting.knowledge_chunking_type === CHUNK_TYPE.DEFAULT}
                    onBlur={() => handleBlurMaxLength('knowledge')}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center">
              <div className="flex-none w-20 text-sm text-[#4F5052]">召回语料</div>
              <Checkbox
                checked={setting.chunking_config.knowledge_chunking.include_filename}
                onChange={(e) =>
                  setSetting((prev) => ({
                    ...prev,
                    chunking_config: {
                      ...prev.chunking_config,
                      knowledge_chunking: {
                        ...prev.chunking_config.knowledge_chunking,
                        include_filename: e.target.checked
                      }
                    }
                  }))
                }
                disabled={setting.knowledge_chunking_type === CHUNK_TYPE.DEFAULT}
              >
                叠加文件名
              </Checkbox>
              <Checkbox
                checked={setting.chunking_config.knowledge_chunking.include_title}
                onChange={(e) =>
                  setSetting((prev) => ({
                    ...prev,
                    chunking_config: {
                      ...prev.chunking_config,
                      knowledge_chunking: {
                        ...prev.chunking_config.knowledge_chunking,
                        include_title: e.target.checked
                      }
                    }
                  }))
                }
                disabled={setting.knowledge_chunking_type === CHUNK_TYPE.DEFAULT}
              >
                叠加标题及子标题
              </Checkbox>
            </div>
          </div>
        </div>
      </div>

      {/* Index Section */}
      <div className="border rounded mt-4">
        <div className="h-12 flex items-center gap-2 px-5 border-b">
          <SvgIcon name="layers" width="16px" height="16px" />
          <h4 className="text-sm text-[#1D1E1F]">检索块</h4>
        </div>
        <div className="p-5 flex flex-col gap-4">
          <Radio.Group
            value={setting.index_chunking_type}
            onChange={(e) => handleTypeChange('index', e.target.value)}
          >
            <Radio value={CHUNK_TYPE.DEFAULT}>默认</Radio>
            <Radio value={CHUNK_TYPE.CUSTOM}>自定义拆分</Radio>
            <Radio value={CHUNK_TYPE.NONE}>整篇</Radio>
          </Radio.Group>

          {[CHUNK_TYPE.CUSTOM, CHUNK_TYPE.DEFAULT].includes(setting.index_chunking_type) && (
            <div className="p-4 bg-[#F8F9FA] rounded-md space-y-2">
              <div className="flex items-center">
                <div className="flex-none w-20 text-sm text-[#4F5052]">标识符</div>
                <Checkbox.Group
                  value={setting.index_chunking_rule}
                  onChange={(values) =>
                    setSetting((prev) => ({ ...prev, index_chunking_rule: values as string[] }))
                  }
                  disabled={setting.index_chunking_type === CHUNK_TYPE.DEFAULT}
                >
                  <Checkbox value={SPLIT_TYPE.HEADING} />
                  <Dropdown
                    menu={{
                      items: CONFIG.headerList.map((item) => ({
                        key: item.type,
                        label: item.label
                      })),
                      onClick: ({ key }) => handleChangeHeading('index', key)
                    }}
                  >
                    <div className="flex items-center gap-1 mr-5 cursor-pointer">
                      {getHeadingLabel('index')}
                      <DownOutlined />
                    </div>
                  </Dropdown>
                  <Checkbox value={SPLIT_TYPE.CUSTOM} />
                  <Select
                    mode="multiple"
                    value={setting.index_chunking_input}
                    onChange={(values) =>
                      setSetting((prev) => ({ ...prev, index_chunking_input: values }))
                    }
                    options={indexCommonList.map((item) => ({
                      label: item.label,
                      value: item.value
                    }))}
                    className="w-52"
                    disabled={setting.index_chunking_type === CHUNK_TYPE.DEFAULT}
                  />
                </Checkbox.Group>
              </div>
              <div className="flex items-center">
                <div className="flex-none w-20 text-sm text-[#4F5052]">长度</div>
                <InputNumber
                  value={setting.chunking_config.index_chunking.max_length}
                  onChange={(value) =>
                    setSetting((prev) => ({
                      ...prev,
                      chunking_config: {
                        ...prev.chunking_config,
                        index_chunking: {
                          ...prev.chunking_config.index_chunking,
                          max_length: value || 0
                        }
                      }
                    }))
                  }
                  min={0}
                  max={1000000}
                  controls={false}
                  disabled={setting.index_chunking_type === CHUNK_TYPE.DEFAULT}
                  onBlur={() => handleBlurMaxLength('index')}
                />
              </div>
            </div>
          )}

          <div className="p-4 bg-[#F8F9FA] rounded-md space-y-2">
            <div className="text-sm text-[#1D1E1F] font-semibold">索引增强</div>
            <div className="flex items-center">
              <div className="flex-none w-20 text-sm text-[#4F5052]">默认索引</div>
              <Checkbox
                checked={setting.chunking_config.index_chunking.include_filename}
                onChange={(e) =>
                  setSetting((prev) => ({
                    ...prev,
                    chunking_config: {
                      ...prev.chunking_config,
                      index_chunking: {
                        ...prev.chunking_config.index_chunking,
                        include_filename: e.target.checked
                      }
                    }
                  }))
                }
                disabled={setting.index_chunking_type === CHUNK_TYPE.DEFAULT}
              >
                叠加文件名
              </Checkbox>
              <Checkbox
                checked={setting.chunking_config.index_chunking.include_title}
                onChange={(e) =>
                  setSetting((prev) => ({
                    ...prev,
                    chunking_config: {
                      ...prev.chunking_config,
                      index_chunking: {
                        ...prev.chunking_config.index_chunking,
                        include_title: e.target.checked
                      }
                    }
                  }))
                }
                disabled={setting.index_chunking_type === CHUNK_TYPE.DEFAULT}
              >
                叠加标题及子标题
              </Checkbox>
            </div>
            <div className="flex items-center -mt-2">
              <div className="flex-none w-20 text-sm text-[#4F5052]">自动生成</div>
              <Checkbox
                checked={setting.chunking_config.content_summary.generation_method === GENERATION.AI}
                onChange={(e) =>
                  setSetting((prev) => ({
                    ...prev,
                    chunking_config: {
                      ...prev.chunking_config,
                      content_summary: {
                        generation_method: e.target.checked ? GENERATION.AI : GENERATION.MANUAL
                      }
                    }
                  }))
                }
                disabled={setting.index_chunking_type === CHUNK_TYPE.DEFAULT}
              >
                内容概要
              </Checkbox>
              <Checkbox
                checked={setting.chunking_config.common_questions.generation_method === GENERATION.AI}
                onChange={(e) =>
                  setSetting((prev) => ({
                    ...prev,
                    chunking_config: {
                      ...prev.chunking_config,
                      common_questions: {
                        generation_method: e.target.checked ? GENERATION.AI : GENERATION.MANUAL
                      }
                    }
                  }))
                }
                disabled={setting.index_chunking_type === CHUNK_TYPE.DEFAULT}
              >
                常见问法
              </Checkbox>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})

ChunkConfig.displayName = 'ChunkConfig'

export { ChunkConfig }
export default ChunkConfig
