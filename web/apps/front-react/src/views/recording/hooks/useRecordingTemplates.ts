/**
 * 录音总结模板列表获取 hook
 */
import { useState, useEffect, useCallback } from 'react'
import type { TemplateItem, TemplateCategory } from '@km/shared-business/recording-template'
import recordingApi from '@/api/modules/recording'
import { groupApi } from '@/api/modules/group'
import { GROUP_TYPE } from '@/constants/group'

interface UseRecordingTemplatesReturn {
  templates: TemplateItem[]
  categories: TemplateCategory[]
  loading: boolean
  refresh: () => void
}

/**
 * 将 API 返回的模板列表转换为 TemplateItem[]
 */
function transformTemplates(
  list: { id: string; name: string; description: string; prompt: string; group_id: number }[],
): TemplateItem[] {
  return list.map((t) => ({
    id: t.id,
    name: t.name,
    category: String(t.group_id),
    description: t.description,
    prompt: t.prompt,
  }))
}

/**
 * 从模板列表的 group_id 中提取分类列表
 */
function extractCategories(templates: TemplateItem[]): TemplateCategory[] {
  const groupIds = [...new Set(templates.map((t) => t.category))]
  // 保持 group_id 顺序
  return groupIds.map((id) => ({
    id,
    name: id === '0' ? '默认' : `分组 ${id}`,
  }))
}

/**
 * 获取录音总结模板列表
 *
 * 同时获取模板列表和分组数据，将模板关联到对应的分组名称。
 * 如果分组接口失败，回退为从 group_id 自动推导分类名。
 */
export function useRecordingTemplates(): UseRecordingTemplatesReturn {
  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [categories, setCategories] = useState<TemplateCategory[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      try {
        // 并行获取模板列表和分组数据
        const [templateList, groups] = await Promise.all([
          recordingApi.getTemplates(),
          groupApi.list({ params: { group_type: GROUP_TYPE.RECORDING_TEMPLATE } }).catch(() => []),
        ])

        if (cancelled) return

        const items = transformTemplates(templateList)
        setTemplates(items)

        // 构建分类列表：使用全量分组数据（分组接口是分类的唯一来源）
        if (groups.length > 0) {
          // 按分组接口返回的顺序展示所有分类
          const orderedCategories: TemplateCategory[] = groups.map((g: any) => ({
            id: String(g.group_id),
            name: g.group_name,
          }))
          setCategories(orderedCategories)
        } else {
          setCategories(extractCategories(items))
        }
      } catch (e) {
        if (!cancelled) {
          console.error('Failed to load templates:', e)
          setTemplates([])
          setCategories([])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  return { templates, categories, loading, refresh }
}

export default useRecordingTemplates