import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import UserFilter from './user'

vi.mock('@/components/DeptMemberPicker', () => ({
  default: ({
    trigger,
    value,
    onChange,
    type,
  }: {
    trigger: ReactNode
    value: { label: string }[]
    onChange: (value: { uid: string; user_id: number; value: number; label: string }[]) => void
    type: string
  }) => (
    <div data-testid="picker" data-type={type}>
      {trigger}
      <button
        type="button"
        onClick={() => onChange([{ uid: 'ccuasQ', user_id: 23, value: 23, label: '刘备' }])}
      >
        mock-select-user
      </button>
    </div>
  ),
}))

describe('UserFilter', () => {
  it('uses a custom trigger and updates its label when selected or reset', () => {
    const { rerender } = render(
      <UserFilter
        emptyLabel="全部"
        renderTrigger={(label) => <button type="button">提问人:{label}</button>}
        type="user"
        resetKey={0}
      />,
    )

    expect(screen.getByRole('button', { name: '提问人:全部' })).toBeInTheDocument()
    expect(screen.getByTestId('picker')).toHaveAttribute('data-type', 'user')

    fireEvent.click(screen.getByRole('button', { name: 'mock-select-user' }))
    expect(screen.getByRole('button', { name: '提问人:刘备' })).toBeInTheDocument()

    rerender(
      <UserFilter
        emptyLabel="全部"
        renderTrigger={(label) => <button type="button">提问人:{label}</button>}
        type="user"
        resetKey={1}
      />,
    )
    expect(screen.getByRole('button', { name: '提问人:全部' })).toBeInTheDocument()
    expect(screen.queryByText('刘备')).not.toBeInTheDocument()
  })
})
