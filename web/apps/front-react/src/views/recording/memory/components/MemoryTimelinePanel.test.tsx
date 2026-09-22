import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { RecordingMemoryTimeline } from '@/api/modules/recording/types'
import { MemoryTimelinePanel } from './MemoryTimelinePanel'

const timeline: RecordingMemoryTimeline = {
  entity: { id: 'entity-1', entity_type: 'matter', canonical_name: '珠江钢琴项目' },
  items: [
    {
      id: 'claim-2',
      timestamp: 1756500000000,
      entity: { id: 'entity-1', entity_type: 'matter', canonical_name: '珠江钢琴项目' },
      record_type: 'claim',
      claim_kind: 'risk',
      event_type: 'risk',
      content: '客户预算冻结',
      source_file: '会议-03.md',
      source_segments: ['seg-12'],
      source_type: 'meeting',
      confidence: 0.92,
      current_validity: 'active',
      evidence_refs: [{ source_file: '会议-03.md', source_segments: ['seg-12'] }],
    },
    {
      id: 'fact-1',
      timestamp: 1756400000000,
      entity: { id: 'entity-1', entity_type: 'matter', canonical_name: '珠江钢琴项目' },
      record_type: 'fact',
      fact_kind: 'status',
      event_type: 'status',
      content: '项目暂缓',
      previous_value: '进行中',
      new_value: '暂缓',
      current_validity: 'compiler_replaced',
      status: 'fulfilled',
    },
  ],
  total: 3,
  offset: 0,
  limit: 2,
  has_more: true,
  compiled_at: '2026-08-30T03:00:00Z',
}

describe('MemoryTimelinePanel', () => {
  it('展示事实/判断、变化和分页状态', () => {
    render(<MemoryTimelinePanel timeline={timeline} />)
    expect(screen.getByText('共 3 条历史记录')).toBeInTheDocument()
    expect(screen.getByText('客户预算冻结')).toBeInTheDocument()
    expect(screen.getByText('事实')).toBeInTheDocument()
    expect(screen.getByText('已被新记录替换')).toBeInTheDocument()
    expect(screen.getByText('进行中')).toBeInTheDocument()
    expect(screen.getByText('已完成')).toBeInTheDocument()
  })

  it('点击加载更早记录回调并可展开证据', async () => {
    const user = userEvent.setup()
    const onLoadMore = vi.fn()
    render(<MemoryTimelinePanel timeline={timeline} onLoadMore={onLoadMore} />)
    await user.click(screen.getByRole('button', { name: '加载更早记录' }))
    expect(onLoadMore).toHaveBeenCalledTimes(1)
    await user.click(screen.getByText('查看来源与证据'))
    expect(screen.getByText('片段：seg-12')).toBeInTheDocument()
  })

  it('接口失败时不显示历史为空', () => {
    render(<MemoryTimelinePanel timeline={null} error="实体不存在" />)
    expect(screen.getByText('历史时间线暂时不可用')).toBeInTheDocument()
    expect(screen.queryByText('暂无历史记录')).not.toBeInTheDocument()
  })
})
