/**
 * 类型测试
 */
import { describe, it, expect } from 'vitest'
import type {
  SystemLogItem,
  SystemLogDisplayItem,
  ActionItem,
  ModuleItem,
  SystemLogListParams,
  SystemLogListResponse,
} from '../../types'

describe('System Log Types', () => {
  it('SystemLogItem 应包含必要字段', () => {
    const item: SystemLogItem = {
      id: 1,
      eid: 1,
      user_id: 1,
      nickname: '测试用户',
      module: 1,
      action: 1,
      content: '日志内容',
      ip: '127.0.0.1',
      action_time: Date.now(),
    }

    expect(item.id).toBeTypeOf('number')
    expect(item.nickname).toBeTypeOf('string')
    expect(item.action_time).toBeTypeOf('number')
  })

  it('SystemLogDisplayItem 应继承 SystemLogItem', () => {
    const displayItem: SystemLogDisplayItem = {
      id: 1,
      eid: 1,
      user_id: 1,
      nickname: '测试用户',
      module: 1,
      action: 1,
      content: '日志内容',
      ip: '127.0.0.1',
      action_time: '2024-01-01 12:00',
    }

    expect(displayItem.action_time).toBeTypeOf('string')
  })

  it('ActionItem 应包含 value 和 text', () => {
    const action: ActionItem = {
      value: 1,
      text: '登录',
    }

    expect(action.value).toBeTypeOf('number')
    expect(action.text).toBeTypeOf('string')
  })

  it('ModuleItem 应包含 value 和 text', () => {
    const module: ModuleItem = {
      value: 1,
      text: '用户管理',
    }

    expect(module.value).toBeTypeOf('number')
    expect(module.text).toBeTypeOf('string')
  })

  it('SystemLogListParams 应包含分页参数', () => {
    const params: SystemLogListParams = {
      offset: 0,
      limit: 10,
      user_id: null,
      start_time: null,
      end_time: null,
      module: undefined,
      action: undefined,
    }

    expect(params.offset).toBeTypeOf('number')
    expect(params.limit).toBeTypeOf('number')
  })

  it('SystemLogListResponse 应包含列表和总数', () => {
    const response: SystemLogListResponse = {
      system_logs: [],
      count: 0,
    }

    expect(Array.isArray(response.system_logs)).toBe(true)
    expect(response.count).toBeTypeOf('number')
  })
})
