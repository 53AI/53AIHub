import { img_host } from '@/utils/config'

/** 新建领域时的默认图标 */
export const DEFAULT_DOMAIN_LOGO = `${img_host}/library/graph-icon.png`

export const CANONICAL_TYPE_LABELS: Record<string, string> = {
  principle: '原则',
  priority: '价值排序',
  criterion: '判断标准',
  preference: '偏好',
  boundary: '边界',
  assumption: '前提',
  trigger: '触发条件',
}

export const LAYER_LABELS: Record<string, string> = {
  core: '长期认知',
  situational: '领域 / 当前情境',
}

export const CORE_GROUPS = [
  { key: 'principle', label: '原则', hint: '老板长期坚持的基本经营准则', iconBg: '#EBFFFF', types: ['principle'] },
  { key: 'priority', label: '价值排序', hint: '多个目标冲突时，老板优先保什么', iconBg: '#FFF0F0', types: ['priority'] },
  { key: 'criterion', label: '判断标准', hint: '老板判断一件事好坏、值不值得做的标准', iconBg: '#FCEBFF', types: ['criterion'] },
  { key: 'preference', label: '偏好', hint: '没有硬性约束时，老板更倾向哪种选择', iconBg: '#FFF5EB', types: ['preference'] },
  { key: 'boundary', label: '边界', hint: '老板明确不能接受或不能突破的范围', iconBg: '#EBFFF4', types: ['boundary'] },
  { key: 'assumption', label: '前提', hint: '老板当前判断所依赖的关键事实或假设', iconBg: '#EBFFFE', types: ['assumption'] },
  { key: 'trigger', label: '触发条件', hint: '达到什么条件后，老板会启动、扩大或停止行动', iconBg: '#EBF1FF', types: ['trigger'] },
] as const
