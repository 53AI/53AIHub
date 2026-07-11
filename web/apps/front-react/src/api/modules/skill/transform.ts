import type { Skill, SkillMyItem, SkillDetail } from './types'

/** 前端使用的 Skill类型 */
// export interface Skill {
//   id: string
//   name: string
//   version: string
//   subtitle: string
//   description: string
//   rating: number
//   usageCount: number
//   category: string
//   isEnabled?: boolean
//   isAdded?: boolean
// }
// export interface Skill {
//   id: string
//   eid: number
//   source_type: 'zip' | 'platform'
//   skill_name: string
//   sort: number
//   display_name: string
//   description: string
//   version: string
//   usage_guide: string
//   origin_zip_name: string
//   origin_zip_size: number
//   origin_zip_sha256: string
//   publish_status: 'published' | 'draft' | 'reviewing'
//   admin_status: 'enabled' | 'disabled'
//   risk_level: 'low' | 'medium' | 'high'
//   score_integrity: number
//   score_practicality: number
//   score_safety: number
//   score_code_quality: number
//   score_doc_quality: number
//   scan_message: string
//   created_time: number
//   updated_time: number
//   binding_id: string
//   added: boolean
//   binding_status: 'enabled' | 'disabled' | ''
// }

/**
 * 计算平均评分
 * 将 0-100 分的各项评分转换为 5 分制
 */
export const calculateAverageScore = (item: Skill | SkillDetail): number => {
  // 优先从 usage_guide.quality_scores 计算
  if (item.usage_guide) {
    try {
      const usageGuide = JSON.parse(item.usage_guide)
      if (usageGuide?.quality_scores) {
        const scores = usageGuide.quality_scores
          .map((s: any) => s.value)
          .filter((v: number) => typeof v === 'number' && v > 0)
        if (scores.length > 0) {
          const avg = scores.reduce((a: number, b: number) => a + b, 0) / scores.length
          return Math.round(avg * 10) / 10
        }
        return 0
      }
    } catch {}
  }
  // 回退到 score_* 字段
  const scores = [
    item.score_integrity,
    item.score_practicality,
    item.score_safety,
    item.score_code_quality,
    item.score_doc_quality,
  ].filter((s): s is number => typeof s === 'number' && s > 0)
  if (scores.length === 0) return 0
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length
  return Math.round(avg * 10) / 10
}

/**
 * 将 API 返回的探索列表项转换为前端 Skill 类型
 */
export const transformExploreItemToSkill = (item: Skill): Skill => {
  return {
    ...item, // 保留原始字段，包括 display_name 和 skill_name
    id: item.id,
    name: item.display_name || item.skill_name,
    version: item.version,
    subtitle: item.skill_name,
    description: item.description,
    rating: calculateAverageScore(item),
    usageCount: 0, // API 暂无此字段
    category: item.source_type === 'platform' ? '平台技能' : '自定义技能',
    isAdded: item.added,
    isEnabled: item.binding_status === 'enabled',
  }
}

/**
 * 将 API 返回的探索列表转换为前端 Skill 列表
 */
export const transformExploreList = (items: Skill[]): Skill[] => {
  return items.map(transformExploreItemToSkill)
}

/**
 * 将 API 返回的我的技能项转换为前端 Skill 类型
 */
export const transformMyItemToSkill = (item: SkillMyItem): Skill => {
  return {
    ...item, // 保留原始字段，包括 display_name 和 skill_name
    id: item.id,
    name: item.display_name || item.skill_name,
    version: item.version,
    subtitle: item.skill_name,
    description: item.description,
    rating: 0, // SkillMyItem 没有评分字段
    usageCount: 0,
    category: item.source_type === 'platform' ? '平台技能' : '自定义技能',
    isAdded: true,
    isEnabled: item.binding_status === 'enabled',
  }
}

/**
 * 将 API 返回的我的技能列表转换为前端 Skill 列表
 */
export const transformMyList = (items: SkillMyItem[]): Skill[] => {
  return items.map(transformMyItemToSkill)
}

/**
 * 将 API 返回的技能详情转换为前端 Skill 类型
 */
export const transformDetailToSkill = (detail: SkillDetail): Skill => {
  return {
    id: detail.id,
    name: detail.display_name || detail.skill_name,
    version: detail.version,
    subtitle: detail.skill_name,
    description: detail.description,
    rating: calculateAverageScore(detail),
    usageCount: 0,
    category: detail.source_type === 'platform' ? '平台技能' : '自定义技能',
    isAdded: detail.added,
    isEnabled: detail.binding_status === 'enabled',
  }
}
