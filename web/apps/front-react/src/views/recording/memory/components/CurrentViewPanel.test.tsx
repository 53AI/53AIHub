import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { RecordingCurrentViewResponse } from '@/api/modules/recording/types'
import { CurrentViewPanel } from './CurrentViewPanel'

const view: RecordingCurrentViewResponse = {
  entity: { id: 'entity-1', entity_type: 'person', canonical_name: '杨芳贤' },
  current_view: {
    current_status: { state: 'resolved', support: 'explicit', value: '正在推进珠江钢琴项目' },
    current_position: { state: 'resolved', support: 'explicit', value: '先验证，再投入' },
    current_demands: { state: 'resolved', support: 'explicit', items: [{ id: 'demand-1', kind: 'demand', content: '需要明确客户预算与交付边界', source_type: 'automatic', evidence_refs: [{ source_file: '会议-03.md', source_segments: ['seg-8'] }] }] },
    current_risks: { state: 'resolved', support: 'explicit', items: [{ id: 'risk-1', kind: 'risk', content: '客户预算冻结', status: 'active', source_type: 'automatic', evidence_refs: [{ source_file: '会议-03.md', source_segments: ['seg-12'] }] }], uncertain_items: [{ id: 'risk-2', kind: 'risk', content: '交付资源不足', status: 'uncertain' }] },
    current_opportunities: { state: 'unknown', support: 'degraded' },
    open_loops: { state: 'resolved', support: 'explicit', items: [{ id: 'loop-1', kind: 'commitment', content: '确认试点方案', status: 'overdue' }] },
    recent_updates: { state: 'resolved', support: 'explicit', items: [{ id: 'update-1', kind: 'status', content: '客户预算在最近会议中被再次提及' }] },
    recent_changes: { state: 'resolved', support: 'explicit', items: [{ id: 'change-1', kind: 'status', content: '开放 → 完成' }] },
    evidence_refs: [],
  },
  conflicts: [],
  compiled_at: '2026-08-30T03:00:00Z',
}

describe('CurrentViewPanel', () => {
  it('按 facet 状态展示当前理解、风险和未闭环事项', () => {
    render(<CurrentViewPanel view={view} />)
    expect(screen.getByText('当前最佳理解')).toBeInTheDocument()
    expect(screen.getByText('正在推进珠江钢琴项目')).toBeInTheDocument()
    expect(screen.getByText('客户预算冻结')).toBeInTheDocument()
    expect(screen.getByText('交付资源不足')).toBeInTheDocument()
    expect(screen.getByText('已逾期')).toBeInTheDocument()
  })

  it('展开条目时能看到来源文件和片段', async () => {
    const user = userEvent.setup()
    render(<CurrentViewPanel view={view} />)
    await user.click(screen.getAllByText('查看证据（1）')[0])
    expect(screen.getByText('片段：seg-12')).toBeInTheDocument()
  })

  it('接口失败时明确提示，不伪装成空的已解决状态', () => {
    render(<CurrentViewPanel view={null} error="无权查看当前理解" />)
    expect(screen.getByText('当前理解暂时不可用')).toBeInTheDocument()
    expect(screen.queryByText('暂无已确认的当前风险')).not.toBeInTheDocument()
  })

  it('冲突时展示候选值和来源，不静默选一条', async () => {
    const user = userEvent.setup()
    render(<CurrentViewPanel view={{ ...view, conflicts: [{ facet: 'current_status', reason: '最近会议出现了不同状态', candidates: [{ id: 'c-1', kind: 'status', content: '项目进行中', source_type: 'user_confirmed_context', evidence_refs: [{ source_file: '确认记录.md', source_segments: ['s-1'] }] }] }] }} />)
    expect(screen.getByText('最近会议出现了不同状态')).toBeInTheDocument()
    expect(screen.getByText('项目进行中')).toBeInTheDocument()
    expect(screen.getByText('你已确认')).toBeInTheDocument()
    const evidenceSummaries = screen.getAllByText('查看证据（1）')
    await user.click(evidenceSummaries[evidenceSummaries.length - 1])
    expect(screen.getByText('片段：s-1')).toBeInTheDocument()
  })

  it('unsupported facet 显示能力边界', () => {
    render(<CurrentViewPanel view={{ ...view, current_view: { ...view.current_view, current_status: { state: 'unknown', support: 'unsupported' } } }} />)
    expect(screen.getByText('当前版本暂不支持该信息类型')).toBeInTheDocument()
  })
})
