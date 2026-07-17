import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  PreviewKnowledgeSourceSelector,
  type PreviewKnowledgeSourceState,
} from '@km/shared-business/agent-create'

vi.mock('@km/shared-components-react', () => ({
  Dropdown: ({ children, menu }: any) => (
    <div>
      <div data-testid="trigger">{children}</div>
      {/* Render one opt button per menu item so we can simulate clicks for the actual set */}
      {(menu?.items || []).map((it: any) => (
        <button
          key={it.key}
          data-testid={`opt-${it.key}`}
          onClick={() => menu.onClick?.({ key: it.key })}
        >
          {String(it.key)}
        </button>
      ))}
    </div>
  ),
  SvgIcon: ({ name }: any) => <span data-testid={`icon-${name}`} />,
}))

const tMap: Record<string, string> = {
  'library.all_knowledge': '全部知识',
  'chat.knowledge_graph': '知识图谱',
  'chat.online_search': '联网搜索',
}
const t = (key: string) => tMap[key] ?? key

const initialAll: PreviewKnowledgeSourceState = { mode: 'all' }

describe('PreviewKnowledgeSourceSelector', () => {
  it('renders trigger showing current mode label', () => {
    render(
      <PreviewKnowledgeSourceSelector
        value={initialAll}
        onChange={() => {}}
        graphEnabled
        webSearchEnabled
        t={t}
      />,
    )
    expect(screen.getByText('全部知识')).toBeTruthy()
    expect(screen.getByTestId('icon-documents')).toBeTruthy()
  })

  it('only renders "all" item when both graph and web search are disabled', () => {
    const onChange = vi.fn()
    render(
      <PreviewKnowledgeSourceSelector
        value={initialAll}
        onChange={onChange}
        graphEnabled={false}
        webSearchEnabled={false}
        t={t}
      />,
    )
    expect(screen.getByTestId('opt-all')).toBeTruthy()
    expect(screen.queryByTestId('opt-knowledgeGraph')).toBeNull()
    expect(screen.queryByTestId('opt-networkSearch')).toBeNull()
  })

  it('renders graph and network items when enabled', () => {
    render(
      <PreviewKnowledgeSourceSelector
        value={initialAll}
        onChange={() => {}}
        graphEnabled
        webSearchEnabled
        t={t}
      />,
    )
    expect(screen.getByTestId('opt-all')).toBeTruthy()
    expect(screen.getByTestId('opt-knowledgeGraph')).toBeTruthy()
    expect(screen.getByTestId('opt-networkSearch')).toBeTruthy()
  })

  it('clicking an item calls onChange with the new mode', () => {
    const onChange = vi.fn()
    render(
      <PreviewKnowledgeSourceSelector
        value={initialAll}
        onChange={onChange}
        graphEnabled
        webSearchEnabled
        t={t}
      />,
    )
    fireEvent.click(screen.getByTestId('opt-networkSearch'))
    expect(onChange).toHaveBeenCalledWith({ mode: 'networkSearch' })
  })

  it('clicking the currently active item is a no-op', () => {
    const onChange = vi.fn()
    render(
      <PreviewKnowledgeSourceSelector
        value={{ mode: 'knowledgeGraph' }}
        onChange={onChange}
        graphEnabled
        webSearchEnabled
        t={t}
      />,
    )
    fireEvent.click(screen.getByTestId('opt-knowledgeGraph'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('falls back to label raw text when t is not provided', () => {
    render(
      <PreviewKnowledgeSourceSelector
        value={initialAll}
        onChange={() => {}}
        graphEnabled={false}
        webSearchEnabled={false}
      />,
    )
    expect(screen.getByText('library.all_knowledge')).toBeTruthy()
  })

  it('trigger reflects current mode', () => {
    const { rerender } = render(
      <PreviewKnowledgeSourceSelector
        value={initialAll}
        onChange={() => {}}
        graphEnabled
        webSearchEnabled
        t={t}
      />,
    )
    expect(screen.getByTestId('icon-documents')).toBeTruthy()

    rerender(
      <PreviewKnowledgeSourceSelector
        value={{ mode: 'knowledgeGraph' }}
        onChange={() => {}}
        graphEnabled
        webSearchEnabled
        t={t}
      />,
    )
    expect(screen.getByTestId('icon-graph_v2')).toBeTruthy()
    expect(screen.getByText('知识图谱')).toBeTruthy()

    rerender(
      <PreviewKnowledgeSourceSelector
        value={{ mode: 'networkSearch' }}
        onChange={() => {}}
        graphEnabled
        webSearchEnabled
        t={t}
      />,
    )
    expect(screen.getByTestId('icon-network')).toBeTruthy()
    expect(screen.getByText('联网搜索')).toBeTruthy()
  })
})