import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import {
  AdapterProvider,
  useAgentFormStore,
  Chat as SharedChat,
} from '@km/shared-business/agent-create'

// Mock the heavy sender component so we can observe props without rendering real DOM
vi.mock('@km/shared-components-react', () => ({
  Dropdown: ({ children, menu }: any) => (
    <div>
      {children}
      {/* Render one opt button per item so PreviewModelSelector / PreviewKnowledgeSourceSelector menus can be exercised */}
      {(menu?.items || []).map((it: any) => (
        <button
          key={it.key}
          data-testid={`opt-${it.key}`}
          onClick={() => menu.onClick?.({ key: it.key })}
        >
          opt-{String(it.key)}
        </button>
      ))}
      <button data-testid="opt-menu" onClick={() => menu.onClick({ key: 's1' })}>opt</button>
    </div>
  ),
  SvgIcon: () => null,
}))

vi.mock('@km/hub-ui-x-react', () => ({
  XBubbleList: ({ children }: any) => <div data-testid="bubble-list">{children}</div>,
  XBubbleUser: ({ children }: any) => <div>{children}</div>,
  XBubbleAssistant: () => null,
  XIcon: () => null,
  XSender: (props: any) => (
    <div data-testid="x-sender">
      <button
        data-testid="x-sender-send"
        onClick={() =>
          props.onSend?.({
            textContent: 'hello',
            pureTextContent: 'hello',
            atList: [],
            skillList: [],
            selectedSkills: props.skill?.list?.map((s: any) => ({
              display_name: s.label || s.display_name,
              skill_name: s.skill_name,
            })) ?? [],
            files: [],
          })
        }
      >
        send
      </button>
      <div data-testid="x-sender-skill-enabled">{String(!!props.skill?.enabled)}</div>
      <div data-testid="x-sender-skill-count">{props.skill?.list?.length ?? 0}</div>
      <button
        data-testid="x-sender-skill-pick"
        onClick={() => props.skill?.onSelect?.({ id: 's1', label: '搜索', skill_name: 'web_search' })}
      >
        pick
      </button>
      {props.slots?.footer ? (
        <div data-testid="x-sender-footer">{props.slots.footer}</div>
      ) : null}
      {props.slots?.extrasLeft ? (
        <div data-testid="x-sender-extras-left">
          {props.slots.extrasLeft}
        </div>
      ) : null}
    </div>
  ),
}))

const sendChatMessage = vi.fn().mockResolvedValue(undefined)
const createConversation = vi.fn().mockResolvedValue({ conversation_id: 1 })
const uploadFile = vi.fn()
const save = vi.fn()

// The adapter provides BubbleComponents; Chat.tsx destructures XSender from there.
// Provide a rich XSender mock so we can observe the props Chat.tsx passes in.
const MockXSender = (props: any) => (
  <div data-testid="x-sender">
    <button
      data-testid="x-sender-send"
      onClick={() =>
        props.onSend?.({
          textContent: 'hello',
          pureTextContent: 'hello',
          atList: [],
          skillList: [],
          selectedSkills: props.skill?.list?.map((s: any) => ({
            display_name: s.label || s.display_name,
            skill_name: s.skill_name,
          })) ?? [],
          files: [],
        })
      }
    >
      send
    </button>
    <div data-testid="x-sender-skill-enabled">{String(!!props.skill?.enabled)}</div>
    <div data-testid="x-sender-skill-count">{props.skill?.list?.length ?? 0}</div>
    <button
      data-testid="x-sender-skill-pick"
      onClick={() => props.skill?.onSelect?.({ id: 's1', label: '搜索', skill_name: 'web_search' })}
    >
      pick
    </button>
    {props.slots?.footer ? (
      <div data-testid="x-sender-footer">{props.slots.footer}</div>
    ) : null}
    {props.slots?.extrasLeft ? (
      <div data-testid="x-sender-extras-left">
        {props.slots.extrasLeft}
      </div>
    ) : null}
  </div>
)

// 模拟后端 agent_models：返回带独立 id 的记录（与真实 API 对齐）
const getAgentModels = vi.fn().mockImplementation(async (agentId: string) => {
  if (agentId === 'agent-1') {
    // workbench 不使用，留空
    return []
  }
  // knowledge agent-2：返回与 form_data.settings.fast_reasoning_config 匹配的模型
  return [
    {
      id: 100, // 后端分配的独立 model id（数字类型，与 RawAgentModelInfo.id 对齐）
      channel_id: 10,
      channel_type: 1,
      model: 'gpt-4',
    },
    {
      id: 101,
      channel_id: 11,
      channel_type: 1,
      model: 'deep',
    },
  ]
})

const adapter = {
  t: (k: string) => k,
  AGENT_TYPES: { '53AI_AGENT': '53AI_AGENT', FASTGPT_AGENT: 'FASTGPT_AGENT' },
  BubbleComponents: {
    XBubbleList: () => null,
    XBubbleUser: () => null,
    XBubbleAssistant: () => null,
    XIcon: () => null,
    XSender: MockXSender,
  },
  sendChatMessage,
  createConversation,
  uploadFile,
  save,
  getAgentModels,
} as any

describe('Chat — workbench preview sender', () => {
  beforeEach(() => {
    sendChatMessage.mockClear()
    createConversation.mockClear()
    useAgentFormStore.setState({
      agent_id: 'agent-1',
      agent_type: 'workbench',
      agent_data: {
        channel_type: 1,
        configs: {},
        settings: {
          skills: [{ skill_id: 's1', display_name: '搜索', skill_name: 'web_search' }],
        },
      },
      form_data: {
        name: 'wb',
        settings: { skills: [{ skill_id: 's1', display_name: '搜索', skill_name: 'web_search' }] },
      },
    } as any)
  })

  it('passes skill prop to XSender when agent_type=workbench', () => {
    render(
      <AdapterProvider adapter={adapter}>
        <SharedChat />
      </AdapterProvider>,
    )
    expect(screen.getByTestId('x-sender-skill-enabled').textContent).toBe('true')
  })

  it('sends skill in sendChatMessage payload after picking a skill', async () => {
    render(
      <AdapterProvider adapter={adapter}>
        <SharedChat />
      </AdapterProvider>,
    )
    fireEvent.click(screen.getByTestId('x-sender-skill-pick'))
    fireEvent.click(screen.getByTestId('x-sender-send'))

    await waitFor(() => expect(sendChatMessage).toHaveBeenCalled())
    const callArg = sendChatMessage.mock.calls[0][0]
    expect(callArg.skill).toEqual({
      display_name: '搜索',
      skill_name: 'web_search',
    })
  })

  it('clears selected skill after send (reset)', async () => {
    render(
      <AdapterProvider adapter={adapter}>
        <SharedChat />
      </AdapterProvider>,
    )
    fireEvent.click(screen.getByTestId('x-sender-skill-pick'))
    expect(screen.getByTestId('x-sender-skill-count').textContent).toBe('1')
    fireEvent.click(screen.getByTestId('x-sender-send'))
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('x-sender-skill-count').textContent).toBe('0'))
  })
})

describe('Chat — knowledge preview sender', () => {
  beforeEach(() => {
    sendChatMessage.mockClear()
    createConversation.mockClear()
    useAgentFormStore.setState({
      agent_id: 'agent-2',
      agent_type: 'knowledge',
      agent_data: {
        channel_type: 1,
        configs: {},
      },
      // useAgentPreviewSender 优先读 form_data.settings；knowledge 场景需要
      // fast_reasoning_config + graph_search_setting + web_search_setting
      form_data: {
        name: 'k',
        settings: {
          fast_reasoning_config: { channel_id: 10, channel_type: 1, model_name: 'gpt-4' },
          deep_thinking_config: { enable: true, channel_id: 11, channel_type: 1, model_name: 'deep' },
        },
      },
    } as any)
  })

  it('renders PreviewModelSelector with options from agent_data', () => {
    render(
      <AdapterProvider adapter={adapter}>
        <SharedChat />
      </AdapterProvider>,
    )
    expect(screen.getByTestId('preview-model-selector')).toBeTruthy()
  })

  it('sends modelId in sendChatMessage payload', async () => {
    render(
      <AdapterProvider adapter={adapter}>
        <SharedChat />
      </AdapterProvider>,
    )
    // 等待 useAgentPreviewSender 通过 adapter.getAgentModels 异步加载 agent_models
    await waitFor(() => expect(getAgentModels).toHaveBeenCalledWith('agent-2'))
    fireEvent.click(screen.getByTestId('x-sender-send'))
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalled())
    const callArg = sendChatMessage.mock.calls[0][0]
    // modelId 取 API 真实 id（后端独立分配的 id，对齐 knowledge/chat.tsx
    // `modelId = currentModel?.id`）。agent_models mock 中第一条 id=100，
    // 与 form_data.settings.fast_reasoning_config (channel_id=10) 匹配。
    expect(callArg.modelId).toBe('100')
  })

  it('does not pass skill prop when agent_type=knowledge', () => {
    render(
      <AdapterProvider adapter={adapter}>
        <SharedChat />
      </AdapterProvider>,
    )
    expect(screen.getByTestId('x-sender-skill-enabled').textContent).toBe('false')
  })

  it('renders PreviewKnowledgeSourceSelector when graph or web search is enabled', () => {
    useAgentFormStore.setState({
      agent_id: 'agent-2',
      agent_type: 'knowledge',
      agent_data: { channel_type: 1, configs: {} },
      form_data: {
        name: 'k',
        settings: {
          fast_reasoning_config: { channel_id: 10, channel_type: 1, model_name: 'gpt-4' },
          graph_search_setting: { enable: true, default_enable: false },
          web_search_setting: { enable: true },
        },
      },
    } as any)
    render(
      <AdapterProvider adapter={adapter}>
        <SharedChat />
      </AdapterProvider>,
    )
    expect(screen.getByTestId('preview-knowledge-source-selector')).toBeTruthy()
  })

  it('passes knowledgeGraph=true when user selects knowledge graph mode', async () => {
    useAgentFormStore.setState({
      agent_id: 'agent-2',
      agent_type: 'knowledge',
      agent_data: { channel_type: 1, configs: {} },
      form_data: {
        name: 'k',
        settings: {
          fast_reasoning_config: { channel_id: 10, channel_type: 1, model_name: 'gpt-4' },
          graph_search_setting: { enable: true, default_enable: false },
          web_search_setting: { enable: true },
        },
      },
    } as any)
    render(
      <AdapterProvider adapter={adapter}>
        <SharedChat />
      </AdapterProvider>,
    )
    fireEvent.click(screen.getByTestId('opt-knowledgeGraph'))
    fireEvent.click(screen.getByTestId('x-sender-send'))
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalled())
    const callArg = sendChatMessage.mock.calls[0][0]
    expect(callArg.knowledgeGraph).toBe(true)
    expect(callArg.networkSearch).toBeUndefined()
  })

  it('passes networkSearch=true when user selects online search mode', async () => {
    useAgentFormStore.setState({
      agent_id: 'agent-2',
      agent_type: 'knowledge',
      agent_data: { channel_type: 1, configs: {} },
      form_data: {
        name: 'k',
        settings: {
          fast_reasoning_config: { channel_id: 10, channel_type: 1, model_name: 'gpt-4' },
          graph_search_setting: { enable: true, default_enable: false },
          web_search_setting: { enable: true },
        },
      },
    } as any)
    render(
      <AdapterProvider adapter={adapter}>
        <SharedChat />
      </AdapterProvider>,
    )
    fireEvent.click(screen.getByTestId('opt-networkSearch'))
    fireEvent.click(screen.getByTestId('x-sender-send'))
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalled())
    const callArg = sendChatMessage.mock.calls[0][0]
    expect(callArg.networkSearch).toBe(true)
    expect(callArg.knowledgeGraph).toBeUndefined()
  })

  it('does not override server defaults when source mode is "all"', async () => {
    useAgentFormStore.setState({
      agent_id: 'agent-2',
      agent_type: 'knowledge',
      agent_data: {
        channel_type: 1,
        configs: {},
        settings: {
          fast_reasoning_config: { channel_id: 10, channel_type: 1, model_name: 'gpt-4' },
          graph_search_setting: { enable: true, default_enable: false },
          web_search_setting: { enable: true },
        },
      },
      form_data: { name: 'k', settings: {} },
    } as any)
    render(
      <AdapterProvider adapter={adapter}>
        <SharedChat />
      </AdapterProvider>,
    )
    fireEvent.click(screen.getByTestId('x-sender-send'))
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalled())
    const callArg = sendChatMessage.mock.calls[0][0]
    expect(callArg.networkSearch).toBeUndefined()
    expect(callArg.knowledgeGraph).toBeUndefined()
  })
})
