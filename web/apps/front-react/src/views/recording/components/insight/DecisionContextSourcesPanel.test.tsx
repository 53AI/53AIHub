import { describe, expect, it } from 'vitest'
import { formatDecisionContextReason } from './DecisionContextSourcesPanel'

describe('decision context degradation labels', () => {
  it('translates known runtime reasons and keeps scope details', () => {
    expect(formatDecisionContextReason('enterprise_knowledge_scope_missing')).toBe('未配置授权知识库范围')
    expect(formatDecisionContextReason('enterprise_knowledge_search_failed:scope-1')).toBe('企业知识检索失败，已降级为三源上下文（范围 scope-1）')
    expect(formatDecisionContextReason('enterprise_knowledge_permission_filtered:chunk-1')).toBe('部分企业知识因权限被排除（引用 chunk-1）')
  })

  it('preserves unknown and free-form reasons for compatibility', () => {
    expect(formatDecisionContextReason('legacy_reason')).toBe('legacy_reason')
    expect(formatDecisionContextReason('')).toBe('')
  })
})
