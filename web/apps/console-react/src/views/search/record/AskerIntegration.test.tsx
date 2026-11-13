import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { forwardRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Record } from './Record'
import WorkAIStatistic from '@/views/agent/create-v2/components/Statistic'
import KnowledgeMapStatistic from '@/views/assistant/map/Statistic'

const mocks = vi.hoisted(() => ({
  getMessageList: vi.fn(),
  getMessageStats: vi.fn(),
  getKnowledgeMapStats: vi.fn(),
  fetchInternalUsers: vi.fn(),
}))

vi.mock('@/locales', () => ({
  t: (key: string, params?: Record<string, unknown>) => {
    const templates: Record<string, string> = {
      'search-record.api_user': 'API用户（{visitor}）',
    }
    const template = templates[key] ?? key
    return params
      ? template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''))
      : template
  },
}))
vi.mock('@/api/modules/record', () => ({
  default: {
    getMessageList: mocks.getMessageList,
    getMessageStats: mocks.getMessageStats,
    getKnowledgeMapStats: mocks.getKnowledgeMapStats,
  },
}))
vi.mock('@/api/modules/record/index', () => ({
  default: {
    getMessageList: mocks.getMessageList,
    getMessageStats: mocks.getMessageStats,
    getKnowledgeMapStats: mocks.getKnowledgeMapStats,
  },
}))
vi.mock('@/api/modules/user', () => {
  const userApi = { fetch_internal_user: mocks.fetchInternalUsers }
  return { default: userApi, userApi }
})
vi.mock('@/components/Filter/Asker', () => ({
  default: ({ onChange }: { onChange: (uid: string | null) => void }) => (
    <button type="button" onClick={() => onChange('ccuasQ')}>
      mock-select-asker
    </button>
  ),
}))
vi.mock('@/components/Filter/date-range', () => ({
  DateRangeFilter: () => null,
  default: () => null,
}))
vi.mock('@km/shared-components-react', () => ({
  SvgIcon: ({ name }: { name: string }) => (name === 'clear' ? <span>clear</span> : null),
  Search: () => <input aria-label="mock-search" />,
  IconAction: () => null,
}))
vi.mock('@/views/search/components/detail', () => ({
  default: forwardRef(() => null),
}))

describe('asker filtering across Agent record pages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getMessageList.mockResolvedValue({ messages: [], total: 0 })
    mocks.getMessageStats.mockResolvedValue({
      total_questions: 0,
      no_search_results: 0,
      quick_answers: 0,
      deep_thinking: 0,
      conversations: 0,
      total_tokens: 0,
      avg_duration_ms: 0,
    })
    mocks.getKnowledgeMapStats.mockResolvedValue({ generate_count: 0, query_count: 0 })
    mocks.fetchInternalUsers.mockResolvedValue({ list: [] })
  })

  it.each([
    ['shared search record page', <Record agentId="agent-a" />],
    ['Agent workbench statistics', <WorkAIStatistic agentId="agent-a" />],
    ['knowledge-map statistics', <KnowledgeMapStatistic agentId="agent-a" />],
  ])('%s immediately sends the selected UID', async (_name, page) => {
    render(page)
    await screen.findByRole('button', { name: 'mock-select-asker' })

    fireEvent.click(screen.getByRole('button', { name: 'mock-select-asker' }))

    await waitFor(() => {
      expect(mocks.getMessageList).toHaveBeenLastCalledWith(
        expect.objectContaining({ uid: 'ccuasQ' }),
      )
    })
  })

  it.each([
    ['shared search record page', <Record agentId="agent-a" />],
    ['Agent workbench statistics', <WorkAIStatistic agentId="agent-a" />],
    ['knowledge-map statistics', <KnowledgeMapStatistic agentId="agent-a" />],
  ])('%s places asker filtering after search', async (_name, page) => {
    render(page)

    const search = await screen.findByRole('textbox', { name: 'mock-search' })
    const asker = screen.getByRole('button', { name: 'mock-select-asker' })
    expect(search.compareDocumentPosition(asker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it.each([
    ['shared search record page', <Record agentId="agent-a" />],
    ['Agent workbench statistics', <WorkAIStatistic agentId="agent-a" />],
    ['knowledge-map statistics', <KnowledgeMapStatistic agentId="agent-a" />],
  ])('%s shows the API visitor id when the asker has no internal nickname', async (_name, page) => {
    mocks.getMessageList.mockResolvedValue({
      messages: [
        {
          id: 'msg-1',
          user_id: 3194,
          visitor_id: 'api_1432',
          request_source: 'api',
          original_question: 'hello',
          updated_time: 0,
        },
      ],
      total: 1,
    })

    render(page)

    expect(await screen.findByText('API用户（api_1432）')).toBeInTheDocument()
  })

  it('clearing the shared record page reloads without a selected UID', async () => {
    render(<Record agentId="agent-a" />)
    await screen.findByRole('button', { name: 'mock-select-asker' })
    fireEvent.click(screen.getByRole('button', { name: 'mock-select-asker' }))

    await waitFor(() => {
      expect(mocks.getMessageList).toHaveBeenLastCalledWith(
        expect.objectContaining({ uid: 'ccuasQ' }),
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'clear' }))

    await waitFor(() => {
      expect(mocks.getMessageList).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ uid: 'ccuasQ' }),
      )
    })
  })
})
