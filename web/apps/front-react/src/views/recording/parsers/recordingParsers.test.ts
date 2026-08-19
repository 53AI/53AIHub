import { describe, expect, it } from 'vitest'
import {
  parseTranscription,
  parseTranscriptionWithUrl,
  parseTranscriptLines,
  parseVoiceTranscriptJSON,
} from './recordingParsers'

describe('parseTranscriptionWithUrl', () => {
  it('从语音模型 JSON 抽出 file_url 和条目', () => {
    const content = JSON.stringify({
      file_url: 'https://oss-cn-hangzhou.aliyuncs.com/recording/abc.m4a?Signature=xxx',
      transcripts: [
        {
          sentences: [
            { begin_time: 0, end_time: 5000, text: '你好', speaker_id: 0 },
            { begin_time: 5000, end_time: 12000, text: '世界', speaker_id: 1 },
          ],
        },
      ],
    })

    const result = parseTranscriptionWithUrl(content)
    expect(result.fileUrl).toBe('https://oss-cn-hangzhou.aliyuncs.com/recording/abc.m4a?Signature=xxx')
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({
      seconds: 0,
      speaker: 'A说话人',
      speakerNum: 1,
      content: '你好',
    })
    expect(result.items[1]).toMatchObject({
      seconds: 5,
      speaker: 'B说话人',
      speakerNum: 2,
      content: '世界',
    })
  })

  it('JSON 不带 file_url 时只返回条目', () => {
    const content = JSON.stringify({
      transcripts: [
        { sentences: [{ begin_time: 1000, text: 'hi', speaker_id: 0 }] },
      ],
    })

    const result = parseTranscriptionWithUrl(content)
    expect(result.fileUrl).toBeUndefined()
    expect(result.items).toHaveLength(1)
  })

  it('非字符串 file_url 视作缺省', () => {
    const content = JSON.stringify({
      file_url: 12345,
      transcripts: [{ sentences: [{ begin_time: 0, text: 'hi', speaker_id: 0 }] }],
    })
    expect(parseTranscriptionWithUrl(content).fileUrl).toBeUndefined()
  })

  it('空字符串 file_url 视作缺省', () => {
    const content = JSON.stringify({
      file_url: '   ',
      transcripts: [{ sentences: [{ begin_time: 0, text: 'hi', speaker_id: 0 }] }],
    })
    expect(parseTranscriptionWithUrl(content).fileUrl).toBeUndefined()
  })

  it('空字符串 / 空白输入返回空结果', () => {
    expect(parseTranscriptionWithUrl('')).toEqual({ items: [] })
    expect(parseTranscriptionWithUrl('  ')).toEqual({ items: [] })
  })

  it('非法 JSON 走 Markdown 降级，fileUrl 为 undefined', () => {
    // 不是 JSON，也不是 ## 开头 → parseTranscriptContent 也会返回 []
    const result = parseTranscriptionWithUrl('not json at all')
    expect(result).toEqual({ items: [], fileUrl: undefined })
  })

  it('JSON 里有 transcripts 但没 sentences，整段文本单条展示，file_url 仍带出', () => {
    const content = JSON.stringify({
      file_url: 'https://example.com/a.m4a',
      transcripts: [{ text: '完整文本' }],
    })
    const result = parseTranscriptionWithUrl(content)
    expect(result.fileUrl).toBe('https://example.com/a.m4a')
    expect(result.items).toEqual([
      expect.objectContaining({ id: 'transcript-1', content: '完整文本', seconds: 0 }),
    ])
  })
})

describe('parseTranscription（向后兼容）', () => {
  it('仍只返回 items，不破坏现有调用方', () => {
    const content = JSON.stringify({
      file_url: 'https://example.com/a.m4a',
      transcripts: [{ sentences: [{ begin_time: 0, text: 'hi', speaker_id: 0 }] }],
    })
    expect(parseTranscription(content)).toHaveLength(1)
    // 返回值仍是数组（不是对象），调用方无需改类型
    expect(Array.isArray(parseTranscription(content))).toBe(true)
  })
})

describe('parseVoiceTranscriptJSON（向后兼容）', () => {
  it('仍只返回 items', () => {
    const content = JSON.stringify({
      file_url: 'https://example.com/a.m4a',
      transcripts: [{ sentences: [{ begin_time: 0, text: 'hi', speaker_id: 0 }] }],
    })
    expect(parseVoiceTranscriptJSON(content)).toHaveLength(1)
  })
})

describe('parseTranscriptLines（分享接口后端预渲染 Markdown）', () => {
  it('逐行解析 [hh:mm:ss] 说话人: 内容，跳过开头的 # 标题', () => {
    const content = [
      '# 批量采购价格谈判.mp3',
      '',
      '[00:00:01] A说话人: 你好，我先开门见山。',
      '',
      '[00:00:12] B说话人: 感谢你们的认可。',
    ].join('\n')

    const items = parseTranscriptLines(content)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      id: 'transcript-1',
      time: '00:00:01',
      seconds: 1,
      speaker: 'A说话人',
      speakerNum: 1,
      content: '你好，我先开门见山。',
    })
    expect(items[1]).toMatchObject({
      id: 'transcript-2',
      time: '00:00:12',
      seconds: 12,
      speaker: 'B说话人',
      speakerNum: 2,
      content: '感谢你们的认可。',
    })
  })

  it('内容里不含音频地址', () => {
    const content = '[00:00:01] A说话人: 你好。'
    expect(parseTranscriptionWithUrl(content).fileUrl).toBeUndefined()
  })

  it('空输入返回空数组', () => {
    expect(parseTranscriptLines('')).toEqual([])
    expect(parseTranscriptLines('  \n\n  ')).toEqual([])
  })

  it('无时间戳前缀的纯文本不产生条目', () => {
    expect(parseTranscriptLines('随便写点文字\n没有时间戳')).toEqual([])
  })
})