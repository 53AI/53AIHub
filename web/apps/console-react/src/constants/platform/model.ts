import { MODEL_VALUES } from './config'

// 模型值分隔符，用于拼接 model_type 和 model_id
export const MODEL_VALUE_SEPARATOR = '_53aikm_'

// 模型默认配置常量
export const DEFAULT_MAX_TOKENS = 4096
export const DEFAULT_CONTEXT_LENGTH = 128000
export const DEFAULT_VECTOR_DIMENSION = 4096

export const MAX_TOKENS_LIMIT = 128000
export const CONTEXT_LENGTH_LIMIT = 200000

// 防抖延迟常量
export const DEBOUNCE_DELAY = 300

// 外部模型 API 地址
export const EXTERNAL_MODEL_API_URL = 'https://dashboard.53ai.com/api/v1/models'

// 构建模型选择值
export const buildModelValue = (modelType: number, modelId: string) =>
  `${modelType}${MODEL_VALUE_SEPARATOR}${modelId}`

// 解析模型选择值
export const parseModelValue = (
  value: string,
): { modelType: string; modelId: string } | null => {
  const parts = value.split(MODEL_VALUE_SEPARATOR)
  if (parts.length === 2) {
    return { modelType: parts[0], modelId: parts[1] }
  }
  return null
}

export interface FormConfig {
  label: string
  prop: string
  type: 'input' | 'select' | 'url' | 'radio' | 'input_number'
  rules?: unknown[]
  placeholder?: string
  required?: boolean
  size?: 'large' | 'default' | 'small'
  multiple?: boolean
  default?: string | boolean | number
  min?: number
  max?: number
  allowCreate?: boolean
  options?: { label: string; value: string | boolean }[]
  showWhen?: (form: any) => boolean
}

// 深度搜索表单配置
export const DEEPSEEK_FORM_CONFIG: FormConfig[] = [
  {
    label: window.$t('module.platform_model_api_endpoint'),
    prop: 'base_url',
    type: 'url',
    placeholder: window.$t('module.platform_model_api_endpoint_placeholder'),
    required: true,
    default: 'https://api.deepseek.com',
  },
  {
    label: window.$t('module.platform_tool_api_key'),
    prop: 'key',
    type: 'input',
    placeholder: window.$t('module.platform_tool_api_key_placeholder'),
    required: true,
  },
  {
    label: window.$t('module.platform_model_models'),
    prop: 'models',
    type: 'select',
    multiple: true,
    placeholder: window.$t('module.platform_model_models_placeholder'),
    required: true,
  },
]

// OpenAI表单配置
export const OPENAI_FORM_CONFIG: FormConfig[] = [
  {
    label: window.$t('module.platform_model_base_url'),
    prop: 'base_url',
    type: 'url',
    placeholder: window.$t('module.platform_model_base_url_placeholder'),
    required: true,
  },
  {
    label: window.$t('module.platform_tool_api_key'),
    prop: 'key',
    type: 'input',
    placeholder: window.$t('module.platform_tool_api_key_placeholder'),
    required: true,
  },
  {
    label: window.$t('module.platform_model_models'),
    prop: 'models',
    type: 'select',
    multiple: true,
    placeholder: window.$t('module.platform_model_models_placeholder'),
    required: true,
  },
]

export const SILICONFLOW_FORM_CONFIG: FormConfig[] = [
  {
    label: window.$t('module.platform_tool_api_key'),
    prop: 'key',
    type: 'input',
    placeholder: window.$t('module.platform_tool_api_key_placeholder'),
    required: true,
  },
  {
    label: window.$t('module.platform_model_models'),
    prop: 'models',
    type: 'select',
    multiple: true,
    placeholder: window.$t('module.platform_model_models_placeholder'),
    required: true,
  },
]

// Azure表单配置
export const AZURE_FORM_CONFIG: FormConfig[] = [
  // 模型类型选择
  {
    label: window.$t('module.platform_model_type'),
    prop: 'model_type',
    type: 'radio',
    required: true,
    options: [
      { label: window.$t('model.reasoning'), value: '1' },
      { label: window.$t('model.embedding'), value: '2' },
    ],
  },
  {
    label: window.$t('module.platform_model_name'),
    prop: 'name',
    type: 'input',
    placeholder: window.$t('module.platform_model_name_placeholder'),
    required: true,
  },
  {
    label: window.$t('module.platform_model_base_url_azure'),
    prop: 'base_url',
    type: 'url',
    placeholder: window.$t('module.platform_model_base_url_azure_placeholder'),
    required: true,
  },
  {
    label: window.$t('module.platform_tool_api_key'),
    prop: 'key',
    type: 'input',
    placeholder: window.$t('module.platform_tool_api_key_placeholder'),
  },
  {
    label: window.$t('module.platform_model_version'),
    prop: 'other',
    type: 'input',
    placeholder: window.$t('module.platform_model_version_placeholder'),
    required: true,
  },
  {
    label: window.$t('module.platform_model_models_azure'),
    prop: 'models',
    type: 'select',
    placeholder: window.$t('module.platform_model_models_azure_placeholder'),
    required: true,
    allowCreate: true,
  },
  {
    label: 'Vision Support',
    prop: 'config.vision',
    type: 'select',
    options: [
      { label: '支持', value: true },
      { label: '不支持', value: false },
    ],
    default: false,
  },
]

// 类OpenAI模型配置
export const CUSTOM_OPENAI_FORM_CONFIG: FormConfig[] = [
  // 模型类型选择
  {
    label: window.$t('module.platform_model_type'),
    prop: 'model_type',
    type: 'radio',
    required: true,
    options: [
      { label: window.$t('model.reasoning'), value: '1' },
      { label: window.$t('model.embedding'), value: '2' },
      { label: window.$t('model.rerank'), value: '3' },
    ],
  },
  {
    label: window.$t('module.platform_model_models_name'),
    prop: 'models',
    type: 'input',
    placeholder: window.$t('module.platform_model_models_placeholder'),
    required: true,
  },
  // 模型显示名称
  {
    label: window.$t('module.platform_model_display_name'),
    prop: 'other',
    type: 'input',
    placeholder: window.$t('module.platform_model_display_name_placeholder'),
  },
  {
    label: window.$t('module.platform_tool_api_key'),
    prop: 'key',
    type: 'input',
    placeholder: window.$t('module.platform_tool_api_key_placeholder'),
  },
  {
    label: window.$t('module.platform_model_base_url_azure'),
    prop: 'base_url',
    type: 'url',
    placeholder: window.$t('module.platform_model_base_url_azure_placeholder'),
    required: true,
  },
  // 模型上下文长度
  {
    label: window.$t('module.platform_model_context_length'),
    prop: 'config.context_length',
    type: 'input_number',
    placeholder: window.$t('module.platform_model_context_length_placeholder'),
    required: true,
    default: DEFAULT_CONTEXT_LENGTH,
    min: 1,
    max: CONTEXT_LENGTH_LIMIT,
  },
  // // 最大token上限
  // {
  //   label: window.$t('module.platform_model_max_tokens'),
  //   prop: 'config.max_tokens',
  //   type: 'input_number',
  //   placeholder: window.$t('module.platform_model_max_tokens_placeholder'),
  //   default: DEFAULT_MAX_TOKENS,
  //   min: 1,
  //   max: MAX_TOKENS_LIMIT,
  //   showWhen: (form: any) => form.model_type === '1',
  // },
  // Agent Thought
  {
    label: 'Agent Thought',
    prop: 'config.agent_thought',
    type: 'select',
    options: [
      { label: '支持', value: true },
      { label: '不支持', value: false },
    ],
    default: false,
    showWhen: (form: any) => form.model_type === '1',
  },
  {
    label: 'Deep Thinking',
    prop: 'config.deep_thinking',
    type: 'select',
    options: [
      { label: '支持', value: true },
      { label: '不支持', value: false },
    ],
    default: false,
    showWhen: (form: any) => form.model_type === '1',
  },
  // vision
  {
    label: window.$t('module.platform_model_vision_support'),
    prop: 'config.vision',
    type: 'select',
    options: [
      { label: '支持', value: true },
      { label: '不支持', value: false },
    ],
    default: false,
    showWhen: (form: any) => form.model_type === '1',
  },
]

export const BAILIAN_FORM_CONFIG: FormConfig[] = [
  {
    label: window.$t('module.platform_model_api_endpoint'),
    prop: 'base_url',
    type: 'url',
    placeholder: window.$t('module.platform_model_base_url_placeholder'),
    required: true,
    // default: 'https://example.com',
  },
  {
    label: window.$t('module.platform_tool_api_key'),
    prop: 'key',
    type: 'input',
    placeholder: window.$t('module.platform_tool_api_key_placeholder'),
    required: true,
  },
  {
    label: window.$t('module.platform_model_models'),
    prop: 'models',
    type: 'select',
    multiple: true,
    placeholder: window.$t('module.platform_model_models_placeholder'),
    required: true,
  },
]

// 月之暗面（Moonshot/Kimi）表单配置
export const MOONSHOT_FORM_CONFIG: FormConfig[] = [
  {
    label: window.$t('module.platform_model_api_endpoint'),
    prop: 'base_url',
    type: 'url',
    placeholder: window.$t('module.platform_model_api_endpoint_placeholder'),
    required: true,
    default: 'https://api.moonshot.cn',
  },
  {
    label: window.$t('module.platform_tool_api_key'),
    prop: 'key',
    type: 'input',
    placeholder: window.$t('module.platform_tool_api_key_placeholder'),
    required: true,
  },
  {
    label: window.$t('module.platform_model_models'),
    prop: 'models',
    type: 'select',
    multiple: true,
    placeholder: window.$t('module.platform_model_models_placeholder'),
    required: true,
  },
]

// Gemini 表单配置
export const GEMINI_FORM_CONFIG: FormConfig[] = [
  {
    label: window.$t('module.platform_model_base_url'),
    prop: 'base_url',
    type: 'url',
    placeholder: window.$t('module.platform_model_base_url_placeholder'),
    required: true,
    default: 'http://agent.gemini.53ai.com',
  },
  {
    label: window.$t('module.platform_tool_api_key'),
    prop: 'key',
    type: 'input',
    placeholder: window.$t('module.platform_tool_api_key_placeholder'),
    required: true,
  },
  {
    label: window.$t('module.platform_model_models'),
    prop: 'models',
    type: 'select',
    multiple: true,
    placeholder: window.$t('module.platform_model_models_placeholder'),
    required: true,
  },
]

// 获取表单配置
export const getFormConfig = (channel_type: number): FormConfig[] => {
  switch (channel_type) {
    case MODEL_VALUES.DEEPSEEK:
      return DEEPSEEK_FORM_CONFIG
    case MODEL_VALUES.OPENAI:
      return OPENAI_FORM_CONFIG
    case MODEL_VALUES.AZURE:
      return AZURE_FORM_CONFIG
    case MODEL_VALUES.SILICONFLOW:
      return SILICONFLOW_FORM_CONFIG
    case MODEL_VALUES.BAILIAN:
    case MODEL_VALUES.VOLCENGINE:
    case MODEL_VALUES.QIANFAN:
      return BAILIAN_FORM_CONFIG
    case MODEL_VALUES.MOONSHOT:
      return MOONSHOT_FORM_CONFIG
    case MODEL_VALUES.GEMINI:
      return GEMINI_FORM_CONFIG
    case MODEL_VALUES.CUSTOM_OPENAI:
      return CUSTOM_OPENAI_FORM_CONFIG
    default:
      return []
  }
}
