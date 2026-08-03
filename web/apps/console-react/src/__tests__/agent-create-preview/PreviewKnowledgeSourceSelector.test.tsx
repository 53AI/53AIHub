import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PreviewKnowledgeSourceSelector } from '@km/shared-business/agent-create'

vi.mock('@km/shared-components-react', () => ({
  Dropdown: ({ children, menu }: any) => (
    <div>
      <div data-testid="trigger">{children}</div>
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
  'chat.wiki': '动态知识',
}
const t = (key: string) => tMap[key] ?? key

const makeKnowledgeSource = (overrides = {}) => ({
  state: { networkSearch: false, knowledgeGraph: false, wiki: false, ...overrides },
  graphEnabled: true,
  webSearchEnabled: true,
  wikiEnabled: true,
})

describe('PreviewKnowledgeSourceSelector', () => {
  it('renders trigger showing "全部知识" when all modes are off', () => {
    render(
      <PreviewKnowledgeSourceSelector
        knowledgeSource={makeKnowledgeSource()}
        onKnowledgeSourceChange={() => {}}
        t={t}
      />,
    )
    expect(screen.getByText('全部知识')).toBeTruthy()
    expect(screen.getByTestId('icon-documents')).toBeTruthy()
  })

  it('only renders "all" item when all feature flags are disabled', () => {
    render(
      <PreviewKnowledgeSourceSelector
        knowledgeSource={{ state: { networkSearch: false, knowledgeGraph: false, wiki: false }, graphEnabled: false, webSearchEnabled: false, wikiEnabled: false }}
        onKnowledgeSourceChange={() => {}}
        t={t}
      />,
    )
    expect(screen.getByTestId('opt-all')).toBeTruthy()
    expect(screen.queryByTestId('opt-knowledgeGraph')).toBeNull()
    expect(screen.queryByTestId('opt-networkSearch')).toBeNull()
    expect(screen.queryByTestId('opt-wiki')).toBeNull()
  })

  it('renders graph and network items when enabled', () => {
    render(
      <PreviewKnowledgeSourceSelector
        knowledgeSource={makeKnowledgeSource()}
        onKnowledgeSourceChange={() => {}}
        t={t}
      />,
    )
    expect(screen.getByTestId('opt-all')).toBeTruthy()
    expect(screen.getByTestId('opt-knowledgeGraph')).toBeTruthy()
    expect(screen.getByTestId('opt-networkSearch')).toBeTruthy()
    expect(screen.getByTestId('opt-wiki')).toBeTruthy()
  })

  it('clicking allKnowledge toggles allKnowledge state', () => {
    const onChange = vi.fn()
    render(
      <PreviewKnowledgeSourceSelector
        knowledgeSource={makeKnowledgeSource({ knowledgeGraph: true, wiki: true, allKnowledge: true })}
        onKnowledgeSourceChange={onChange}
        t={t}
      />,
    )
    fireEvent.click(screen.getByTestId('opt-all'))
    // 点击 all 切换 allKnowledge 状态，从 true 变为 false
    expect(onChange).toHaveBeenCalledWith({ networkSearch: false, knowledgeGraph: true, wiki: true, allKnowledge: false })
  })

  it('clicking networkSearch toggles it (互斥 only)', () => {
    const onChange = vi.fn()
    render(
      <PreviewKnowledgeSourceSelector
        knowledgeSource={makeKnowledgeSource({ knowledgeGraph: true })}
        onKnowledgeSourceChange={onChange}
        t={t}
      />,
    )
    fireEvent.click(screen.getByTestId('opt-networkSearch'))
    expect(onChange).toHaveBeenCalledWith({ networkSearch: true, knowledgeGraph: false, wiki: false, allKnowledge: false })
  })

  it('clicking knowledgeGraph toggles it without affecting wiki', () => {
    const onChange = vi.fn()
    render(
      <PreviewKnowledgeSourceSelector
        knowledgeSource={makeKnowledgeSource({ wiki: true })}
        onKnowledgeSourceChange={onChange}
        t={t}
      />,
    )
    fireEvent.click(screen.getByTestId('opt-knowledgeGraph'))
    expect(onChange).toHaveBeenCalledWith({ networkSearch: false, knowledgeGraph: true, wiki: true })
  })

  it('clicking wiki toggles it without affecting knowledgeGraph', () => {
    const onChange = vi.fn()
    render(
      <PreviewKnowledgeSourceSelector
        knowledgeSource={makeKnowledgeSource({ knowledgeGraph: true })}
        onKnowledgeSourceChange={onChange}
        t={t}
      />,
    )
    fireEvent.click(screen.getByTestId('opt-wiki'))
    expect(onChange).toHaveBeenCalledWith({ networkSearch: false, knowledgeGraph: true, wiki: true })
  })

  it('trigger reflects networkSearch priority', () => {
    const { rerender } = render(
      <PreviewKnowledgeSourceSelector
        knowledgeSource={makeKnowledgeSource()}
        onKnowledgeSourceChange={() => {}}
        t={t}
      />,
    )
    expect(screen.getByTestId('icon-documents')).toBeTruthy()

    rerender(
      <PreviewKnowledgeSourceSelector
        knowledgeSource={makeKnowledgeSource({ networkSearch: true })}
        onKnowledgeSourceChange={() => {}}
        t={t}
      />,
    )
    expect(screen.getByTestId('icon-network')).toBeTruthy()
    expect(screen.getByText('联网搜索')).toBeTruthy()
  })

  it('trigger reflects wiki priority (below networkSearch)', () => {
    const { rerender } = render(
      <PreviewKnowledgeSourceSelector
        knowledgeSource={makeKnowledgeSource({ wiki: true })}
        onKnowledgeSourceChange={() => {}}
        t={t}
      />,
    )
    expect(screen.getByTestId('icon-book-one')).toBeTruthy()
    expect(screen.getByText('动态知识')).toBeTruthy()

    rerender(
      <PreviewKnowledgeSourceSelector
        knowledgeSource={makeKnowledgeSource({ wiki: true, networkSearch: true })}
        onKnowledgeSourceChange={() => {}}
        t={t}
      />,
    )
    // networkSearch should take priority
    expect(screen.getByTestId('icon-network')).toBeTruthy()
  })

  it('falls back to label raw text when t is not provided', () => {
    render(
      <PreviewKnowledgeSourceSelector
        knowledgeSource={makeKnowledgeSource()}
        onKnowledgeSourceChange={() => {}}
      />,
    )
    expect(screen.getByText('library.all_knowledge')).toBeTruthy()
  })
})