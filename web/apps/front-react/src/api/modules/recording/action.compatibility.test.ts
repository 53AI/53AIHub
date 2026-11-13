import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get, post } from '../../config'
import {
  findActionPlanByOpportunity,
  isActionOpportunityDismissed,
  selectActionPlan,
  listActionItems,
  getActionItem,
  confirmActionPlan,
} from './action'
import type { ActionOpportunity, ActionPlan } from './action'

vi.mock('../../index', () => ({ default: {} }))
vi.mock('../../config', () => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }))
vi.mock('../../errorHandler', () => ({
  handleError: (error: unknown) => Promise.reject(error),
}))

const mockGet = vi.mocked(get)
const mockPost = vi.mocked(post)

function plan(id: string, opportunityId: string, status: ActionPlan['status'] = 'confirmed'): ActionPlan {
  return { plan_id: id, opportunity_id: opportunityId, status } as ActionPlan
}

describe('会议洞察 Web 行动兼容', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockPost.mockReset()
  })

  it('来源筛选与主阶段合并使用同一分页接口', async () => {
    const page = { items: [{ item_id: 'op-1', stage: 'action' }], total: 1, page: 1, page_size: 20, counts: { proposal: 0, action: 1, result: 0, trash: 0 } }
    mockGet.mockResolvedValueOnce(page)
    expect(await listActionItems({ insight_id: 'insight-1', stage: 'action', page: 1, page_size: 20 })).toEqual(page)
    expect(mockGet).toHaveBeenCalledWith('/api/actions/items', { params: { insight_id: 'insight-1', stage: 'action', page: 1, page_size: 20 } })
  })

  it('录音文件 ID 使用专用来源筛选，不与规范洞察 ID 混用', async () => {
    mockGet.mockResolvedValueOnce({ items: [], total: 0, page: 1, page_size: 20, counts: { proposal: 0, action: 0, result: 0, trash: 0 } })
    await listActionItems({ recording_file_id: 'recording-hashid', stage: 'all', page: 1, page_size: 20 })
    expect(mockGet).toHaveBeenCalledWith('/api/actions/items', {
      params: { recording_file_id: 'recording-hashid', stage: 'all', page: 1, page_size: 20 },
    })
  })

  it('批准计划时传递用户补充信息，后端原接口保持不变', async () => {
    mockPost.mockResolvedValueOnce({ run: { run_id: 'r1' } })
    await confirmActionPlan('plan1', '  请核验预算  ')
    expect(mockPost).toHaveBeenCalledWith('/api/recordings/action-plans/plan1/confirm', {
      supplemental_info: '请核验预算',
    })
  })

  it('不同业务阶段始终通过相同 item_id 打开详情', async () => {
    mockGet.mockResolvedValueOnce({ item_id: 'op-1', stage: 'result', title: '项目推进研究' })
    const item = await getActionItem('op-1')
    expect(item.stage).toBe('result')
    expect(mockGet).toHaveBeenCalledWith('/api/actions/items/op-1')
  })

  it('同时识别旧 dismissed 和新版回收站标记', () => {
    expect(isActionOpportunityDismissed({ status: 'dismissed' } as ActionOpportunity)).toBe(true)
    expect(isActionOpportunityDismissed({ status: 'candidate', is_trashed: true } as ActionOpportunity)).toBe(true)
    expect(isActionOpportunityDismissed({ status: 'candidate', is_trashed: false } as ActionOpportunity)).toBe(false)
  })

  it('优先非 superseded 计划，不把回收站计划当成有效计划', () => {
    const hidden = { ...plan('trash', 'a'), is_trashed: true }
    expect(selectActionPlan([hidden, plan('old', 'a', 'superseded'), plan('current', 'a')])?.plan_id).toBe('current')
    expect(selectActionPlan([hidden])).toBeNull()
  })

  it('老接口列表中能定位有效计划时不访问新接口', async () => {
    mockGet.mockResolvedValueOnce([plan('match', 'target')])
    const result = await findActionPlanByOpportunity('target')
    expect(result?.plan_id).toBe('match')
    expect(mockGet).toHaveBeenCalledTimes(1)
  })

  it('新版默认列表隐藏已完成计划时继续分页寻找历史计划', async () => {
    mockGet
      .mockResolvedValueOnce([plan('other', 'another')])
      .mockResolvedValueOnce({ items: Array.from({ length: 100 }, (_, n) => plan(`p${n}`, 'another')), total: 101 })
      .mockResolvedValueOnce({ items: [plan('completed', 'target')], total: 101 })
    const result = await findActionPlanByOpportunity('target')
    expect(result?.plan_id).toBe('completed')
    expect(mockGet).toHaveBeenCalledTimes(3)
    expect(mockGet).toHaveBeenNthCalledWith(3, '/api/actions/plans', {
      params: { status: 'all_with_trash', page: 2, page_size: 100 },
    })
  })

  it('存在过时计划时优先查找已完成的最新计划', async () => {
    mockGet.mockResolvedValueOnce([plan('superseded', 'target', 'superseded')])
      .mockResolvedValueOnce({ items: [plan('completed', 'target')], total: 1 })
    expect((await findActionPlanByOpportunity('target'))?.plan_id).toBe('completed')
  })

  it('兼容旧服务对筛选参数仍返回数组', async () => {
    mockGet.mockResolvedValueOnce([]).mockResolvedValueOnce([plan('legacy', 'target')])
    expect((await findActionPlanByOpportunity('target'))?.plan_id).toBe('legacy')
  })

  it('旧服务不支持扩展查询时退回未找到，避免误创建计划', async () => {
    mockGet.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('not found'))
    expect(await findActionPlanByOpportunity('target')).toBeNull()
  })
})
