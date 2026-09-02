import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { ConfigProvider } from 'antd'

// Mock the enterprise store
const mockEnterpriseInfo = {
  is_independent: false,
  is_industry: false,
  is_enterprise: true,
}

vi.mock('@/stores/modules/enterprise', () => ({
  useEnterpriseStore: (selector?: any) => {
    const state = { info: mockEnterpriseInfo }
    return typeof selector === 'function' ? selector(state) : state
  },
}))

const mockDeptMemberPicker = vi.fn((props: any) => {
  return <div data-testid="dept-member-picker" data-type={props.type} data-value={JSON.stringify(props.value)} />
})
vi.mock('@/components/DeptMemberPicker', () => ({
  DeptMemberPicker: (props: any) => mockDeptMemberPicker(props),
}))

vi.mock('@/locales', () => ({
  t: (k: string) => k,
}))

import { UseScope } from '../UseScope'

const renderWithAntd = (ui: React.ReactElement) => {
  return render(<ConfigProvider>{ui}</ConfigProvider>)
}

describe('UseScope (toolbox)', () => {
  beforeEach(() => {
    mockDeptMemberPicker.mockClear()
  })

  it('returns null when not in enterprise/industry mode', () => {
    mockEnterpriseInfo.is_enterprise = false
    mockEnterpriseInfo.is_industry = false
    const { queryByTestId } = renderWithAntd(<UseScope value={[]} onChange={() => {}} />)
    expect(queryByTestId('dept-member-picker')).toBeNull()
    mockEnterpriseInfo.is_enterprise = true
  })

  it('renders DeptMemberPicker with type="scope" when in enterprise mode', () => {
    mockEnterpriseInfo.is_enterprise = true
    mockEnterpriseInfo.is_industry = false
    const { getByTestId } = renderWithAntd(<UseScope value={[]} onChange={() => {}} />)
    expect(getByTestId('dept-member-picker').getAttribute('data-type')).toBe('scope')
  })

  it('passes scopes and onChange to picker', () => {
    mockEnterpriseInfo.is_enterprise = true
    mockEnterpriseInfo.is_industry = false
    const scopes = [{ scope_type: 'department' as const, target_id: 7 }]
    const onChange = vi.fn()
    renderWithAntd(<UseScope value={scopes} onChange={onChange} />)
    const lastCall = mockDeptMemberPicker.mock.calls[mockDeptMemberPicker.mock.calls.length - 1][0]
    expect(lastCall.value).toEqual(scopes)
    expect(lastCall.onChange).toBe(onChange)
  })
})
