/**
 * Toolbox API 封装
 * 提供可测试的 API 层，支持依赖注入
 */
import { aiLinkApi } from '@/api/modules/ai-link'
import groupApi from '@/api/modules/group'
import type { AiLinkItem, GroupOption, SortItem, AiLinkDetail, GroupApiResponse, AiLinkListParams, RawGroupOption } from '../types'

/**
 * API 响应类型
 */
export interface ToolboxApiInterface {
  list: (params: AiLinkListParams) => Promise<AiLinkItem[]>
  save: (data: Partial<AiLinkDetail>) => Promise<AiLinkDetail>
  delete: (aiLinkId: string) => Promise<void>
  store: () => Promise<{ data: StoreGroupData[] }>
  sort: (items: SortItem[]) => Promise<void>
  detail: (id: string) => Promise<{ data: AiLinkDetail }>
  loadGroups: (groupType: number) => Promise<RawGroupOption[]>
}

/**
 * 商店分组数据
 */
interface StoreGroupData {
  group_name: string
  links: AiLinkItem[]
}

/**
 * 默认 API 实现
 */
export const toolboxApi: ToolboxApiInterface = {
  /**
   * 获取 AI 工具列表
   */
  async list({ group_id, keyword }: AiLinkListParams): Promise<AiLinkItem[]> {
    const params: AiLinkListParams = {}

    if (group_id && group_id.length > 0 && !group_id.some((id) => Number(id) < 0)) {
      params.group_id = group_id.map((id) => Number(id))
    }
    if (keyword) {
      params.keyword = keyword
    }

    const result = await aiLinkApi.list({
      params,
      paramsSerializer: (p: AiLinkListParams | undefined) => {
        const entries: string[] = []
        if (p?.group_id && Array.isArray(p.group_id) && p.group_id.length > 0) {
          p.group_id.forEach((id: number) => {
            entries.push(`group_id=${encodeURIComponent(id)}`)
          })
        }
        if (p?.keyword) {
          entries.push(`keyword=${encodeURIComponent(p.keyword)}`)
        }
        return entries.join('&')
      },
    })

    return result as AiLinkItem[]
  },

  /**
   * 保存 AI 工具
   */
  async save(data: Partial<AiLinkDetail>): Promise<AiLinkDetail> {
    const result = await aiLinkApi.save({ data })
    return result as AiLinkDetail
  },

  /**
   * 删除 AI 工具
   */
  async delete(aiLinkId: string): Promise<void> {
    await aiLinkApi.delete({ data: { ai_link_id: aiLinkId } })
  },

  /**
   * 获取商店数据
   */
  async store(): Promise<{ data: StoreGroupData[] }> {
    const result = await aiLinkApi.store()
    return result as { data: StoreGroupData[] }
  },

  /**
   * 批量排序
   */
  async sort(items: SortItem[]): Promise<void> {
    await aiLinkApi.sort({ items })
  },

  /**
   * 获取详情
   */
  async detail(id: string): Promise<{ data: AiLinkDetail }> {
    const result = await aiLinkApi.detail(id)
    return result as { data: AiLinkDetail }
  },

  /**
   * 加载分组列表
   */
  async loadGroups(groupType: number): Promise<RawGroupOption[]> {
    const result = await groupApi.list({
      params: { group_type: groupType },
    })
    return (result || []).map((item: GroupApiResponse) => ({
      group_id: item.group_id,
      group_name: item.group_name,
      sort: item.sort ?? 0,
    }))
  },
}

/**
 * 创建可注入的 API 实例
 * 用于测试时 mock
 */
export function createToolboxApi(overrides: Partial<ToolboxApiInterface> = {}): ToolboxApiInterface {
  return {
    ...toolboxApi,
    ...overrides,
  }
}

export default toolboxApi
