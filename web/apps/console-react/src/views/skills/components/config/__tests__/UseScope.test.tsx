import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
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

// Mock locales
vi.mock('@/locales', () => ({
  t: (k: string) => k,
}))

import { UseScope } from '../UseScope'

const renderWithAntd = (ui: React.ReactElement) => {
  return render(<ConfigProvider>{ui}</ConfigProvider>)
}

describe('UseScope (skills)', () => {
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

  it('applies default company scope when isNew=true and value is empty', async () => {
    mockEnterpriseInfo.is_enterprise = true
    mockEnterpriseInfo.is_industry = false
    const onChange = vi.fn()
    renderWithAntd(<UseScope value={[]} onChange={onChange} isNew={true} />)
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([
        { scope_type: 'company', target_id: 0 },
      ])
    })
  })

  it('does not apply default when value is non-empty', async () => {
    mockEnterpriseInfo.is_enterprise = true
    mockEnterpriseInfo.is_industry = false
    const onChange = vi.fn()
    renderWithAntd(
      <UseScope
        value={[{ scope_type: 'group', target_id: 1 }]}
        onChange={onChange}
        isNew={true}
      />,
    )
    // wait a tick to ensure effect has run
    await new Promise((r) => setTimeout(r, 50))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not apply default when isNew=false', async () => {
    mockEnterpriseInfo.is_enterprise = true
    mockEnterpriseInfo.is_industry = false
    const onChange = vi.fn()
    renderWithAntd(<UseScope value={[]} onChange={onChange} isNew={false} />)
    await new Promise((r) => setTimeout(r, 50))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('passes defaultFirstValue=true to picker when isNew=true', () => {
    mockEnterpriseInfo.is_enterprise = true
    mockEnterpriseInfo.is_industry = false
    renderWithAntd(<UseScope value={[]} onChange={() => {}} isNew={true} />)
    const lastCall = mockDeptMemberPicker.mock.calls[mockDeptMemberPicker.mock.calls.length - 1][0]
    expect(lastCall.defaultFirstValue).toBe(true)
  })

  it('passes defaultFirstValue=false to picker when isNew=false (regression: 编辑模式不允许 picker 强行补"全公司")', () => {
    mockEnterpriseInfo.is_enterprise = true
    mockEnterpriseInfo.is_industry = false
    renderWithAntd(<UseScope value={[]} onChange={() => {}} isNew={false} />)
    const lastCall = mockDeptMemberPicker.mock.calls[mockDeptMemberPicker.mock.calls.length - 1][0]
    expect(lastCall.defaultFirstValue).toBe(false)
  })
})
