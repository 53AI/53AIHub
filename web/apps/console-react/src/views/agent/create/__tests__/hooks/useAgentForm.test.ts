/**
 * useAgentForm Hook 测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAgentForm, createValidateForm } from '../../hooks/useAgentForm'
import { useAgentFormStore } from '../../store'
import { getInitialFormData } from '../../types'

// Mock dependencies
vi.mock('../../store', () => ({
  useAgentFormStore: vi.fn(),
}))

vi.mock('@/api/modules/agent', () => ({
  agentApi: {
    detail: vi.fn().mockResolvedValue({ agent_id: 1, name: '测试' }),
    save: vi.fn().mockResolvedValue({ agent_id: 1 }),
  },
}))

vi.mock('@/api/modules/group', () => ({
  groupApi: {
    list: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('@/stores', () => ({
  useEnterpriseStore: {
    getState: () => ({
      info: { is_independent: false },
    }),
  },
}))

vi.mock('@/constants/platform/config', () => ({
  getAgentByAgentType: vi.fn(() => ({ id: 'prompt', mode: 'chat' })),
}))

vi.mock('@/constants/platform/channel', () => ({
  CHANNEL_TYPE_VALUE_MAP: new Map([['prompt', 1]]),
}))

vi.mock('@/constants/group', () => ({
  GROUP_TYPE: { AGENT: 1 },
}))

// 创建 mock store 状态
const createMockStore = (overrides = {}) => ({
  form_data: getInitialFormData(),
  agent_id: 0,
  agent_type: 'prompt',
  is_new: false,
  loading: false,
  saving: false,
  initializing: false,  // 新增：与 store.ts 初始值保持一致
  agent_data: {},  // 修复：与 store.ts 初始值保持一致
  group_options: [],
  support_image: false,
  getAgentOptionData: vi.fn(() => ({ id: 'prompt', mode: 'chat' })),
  getSupportFile: vi.fn(() => false),
  getIsIndependent: vi.fn(() => false),
  loadDetailData: vi.fn().mockResolvedValue(undefined),
  loadGroupOptions: vi.fn().mockResolvedValue(undefined),
  resetState: vi.fn(),
  saveAgentData: vi.fn().mockResolvedValue({ agent_id: 1 }),
  ...overrides,
})

describe('useAgentForm', () => {
  let mockStore: ReturnType<typeof createMockStore>
  let setStateMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockStore = createMockStore()
    setStateMock = vi.fn()

    // 设置 useAgentFormStore 的行为
    const storeState = { ...mockStore }

    ;(useAgentFormStore as any).mockImplementation((selector?: (state: any) => any) => {
      if (typeof selector === 'function') {
        return selector(storeState)
      }
      return {
        ...storeState,
        saveAgentData: mockStore.saveAgentData,
        loadDetailData: mockStore.loadDetailData,
        loadGroupOptions: mockStore.loadGroupOptions,
        resetState: mockStore.resetState,
        getAgentOptionData: mockStore.getAgentOptionData,
        getSupportFile: mockStore.getSupportFile,
        getIsIndependent: mockStore.getIsIndependent,
      }
    })

    ;(useAgentFormStore as any).setState = setStateMock
    ;(useAgentFormStore as any).getState = () => storeState
  })

  // ============ 状态访问测试 ============
  describe('状态访问', () => {
    it('应返回 formData', () => {
      const { result } = renderHook(() => useAgentForm())
      expect(result.current.formData).toBeDefined()
      expect(result.current.formData.name).toBe('')
    })

    it('应返回 agentType', () => {
      const { result } = renderHook(() => useAgentForm())
      expect(result.current.agentType).toBe('prompt')
    })

    it('应返回 agentId', () => {
      const { result } = renderHook(() => useAgentForm())
      expect(result.current.agentId).toBe(0)
    })

    it('应返回 isNew', () => {
      const { result } = renderHook(() => useAgentForm())
      expect(result.current.isNew).toBe(false)
    })

    it('应返回 loading', () => {
      const { result } = renderHook(() => useAgentForm())
      expect(result.current.loading).toBe(false)
    })

    it('应返回 saving', () => {
      const { result } = renderHook(() => useAgentForm())
      expect(result.current.saving).toBe(false)
    })

    it('应返回 agentData', () => {
      const { result } = renderHook(() => useAgentForm())
      expect(result.current.agentData).toEqual({})  // 修复：与 store.ts 初始值保持一致
    })

    it('应返回 groupOptions', () => {
      const { result } = renderHook(() => useAgentForm())
      expect(result.current.groupOptions).toEqual([])
    })

    it('应返回 supportImage', () => {
      const { result } = renderHook(() => useAgentForm())
      expect(result.current.supportImage).toBe(false)
    })
  })

  // ============ updateField 测试 ============
  describe('updateField', () => {
    it('应更新单个字段', () => {
      const { result } = renderHook(() => useAgentForm())

      act(() => {
        result.current.updateField('name', '新名称')
      })

      expect(setStateMock).toHaveBeenCalled()
    })

    it('应更新 group_id 字段', () => {
      const { result } = renderHook(() => useAgentForm())

      act(() => {
        result.current.updateField('group_id', 5)
      })

      expect(setStateMock).toHaveBeenCalled()
    })

    it('应更新 description 字段', () => {
      const { result } = renderHook(() => useAgentForm())

      act(() => {
        result.current.updateField('description', '新描述')
      })

      expect(setStateMock).toHaveBeenCalled()
    })
  })

  // ============ updateFields 测试 ============
  describe('updateFields', () => {
    it('应批量更新多个字段', () => {
      const { result } = renderHook(() => useAgentForm())

      act(() => {
        result.current.updateFields({
          name: '批量名称',
          description: '批量描述',
          group_id: 10,
        })
      })

      expect(setStateMock).toHaveBeenCalled()
    })
  })

  // ============ updateSettings 测试 ============
  describe('updateSettings', () => {
    it('应更新 settings', () => {
      const { result } = renderHook(() => useAgentForm())

      act(() => {
        result.current.updateSettings({
          opening_statement: '新的开场白',
        })
      })

      expect(setStateMock).toHaveBeenCalled()
    })
  })

  // ============ updateOpeningStatement 测试 ============
  describe('updateOpeningStatement', () => {
    it('应更新开场白', () => {
      const { result } = renderHook(() => useAgentForm())

      act(() => {
        result.current.updateOpeningStatement('你好，我是助手')
      })

      expect(setStateMock).toHaveBeenCalled()
    })
  })

  // ============ updateSuggestedQuestions 测试 ============
  describe('updateSuggestedQuestions', () => {
    it('应更新建议问题', () => {
      const { result } = renderHook(() => useAgentForm())

      const questions = [
        { id: '1', content: '问题1' },
        { id: '2', content: '问题2' },
      ]

      act(() => {
        result.current.updateSuggestedQuestions(questions)
      })

      expect(setStateMock).toHaveBeenCalled()
    })
  })

  // ============ updateFileParse 测试 ============
  describe('updateFileParse', () => {
    it('应更新文件解析配置', () => {
      const { result } = renderHook(() => useAgentForm())

      act(() => {
        result.current.updateFileParse(true)
      })

      expect(setStateMock).toHaveBeenCalled()
    })
  })

  // ============ updateImageParse 测试 ============
  describe('updateImageParse', () => {
    it('应更新图片解析配置', () => {
      const { result } = renderHook(() => useAgentForm())

      act(() => {
        result.current.updateImageParse(true)
      })

      expect(setStateMock).toHaveBeenCalled()
    })
  })

  // ============ updateInputFields 测试 ============
  describe('updateInputFields', () => {
    it('应更新输入字段', () => {
      const { result } = renderHook(() => useAgentForm())

      const fields = [
        {
          id: '1',
          variable: 'input1',
          label: '输入1',
          type: 'text',
          desc: '',
          required: false,
          max_length: 100,
          show_word_limit: false,
          options: [],
          multiple: false,
          date_format: '',
          file_type: 'all',
          file_accept: [],
          file_limit: 1,
          file_size: 30,
          is_system: false,
        },
      ]

      act(() => {
        result.current.updateInputFields(fields)
      })

      expect(setStateMock).toHaveBeenCalled()
    })
  })

  // ============ updateOutputFields 测试 ============
  describe('updateOutputFields', () => {
    it('应更新输出字段', () => {
      const { result } = renderHook(() => useAgentForm())

      const fields = [
        {
          id: '1',
          variable: 'output1',
          label: '输出1',
          type: 'text',
          desc: '',
          required: false,
          max_length: 100,
          show_word_limit: false,
          options: [],
          multiple: false,
          date_format: '',
          file_type: 'all',
          file_accept: [],
          file_limit: 1,
          file_size: 30,
          is_system: false,
        },
      ]

      act(() => {
        result.current.updateOutputFields(fields)
      })

      expect(setStateMock).toHaveBeenCalled()
    })
  })

  // ============ 关联应用管理测试 ============
  describe('关联应用管理', () => {
    it('updateRelateAgents 应更新关联应用列表', () => {
      const { result } = renderHook(() => useAgentForm())

      const agents = [
        {
          agent_id: 1,
          id: '1',
          name: '关联应用1',
          logo: '',
          input_fields: [],
          field_mapping: {},
          execution_rule: 'auto' as const,
        },
      ]

      act(() => {
        result.current.updateRelateAgents(agents)
      })

      expect(setStateMock).toHaveBeenCalled()
    })

    it('addRelateAgent 应添加关联应用', () => {
      const { result } = renderHook(() => useAgentForm())

      const agent = {
        agent_id: 2,
        id: '2',
        name: '新关联应用',
        logo: '',
        input_fields: [],
        field_mapping: {},
        execution_rule: 'manual' as const,
      }

      act(() => {
        result.current.addRelateAgent(agent)
      })

      expect(setStateMock).toHaveBeenCalled()
    })

    it('removeRelateAgent 应移除关联应用', () => {
      const { result } = renderHook(() => useAgentForm())

      act(() => {
        result.current.removeRelateAgent(1)
      })

      expect(setStateMock).toHaveBeenCalled()
    })

    it('updateRelateAgent 应更新指定关联应用', () => {
      const { result } = renderHook(() => useAgentForm())

      const agent = {
        agent_id: 1,
        id: '1',
        name: '更新后的名称',
        logo: '',
        input_fields: [],
        field_mapping: {},
        execution_rule: 'auto' as const,
      }

      act(() => {
        result.current.updateRelateAgent(agent)
      })

      expect(setStateMock).toHaveBeenCalled()
    })
  })

  // ============ updateCustomConfig 测试 ============
  describe('updateCustomConfig', () => {
    it('应更新 custom_config', () => {
      const { result } = renderHook(() => useAgentForm())

      act(() => {
        result.current.updateCustomConfig({
          channel_id: 10,
          coze_bot_id: 'bot-123',
        })
      })

      expect(setStateMock).toHaveBeenCalled()
    })
  })

  // ============ 基本信息更新测试 ============
  describe('基本信息更新', () => {
    it('updateName 应更新名称', () => {
      const { result } = renderHook(() => useAgentForm())

      act(() => {
        result.current.updateName('新名称')
      })

      expect(setStateMock).toHaveBeenCalled()
    })

    it('updateLogo 应更新 Logo', () => {
      const { result } = renderHook(() => useAgentForm())

      act(() => {
        result.current.updateLogo('https://example.com/new-logo.png')
      })

      expect(setStateMock).toHaveBeenCalled()
    })

    it('updateDescription 应更新描述', () => {
      const { result } = renderHook(() => useAgentForm())

      act(() => {
        result.current.updateDescription('新描述')
      })

      expect(setStateMock).toHaveBeenCalled()
    })

    it('updateGroupId 应更新分组', () => {
      const { result } = renderHook(() => useAgentForm())

      act(() => {
        result.current.updateGroupId(5)
      })

      expect(setStateMock).toHaveBeenCalled()
    })

    it('updateUseCases 应更新用例场景', () => {
      const { result } = renderHook(() => useAgentForm())

      const useCases = [
        { id: '1', type: 'case' as const, input_text: '输入', output_text: '输出' },
      ]

      act(() => {
        result.current.updateUseCases(useCases)
      })

      expect(setStateMock).toHaveBeenCalled()
    })
  })

  // ============ Store 操作代理测试 ============
  describe('Store 操作代理', () => {
    it('save 应调用 store.saveAgentData', async () => {
      const { result } = renderHook(() => useAgentForm())

      await act(async () => {
        await result.current.save()
      })

      expect(mockStore.saveAgentData).toHaveBeenCalled()
    })

    it('reset 应调用 store.resetState', () => {
      const { result } = renderHook(() => useAgentForm())

      act(() => {
        result.current.reset()
      })

      expect(mockStore.resetState).toHaveBeenCalled()
    })

    it('loadDetail 应调用 store.loadDetailData', async () => {
      const { result } = renderHook(() => useAgentForm())

      await act(async () => {
        await result.current.loadDetail()
      })

      expect(mockStore.loadDetailData).toHaveBeenCalled()
    })

    it('loadGroups 应调用 store.loadGroupOptions', async () => {
      const { result } = renderHook(() => useAgentForm())

      await act(async () => {
        await result.current.loadGroups()
      })

      expect(mockStore.loadGroupOptions).toHaveBeenCalled()
    })
  })

  // ============ setAgentType 测试 ============
  describe('setAgentType', () => {
    it('应设置 agent_type', () => {
      const { result } = renderHook(() => useAgentForm())

      act(() => {
        result.current.setAgentType('coze_agent_cn')
      })

      expect(setStateMock).toHaveBeenCalledWith({ agent_type: 'coze_agent_cn' })
    })
  })

  // ============ setAgentInfo 测试 ============
  describe('setAgentInfo', () => {
    it('应同时设置 agent_type 和 agent_id', () => {
      const { result } = renderHook(() => useAgentForm())

      act(() => {
        result.current.setAgentInfo('coze_agent_cn', 123)
      })

      expect(setStateMock).toHaveBeenCalledWith({
        agent_type: 'coze_agent_cn',
        agent_id: 123,
      })
    })
  })

  // ============ setIsNew 测试 ============
  describe('setIsNew', () => {
    it('应设置 is_new', () => {
      const { result } = renderHook(() => useAgentForm())

      act(() => {
        result.current.setIsNew(true)
      })

      expect(setStateMock).toHaveBeenCalledWith({ is_new: true })
    })
  })

  // ============ getAgentOptionData 测试 ============
  describe('getAgentOptionData', () => {
    it('应调用 store.getAgentOptionData', () => {
      const { result } = renderHook(() => useAgentForm())

      const data = result.current.getAgentOptionData()

      expect(mockStore.getAgentOptionData).toHaveBeenCalled()
      expect(data).toEqual({ id: 'prompt', mode: 'chat' })
    })
  })

  // ============ getSupportFile 测试 ============
  describe('getSupportFile', () => {
    it('应调用 store.getSupportFile', () => {
      const { result } = renderHook(() => useAgentForm())

      const support = result.current.getSupportFile()

      expect(mockStore.getSupportFile).toHaveBeenCalled()
      expect(support).toBe(false)
    })
  })

  // ============ getIsIndependent 测试 ============
  describe('getIsIndependent', () => {
    it('应调用 store.getIsIndependent', () => {
      const { result } = renderHook(() => useAgentForm())

      const isIndependent = result.current.getIsIndependent()

      expect(mockStore.getIsIndependent).toHaveBeenCalled()
      expect(isIndependent).toBe(false)
    })
  })
})

// ============ createValidateForm 测试 ============
describe('createValidateForm', () => {
  it('表单验证成功应返回 true', async () => {
    const mockForm = {
      validateFields: vi.fn().mockResolvedValue({}),
    }

    const validate = createValidateForm(mockForm)
    const result = await validate()

    expect(result).toBe(true)
  })

  it('表单验证失败应返回 false', async () => {
    const mockForm = {
      validateFields: vi.fn().mockRejectedValue(new Error('验证失败')),
    }

    const validate = createValidateForm(mockForm)
    const result = await validate()

    expect(result).toBe(false)
  })

  it('表单为空应返回 true', async () => {
    const validate = createValidateForm(null)
    const result = await validate()

    expect(result).toBe(true)
  })

  it('表单为 undefined 应返回 true', async () => {
    const validate = createValidateForm(undefined)
    const result = await validate()

    expect(result).toBe(true)
  })
})
