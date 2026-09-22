import { describe, expect, it } from 'vitest'
import { INSIGHT_BACKGROUND_CARDS, parseRelatedHistory } from './InsightBackgroundWorkshop'

describe('parseRelatedHistory', () => {
  it('parses structured memories and meetings', () => {
    const result = parseRelatedHistory(JSON.stringify({
      related_memories: [{ memory_id: 7, type: 'decision', content: '先做小范围验证' }],
      related_meetings: [{ file_id: 9, title: '供应商会议', minutes: '会议纪要' }],
    }))

    expect(result?.memories).toEqual([{ memory_id: 7, type: 'decision', content: '先做小范围验证' }])
    expect(result?.meetings).toEqual([{ file_id: 9, title: '供应商会议', minutes: '会议纪要' }])
  })

  it('returns an empty result for valid empty history', () => {
    expect(parseRelatedHistory('{"related_memories":[],"related_meetings":[]}')).toEqual({
      memories: [],
      meetings: [],
    })
  })

  it('falls back for legacy non-json text', () => {
    expect(parseRelatedHistory('旧版关联记忆文本')).toBeNull()
  })

  it('keeps personal information server-controlled', () => {
    expect(INSIGHT_BACKGROUND_CARDS.find((card) => card.key === 'personal_info')?.readOnly).toBe(true)
  })

  it('hides low-confidence historical memories from the background card', () => {
    const result = parseRelatedHistory(JSON.stringify({
      related_memories: [
        { memory_id: 1, type: 'viewpoint', content: '不应展示', confidence: 0 },
        { memory_id: 2, type: 'decision', content: '应展示', confidence: 0.8 },
      ],
    }))
    expect(result?.memories.map((memory) => memory.content)).toEqual(['应展示'])
  })
})
