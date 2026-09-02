import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { ConfigProvider } from 'antd'

// Mock the enterprise store before importing UseScope
const mockEnterpriseInfo = {
  is_independent: false,
  is_industry: false,
  is_enterprise: true,
}

vi.mock('@/stores', () => ({
  useEnterpriseStore: (selector?: any) => {
    const state = { info: mockEnterpriseInfo }
    return typeof selector === 'function' ? selector(state) : state
  },
}))

// Mock the DeptMemberPicker so we can assert on the props it receives
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

describe('UseScope (prompt)', () => {
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
    const picker = getByTestId('dept-member-picker')
    expect(picker.getAttribute('data-type')).toBe('scope')
  })

  it('passes value through to picker', () => {
    mockEnterpriseInfo.is_enterprise = true
    mockEnterpriseInfo.is_industry = false
    const scopes = [{ scope_type: 'group' as const, target_id: 5 }]
    renderWithAntd(<UseScope value={scopes} onChange={() => {}} />)
    const lastCall = mockDeptMemberPicker.mock.calls[mockDeptMemberPicker.mock.calls.length - 1][0]
    expect(lastCall.value).toEqual(scopes)
  })

  it('forwards onChange to picker', () => {
    mockEnterpriseInfo.is_enterprise = true
    mockEnterpriseInfo.is_industry = false
    const onChange = vi.fn()
    renderWithAntd(<UseScope value={[]} onChange={onChange} />)
    const lastCall = mockDeptMemberPicker.mock.calls[mockDeptMemberPicker.mock.calls.length - 1][0]
    expect(lastCall.onChange).toBe(onChange)
  })

  it('passes defaultFirstValue=true to picker when isNew=true', () => {
    mockEnterpriseInfo.is_enterprise = true
    mockEnterpriseInfo.is_industry = false
    renderWithAntd(<UseScope value={[]} onChange={() => {}} isNew={true} />)
    const lastCall = mockDeptMemberPicker.mock.calls[mockDeptMemberPicker.mock.calls.length - 1][0]
    expect(lastCall.defaultFirstValue).toBe(true)
  })

  it('passes defaultFirstValue=false to picker when isNew=false (regression: 编辑模式不允许 picker 强行补"全部成员")', () => {
    mockEnterpriseInfo.is_enterprise = true
    mockEnterpriseInfo.is_industry = false
    renderWithAntd(<UseScope value={[]} onChange={() => {}} isNew={false} />)
    const lastCall = mockDeptMemberPicker.mock.calls[mockDeptMemberPicker.mock.calls.length - 1][0]
    expect(lastCall.defaultFirstValue).toBe(false)
  })
})
