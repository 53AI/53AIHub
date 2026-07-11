import { getPublicPath } from '@/utils/config'

// 解析工具配置元数据
export type ParserConfig = {
  key: string // 用于保存和识别的key（与 platform_key 保持一致）
  name: string // 显示名称
  icon: string // 图标路径
  category: 'document' | 'audio' // 分类：文档解析 或 语音解析
  isDefault?: boolean // 是否是默认解析
  description?: string // 配置说明（HTML格式）
  desc?: string // 描述
  detailedDesc?: string // 详细描述
  formFields: Array<{ key: string; label: string; defaultValue?: string }> // 表单字段
  displayFields: Array<{ key: string; label: string; isSecret?: boolean }> // 显示字段
  supportedExts?: string[] // 支持的文件类型扩展名，如果不设置则支持所有类型
}

// 解析工具配置列表
const PARSER_CONFIGS: ParserConfig[] = [
  {
    key: 'markitdown',
    name: '标准解析',
    desc: '快速提取数字原生文档',
    detailedDesc: '支持 PDF、Word、Excel、PPT 等快速转化成 Markdown，本地运行无数据隐私风险。',
    icon: getPublicPath('/images/tools/markitdown.png'),
    category: 'document',
    formFields: [],
    displayFields: [],
    isDefault: true,
  },
  {
    key: 'mineru.net',
    name: 'MinerU 云服务',
    icon: getPublicPath('/images/tools/mineru.png'),
    category: 'document',
    desc: '专用于论文与多栏 PDF',
    detailedDesc:
      '专为复杂学术文献设计的 PDF 解析器，能够精准提取公式、表格及版面结构，生成高质量 Markdown。',
    description: `
      <p>为了保证您的数据安全，所有 API Tokens 有效期为 14 天，请在过期前更新 API Tokens</p>
    `,
    formFields: [
      { key: 'base_url', label: '服务器地址', defaultValue: 'https://mineru.net/api/v4' },
      { key: 'api_key', label: 'Token' },
    ],
    displayFields: [
      { key: 'base_url', label: '服务器地址' },
      { key: 'api_key', label: 'Token', isSecret: true },
    ],
    supportedExts: ['doc', 'ppt', 'pdf'], // 不支持 xls、md、html
  },
  {
    key: 'mineru.local',
    name: 'MinerU 私有部署',
    icon: getPublicPath('/images/tools/mineru.png'),
    category: 'document',
    desc: '专用于论文与多栏 PDF',
    detailedDesc:
      '专为复杂学术文献设计的 PDF 解析器，能够精准提取公式、表格及版面结构，生成高质量 Markdown。',
    formFields: [
      { key: 'base_url', label: '服务器地址', defaultValue: '' },
      { key: 'api_key', label: 'Token' },
    ],
    displayFields: [
      { key: 'base_url', label: '服务器地址' },
      { key: 'api_key', label: 'Token', isSecret: true },
    ],
    supportedExts: ['pdf'], // 不支持 xls、md、html、doc、ppt
  }
] as const

export type ParserKeys = (typeof PARSER_CONFIGS)[number]['key']

export { PARSER_CONFIGS }

// 获取简化的解析工具配置（仅用于 parse/index.vue）
export type SimpleParserConfig = {
  key: string
  name: string
  desc?: string
  detailedDesc?: string
  icon?: string
  platform_key: string
  supportedExts?: string[] // 支持的文件类型扩展名
}

export const getSimpleParserConfigs = (): SimpleParserConfig[] => {
  return PARSER_CONFIGS.map(config => ({
    key: config.key,
    name: config.name,
    desc: config.desc,
    detailedDesc: config.detailedDesc,
    icon: config.icon,
    platform_key: config.key, // platform_key 与 key 保持一致
    supportedExts: config.supportedExts,
  }))
}

export const getAvailableKeys = (): string[] => {
  return PARSER_CONFIGS.map(config => config.key)
}

export type ParserOption = {
  key: string
  label: string
  type: 'select' | 'input' | 'switch' | 'number'
  options?: { label: string; value: string | number | boolean }[]
  defaultValue?: string | number | boolean | string[]
  desc?: string
  placeholder?: string
  min?: number
  max?: number
  multiple?: boolean
}

export const PARSER_BUSINESS_OPTIONS: Record<string, ParserOption[]> = {
  'mineru.net': [
    {
      key: 'pages',
      label: '解析页码范围',
      type: 'input',
      placeholder: '例如：1-5,8,10-12',
    },
    {
      key: 'language',
      label: '文档语言',
      type: 'select',
      defaultValue: 'auto',
      options: [
        { label: 'auto(综合识别)', value: 'auto' },
        { label: 'en(英文)', value: 'en' },
        { label: 'zh(中文)', value: 'zh' },
      ],
    },
    {
      key: 'model',
      label: '模型版本',
      type: 'select',
      defaultValue: 'default',
      options: [{ label: '默认', value: 'default' }],
    },
    {
      key: 'enable_ocr',
      label: 'OCR 识别',
      desc: '启用 OCR 识别',
      type: 'switch',
      defaultValue: true,
    },
    {
      key: 'enable_formula',
      label: '公式识别',
      desc: '启用数学公式识别',
      type: 'switch',
      defaultValue: false,
    },
    {
      key: 'enable_table',
      label: '表格识别',
      desc: '启用表格识别',
      type: 'switch',
      defaultValue: true,
    },
  ],
  'mineru.local': [
    {
      key: 'start_page_id',
      label: '解析起始页',
      type: 'number',
      defaultValue: 0,
      min: 0,
    },
    {
      key: 'end_page_id',
      label: '解析结束页',
      type: 'number',
      defaultValue: 9999,
      min: 0,
    },
    {
      key: 'parse_method',
      label: '解析方法（仅 pipeline 后端生效）',
      type: 'select',
      defaultValue: 'auto',
      options: [
        { label: 'auto(综合识别)', value: 'auto' },
        { label: 'ocr(OCR识别)', value: 'ocr' },
        { label: 'txt(文本识别)', value: 'txt' },
      ],
    },
    {
      key: 'language',
      label: '语言列表',
      type: 'select',
      multiple: true,
      defaultValue: ['ch', 'en'],
      options: [
        { label: '中文CN', value: 'ch' },
        { label: '英文EN', value: 'en' },
      ],
    },
    {
      key: 'is_draw',
      label: '返回图片',
      desc: '解析后输出图片',
      type: 'switch',
      defaultValue: true,
    },
    {
      key: 'is_formula',
      label: '公式识别',
      desc: '启用数学公式识别',
      type: 'switch',
      defaultValue: false,
    },
    {
      key: 'is_table',
      label: '表格识别',
      desc: '启用表格识别',
      type: 'switch',
      defaultValue: true,
    },
  ],
  'paddlepaddle_pp-ocrv5': [
    {
      key: 'enable_cls_image',
      label: '图片方向矫正',
      desc: '自动矫正 0/90/180/270 度',
      type: 'switch',
      defaultValue: true,
    },
    {
      key: 'enable_rectification',
      label: '图片扭曲矫正',
      desc: '用于褶皱、倾斜等扭曲场景',
      type: 'switch',
      defaultValue: false,
    },
    {
      key: 'enable_cls_text',
      label: '文本行方向矫正',
      desc: '自动矫正文本 0/180 度',
      type: 'switch',
      defaultValue: true,
    },
  ],
  'paddlepaddle_pp-structurev3': [
    {
      key: 'enable_cls_image',
      label: '图片方向矫正',
      desc: '自动矫正 0/90/180/270 度',
      type: 'switch',
      defaultValue: true,
    },
    {
      key: 'enable_rectification',
      label: '图片扭曲矫正',
      desc: '用于褶皱、倾斜等扭曲场景',
      type: 'switch',
      defaultValue: false,
    },
    {
      key: 'enable_cls_text',
      label: '文本行方向矫正',
      desc: '自动矫正文本 0/180 度',
      type: 'switch',
      defaultValue: true,
    },
  ],
  'paddlepaddle_paddleocr-vl': [
    {
      key: 'enable_cls_image',
      label: '图片方向矫正',
      desc: '自动矫正 0/90/180/270 度',
      type: 'switch',
      defaultValue: true,
    },
    {
      key: 'enable_rectification',
      label: '图片扭曲矫正',
      desc: '用于褶皱、倾斜等扭曲场景',
      type: 'switch',
      defaultValue: false,
    },
    {
      key: 'enable_figure',
      label: '图表识别',
      desc: '启用图表识别',
      type: 'switch',
      defaultValue: true,
    },
  ],
  tingwu: [
    {
      key: 'language',
      label: '语音语言',
      type: 'select',
      defaultValue: 'zh',
      options: [
        { label: '中文', value: 'zh' },
        { label: '英文', value: 'en' },
        { label: '粤语', value: 'yue' },
        { label: '日语', value: 'ja' },
        { label: '韩语', value: 'ko' },
        { label: '西班牙语', value: 'es' },
        { label: '法语', value: 'fr' },
        { label: '德语', value: 'de' },
        { label: '俄语', value: 'ru' },
      ],
    },
    {
      key: 'enable_speaker_diarization',
      label: '说话人分离',
      desc: '识别不同说话人并区分标注',
      type: 'switch',
      defaultValue: true,
    },
    {
      key: 'enable_punctuation',
      label: '智能断句',
      desc: '自动添加标点符号',
      type: 'switch',
      defaultValue: true,
    },
    {
      key: 'enable_inverse_text_normalization',
      label: '数字规范化',
      desc: '将口语数字转换为阿拉伯数字',
      type: 'switch',
      defaultValue: true,
    },
    {
      key: 'enable_words',
      label: '输出词级别信息',
      desc: '返回每个词的时间戳',
      type: 'switch',
      defaultValue: false,
    },
    {
      key: 'enable_summary',
      label: '生成摘要',
      desc: '自动生成内容摘要',
      type: 'switch',
      defaultValue: false,
    },
  ],
}
