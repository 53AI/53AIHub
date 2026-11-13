import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AskerFilter from './Asker'

vi.mock('@/locales', () => ({
  t: (key: string) => ({ 'search-record.user': '提问人', 'search-record.all': '全部' })[key] || key,
}))
vi.mock('@/components/Filter/user', () => ({
  default: ({
    emptyLabel,
    renderTrigger,
    resetKey,
    type,
    onChange,
  }: {
    renderTrigger: (label: string) => ReactNode
    emptyLabel: string
    resetKey: number
    type: string
    onChange: (value: { uid: string; user_id: number; value: number; label: string }[]) => void
  }) => (
    <div>
      {renderTrigger(emptyLabel)}
      <span data-testid="user-filter-config">{`${type}:${resetKey}`}</span>
      <button
        type="button"
        onClick={() => onChange([{ uid: 'ccuasQ', user_id: 23, value: 23, label: '刘备' }])}
      >
        mock-select-user
      </button>
    </div>
  ),
}))

describe('AskerFilter', () => {
  it('uses the shared user filter with the asker prefix and reset key', () => {
    render(<AskerFilter onChange={vi.fn()} />)

    expect(screen.getByText('提问人:')).toBeInTheDocument()
    expect(screen.getByText('全部')).toBeInTheDocument()
    expect(document.querySelector('.ant-select')).toBeInTheDocument()
    expect(screen.getByTestId('user-filter-config')).toHaveTextContent('user:0')
  })

  it('emits the selected user HashID and resets its label when cleared', () => {
    const onChange = vi.fn()
    const { rerender } = render(<AskerFilter clearKey={0} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'mock-select-user' }))

    expect(onChange).toHaveBeenCalledWith('ccuasQ')

    rerender(<AskerFilter clearKey={1} onChange={onChange} />)
    expect(screen.getByTestId('user-filter-config')).toHaveTextContent('user:1')
  })
})
