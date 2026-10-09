import { describe, expect, it } from 'vitest'
import {
	RecordingCognitionCandidate,
	RecordingDecisionContextPackage,
	RecordingDecisionRuntimeContext,
	resolveInsightPerspectiveForSubmit,
} from './types'

describe('insight scene compatibility', () => {
  it('preserves auto until the user explicitly changes the scene', () => {
    expect(resolveInsightPerspectiveForSubmit('auto', 'strategy_operation', false)).toBe('auto')
    expect(resolveInsightPerspectiveForSubmit('auto', 'customer_growth', true)).toBe('customer_growth')
  })

  it('preserves a legacy value until the user explicitly changes the scene', () => {
    expect(resolveInsightPerspectiveForSubmit('sales_visit', 'customer_growth', false)).toBe('sales_visit')
  })
})

describe('recording cognition and decision context baseline contract', () => {
	it('accepts the four-source runtime context envelope', () => {
		const runtime: RecordingDecisionRuntimeContext = {
			context_version: 'v1.1',
			current_context: [{ audit_item_id: 'current:1', source_id: '1', content: '当前事实' }],
			boss_cognition: [],
			business_memory: [],
			enterprise_knowledge: [],
			evidence_refs: ['seg-1'],
			degraded: true,
			degradation_reasons: ['enterprise_knowledge_scope_missing'],
		}
		expect(runtime.current_context[0].content).toBe('当前事实')
		expect(runtime.degradation_reasons).toContain('enterprise_knowledge_scope_missing')
	})

  it('keeps imported cognition as a reviewable candidate', () => {
    const candidate: RecordingCognitionCandidate = {
      id: 'candidate-1',
      eid: 'eid-1',
      owner_id: 'owner-1',
      file_id: 'file-1',
      title: '现金流优先',
      statement: '先验证再扩大投入',
      cognition_type: 'principle',
      canonical_type: 'criterion',
      canonical_type_status: 'candidate',
      layer: 'core',
      scope: [],
      source_type: 'external_import',
      confidence: 0.8,
      source_file_id: 'file-1',
      source_segment_ids: ['seg-1'],
      status: 'candidate',
      external_source: 'crm',
      external_ref: 'boss-profile-1',
    }

    expect(candidate.status).toBe('candidate')
    expect(candidate.external_source).toBe('crm')
    expect(candidate.source_segment_ids).toEqual(['seg-1'])
    expect(candidate.canonical_type_status).toBe('candidate')
  })

  it('keeps current facts, evidence policy, and memory shadow boundary', () => {
    const context: RecordingDecisionContextPackage = {
      current_context: {
        file_id: 'file-1',
        generation: 2,
        minutes_hash: 'hash-1',
        segment_ids: ['seg-1'],
        claims: [{ temp_id: 'decision-1', kind: 'decision', content: '先验证', evidence_segment_ids: ['seg-1'] }],
        entities: [],
        relations: [],
        claim_entity_bindings: [],
      },
      cognitions: { core: [], situational: [], conflicts: [] },
      business_memory: { items: [] },
      evidence_policy: {
        current_facts_first: true,
        require_source_segments: true,
        max_relation_hops: 1,
        memory_v2_shadow_only: true,
      },
      omitted_reasons: ['候选未确认'],
      built_at_unix: 1710000000000,
    }

    expect(context.current_context.claims[0].evidence_segment_ids).toEqual(['seg-1'])
    expect(context.evidence_policy.current_facts_first).toBe(true)
    expect(context.evidence_policy.memory_v2_shadow_only).toBe(true)
    expect(context.omitted_reasons).toContain('候选未确认')
  })
})
