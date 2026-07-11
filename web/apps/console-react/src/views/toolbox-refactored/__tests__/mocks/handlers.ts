/**
 * MSW (Mock Service Worker) Handlers
 * 用于模拟真实网络请求，比 vi.mock 更接近真实场景
 *
 * @example
 * // 在测试中使用
 * import { server } from './server'
 * import { toolboxHandlers } from './handlers'
 *
 * beforeAll(() => server.listen())
 * afterEach(() => server.resetHandlers())
 * afterAll(() => server.close())
 *
 * // 自定义响应
 * server.use(
 *   http.get('/api/ai-link/list', () => HttpResponse.json({ data: [...] }))
 * )
 */
import { http, HttpResponse, delay } from 'msw'
import { factories, resetIdCounter } from '../factories'
import type { AiLinkItem, AiLinkDetail, SortItem } from '../../types'

/**
 * API 基础路径
 */
const API_BASE = '/api'

/**
 * 内存数据存储（用于模拟 CRUD 操作）
 */
let dataStore: {
  items: AiLinkItem[]
  groups: { group_id: number; group_name: string }[]
} = {
  items: [],
  groups: [],
}

/**
 * 重置数据存储
 */
export function resetDataStore(): void {
  resetIdCounter()
  dataStore = {
    items: factories.aiLinkList(5),
    groups: factories.rawGroupOptionList(3),
  }
}

/**
 * 初始化数据存储
 */
export function initDataStore(options?: {
  itemCount?: number
  groupCount?: number
}): void {
  resetIdCounter()
  const { itemCount = 5, groupCount = 3 } = options || {}

  dataStore = {
    items: factories.aiLinkList(itemCount),
    groups: factories.rawGroupOptionList(groupCount),
  }
}

/**
 * 获取当前数据存储（用于断言）
 */
export function getDataStore(): typeof dataStore {
  return dataStore
}

/**
 * 设置数据存储（用于测试准备）
 */
export function setDataStore(data: Partial<typeof dataStore>): void {
  dataStore = { ...dataStore, ...data }
}

/**
 * Toolbox API Handlers
 */
export const toolboxHandlers = [
  /**
   * 获取 AI 工具列表
   * GET /api/ai-link/list
   */
  http.get(`${API_BASE}/ai-link/list`, async ({ request }) => {
    const url = new URL(request.url)
    const groupIds = url.searchParams.getAll('group_id').map(Number)
    const keyword = url.searchParams.get('keyword') || undefined

    let items = [...dataStore.items]

    // 按分组筛选
    if (groupIds.length > 0 && !groupIds.includes(-1)) {
      items = items.filter((item) => groupIds.includes(item.group_id))
    }

    // 按关键词筛选
    if (keyword) {
      const lowerKeyword = keyword.toLowerCase()
      items = items.filter(
        (item) =>
          item.name.toLowerCase().includes(lowerKeyword) ||
          item.description.toLowerCase().includes(lowerKeyword)
      )
    }

    // 按排序值降序
    items.sort((a, b) => b.sort - a.sort)

    await delay(50) // 模拟网络延迟
    return HttpResponse.json(items)
  }),

  /**
   * 保存 AI 工具（创建/更新）
   * POST /api/ai-link/save
   */
  http.post(`${API_BASE}/ai-link/save`, async ({ request }) => {
    const body = (await request.json()) as Partial<AiLinkDetail>

    await delay(100)

    if (body.ai_link_id) {
      // 更新
      const index = dataStore.items.findIndex(
        (item) => item.ai_link_id === body.ai_link_id
      )
      if (index >= 0) {
        dataStore.items[index] = {
          ...dataStore.items[index],
          ...body,
        } as AiLinkItem
        return HttpResponse.json(dataStore.items[index])
      }
      return HttpResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // 创建
    const newItem = factories.aiLinkItem({
      ...body,
      sort: dataStore.items.length + 1,
    })
    dataStore.items.push(newItem)
    return HttpResponse.json(newItem)
  }),

  /**
   * 删除 AI 工具
   * DELETE /api/ai-link/delete
   */
  http.delete(`${API_BASE}/ai-link/delete`, async ({ request }) => {
    const url = new URL(request.url)
    const aiLinkId = url.searchParams.get('ai_link_id')

    await delay(50)

    if (!aiLinkId) {
      return HttpResponse.json({ error: 'Missing ai_link_id' }, { status: 400 })
    }

    const index = dataStore.items.findIndex((item) => item.ai_link_id === aiLinkId)
    if (index >= 0) {
      dataStore.items.splice(index, 1)
      return HttpResponse.json({ success: true })
    }

    return HttpResponse.json({ error: 'Not found' }, { status: 404 })
  }),

  /**
   * 批量排序
   * POST /api/ai-link/sort
   */
  http.post(`${API_BASE}/ai-link/sort`, async ({ request }) => {
    const body = (await request.json()) as { items: SortItem[] }

    await delay(100)

    body.items.forEach((sortItem) => {
      const item = dataStore.items.find((i) => i.ai_link_id === sortItem.id)
      if (item) {
        item.sort = sortItem.sort
        item.group_id = sortItem.group_id
      }
    })

    return HttpResponse.json({ success: true })
  }),

  /**
   * 获取工具详情
   * GET /api/ai-link/detail/:id
   */
  http.get(`${API_BASE}/ai-link/detail/:id`, async ({ params }) => {
    const { id } = params

    await delay(50)

    const item = dataStore.items.find((i) => i.ai_link_id === id)
    if (item) {
      return HttpResponse.json({ data: item })
    }

    return HttpResponse.json({ error: 'Not found' }, { status: 404 })
  }),

  /**
   * 获取商店数据
   * GET /api/ai-link/store
   */
  http.get(`${API_BASE}/ai-link/store`, async () => {
    await delay(100)

    // 按分组组织商店数据
    const storeData = dataStore.groups.map((group) => ({
      group_id: group.group_id,
      group_name: group.group_name,
      links: dataStore.items.filter((item) => item.group_id === group.group_id),
    }))

    return HttpResponse.json({ data: storeData })
  }),

  /**
   * 获取分组列表
   * GET /api/group/list
   */
  http.get(`${API_BASE}/group/list`, async ({ request }) => {
    const url = new URL(request.url)
    const groupType = url.searchParams.get('group_type')

    await delay(50)

    // 这里可以根据 groupType 返回不同的分组
    // 当前简化处理，返回所有分组
    return HttpResponse.json(dataStore.groups)
  }),
]

/**
 * 错误场景 Handlers
 * 用于测试错误处理
 */
export const errorHandlers = {
  /**
   * 网络错误
   */
  networkError: http.get(`${API_BASE}/ai-link/list`, () => {
    return HttpResponse.error()
  }),

  /**
   * 服务器错误
   */
  serverError: http.get(`${API_BASE}/ai-link/list`, () => {
    return HttpResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }),

  /**
   * 认证错误
   */
  unauthorized: http.get(`${API_BASE}/ai-link/list`, () => {
    return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }),

  /**
   * 超时（延迟 30 秒）
   */
  timeout: http.get(`${API_BASE}/ai-link/list`, async () => {
    await delay(30000)
    return HttpResponse.json([])
  }),

  /**
   * 保存失败
   */
  saveError: http.post(`${API_BASE}/ai-link/save`, () => {
    return HttpResponse.json({ error: 'Save failed' }, { status: 400 })
  }),

  /**
   * 删除失败
   */
  deleteError: http.delete(`${API_BASE}/ai-link/delete`, () => {
    return HttpResponse.json({ error: 'Delete failed' }, { status: 400 })
  }),
}

export default toolboxHandlers
