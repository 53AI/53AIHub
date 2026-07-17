import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAgentFormStore, useAgentPreviewSender } from '@km/shared-business/agent-create'

describe('useAgentPreviewSender — workbench', () => {
  beforeEach(() => {
    useAgentFormStore.setState({
      agent_type: 'workbench',
      agent_data: {
        settings: {
          skills: [
            { skill_id: 's1', display_name: '搜索', skill_name: 'web_search' },
            { skill_id: 's2', display_name: '绘图', skill_name: 'image_gen' },
          ],
        },
      },
    } as any)
  })

  it('returns enabled=true and agentKind=workbench', () => {
    const { result } = renderHook(() =>
      useAgentPreviewSender({
        agent_type: useAgentFormStore.getState().agent_type,
        agent_data: useAgentFormStore.getState().agent_data,
      }),
    )
    expect(result.current.enabled).toBe(true)
    expect(result.current.agentKind).toBe('workbench')
  })

  it('exposes skill.list mapped from agent_data.settings.skills', () => {
    const { result } = renderHook(() =>
      useAgentPreviewSender({
        agent_type: 'workbench',
        agent_data: {
          settings: {
            skills: [
              { skill_id: 's1', display_name: '搜索', skill_name: 'web_search' },
              { skill_id: 's2', display_name: '绘图', skill_name: 'image_gen' },
            ],
          },
        },
      }),
    )
    expect(result.current.skill?.list).toEqual([
      { id: 's1', label: '搜索', display_name: '搜索', skill_name: 'web_search' },
      { id: 's2', label: '绘图', display_name: '绘图', skill_name: 'image_gen' },
    ])
  })

  it('onSelect replaces selected skill (single-select)', () => {
    const { result } = renderHook(() =>
      useAgentPreviewSender({
        agent_type: 'workbench',
        agent_data: {
          settings: {
            skills: [
              { skill_id: 's1', display_name: '搜索', skill_name: 'web_search' },
              { skill_id: 's2', display_name: '绘图', skill_name: 'image_gen' },
            ],
          },
        },
      }),
    )
    act(() => result.current.skill!.onSelect!({ id: 's2', label: '绘图', skill_name: 'image_gen' } as any))
    expect(result.current.skill?.list).toEqual([
      { id: 's2', label: '绘图', display_name: '绘图', skill_name: 'image_gen' },
    ])
  })

  it('onRemove clears selected skill', () => {
    const { result } = renderHook(() =>
      useAgentPreviewSender({
        agent_type: 'workbench',
        agent_data: {
          settings: {
            skills: [{ skill_id: 's1', display_name: '搜索', skill_name: 'web_search' }],
          },
        },
      }),
    )
    act(() => result.current.skill!.onSelect!({ id: 's1', label: '搜索', skill_name: 'web_search' } as any))
    expect(result.current.skill?.list).toHaveLength(1)
    act(() => result.current.skill!.onRemove!())
    expect(result.current.skill?.list).toHaveLength(0)
  })

  it('reset() clears selected skill', () => {
    const { result } = renderHook(() =>
      useAgentPreviewSender({
        agent_type: 'workbench',
        agent_data: {
          settings: {
            skills: [{ skill_id: 's1', display_name: '搜索', skill_name: 'web_search' }],
          },
        },
      }),
    )
    act(() => result.current.skill!.onSelect!({ id: 's1', label: '搜索', skill_name: 'web_search' } as any))
    act(() => result.current.reset())
    expect(result.current.skill?.list).toHaveLength(0)
  })

  it('skill.suggestions always carries the full set of available skills (even after clear)', () => {
    const { result } = renderHook(() =>
      useAgentPreviewSender({
        agent_type: 'workbench',
        agent_data: {
          settings: {
            skills: [
              { skill_id: 's1', display_name: '搜索', skill_name: 'web_search' },
              { skill_id: 's2', display_name: '绘图', skill_name: 'image_gen' },
            ],
          },
        },
      }),
    )
    expect(result.current.skill?.suggestions).toEqual([
      { id: 's1', label: '搜索', display_name: '搜索', skill_name: 'web_search' },
      { id: 's2', label: '绘图', display_name: '绘图', skill_name: 'image_gen' },
    ])
    act(() => result.current.skill!.onSelect!({ id: 's1', label: '搜索', skill_name: 'web_search' } as any))
    expect(result.current.skill?.suggestions).toHaveLength(2)
    act(() => result.current.skill!.onRemove!())
    expect(result.current.skill?.suggestions).toHaveLength(2)
  })
})

describe('useAgentPreviewSender — knowledge', () => {
  const baseAgentData = {
    settings: {
      fast_reasoning_config: {
        channel_id: 10,
        channel_type: 1,
        model_name: 'gpt-4',
      },
    },
  }

  it('returns enabled=true and agentKind=knowledge', () => {
    const { result } = renderHook(() =>
      useAgentPreviewSender({
        agent_type: 'knowledge',
        agent_data: baseAgentData,
      }),
    )
    expect(result.current.enabled).toBe(true)
    expect(result.current.agentKind).toBe('knowledge')
  })

  it('model.options contains only fast_reasoning when deep_thinking_config is missing or disabled', () => {
    const { result } = renderHook(() =>
      useAgentPreviewSender({
        agent_type: 'knowledge',
        agent_data: baseAgentData,
      }),
    )
    expect(result.current.model?.options).toHaveLength(1)
    const opt = result.current.model?.options[0]
    expect(opt?.id).toBe('10_1_gpt-4')
    expect(opt?.label).toBe('chat.fast_response')
    expect(opt?.icon).toBe('lightning')
  })

  it('model.options contains fast + deep when deep_thinking_config.enable=true', () => {
    const { result } = renderHook(() =>
      useAgentPreviewSender({
        agent_type: 'knowledge',
        agent_data: {
          settings: {
            fast_reasoning_config: { channel_id: 10, channel_type: 1, model_name: 'gpt-4' },
            deep_thinking_config: { enable: true, channel_id: 11, channel_type: 1, model_name: 'gpt-4-deep' },
          },
        },
      }),
    )
    expect(result.current.model?.options).toHaveLength(2)
    expect(result.current.model?.options.map((o) => o.id)).toEqual(['10_1_gpt-4', '11_1_gpt-4-deep'])
    const deepOpt = result.current.model?.options.find((o) => o.id === '11_1_gpt-4-deep')
    expect(deepOpt?.label).toBe('chat.deep_thinking')
    expect(deepOpt?.icon).toBe('star-link')
  })

  it('model.selectedId defaults to fast_reasoning id', () => {
    const { result } = renderHook(() =>
      useAgentPreviewSender({
        agent_type: 'knowledge',
        agent_data: baseAgentData,
      }),
    )
    expect(result.current.model?.selectedId).toBe('10_1_gpt-4')
  })

  it('model.onChange updates selectedId', () => {
    const { result } = renderHook(() =>
      useAgentPreviewSender({
        agent_type: 'knowledge',
        agent_data: {
          settings: {
            fast_reasoning_config: { channel_id: 10, channel_type: 1, model_name: 'gpt-4' },
            deep_thinking_config: { enable: true, channel_id: 11, channel_type: 1, model_name: 'deep' },
          },
        },
      }),
    )
    act(() => result.current.model!.onChange('11_1_deep'))
    expect(result.current.model?.selectedId).toBe('11_1_deep')
  })

  it('reset() does not change model.selectedId', () => {
    const { result } = renderHook(() =>
      useAgentPreviewSender({
        agent_type: 'knowledge',
        agent_data: baseAgentData,
      }),
    )
    const before = result.current.model?.selectedId
    act(() => result.current.reset())
    expect(result.current.model?.selectedId).toBe(before)
  })

  it('returns enabled=false when agent_data is missing or fast_reasoning_config.channel_id is missing', () => {
    const { result } = renderHook(() =>
      useAgentPreviewSender({
        agent_type: 'knowledge',
        agent_data: { settings: { fast_reasoning_config: { channel_id: 0 } } },
      }),
    )
    expect(result.current.enabled).toBe(false)
    expect(result.current.model).toBeUndefined()
  })

  it('source default mode is "all" when graph_search_setting.default_enable is false or missing', () => {
    const { result } = renderHook(() =>
      useAgentPreviewSender({
        agent_type: 'knowledge',
        agent_data: {
          settings: {
            fast_reasoning_config: { channel_id: 10, channel_type: 1, model_name: 'gpt-4' },
            graph_search_setting: { enable: true, default_enable: false },
            web_search_setting: { enable: true },
          },
        },
      }),
    )
    expect(result.current.source?.value.mode).toBe('all')
    expect(result.current.source?.graphEnabled).toBe(true)
    expect(result.current.source?.webSearchEnabled).toBe(true)
  })

  it('source default mode is "knowledgeGraph" when graph_search_setting.default_enable=true', () => {
    const { result } = renderHook(() =>
      useAgentPreviewSender({
        agent_type: 'knowledge',
        agent_data: {
          settings: {
            fast_reasoning_config: { channel_id: 10, channel_type: 1, model_name: 'gpt-4' },
            graph_search_setting: { enable: true, default_enable: true },
          },
        },
      }),
    )
    expect(result.current.source?.value.mode).toBe('knowledgeGraph')
  })

  it('source.onChange updates the mode', () => {
    const { result } = renderHook(() =>
      useAgentPreviewSender({
        agent_type: 'knowledge',
        agent_data: {
          settings: {
            fast_reasoning_config: { channel_id: 10, channel_type: 1, model_name: 'gpt-4' },
            graph_search_setting: { enable: true, default_enable: true },
            web_search_setting: { enable: true },
          },
        },
      }),
    )
    act(() => result.current.source!.onChange({ mode: 'networkSearch' }))
    expect(result.current.source?.value.mode).toBe('networkSearch')
  })

  it('source is undefined for non-knowledge agent types', () => {
    const { result } = renderHook(() =>
      useAgentPreviewSender({
        agent_type: 'workbench',
        agent_data: {
          settings: {
            skills: [{ skill_id: 's1', display_name: '搜索', skill_name: 'web_search' }],
            graph_search_setting: { enable: true, default_enable: true },
          },
        },
      }),
    )
    expect(result.current.source).toBeUndefined()
  })
})

describe('useAgentPreviewSender — other agent_type', () => {
  it('returns enabled=false for prompt/coze/...', () => {
    const { result } = renderHook(() =>
      useAgentPreviewSender({ agent_type: 'prompt', agent_data: undefined }),
    )
    expect(result.current.enabled).toBe(false)
    expect(result.current.agentKind).toBe('none')
    expect(result.current.skill).toBeUndefined()
    expect(result.current.model).toBeUndefined()
  })
})
