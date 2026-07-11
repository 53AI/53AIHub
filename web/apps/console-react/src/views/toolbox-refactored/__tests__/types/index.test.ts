/**
 * 类型定义测试
 */
import { describe, it, expect } from 'vitest'
import type { AiLinkItem, GroupOption, SharedAccountItem, FilterForm } from '../../types'

describe('Types', () => {
  it('AiLinkItem 类型应该正确定义', () => {
    const item: AiLinkItem = {
      ai_link_id: '1',
      name: 'Test Tool',
      description: 'A test tool',
      logo: 'https://example.com/logo.png',
      url: 'https://example.com',
      group_id: 1,
      sort: 1,
    }

    expect(item.ai_link_id).toBe('1')
    expect(item.name).toBe('Test Tool')
  })

  it('GroupOption 类型应该正确定义', () => {
    const group: GroupOption = {
      group_id: 1,
      group_name: 'Test Group',
      children: [],
    }

    expect(group.group_id).toBe(1)
    expect(group.group_name).toBe('Test Group')
    expect(group.children).toEqual([])
  })

  it('SharedAccountItem 类型应该正确定义', () => {
    const account: SharedAccountItem = {
      account: 'user@example.com',
      password: 'password123',
      remark: 'Test account',
    }

    expect(account.account).toBe('user@example.com')
    expect(account.password).toBe('password123')
    expect(account.remark).toBe('Test account')
  })

  it('FilterForm 类型应该正确定义', () => {
    const filter: FilterForm = {
      group_id: [1, 2, 3],
      keyword: 'test',
    }

    expect(filter.group_id).toEqual([1, 2, 3])
    expect(filter.keyword).toBe('test')
  })
})
