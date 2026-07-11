import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SkillEnvVarsDrawer from './SkillEnvVarsDrawer'

const mocks = vi.hoisted(() => ({
  getDetail: vi.fn(),
  getMyEnvVars: vi.fn(),
  createMyEnvVar: vi.fn(),
  updateMyEnvVar: vi.fn(),
  deleteMyEnvVar: vi.fn(),
}))

vi.mock('@/api/modules/skill', () => ({
  default: {
    getDetail: mocks.getDetail,
    getMyEnvVars: mocks.getMyEnvVars,
    createMyEnvVar: mocks.createMyEnvVar,
    updateMyEnvVar: mocks.updateMyEnvVar,
    deleteMyEnvVar: mocks.deleteMyEnvVar,
  },
}))

beforeEach(() => {
  mocks.getDetail.mockReset()
  mocks.getMyEnvVars.mockReset()
  mocks.createMyEnvVar.mockReset()
  mocks.updateMyEnvVar.mockReset()
  mocks.deleteMyEnvVar.mockReset()

  mocks.getDetail.mockResolvedValue({
    env_vars: [
      { key: 'API_KEY', sensitive: true },
      { key: 'TIMEOUT', sensitive: false },
    ],
  })
  mocks.getMyEnvVars.mockResolvedValue([])
  mocks.createMyEnvVar.mockResolvedValue({
    id: 'env-1',
    key: 'API_KEY',
    value: 'secret-value',
    sensitive: true,
  })
  mocks.updateMyEnvVar.mockResolvedValue({
    id: 'env-1',
    key: 'API_KEY',
    value: 'secret-value',
    sensitive: true,
  })
  mocks.deleteMyEnvVar.mockResolvedValue(undefined)
})

describe('SkillEnvVarsDrawer', () => {
  it('loads enterprise keys and saves a custom override for the current user', async () => {
    const user = userEvent.setup()

    render(
      createElement(SkillEnvVarsDrawer, {
        open: true,
        skillId: 'skill-1',
        skillDisplayName: '腾讯会议',
        onClose: () => undefined,
      }),
    )

    await waitFor(() => {
      expect(screen.getByText('API_KEY')).toBeInTheDocument()
      expect(screen.getByText('TIMEOUT')).toBeInTheDocument()
    })

    const apiKeyRow = screen.getByTestId('skill-env-var-API_KEY')
    await user.click(within(apiKeyRow).getByRole('button', { name: '设置' }))

    const input = within(apiKeyRow).getByPlaceholderText('输入自定义值')
    await user.type(input, 'secret-value')
    await user.click(within(apiKeyRow).getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(mocks.createMyEnvVar).toHaveBeenCalledWith('skill-1', {
        key: 'API_KEY',
        value: 'secret-value',
        sensitive: true,
      })
    })
  })

  it('prefills the existing override value when editing and lets the user update it', async () => {
    mocks.getMyEnvVars.mockResolvedValue([
      {
        id: 'env-1',
        key: 'API_KEY',
        value: 'secret-value',
        sensitive: true,
      },
    ])

    const user = userEvent.setup()

    render(
      createElement(SkillEnvVarsDrawer, {
        open: true,
        skillId: 'skill-1',
        skillDisplayName: '腾讯会议',
        onClose: () => undefined,
      }),
    )

    await waitFor(() => {
      expect(screen.getByText('API_KEY')).toBeInTheDocument()
      expect(screen.getByText('secret-value')).toBeInTheDocument()
    })

    const apiKeyRow = screen.getByTestId('skill-env-var-API_KEY')
    await user.click(within(apiKeyRow).getByRole('button', { name: '设置' }))

    const input = within(apiKeyRow).getByPlaceholderText('输入自定义值')
    expect(input).toHaveValue('secret-value')

    await user.clear(input)
    await user.type(input, 'updated-value')
    await user.click(within(apiKeyRow).getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(mocks.updateMyEnvVar).toHaveBeenCalledWith('skill-1', 'env-1', {
        key: 'API_KEY',
        value: 'updated-value',
        sensitive: true,
      })
    })
  })
})
