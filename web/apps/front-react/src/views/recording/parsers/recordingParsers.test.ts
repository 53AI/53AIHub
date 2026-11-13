import { describe, expect, it } from 'vitest'
import {
  isInsightHTMLPage,
  parsePageJson,
  parseTranscription,
  parseTranscriptionWithUrl,
  parseTranscriptLines,
  parseVoiceTranscriptJSON,
} from './recordingParsers'

describe('parsePageJson', () => {
  it('识别新的 HTML 页面封装', () => {
    const parsed = parsePageJson(JSON.stringify({
      format: 'html_v2',
      version: 1,
      html: '<!doctype html><html><body><svg /></body></html>',
    }))
    expect(isInsightHTMLPage(parsed)).toBe(true)
    expect(parsed._html).toContain('<svg')
  })

  it('html_v2 的 HTML 会被装饰：body 白底 + 根节点布局 style', () => {
    const parsed = parsePageJson(JSON.stringify({
      format: 'html_v2',
      version: 1,
      html: '<!doctype html><html><head><style>body{background:red}</style></head><body><div class="page">内容</div></body></html>',
    }))
    expect(parsed._html).toContain('background-color: #fff')
    // 装饰走 inline style（HTML_ROOT_CLASS），不依赖宿主 Tailwind 环境
    expect(parsed._html).toContain('class="page"')
    expect(parsed._html).toContain('style="max-width: 1200px; margin: 0 auto; padding: 0;')
  })

  it('历史 Markdown 仍然返回旧格式', () => {
    const parsed = parsePageJson('# 旧版洞察\n\n## 风险\n内容')
    expect(parsed).toEqual({ _markdown: '# 旧版洞察\n\n## 风险\n内容' })
    expect(isInsightHTMLPage(parsed)).toBe(false)
  })

  it('历史 JSON Block 不被误判为 HTML', () => {
    const parsed = parsePageJson(JSON.stringify({ title: '旧页面', blocks: [] }))
    expect(parsed).toEqual({ title: '旧页面', blocks: [] })
    expect(isInsightHTMLPage(parsed)).toBe(false)
  })
})

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

  it('说话人携带头像标记时提取 avatarUrl，speaker 为纯文本（与 KM-Record 同源）', () => {
    const content = '[00:00:01] ![avatar](https://oss.example.com/u1.png) 张三: 你好。'
    const items = parseTranscriptLines(content)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      speaker: '张三',
      avatarUrl: 'https://oss.example.com/u1.png',
      content: '你好。',
    })
  })

  it('说话人携带隐藏人员注释时从 speaker 中剔除，不影响解析', () => {
    const content =
      '[00:00:01] ![avatar](https://oss.example.com/u1.png) 李四<!--contact:{"id":"mem-42"}-->: 内容甲'
    const items = parseTranscriptLines(content)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      // 注释与头像标记都不进 speaker 纯文本
      speaker: '李四',
      contactId: 'mem-42',
      avatarUrl: 'https://oss.example.com/u1.png',
      content: '内容甲',
    })
  })

  it('绑定人员缺失头像 URL 时仍保留联系人的 ID', () => {
    const items = parseTranscriptLines('[00:00:01] 李四<!--contact:{"id":"mem-42"}-->: 你好')
    expect(items[0]).toMatchObject({ speaker: '李四', contactId: 'mem-42' })
    expect(items[0].avatarUrl).toBeUndefined()
  })

  it('说话人B 格式也按 B 分配颜色编号', () => {
    const items = parseTranscriptLines('[00:00:01] 说话人A: 一\n[00:00:02] 说话人B: 二')
    expect(items.map(item => item.speakerNum)).toEqual([1, 2])
  })

  it('未绑定说话人无 avatarUrl 字段', () => {
    const items = parseTranscriptLines('[00:00:01] 说话人1: 你好。')
    expect(items[0].avatarUrl).toBeUndefined()
  })
})
