import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PreviewModelSelector } from '@km/shared-business/agent-create'
import type { AgentPreviewModelOption } from '@km/shared-business/agent-create'

vi.mock('@km/shared-components-react', () => ({
  Dropdown: ({ children, menu }: any) => (
    <div>
      <div data-testid="trigger">{children}</div>
      <button data-testid="opt-fast" onClick={() => menu.onClick({ key: '10_1_gpt-4' })}>fast</button>
      <button data-testid="opt-deep" onClick={() => menu.onClick({ key: '11_1_deep' })}>deep</button>
    </div>
  ),
  SvgIcon: ({ name }: any) => <span data-testid={`icon-${name}`} />,
}))

const tMap: Record<string, string> = {
  'chat.fast_response': '快速回答',
  'chat.deep_thinking': '深度思考',
  'chat.select_model': '选择模型',
}

const t = (key: string) => tMap[key] ?? key

const options: AgentPreviewModelOption[] = [
  { id: '10_1_gpt-4', label: 'chat.fast_response', icon: 'lightning', channel_id: 10, channel_type: 1, model: 'gpt-4' },
  { id: '11_1_deep', label: 'chat.deep_thinking', icon: 'star-link', channel_id: 11, channel_type: 1, model: 'deep' },
]

describe('PreviewModelSelector', () => {
  it('renders null when options is empty', () => {
    const { container } = render(
      <PreviewModelSelector options={[]} selectedId="" onChange={() => {}} t={t} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders trigger with current selected label (translated via t)', () => {
    render(
      <PreviewModelSelector options={options} selectedId="11_1_deep" onChange={() => {}} t={t} />,
    )
    expect(screen.getByText('深度思考')).toBeTruthy()
    expect(screen.getByTestId('icon-star-link')).toBeTruthy()
  })

  it('falls back to label raw text when t is not provided', () => {
    render(
      <PreviewModelSelector options={options} selectedId="11_1_deep" onChange={() => {}} />,
    )
    expect(screen.getByText('chat.deep_thinking')).toBeTruthy()
  })

  it('calls onChange when menu item clicked', () => {
    const onChange = vi.fn()
    render(
      <PreviewModelSelector options={options} selectedId="10_1_gpt-4" onChange={onChange} t={t} />,
    )
    fireEvent.click(screen.getByTestId('opt-deep'))
    expect(onChange).toHaveBeenCalledWith('11_1_deep')
  })
})