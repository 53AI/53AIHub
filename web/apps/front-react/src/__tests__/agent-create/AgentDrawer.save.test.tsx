import { act, render } from '@testing-library/react'
import { createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentDrawer, type AgentDrawerRef } from '@km/shared-business/agent-create/components/layout/Drawer'

const mocks = vi.hoisted(() => ({
  state: {
    is_new: false,
    agent_type: 'knowledge',
    saveAgentData: vi.fn(),
  },
  validateForm: vi.fn(),
  onChannelSave: vi.fn(),
}))

vi.mock('@km/shared-business/agent-create/store', () => ({
  useAgentFormStore: Object.assign(
    (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
    { getState: () => mocks.state },
  ),
}))

vi.mock('@km/shared-business/agent-create/adapters', async () => {
  const React = await import('react')
  const AgentFormComponent = React.forwardRef((_props, ref) => {
    React.useImperativeHandle(ref, () => ({
      validateForm: mocks.validateForm,
      onChannelSave: mocks.onChannelSave,
    }))
    return null
  })
  return {
    useAgentCreateAdapter: () => ({
      defaultPlatform: 'knowledge',
      AgentFormComponent,
    }),
  }
})

vi.mock('@km/shared-business/agent-create/hooks/useChannelConfig', () => ({ useChannelConfig: () => ({}) }))
vi.mock('@km/shared-business/agent-create/types', () => ({ getInitialFormData: () => ({}) }))

describe('AgentDrawer save', () => {
  beforeEach(() => {
    mocks.state.is_new = false
    mocks.state.agent_type = 'knowledge'
    mocks.state.saveAgentData.mockReset().mockResolvedValue(undefined)
    mocks.validateForm.mockReset().mockResolvedValue(true)
    mocks.onChannelSave.mockReset().mockResolvedValue(undefined)
  })

  it.each(['knowledge', 'workbench'])('persists existing %s agents through the adapter', async (agentType) => {
    mocks.state.agent_type = agentType
    const ref = createRef<AgentDrawerRef>()
    const onSuccess = vi.fn()
    render(<AgentDrawer ref={ref} onSuccess={onSuccess} />)

    await act(async () => ref.current?.handleSave())

    expect(mocks.state.saveAgentData).toHaveBeenCalledWith({ hideToast: true })
    expect(onSuccess).toHaveBeenCalledWith({ agent_id: undefined, agent_type: agentType, action: 'update' })
  })

  it('does not add an adapter save for other existing platform agents', async () => {
    mocks.state.agent_type = 'dify_agent'
    const ref = createRef<AgentDrawerRef>()
    render(<AgentDrawer ref={ref} />)

    await act(async () => ref.current?.handleSave())

    expect(mocks.onChannelSave).toHaveBeenCalledOnce()
    expect(mocks.state.saveAgentData).not.toHaveBeenCalled()
  })

  it('keeps the save failure visible to the caller and skips success notification', async () => {
    mocks.state.saveAgentData.mockRejectedValueOnce(new Error('save failed'))
    const ref = createRef<AgentDrawerRef>()
    const onSuccess = vi.fn()
    render(<AgentDrawer ref={ref} onSuccess={onSuccess} />)

    await expect(ref.current?.handleSave()).rejects.toThrow('save failed')
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
