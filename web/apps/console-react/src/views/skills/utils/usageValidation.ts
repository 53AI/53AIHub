import { t } from '@/locales'

/** 质量评分项 */
export interface QualityScore {
  key: string
  label: string
  value: number
}

/** 使用说明项 */
export interface UsageItem {
  id: string
  title: string
  description: string
}

/** 验证规则 */
export const validationRules = {
  usageSectionNames: {
    quality_scores: 'skills.usage.quality_scores',
    capabilities: 'skills.usage.capabilities',
    usage_example: 'skills.usage.usage_example',
    best_practice: 'skills.usage.best_practice',
    faq: 'skills.usage.faq',
  } as Record<string, string>,
}

/** 检查质量评分是否有有效内容（所有评分都在 0-5 之间） */
export function hasValidQualityScores(items: QualityScore[]): boolean {
  return items.every((item) => {
    const value = Number(item.value)
    return !isNaN(value) && value >= 0 && value <= 5
  })
}

/** 检查使用说明项是否有有效内容（至少有一个项的 title 非空） */
export function hasValidUsageContent(items: UsageItem[]): boolean {
  return items.some((item) => item.title.trim() !== '')
}

/** 验证使用说明配置 */
export interface UsageValidationResult {
  valid: boolean
  message?: string
}

export function validateUsageGuide(
  usageSwitches: Record<string, boolean>,
  usageItems: {
    quality_scores: QualityScore[]
    capabilities: UsageItem[]
    usage_example: UsageItem[]
    bestPracticesPositive: UsageItem[]
    bestPracticesNegative: UsageItem[]
    faq: UsageItem[]
  },
): UsageValidationResult {
  for (const [key, enabled] of Object.entries(usageSwitches)) {
    if (!enabled) continue

    const sectionName = t(validationRules.usageSectionNames[key] || key)
    let hasContent = false

    if (key === 'quality_scores') {
      hasContent = hasValidQualityScores(usageItems.quality_scores)
      if (!hasContent) {
        return {
          valid: false,
          message: t('skills.usage.score_required', { section: sectionName }),
        }
      }
    } else if (key === 'best_practice') {
      const hasPositive = hasValidUsageContent(usageItems.bestPracticesPositive)
      const hasNegative = hasValidUsageContent(usageItems.bestPracticesNegative)
      hasContent = hasPositive || hasNegative

      if (!hasPositive && !hasNegative) {
        return {
          valid: false,
          message: t('skills.usage.best_practice_required', { section: sectionName }),
        }
      }
    } else {
      const items = usageItems[key as keyof typeof usageItems] as UsageItem[]
      hasContent = hasValidUsageContent(items)

      if (!hasContent) {
        return {
          valid: false,
          message: t('skills.usage.content_required', { section: sectionName }),
        }
      }
    }
  }

  return { valid: true }
}
