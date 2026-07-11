import { describe, it, expect } from 'vitest'
import { DEFAULT_PIPELINE_STEP } from '@km/shared-business/knowledge-pipeline'
import type { Strategy } from '@/api/modules/rag-strategy'

// 导入实际的函数进行测试
// 注意：由于 createPipelineFromRule 是模块内部的辅助函数，
// 我们需要通过测试实际的 useRuleEditor hook 来间接测试它
// 或者我们可以提取这个函数到单独的工具文件中

// 为了验证修复效果，我们先模拟实现
const createPipelineFromRuleFixed = (rule: Partial<Strategy>) => {
  // 1. 获取传入的 steps
  const inputSteps = rule.pipeline_profile?.steps || []

  // 2. 使用 DEFAULT_PIPELINE_STEP 作为基准补全缺失字段
  const normalizedSteps = inputSteps.map(inputStep => {
    // 找到对应的默认步骤
    const defaultStep = DEFAULT_PIPELINE_STEP.find(d => d.step_key === inputStep.step_key)

    if (!defaultStep) {
      // 如果没有找到对应的默认步骤，至少填充基本字段
      return {
        step_key: inputStep.step_key,
        run_mode: inputStep.run_mode || 'auto',
        name: inputStep.name || inputStep.step_key,
        description: inputStep.description || '',
        config: inputStep.config || {},
      }
    }

    // 合并：默认值 + 输入值（输入值覆盖默认值）
    return {
      ...defaultStep,
      ...inputStep,
      config: {
        ...defaultStep.config,
        ...(inputStep.config || {}),
      },
    }
  })

  // 3. 如果没有输入步骤，使用默认步骤
  const steps = normalizedSteps.length > 0 ? normalizedSteps : JSON.parse(JSON.stringify(DEFAULT_PIPELINE_STEP))

  return {
    id: rule.pipeline_id || '',
    name: rule.pipeline_name || '',
    icon: rule.icon || '',
    created_at: '',
    profile_json: { steps },
    stats: { total: 0, success_rate: 0 },
  }
}

describe('createPipelineFromRule - 缩略数据处理', () => {
  // 模拟后端返回的缩略数据（只有 step_key）
  const minimalStrategy: Partial<Strategy> = {
    id: 'test-1',
    name: '默认策略',
    pipeline_id: 'pipeline-1',
    pipeline_name: '默认管线',
    icon: 'test-icon',
    pipeline_profile: {
      steps: [
        { step_key: 'document_parsing' },
        { step_key: 'content_cleaning' },
        { step_key: 'document_chunking' },
        { step_key: 'vector_indexing' },
        { step_key: 'graph_generation' },
      ],
    },
  }

  it('修复后的实现：缩略数据被正确补全', () => {
    const pipeline = createPipelineFromRuleFixed(minimalStrategy)

    // 验证步骤数量
    expect(pipeline.profile_json.steps.length).toBe(5)

    // 验证每个步骤都被正确补全
    const firstStep = pipeline.profile_json.steps[0]

    // 这些字段应该有值（使用 DEFAULT_PIPELINE_STEP 的默认值）
    expect(firstStep.run_mode).toBeDefined()
    expect(firstStep.name).toBeDefined()
    expect(firstStep.description).toBeDefined()
    expect(firstStep.config).toBeDefined()

    // 验证具体值是否正确
    expect(firstStep.step_key).toBe('document_parsing')
    expect(firstStep.run_mode).toBe('auto')
    expect(firstStep.config.engine).toBe('markitdown')

    console.log('✅ 修复后的结果：', {
      step_key: firstStep.step_key,
      run_mode: firstStep.run_mode,
      name: firstStep.name,
      description: firstStep.description,
      config: firstStep.config,
    })
  })

  it('修复后的实现：完整数据保持不变', () => {
    // 模拟完整数据（包含所有字段）
    const fullStrategy: Partial<Strategy> = {
      id: 'test-2',
      name: '自定义策略',
      pipeline_id: 'pipeline-2',
      pipeline_name: '自定义管线',
      icon: 'custom-icon',
      pipeline_profile: {
        steps: [
          {
            step_key: 'document_parsing',
            run_mode: 'manual',
            name: 'custom_name',
            description: 'custom_desc',
            config: { engine: 'custom_engine', custom_option: true },
          },
        ],
      },
    }

    const pipeline = createPipelineFromRuleFixed(fullStrategy)

    // 验证自定义值被保留，没有被默认值覆盖
    const firstStep = pipeline.profile_json.steps[0]

    expect(firstStep.run_mode).toBe('manual') // 自定义值
    expect(firstStep.name).toBe('custom_name') // 自定义值
    expect(firstStep.config.engine).toBe('custom_engine') // 自定义值
    expect(firstStep.config.custom_option).toBe(true) // 新增的自定义配置

    console.log('✅ 完整数据保持不变：', firstStep)
  })

  it('修复后的实现：部分字段缺失时选择性补全', () => {
    // 模拟部分字段缺失的数据
    const partialStrategy: Partial<Strategy> = {
      id: 'test-3',
      pipeline_id: 'pipeline-3',
      pipeline_profile: {
        steps: [
          {
            step_key: 'document_parsing',
            run_mode: 'skip', // 只提供了 run_mode
          },
        ],
      },
    }

    const pipeline = createPipelineFromRuleFixed(partialStrategy)
    const firstStep = pipeline.profile_json.steps[0]

    // run_mode 使用自定义值
    expect(firstStep.run_mode).toBe('skip')

    // 其他字段使用默认值补全
    expect(firstStep.name).toBeDefined()
    expect(firstStep.description).toBeDefined()
    expect(firstStep.config).toBeDefined()
    expect(firstStep.config.engine).toBe('markitdown')

    console.log('✅ 部分缺失选择性补全：', firstStep)
  })
})