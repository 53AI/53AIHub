import { useState, useEffect, useMemo } from 'react'
import { t } from '@/locales'
import { 
  Modal, Button, Radio, Checkbox, InputNumber, Select, Spin, message 
} from 'antd'
import { DownOutlined } from '@ant-design/icons'
import { chunkSettingApi, ChunkSetting } from '@/api/modules/chunk-setting'
import { CHUNK_SETTING_DEFAULT } from '@/constants/chunk'
import { cacheManager as cache } from '@km/shared-utils'

// Constants
const CHUNK_TYPE = {
  CUSTOM: 'custom',
  NONE: 'none',
  DEFAULT: 'default',
} as const

const SPLIT_TYPE = {
  HEADING: 'heading',
  CUSTOM: 'custom',
} as const

const GENERATION = {
  MANUAL: 'manual',
  AI: 'ai',
} as const

const CHUNK_MODE = {
  LENGTH: 'length_first',
  IDENTIFIER: 'identifier_first',
} as const

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

// Escape mapping
const ESCAPE_MAP: Record<string, string> = {
  '\n': '\\n',
  '\n\n': '\\n\\n',
  '\r\n': '\\r\\n',
  '\r': '\\r',
  '\t': '\\t',
}

const REVERSE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(ESCAPE_MAP).map(([k, v]) => [v, k])
)

const formatDisplayValue = (value: string) => ESCAPE_MAP[value] ?? value
const parseInputValue = (input: string) => REVERSE_MAP[input] ?? input

interface ChunkingConfig {
  chunk_mode: string
  max_length: number
  split_rule: string
  include_filename: boolean
  include_title: boolean
}

interface Setting {
  chunking_config: {
    knowledge_chunking: ChunkingConfig & {
      content_summary?: { generation_method: string }
      common_questions?: { generation_method: string }
    }
    index_chunking: ChunkingConfig & {
      content_summary: { generation_method: string }
      common_questions: { generation_method: string }
    }
    content_summary: { generation_method: string }
    common_questions: { generation_method: string }
  }
  knowledge_chunking_type: string
  knowledge_chunking_head: string
  knowledge_chunking_input: string[]
  knowledge_chunking_rule: string[]
  index_chunking_type: string
  index_chunking_head: string
  index_chunking_input: string[]
  index_chunking_rule: string[]
}

const extraSetting = {
  knowledge_chunking_type: CHUNK_TYPE.CUSTOM,
  knowledge_chunking_rule: ['heading'],
  knowledge_chunking_head: CONFIG.headerList[0].type,
  knowledge_chunking_input: [],
  index_chunking_type: CHUNK_TYPE.CUSTOM,
  index_chunking_head: CONFIG.headerList[0].type,
  index_chunking_rule: ['heading'],
  index_chunking_input: [],
}

export function KnowledgeChunkPage() {
  
  const [loading, setLoading] = useState(false)
  const [list, setList] = useState<ChunkSetting[]>([])
  const [configVisible, setConfigVisible] = useState(false)
  const [defaultConfig, setDefaultConfig] = useState<Setting | null>(null)
  const [customConfig, setCustomConfig] = useState<Setting | null>(null)
  
  const [setting, setSetting] = useState<Setting>(() => ({
    ...JSON.parse(JSON.stringify(CHUNK_SETTING_DEFAULT)),
    ...extraSetting,
  }))

  // Computed common lists
  const knowledgeCommonList = useMemo(() => {
    const customItems = setting.knowledge_chunking_input.filter(
      item => !CONFIG.commonList.some(common => common.value === item)
    )
    return CONFIG.commonList.concat(customItems.map(item => ({ label: item, value: item })))
  }, [setting.knowledge_chunking_input])

  const indexCommonList = useMemo(() => {
    const customItems = setting.index_chunking_input.filter(
      item => !CONFIG.commonList.some(common => common.value === item)
    )
    return CONFIG.commonList.concat(customItems.map(item => ({ label: item, value: item })))
  }, [setting.index_chunking_input])

  // Get heading label
  const getHeadingLabel = (type: 'knowledge' | 'index') => {
    const chunkHead = type === 'knowledge' ? 'knowledge_chunking_head' : 'index_chunking_head'
    const label = CONFIG.headerList.find(item => item.type === setting[chunkHead])?.label
    return label || CONFIG.headerList[0].label
  }

  // Load chunk setting list
  const loadChunkSettingList = async () => {
    setLoading(true)
    try {
      const res = await chunkSettingApi.list()
      setList(res)
    } finally {
      setLoading(false)
    }
  }

  // Load default config
  const loadDefaultConfig = async () => {
    const data = await cache.getOrFetch('default_chunk_setting', () => chunkSettingApi.default.get())
    const config = {
      ...JSON.parse(JSON.stringify(data)),
      ...extraSetting,
    }
    setSplitRule(config, 'knowledge_chunking')
    setSplitRule(config, 'index_chunking')
    setDefaultConfig(config)
    return config
  }

  // Set split rule
  const setSplitRule = (config: Setting, prefix: 'knowledge_chunking' | 'index_chunking') => {
    const splitRule = config.chunking_config[prefix].split_rule
    if (splitRule) {
      const rules = splitRule.split(',')
      const headers = CONFIG.headerList.map(item => item.type)
      if (headers.includes(rules[0])) {
        config[`${prefix}_head` as keyof Setting] = rules[0] as any
        config[`${prefix}_input` as keyof Setting] = rules.slice(1).map(formatDisplayValue) as any
      } else {
        config[`${prefix}_input` as keyof Setting] = rules.map(formatDisplayValue) as any
        config[`${prefix}_rule` as keyof Setting] = [] as any
      }
      if ((config[`${prefix}_input` as keyof Setting] as string[]).length === 0) {
        config[`${prefix}_input` as keyof Setting] = [CONFIG.commonList[0].value] as any
      }
      (config[`${prefix}_rule` as keyof Setting] as string[]).push(SPLIT_TYPE.CUSTOM)
    } else {
      config[`${prefix}_type` as keyof Setting] = CHUNK_TYPE.NONE as any
    }
    if (!config.chunking_config[prefix].chunk_mode) {
      config.chunking_config[prefix].chunk_mode = CHUNK_MODE.LENGTH
    }
  }

  // Handle edit
  const handleEdit = async (data: ChunkSetting) => {
    setConfigVisible(true)
    await loadDefaultConfig()
    
    const config = {
      ...JSON.parse(JSON.stringify(data)),
      ...extraSetting,
    }
    setSplitRule(config, 'knowledge_chunking')
    setSplitRule(config, 'index_chunking')

    // Check if config equals default
    if (isConfigEqual(config, 'knowledge')) {
      config.knowledge_chunking_type = CHUNK_TYPE.DEFAULT
    }
    if (isConfigEqual(config, 'index')) {
      config.index_chunking_type = CHUNK_TYPE.DEFAULT
    }

    setSetting(config)
  }

  // Check if config equals default
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

  const isConfigEqual = (config: Setting, type: 'knowledge' | 'index'): boolean => {
    if (!defaultConfig) return false

    const fields = fieldMap[type]
    for (const field of fields) {
      const [key, subKey] = field.split('.')
      if (subKey) {
        const configObj = (config as any)[key]
        const defaultObj = (defaultConfig as any)[key]
        if (JSON.stringify(configObj[subKey]) !== JSON.stringify(defaultObj[subKey])) {
          return false
        }
      } else {
        if (JSON.stringify((config as any)[key]) !== JSON.stringify((defaultConfig as any)[key])) {
          return false
        }
      }
    }
    return true
  }

  // Handle type change
  const handleTypeChange = (type: 'knowledge' | 'index', newType: string) => {
    const newSetting = { ...setting }
    
    if (newType === CHUNK_TYPE.DEFAULT) {
      setCustomConfig(JSON.parse(JSON.stringify(setting)))
      fieldMap[type].forEach(field => {
        const [key, subKey] = field.split('.')
        if (subKey) {
          newSetting[key] = JSON.parse(JSON.stringify({
            ...newSetting[key],
            [subKey]: defaultConfig?.[key]?.[subKey],
          }))
        } else {
          newSetting[key] = JSON.parse(JSON.stringify(defaultConfig?.[key]))
        }
      })
    } else if (customConfig) {
      fieldMap[type].forEach(field => {
        const [key, subKey] = field.split('.')
        if (subKey) {
          newSetting[key] = JSON.parse(JSON.stringify({
            ...newSetting[key],
            [subKey]: customConfig[key]?.[subKey],
          }))
        } else {
          newSetting[key] = JSON.parse(JSON.stringify(customConfig[key]))
        }
      })
    }

    if (type === 'knowledge') {
      newSetting.knowledge_chunking_type = newType
    } else {
      newSetting.index_chunking_type = newType
    }
    
    setSetting(newSetting)
  }

  // Handle chunk mode change
  const handleChangeChunkMode = (type: 'knowledge' | 'index', value: string) => {
    if (setting[`${type}_chunking_type`] === CHUNK_TYPE.DEFAULT) return
    
    const newSetting = { ...setting }
    if (type === 'knowledge') {
      newSetting.chunking_config.knowledge_chunking.chunk_mode = value
    } else {
      newSetting.chunking_config.index_chunking.chunk_mode = value
    }
    setSetting(newSetting)
  }

  // Handle heading change
  const handleChangeHeading = (type: 'knowledge' | 'index', value: string) => {
    const newSetting = { ...setting }
    if (type === 'knowledge') {
      newSetting.knowledge_chunking_head = value
    } else {
      newSetting.index_chunking_head = value
    }
    setSetting(newSetting)
  }

  // Handle confirm
  const handleConfirm = async () => {
    const data = { chunking_config: JSON.parse(JSON.stringify(setting.chunking_config)) }

    // Process split rules
    const processSplitRule = (type: 'knowledge' | 'index') => {
      const chunkType = type === 'knowledge' ? 'knowledge_chunking_type' : 'index_chunking_type'
      const chunkInput = type === 'knowledge' ? 'knowledge_chunking_input' : 'index_chunking_input'
      const chunkHead = type === 'knowledge' ? 'knowledge_chunking_head' : 'index_chunking_head'
      const chunkRule = type === 'knowledge' ? 'knowledge_chunking_rule' : 'index_chunking_rule'
      const config = type === 'knowledge' ? data.chunking_config.knowledge_chunking : data.chunking_config.index_chunking

      if (setting[chunkType] === CHUNK_TYPE.NONE) {
        config.split_rule = ''
      } else {
        const split_rule = []
        if ((setting[chunkRule] as string[]).includes(SPLIT_TYPE.HEADING)) {
          split_rule.push(setting[chunkHead])
        }
        if ((setting[chunkRule] as string[]).includes(SPLIT_TYPE.CUSTOM) && setting[chunkInput].length > 0) {
          split_rule.push(...setting[chunkInput].map(parseInputValue))
        }
        config.split_rule = split_rule.join(',')
      }
    }

    processSplitRule('knowledge')
    processSplitRule('index')

    if (setting.knowledge_chunking_type === CHUNK_TYPE.CUSTOM) {
      if (data.chunking_config.knowledge_chunking.split_rule === '') {
        message.error('知识点拆分规则不能为空')
        return
      }
    }
    if (setting.index_chunking_type === CHUNK_TYPE.CUSTOM) {
      if (data.chunking_config.index_chunking.split_rule === '') {
        message.error('索引块拆分规则不能为空')
        return
      }
    }

    await chunkSettingApi.chunkingConfig.update(data)
    message.success(t('message_status.save_success'))
    loadChunkSettingList()
    setConfigVisible(false)
  }

  useEffect(() => {
    loadChunkSettingList()
  }, [])

  // Render chunk config section
  const renderChunkConfig = (type: 'knowledge' | 'index') => {
    const chunkType = type === 'knowledge' ? 'knowledge_chunking_type' : 'index_chunking_type'
    const chunkRule = type === 'knowledge' ? 'knowledge_chunking_rule' : 'index_chunking_rule'
    const chunkHead = type === 'knowledge' ? 'knowledge_chunking_head' : 'index_chunking_head'
    const chunkInput = type === 'knowledge' ? 'knowledge_chunking_input' : 'index_chunking_input'
    const chunkConfig = type === 'knowledge' ? setting.chunking_config.knowledge_chunking : setting.chunking_config.index_chunking
    const commonList = type === 'knowledge' ? knowledgeCommonList : indexCommonList
    const isDefault = setting[chunkType] === CHUNK_TYPE.DEFAULT
    const showConfig = [CHUNK_TYPE.CUSTOM, CHUNK_TYPE.DEFAULT].includes(setting[chunkType] as any)

    return (
      <div className="border rounded">
        <div className="h-12 flex items-center gap-2 px-5 border-b bg-gray-50">
          <span className="text-sm font-medium">{type === 'knowledge' ? '知识点' : '检索块'}</span>
        </div>
        
        <div className="py-5 px-10 flex flex-col gap-4">
          {/* Type selection */}
          <Radio.Group
            value={setting[chunkType]}
            onChange={(e) => handleTypeChange(type, e.target.value)}
          >
            <Radio value={CHUNK_TYPE.DEFAULT}>默认</Radio>
            <Radio value={CHUNK_TYPE.CUSTOM}>自定义拆分</Radio>
            <Radio value={CHUNK_TYPE.NONE}>不拆分</Radio>
          </Radio.Group>

          {/* Chunk mode */}
          {showConfig && (
            <div className="flex items-center gap-2">
              <div
                className={`w-[212px] h-9 px-3 border rounded flex items-center gap-1.5 ${
                  !isDefault && chunkConfig.chunk_mode === CHUNK_MODE.LENGTH ? 'border-blue-500' : ''
                } ${!isDefault ? 'cursor-pointer' : ''}`}
                onClick={() => handleChangeChunkMode(type, CHUNK_MODE.LENGTH)}
              >
                <div className="size-5 rounded bg-blue-50 flex items-center justify-center text-blue-500">
                  #
                </div>
                <span className="flex-1 text-sm">长度优先</span>
                <Radio
                  checked={chunkConfig.chunk_mode === CHUNK_MODE.LENGTH}
                  disabled={isDefault}
                />
              </div>
              <div
                className={`w-[212px] h-9 px-3 border rounded flex items-center gap-1.5 ${
                  !isDefault && chunkConfig.chunk_mode === CHUNK_MODE.IDENTIFIER ? 'border-blue-500' : ''
                } ${!isDefault ? 'cursor-pointer' : ''}`}
                onClick={() => handleChangeChunkMode(type, CHUNK_MODE.IDENTIFIER)}
              >
                <div className="size-5 rounded bg-yellow-50 flex items-center justify-center text-yellow-500">
                  #
                </div>
                <span className="flex-1 text-sm">标识符优先</span>
                <Radio
                  checked={chunkConfig.chunk_mode === CHUNK_MODE.IDENTIFIER}
                  disabled={isDefault}
                />
              </div>
            </div>
          )}

          {/* Config panel */}
          {showConfig && (
            <div className="p-4 bg-gray-50 rounded space-y-3">
              {/* Split rule */}
              <div className="flex items-center">
                <div className="w-20 text-sm text-gray-600">标识符</div>
                <Checkbox.Group
                  value={setting[chunkRule]}
                  onChange={(values) => {
                    const newSetting = { ...setting }
                    newSetting[chunkRule] = values as any
                    setSetting(newSetting)
                  }}
                  disabled={isDefault}
                >
                  <Checkbox value={SPLIT_TYPE.HEADING} />
                  <Select
                    value={setting[chunkHead]}
                    onChange={(val) => handleChangeHeading(type, val)}
                    disabled={isDefault}
                    style={{ width: 150 }}
                    suffixIcon={<DownOutlined />}
                    options={CONFIG.headerList.map(item => ({ value: item.type, label: item.label }))}
                  />
                  <Checkbox value={SPLIT_TYPE.CUSTOM} className="ml-4" />
                  <span className="text-sm text-gray-600 whitespace-nowrap ml-2">指定标识符</span>
                  <Select
                    mode="multiple"
                    value={setting[chunkInput]}
                    onChange={(values) => {
                      const newSetting = { ...setting }
                      newSetting[chunkInput] = values as any
                      setSetting(newSetting)
                    }}
                    disabled={isDefault}
                    style={{ width: 200, marginLeft: 8 }}
                    options={commonList.map(item => ({ value: item.value, label: item.label }))}
                    allowClear
                  />
                </Checkbox.Group>
              </div>

              {/* Max length */}
              <div className="flex items-center">
                <div className="w-20 text-sm text-gray-600">长度</div>
                <InputNumber
                  value={chunkConfig.max_length}
                  onChange={(val) => {
                    const newSetting = { ...setting }
                    if (type === 'knowledge') {
                      newSetting.chunking_config.knowledge_chunking.max_length = val || CONFIG.maxLength.min
                    } else {
                      newSetting.chunking_config.index_chunking.max_length = val || CONFIG.maxLength.min
                    }
                    setSetting(newSetting)
                  }}
                  min={CONFIG.maxLength.min}
                  max={CONFIG.maxLength.max}
                  disabled={isDefault}
                  controls={false}
                />
              </div>

              {/* Include options */}
              <div className="flex items-center">
                <div className="w-20 text-sm text-gray-600">召回语料</div>
                <Checkbox
                  checked={chunkConfig.include_filename}
                  onChange={(e) => {
                    const newSetting = { ...setting }
                    if (type === 'knowledge') {
                      newSetting.chunking_config.knowledge_chunking.include_filename = e.target.checked
                    } else {
                      newSetting.chunking_config.index_chunking.include_filename = e.target.checked
                    }
                    setSetting(newSetting)
                  }}
                  disabled={isDefault}
                >
                  叠加文件名
                </Checkbox>
                <Checkbox
                  checked={chunkConfig.include_title}
                  onChange={(e) => {
                    const newSetting = { ...setting }
                    if (type === 'knowledge') {
                      newSetting.chunking_config.knowledge_chunking.include_title = e.target.checked
                    } else {
                      newSetting.chunking_config.index_chunking.include_title = e.target.checked
                    }
                    setSetting(newSetting)
                  }}
                  disabled={isDefault}
                >
                  叠加标题及子标题
                </Checkbox>
              </div>

              {/* Index enhancement (index only) */}
              {type === 'index' && (
                <>
                  <div className="text-sm font-medium mt-4">索引增强</div>
                  <div className="flex items-center">
                    <div className="w-20 text-sm text-gray-600">默认索引</div>
                    <Checkbox
                      checked={setting.chunking_config.index_chunking.include_filename}
                      disabled={isDefault}
                    >
                      叠加文件名
                    </Checkbox>
                    <Checkbox
                      checked={setting.chunking_config.index_chunking.include_title}
                      disabled={isDefault}
                    >
                      叠加标题及子标题
                    </Checkbox>
                  </div>
                  <div className="flex items-center">
                    <div className="w-20 text-sm text-gray-600">自动生成</div>
                    <Checkbox
                      checked={setting.chunking_config.content_summary.generation_method === GENERATION.AI}
                      onChange={(e) => {
                        const newSetting = { ...setting }
                        newSetting.chunking_config.content_summary.generation_method = 
                          e.target.checked ? GENERATION.AI : GENERATION.MANUAL
                        setSetting(newSetting)
                      }}
                      disabled={isDefault}
                    >
                      内容概要
                    </Checkbox>
                    <Checkbox
                      checked={setting.chunking_config.common_questions.generation_method === GENERATION.AI}
                      onChange={(e) => {
                        const newSetting = { ...setting }
                        newSetting.chunking_config.common_questions.generation_method = 
                          e.target.checked ? GENERATION.AI : GENERATION.MANUAL
                        setSetting(newSetting)
                      }}
                      disabled={isDefault}
                    >
                      常见问法
                    </Checkbox>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <Spin spinning={loading}>
        <div className="flex-1 bg-white p-6 space-y-3 overflow-y-auto">
          {list.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between bg-white border rounded-lg p-4 hover:shadow-sm transition-shadow"
            >
              <div className="flex-1 flex items-center gap-3">
                <img
                  src={`/images/split/${item.chunking_config?.type || 'default'}.png`}
                  alt=""
                  className="size-8"
                />
                <h4 className="text-sm font-medium">{item.chunking_config?.name}</h4>
                <span className="text-sm text-gray-400">
                  {item.chunking_config?.type === 'default' && '根据智能算法进行分段计算及数据清洗'}
                  {item.chunking_config?.type === 'data_table' && '识别表格结构与数据逻辑，自动对表格类文档进行分段计算与数据清洗'}
                  {item.chunking_config?.type === 'qa' && '聚焦问答类文档的问答结构，清晰拆分问题与答案'}
                </span>
              </div>
              {item.chunking_config?.type === 'default' && (
                <div className="flex items-center gap-4 ml-2">
                  <div className="border-r h-3 w-px" />
                  <Button type="link" onClick={() => handleEdit(item)}>
                    配置
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </Spin>

      {/* Config Modal */}
      <Modal
        open={configVisible}
        onCancel={() => setConfigVisible(false)}
        width={1000}
        footer={[
          <Button key="cancel" onClick={() => setConfigVisible(false)}>
            取消
          </Button>,
          <Button key="save" type="primary" onClick={handleConfirm}>
            保存
          </Button>,
        ]}
      >
        <div className="flex items-center gap-2 mb-4">
          <img className="size-8" src="/images/split/default.png" alt="" />
          <h4 className="font-medium">通用文档</h4>
        </div>

        {/* Knowledge chunking */}
        {renderChunkConfig('knowledge')}

        {/* Index chunking */}
        <div className="mt-4">
          {renderChunkConfig('index')}
        </div>
      </Modal>
    </div>
  )
}

export default KnowledgeChunkPage