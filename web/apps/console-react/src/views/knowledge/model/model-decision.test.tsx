import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeModel } from './index'

const api = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/api/modules/chunk-setting', () => ({
  chunkSettingApi: { modelConfig: { get: api.get, update: api.update } },
}))
vi.mock('@/locales', () => ({ t: (key: string) => key }))
vi.mock('@/directive/debounce', () => ({ debounce: (fn: () => void) => fn }))
vi.mock('@/components/Model/select', () => ({
  ModelSelect: ({ type, value, onChange }: { type: string; value: string; onChange: (value: string) => void }) => (
    <select data-testid={`model-${type}`} value={value || ''} onChange={(event) => onChange(event.target.value)}>
      <option value="" />
      <option value="17_53aikm_decision-model-preview">decision-model-preview</option>
    </select>
  ),
}))
vi.mock('antd', () => {
  const Form = Object.assign(({ children }: { children?: React.ReactNode }) => <div>{children}</div>, {
    Item: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  })
  return {
    Form,
    Button: ({ children, onClick }: { children?: React.ReactNode; onClick: () => void }) => <button onClick={onClick}>{children}</button>,
    Spin: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Switch: ({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) => (
      <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>decision toggle</button>
    ),
    InputNumber: ({ value, onChange }: { value: number; onChange: (value: number) => void }) => (
      <input aria-label="confidence" type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    ),
    Modal: { confirm: vi.fn() },
    Input: () => null,
    message: { success: api.success, error: api.error },
  }
})
vi.mock('@ant-design/icons', () => ({ ExclamationCircleFilled: () => null }))

const initialSetting = () => ({
  id: 1, eid: 53, file_id: 0, library_id: 0, created_time: 0, updated_time: 0,
  model_config: {
    version: '1.0',
    logic_reasoning: { channel_id: 455, model_name: 'logic-model' },
    vector_embedding: { channel_id: 100, model_name: 'vector-model' },
    fast_reasoning: { channel_id: 300, model_name: 'fast-model' },
    search_config: { rerank_model: 'reranking_model', top_k: 4 },
  },
})

describe('enterprise decision model settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('moves the decision toggle into site settings and persists its selection across reloads', async () => {
    let site = initialSetting()
    api.get.mockImplementation(async () => JSON.parse(JSON.stringify(site)))
    api.update.mockImplementation(async ({ model_config }) => {
      site = { ...site, model_config }
      return {}
    })

    const view = render(<KnowledgeModel activeTab="model" />)
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByTestId('model-5')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch'))
    fireEvent.change(screen.getByTestId('model-5'), { target: { value: '17_53aikm_decision-model-preview' } })
    fireEvent.click(screen.getByRole('button', { name: 'action_save' }))
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1))
    expect(api.update.mock.calls[0][0].model_config).toMatchObject({
      fast_reasoning: { channel_id: 300, model_name: 'fast-model' },
      intent_decision_config: { enable: true, channel_id: 17, model_name: 'decision-model-preview', confidence_threshold: 0.85 },
    })

    view.unmount()
    render(<KnowledgeModel activeTab="model" />)
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('model-5')).toHaveValue('17_53aikm_decision-model-preview')

    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByRole('button', { name: 'action_save' }))
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(2))
    expect(api.update.mock.calls[1][0].model_config.intent_decision_config).toMatchObject({
      enable: false, channel_id: 17, model_name: 'decision-model-preview',
    })
  })
})
