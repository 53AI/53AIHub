/**
 * 录音数据解析纯函数
 *
 * 这些函数不依赖 React 或接口调用，被两类调用方共用：
 * - useFileParse（登录态：分阶段轮询后逐个解析）
 * - 分享落地页（匿名态：一次性拿到快照后解析）
 * 放在这里保证两端对同一份后端数据的解析口径完全一致。
 */

import { parseTranscriptContent } from '@/components/Audio/index'
import { stripMarkdownCodeFence } from '@/views/recording/components/insightRenderer/markdownParser'

export interface TranscriptItem {
  id: string
  time: string
  seconds: number
  speaker: string
  speakerNum: number
  content: string
}

/**
 * 转写解析结果：条目 + 解析过程中顺带拿到的音频地址
 *
 * 后端语音模型 JSON 把 file_url 与 transcripts 放在同一个对象里（OSS 临时签名 URL），
 * 登录态通过 file metadata 拿 URL，分享快照只能从 transcription 字符串里取出来。
 * 旧调用方只用 items，所以单独提供 parseTranscription；需要 file_url 的场景（分享页）
 * 走 parseTranscriptionWithUrl，避免给登录态引入额外解构负担。
 */
export interface ParsedTranscription {
  items: TranscriptItem[]
  fileUrl?: string
}

/** 从语音模型 JSON 里抽出音频地址（非字符串视作缺省，避免把异常值塞给 <audio>） */
function extractFileUrl(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined
  const url = (json as { file_url?: unknown }).file_url
  return typeof url === 'string' && url.trim() ? url : undefined
}

/** 毫秒 → hh:mm:ss */
export function msToTimeStr(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * 解析语音模型转写 JSON（内部用）
 * 无 sentences 时降级为整段文本单条展示；非法 JSON 返回空数组交由上层兜底。
 * 同时把根级的 file_url（OSS 临时签名 URL）一并带出，分享快照只能用这一条路径
 * 拿到音频地址，登录态则继续走 file metadata。
 */
function parseVoiceTranscriptRaw(content: string): ParsedTranscription {
  if (!content?.trim()) return { items: [] }
  try {
    const json = JSON.parse(content)
    const fileUrl = extractFileUrl(json)
    const transcripts = json?.transcripts || []
    const sentences: Array<{
      begin_time: number
      end_time: number
      text: string
      speaker_id: number
    }> = []
    transcripts.forEach((t: any) => {
      if (Array.isArray(t.sentences)) {
        sentences.push(...t.sentences)
      }
    })

    if (sentences.length === 0) {
      const fullText = transcripts.map((t: any) => t.text || '').filter(Boolean).join('\n')
      if (fullText) {
        return {
          items: [{
            id: 'transcript-1',
            time: '00:00:00',
            seconds: 0,
            speaker: 'A说话人',
            speakerNum: 1,
            content: fullText,
          }],
          fileUrl,
        }
      }
      return { items: [], fileUrl }
    }

    return {
      items: sentences.map((s, index) => ({
        id: `transcript-${index + 1}`,
        time: msToTimeStr(s.begin_time || 0),
        seconds: Math.floor((s.begin_time || 0) / 1000),
        speaker: `${String.fromCharCode(65 + (s.speaker_id ?? 0))}说话人`,
        speakerNum: (s.speaker_id ?? 0) + 1,
        content: s.text || '',
      })),
      fileUrl,
    }
  } catch {
    return { items: [] }
  }
}

/**
 * 解析语音模型转写 JSON（公开 API，只取条目）
 * 保留旧签名给 useFileParse 等历史调用方，避免影响既有类型契约。
 */
export function parseVoiceTranscriptJSON(content: string): TranscriptItem[] {
  return parseVoiceTranscriptRaw(content).items
}

/**
 * 解析转写内容：先按新格式（语音模型 JSON），失败再按旧格式（## 说话人分块 Markdown）。
 * 两种都解析不出条目时返回空数组，由调用方决定如何兜底展示。
 */
export function parseTranscription(content: string): TranscriptItem[] {
  return parseTranscriptionWithUrl(content).items
}

/**
 * 解析转写内容 + 音频地址
 * 依次尝试三种格式，找到第一个能产出条目的就返回：
 * 1. 语音模型 JSON（带 file_url，分享快照旧版 / 登录态都用这个）
 * 2. 老格式 Markdown（`## {speakerNum}` 分块 + `> hh:mm:ss - hh:mm:ss`）
 * 3. 新格式 Markdown（`[hh:mm:ss] 说话人: 文本`，分享接口后端预渲染产物）
 *
 * 老格式 / 新格式 Markdown 不含 file_url，统一返回 undefined。
 */
export function parseTranscriptionWithUrl(content: string): ParsedTranscription {
  const raw = parseVoiceTranscriptRaw(content)
  if (raw.items.length > 0) return raw
  const oldFormatItems = parseTranscriptContent(content, [])
  if (oldFormatItems.length > 0) return { items: oldFormatItems, fileUrl: undefined }
  const lineItems = parseTranscriptLines(content)
  return { items: lineItems, fileUrl: undefined }
}

/** `hh:mm:ss` 或 `mm:ss` → 秒数（与 Audio/index 中 timeStringToSeconds 行为一致） */
function timeStringToSeconds(timeStr: string): number {
  const parts = timeStr.trim().split(':').map(Number)
  if (parts.length === 2) {
    const [m, s] = parts
    return (m || 0) * 60 + (s || 0)
  }
  if (parts.length === 3) {
    const [h, m, s] = parts
    return (h || 0) * 3600 + (m || 0) * 60 + (s || 0)
  }
  return 0
}

/** 从说话人文本里推出 speakerNum，用于 UI 颜色轮换等场景 */
function deriveSpeakerNum(speaker: string): number {
  const letter = /^([A-Z])/i.exec(speaker)
  if (letter) {
    const code = letter[1].toUpperCase().charCodeAt(0) - 64
    if (code >= 1 && code <= 26) return code
  }
  const num = /(\d+)\s*$/.exec(speaker)
  if (num) return parseInt(num[1], 10)
  return 1
}

/**
 * 解析分享接口后端预渲染的转写 Markdown：`# 文件名\n\n[hh:mm:ss] 说话人: 内容\n…`
 * 逐行匹配时间戳前缀，跳过开头的 `# ` 标题（与页面 header 重复）。
 * 不含音频地址，调用方 fileUrl = undefined。
 */
export function parseTranscriptLines(content: string): TranscriptItem[] {
  if (!content?.trim()) return []
  const items: TranscriptItem[] = []
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('# ')) continue
    const match = line.match(/^\[(\d{2}:\d{2}(?::\d{2})?)\]\s*([^:]+?):\s*(.*)$/)
    if (!match) continue
    const [, timeStr, speakerRaw, contentText] = match
    items.push({
      id: `transcript-${items.length + 1}`,
      time: timeStr,
      seconds: timeStringToSeconds(timeStr),
      speaker: speakerRaw.trim(),
      speakerNum: deriveSpeakerNum(speakerRaw.trim()),
      content: contentText.trim(),
    })
  }
  return items
}

/**
 * 解析 page_json：兼容旧 JSON Block 格式和新 Markdown 格式
 * 旧格式以 { 开头（JSON.parse），新格式为 Markdown 字符串
 * 统一返回 { _markdown?: string, ... } 结构，非 Markdown 时保留原有字段
 */
export function parsePageJson(pageJson: string): Record<string, any> {
  const trimmed = pageJson.trim()
  if (trimmed.startsWith('{')) {
    // 旧格式：JSON Block 结构
    return JSON.parse(pageJson)
  }
  // 新格式：Markdown 字符串
  // 后端可能用 ```markdown ... ``` 把整段包起来返回，先剥掉围栏避免污染
  return { _markdown: stripMarkdownCodeFence(pageJson) }
}

/**
 * parsePageJson 的安全版：入参非字符串或解析失败时返回 null。
 *
 * 分享接口的 insight_page 既可能是字符串，也可能被包成 { page_json }，
 * 这里统一收口，避免每个调用点各写一遍 try/catch 和类型判断。
 */
export function safeParsePageJson(pageJson?: unknown): Record<string, any> | null {
  const raw = typeof pageJson === 'string'
    ? pageJson
    : (pageJson as { page_json?: string } | null)?.page_json
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    return parsePageJson(raw)
  } catch {
    return null
  }
}
