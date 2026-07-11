import { getPublicPath } from '@/utils/config'

// 解析工具配置元数据
export type ParserConfig = {
  key: string // 用于保存和识别的key（与 platform_key 保持一致）
  name: string // 显示名称
  icon: string // 图标路径
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
    key: 'default',
    name: '标准解析',
    desc: '快速提取数字原生文档',
    detailedDesc: '支持 PDF、Word、Excel、PPT 等快速转化成 Markdown，本地运行无数据隐私风险。',
    icon: getPublicPath('/images/tools/markitdown.png'),
    formFields: [],
    displayFields: [],
    isDefault: true,
  },
  {
    key: 'markitdown',
    name: '标准解析',
    desc: '快速提取数字原生文档',
    detailedDesc: '支持 PDF、Word、Excel、PPT 等快速转化成 Markdown，本地运行无数据隐私风险。',
    icon: getPublicPath('/images/tools/markitdown.png'),
    formFields: [],
    displayFields: [],
    isDefault: true,
  },
  {
    key: 'textin',
    name: '高精解析',
    icon: getPublicPath('/images/tools/textin.png'),
    desc: '支持复杂版面与扫描件',
    detailedDesc: '企业级 OCR 引擎，在扫描件识别、复杂表格还原以及手写体识别方面表现优异。',
    description: `
      <p class="mb-3">通过调用Textin的服务开放接口,实现对文件内容的解析。</p>
      <ol class="list-decimal list-inside space-y-1">
        <li>
          前往Textin工作台(<a
            href="https://www.textin.com/console/dashboard/overview"
            target="_blank"
            class="text-[#2563EB]"
            >https://www.textin.com/console/dashboard/overview</a
          >):
        </li>
        <li>在【账号与开发者信息】下,复制「x-ti-app-id」和「x-ti-secret-code」;</li>
      </ol>
    `,
    formFields: [
      { key: 'x-ti-app-id', label: 'x-ti-app-id' },
      { key: 'x-ti-secret-code', label: 'x-ti-secret-code' },
    ],
    displayFields: [
      { key: 'x-ti-app-id', label: 'x-ti-app-id' },
      { key: 'x-ti-secret-code', label: 'x-ti-secret-code', isSecret: true },
    ],
  },
  {
    key: 'mineru.net',
    name: 'MinerU 云服务',
    icon: getPublicPath('/images/tools/mineru.png'),
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
  },
  {
    key: 'paddlepaddle_pp-ocrv5',
    name: 'PP-OCRV5',
    desc: '百度开源引擎',
    detailedDesc: '基于百度开源的 PP-OCRV5 技术，高性能的中英文识别引擎，适合各种通用场景。',
    icon: getPublicPath('/images/tools/paddlepaddle.png'),

    formFields: [
      { key: 'api_url', label: '服务器地址' },
      { key: 'token', label: 'Token' },
    ],
    displayFields: [
      { key: 'api_url', label: '服务器地址' },
      { key: 'token', label: 'Token', isSecret: true },
    ],
    supportedExts: ['pdf'],
  },
  {
    key: 'paddlepaddle_pp-structurev3',
    name: 'PP-StructureV3',
    icon: getPublicPath('/images/tools/paddlepaddle.png'),
    desc: '百度开源引擎',
    detailedDesc: '超轻量级 OCR 系统，支持 80+ 种语言、复杂版面分析(PP-Structure) 及表格还原',
    formFields: [
      { key: 'api_url', label: '服务器地址' },
      { key: 'token', label: 'Token' },
    ],
    displayFields: [
      { key: 'api_url', label: '服务器地址' },
      { key: 'token', label: 'Token', isSecret: true },
    ],
    supportedExts: ['pdf'],
  },
  {
    key: 'paddlepaddle_paddleocr-vl',
    name: 'PaddleOCR-VL',
    icon: getPublicPath('/images/tools/paddlepaddle.png'),
    desc: '百度开源引擎',
    detailedDesc: '基于百度开源的 PaddleOCR 技术，高性能的中英文识别引擎，适合各种通用场景。',
    formFields: [
      { key: 'api_url', label: '服务器地址' },
      { key: 'token', label: 'Token' },
    ],
    displayFields: [
      { key: 'api_url', label: '服务器地址' },
      { key: 'token', label: 'Token', isSecret: true },
    ],
    supportedExts: ['pdf'],
  },
  {
    key: 'tingwu',
    name: '通义听悟',
    icon: getPublicPath('/images/tools/tingwu.png'),
    desc: '语音解析服务',
    detailedDesc:
      '阿里云通义听悟，支持音视频转文字、会议记录、字幕生成等场景，准确率高，支持多种语言。',
    description: `
      <ol class="list-decimal list-inside space-y-1">
        <li>
          如何获取 AccessKey ID 和 AccessKey Secret：登录 RAM 访问控制台，使用阿里云账号创建 AccessKey。具体操作，请参见<a
            href="https://help.aliyun.com/zh/tingwu/getting-started-1?spm=a2c4g.11186623.help-menu-454189.d_1.475631527aKt0n#c34213b07edk5"
            target="_blank"
            class="text-[#2563EB]"
            >阿里云文档</a
          >。
        </li>
        <li>Endpoint 默认为 tingwu.cn-beijing.aliyuncs.com，一般无需修改</li>
      </ol>
    `,
    formFields: [
      { key: 'app_key', label: 'AppKey' },
      { key: 'access_key_id', label: 'AccessKey ID' },
      { key: 'access_key_secret', label: 'AccessKey Secret' },
      { key: 'endpoint', label: 'Endpoint', defaultValue: 'tingwu.cn-beijing.aliyuncs.com' },
    ],
    displayFields: [
      { key: 'app_key', label: 'AppKey' },
      { key: 'access_key_id', label: 'AccessKey ID', isSecret: true },
      { key: 'access_key_secret', label: 'AccessKey Secret', isSecret: true },
    ],
    supportedExts: ['mp3'],
  },
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
  defaultValue?: any
  desc?: string
  placeholder?: string
  min?: number
  max?: number
  multiple?: boolean
}

export const PARSER_BUSINESS_OPTIONS: Record<string, ParserOption[]> = {
  textin: [
    {
      key: 'page_start',
      label: '解析起始页',
      type: 'number',
      defaultValue: 1,
      min: 1,
      placeholder: '起始页码',
    },
    {
      key: 'page_end',
      label: '解析结束页',
      type: 'number',
      defaultValue: 1000,
      min: 1,
      placeholder: '结束页码',
    },
    {
      key: 'parse_mode',
      label: '解析模式',
      type: 'select',
      defaultValue: 'auto',
      options: [
        { label: 'auto(综合识别)', value: 'auto' },
        { label: 'scan(扫描件)', value: 'scan' },
        { label: 'text(电子文档)', value: 'text' },
      ],
    },
    {
      key: 'dpi',
      label: 'DPI',
      type: 'select',
      defaultValue: 144,
      options: [
        { label: '72 DPI', value: 72 },
        { label: '96 DPI', value: 96 },
        { label: '144 DPI (推荐)', value: 144 },
        { label: '300 DPI', value: 300 },
      ],
    },
    {
      key: 'table_flavor',
      label: '表格格式',
      type: 'select',
      defaultValue: 'md',
      options: [
        { label: 'Markdown格式', value: 'md' },
        { label: 'HTML格式', value: 'html' },
        { label: '无表格', value: 'none' },
      ],
    },
    {
      key: 'image_output',
      label: '图片获取',
      type: 'select',
      defaultValue: 'whole_page',
      options: [
        { label: '整页图像', value: 'whole_page' },
        { label: '切片图像', value: 'crop' },
        { label: '无', value: 'none' },
      ],
    },
    {
      key: 'ignored_text_mode',
      label: '非正文文本处理',
      type: 'select',
      defaultValue: 'comment',
      options: [
        { label: '注释格式', value: 'comment' },
        { label: '移除', value: 'remove' },
        { label: '保留', value: 'keep' },
      ],
    },
    {
      key: 'formula_level',
      label: '公式识别等级',
      type: 'select',
      defaultValue: 'high',
      options: [
        { label: '全识别', value: 'high' },
        { label: '仅行间公式', value: 'inline' },
        { label: '不识别', value: 'none' },
      ],
    },
    {
      key: 'generate_title',
      label: '生成标题',
      desc: '是否在markdown中生成标题层级',
      type: 'switch',
      defaultValue: true,
    },
    {
      key: 'merge_paragraph',
      label: '段落表格合并',
      desc: '进行段落合并和表格合并',
      type: 'switch',
      defaultValue: true,
    },
    {
      key: 'image_analysis',
      label: '图像分析',
      desc: '利用大模型对文档中的子图进行分析',
      type: 'switch',
      defaultValue: false,
    },
  ],
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
}


export const getParserConfig = (key: string): ParserConfig | undefined => {
  return PARSER_CONFIGS.find(config => config.key === key)
}
