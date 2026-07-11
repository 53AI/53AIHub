export const AGENT_USAGES = {
  HUB: 0,
  KM_AI_SEARCH: 1,
  KM_FILE_CHAT: 2,
  KM_MAP: 3,
  WORK_AI: 4,
}

export const inputTypeList = [
  {
    label: window.$t('variable_type.text'),
    type: 'text',
  },
  {
    label: window.$t('variable_type.textarea'),
    type: 'textarea',
  },
  {
    label: window.$t('variable_type.inputNumber'),
    type: 'inputNumber',
  },
  {
    label: window.$t('variable_type.select'),
    type: 'select',
  },
  { label: window.$t('variable_type.date'), type: 'date', allowed: ['53ai_workflow'] },
  { label: window.$t('variable_type.tag'), type: 'tag', allowed: ['53ai_workflow'] },
  { label: window.$t('variable_type.file'), type: 'file' },
  {
    label: window.$t('variable_type.array_text'),
    type: 'array_text',
    allowed: ['coze_workflow_cn'],
  },
  {
    label: window.$t('variable_type.array_image'),
    type: 'array_image',
    allowed: ['coze_workflow_cn'],
  },
  {
    label: window.$t('variable_type.array_audio'),
    type: 'array_audio',
    allowed: ['coze_workflow_cn'],
  },
  {
    label: window.$t('variable_type.array_video'),
    type: 'array_video',
    allowed: ['coze_workflow_cn'],
  },
  {
    label: window.$t('variable_type.array_file'),
    type: 'array_file',
    allowed: ['coze_workflow_cn'],
  },
]

export const outputTypeList = [
  { label: window.$t('variable_type.textarea'), type: 'textarea' },
  { label: window.$t('variable_type.image'), type: 'image' },
  { label: window.$t('variable_type.audio'), type: 'audio' },
  { label: window.$t('variable_type.video'), type: 'video' },
  { label: window.$t('variable_type.markdown'), type: 'markdown' },
  { label: window.$t('variable_type.array_text'), type: 'array_text' },
  { label: window.$t('variable_type.array_image'), type: 'array_image' },
  { label: window.$t('variable_type.array_audio'), type: 'array_audio' },
  { label: window.$t('variable_type.array_video'), type: 'array_video' },
]

export const outputDefaultField = {
  id: '',
  variable: '',
  label: '',
  type: 'text',
  desc: '',
  required: false,
  max_length: 0,
  is_system: false,
  options: [],
  date_format: '',
  multiple: false,
  show_word_limit: false,
  file_type: 'all',
  file_accept: [],
  file_limit: 1,
  file_size: 30,
}

