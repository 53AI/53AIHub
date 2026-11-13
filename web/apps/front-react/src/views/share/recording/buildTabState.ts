/**
 * 录音分享视图共享逻辑：tab state 组装 + 工具函数
 *
 * 抽出的目的：
 * - snapshot 分支（ShareRecordingView）从 RecordingSharedContent 一把梭，
 *   后端已经在快照里预清洗了 insight_page / transcription 字段
 * - live 分支（ShareRecordingLiveView）走实时 5 个接口，
 *   前端要从 RawFileItem + FileParseStatus + TranscriptionExportResponse + RecordingFileSummary[] + RecordingFileInsightPage 重新组装
 * 两者最终都收敛成同一个 TabState，渲染层零感知。
 */
import type { RecordingSharedContent, RecordingFileSummary, TranscriptionExportResponse, FileParseStatus, RecordingFileInsightPage } from '@/api/modules/recording/types'
import type { RawFileItem } from '@/api/modules/files/types'
import type { RecordingShareSelection } from '@/views/recording/selection/shareSelection'
import { buildLibraryPreviewUrl, buildPreviewUrl } from '@/utils/preview'
import { parseTranscriptLines, parseTranscriptionWithUrl, safeParsePageJson, type TranscriptItem } from '@/views/recording/parsers/recordingParsers'

/** 渲染层消费的 tab state —— 两分支共同产物。 */
export interface TabState {
  summaries: RecordingFileSummary[]
  /** 纪要：template_id === 0 且有 summary_content */
  meetingMinutes: RecordingFileSummary | undefined
  /** 模板总结：template_id !== 0 且有 summary_content */
  templateSummaries: RecordingFileSummary[]
  /** 转写条目 */
  transcriptItems: TranscriptItem[]
  /**
   * 分享快照里的音频地址：优先语音模型 JSON 根级 file_url（OSS 临时签名 URL），
   * 缺省时退回 upload_file.preview_key 拼出的 /api/preview/{key}。
   */
  transcriptFileUrl?: string
  /** 页面编排结果（Markdown → {_markdown} / JSON Block → 原结构） */
  insightPage: Record<string, any> | null
  hasInsight: boolean
  hasSummary: boolean
  hasTranscript: boolean
}

/** 模板总结 tab key 命名规则 —— 渲染层按 sum- 前缀识别模板总结 tab */
export function sumTabKey(id: string | number): string {
  return `sum-${id}`
}

/**
 * 分享快照里的 title 在某些链路上会带双重后缀（如 "xxx.mp3.md"），
 * 出现多重扩展时去掉最后一个后缀，还原成原始文件名。
 */
export function stripLastExtension(title: string): string {
  const lastDot = title.lastIndexOf('.')
  if (lastDot <= 0) return title
  if (title.slice(0, lastDot).includes('.')) {
    return title.slice(0, lastDot)
  }
  return title
}

/** snapshot 分支入参 —— 后端已预清洗过 insight_page / transcription */
export interface SnapshotTabInputs {
  kind: 'snapshot'
  snapshot: RecordingSharedContent
  selection: RecordingShareSelection | null
}

/** live 分支入参 —— 前端从 5 个接口分别拉取后组装 */
export interface LiveTabInputs {
  kind: 'live'
  /** 来自 filesApi.get，承载 file_id + file_name（或 path）+ upload_file.preview_key（音频地址） */
  file: RawFileItem
  /** 来自 recordingApi.getParseStatus —— 当前实时分支未在 TabState 中使用，保留便于以后按状态禁用 tab */
  parseStatus: FileParseStatus | null
  /**
   * 来自 recordingApi.exportTranscription（/transcription/export，后端预渲染 Markdown）
   * —— 可能为 null（接口失败 / 无数据）。
   * 不用 /transcription 原始接口：它偶尔「状态 normal 但内容空」，
   * 导出接口是稳定产物（与主录音页 useFileParse 同源同口径）。
   */
  transcriptionExport: TranscriptionExportResponse | null
  /** 来自 recordingApi.getFileSummaries —— 可能为 [] */
  summaries: RecordingFileSummary[]
  /** 来自 recordingApi.getInsightPage —— 可能为 null */
  insightPage: RecordingFileInsightPage | null
  selection: RecordingShareSelection | null
}

export type TabInputs = SnapshotTabInputs | LiveTabInputs

/**
 * 快照 → tab 状态。
 *
 * 音频地址两条来源：旧快照的语音模型 JSON 根级 file_url，新快照只剩透传的
 * upload_file —— 用 preview_key 拼出匿名可访问的 /api/preview/{key}。
 *
 * `selection` 来自 URL `?t=<base64url>` —— 用户在分享 popover 里勾选要包含的内容：
 * - i 洞察 / s 纪要 / t 转写：核心 tab，按勾选屏蔽
 * - sums：模板总结 id 列表，按 id 过滤（不在列表里的 sum-* 不渲染）
 * 未传 / 解码失败 → null，全量展示（与历史链接兼容，避免被静默裁剪）。
 */
function buildFromSnapshot(snapshot: RecordingSharedContent, selection: RecordingShareSelection | null): TabState {
  const summaries = snapshot.summaries ?? []
  const meetingMinutes = summaries.find((s) => s.template_id === 0 && s.summary_content)
  const allTemplates = summaries.filter((s) => s.template_id !== 0 && s.summary_content)
  // 用 parseTranscriptionWithUrl 一次拿齐 items + file_url，避免两份解析走偏
  const { items: transcriptItems, fileUrl } = snapshot.transcription
    ? parseTranscriptionWithUrl(snapshot.transcription)
    : { items: [] as TranscriptItem[], fileUrl: undefined }

  const transcriptFileUrl = fileUrl ?? buildLibraryPreviewUrl(snapshot.file_id, snapshot.upload_file?.file_name || 'audio.mp3')
  const insightPage = safeParsePageJson(snapshot.insight_page)

  const showInsight = !!insightPage
  const showSummary = !!meetingMinutes
  const showTranscript = transcriptItems.length > 0
  const templateSummaries = selection
    ? allTemplates.filter((s) => selection.sums.includes(s.id))
    : allTemplates

  return {
    summaries,
    meetingMinutes,
    templateSummaries,
    transcriptItems,
    transcriptFileUrl,
    insightPage,
    hasInsight: selection ? selection.i && showInsight : showInsight,
    hasSummary: selection ? selection.s && showSummary : showSummary,
    hasTranscript: selection ? selection.t && showTranscript : showTranscript,
  }
}

/**
 * 实时 5 接口产物 → tab 状态。
 *
 * 与 snapshot 分支的差异：
 * - transcriptionExport 是 /transcription/export 的预渲染 Markdown
 *   （`[hh:mm:ss] 说话人: 文本`），用 parseTranscriptLines 还原条目；
 *   不含音频地址，音频从 file.upload_file.preview_key 还原匿名 /api/preview/{key}
 *   （对齐 snapshot 分支设计；不再依赖语音 JSON 根级 file_url）
 * - insightPage 是 RecordingFileInsightPage 对象（含 page_json string），不是已渲染字符串；
 *   用 safeParsePageJson 解析成 { _markdown } / Block 结构
 * - file_name 来自 RawFileItem.path（拆出最后一段）
 *
 * 错误接口的产物以 null 形态传入，本函数视同「无内容」处理，
 * 渲染层按 has* 字段决定 tab 是否展示，tab 自身在 content 缺失时各自走空态。
 */
function buildFromLive(inputs: LiveTabInputs): TabState {
  const { file, transcriptionExport, summaries, insightPage, selection } = inputs
  const allSummaries = summaries ?? []
  const meetingMinutes = allSummaries.find((s) => s.template_id === 0 && s.summary_content)
  const allTemplates = allSummaries.filter((s) => s.template_id !== 0 && s.summary_content)

  // 转写条目：/transcription/export 预渲染 Markdown，与主录音页解析口径一致
  const transcriptItems = parseTranscriptLines(transcriptionExport?.markdown ?? '')

  // audio 地址：优先 upload_file.preview_key 还原匿名 /api/preview/{key}（<audio> 无法带
  // Authorization，必须走匿名路径）；preview_key 缺失时退回 /api/files/{id}/preview 兕底
  const fileName = extractFileNameFromPath(file.path)
  const transcriptFileUrl =
    buildPreviewUrl(file.upload_file?.preview_key) ??
    buildLibraryPreviewUrl(String(file.id), fileName || 'audio.mp3')

  const parsedInsightPage = insightPage ? safeParsePageJson(insightPage.page_json) : null

  const showInsight = !!parsedInsightPage
  const showSummary = !!meetingMinutes
  const showTranscript = transcriptItems.length > 0
  const templateSummaries = selection
    ? allTemplates.filter((s) => selection.sums.includes(s.id))
    : allTemplates

  return {
    summaries: allSummaries,
    meetingMinutes,
    templateSummaries,
    transcriptItems,
    transcriptFileUrl,
    insightPage: parsedInsightPage,
    hasInsight: selection ? selection.i && showInsight : showInsight,
    hasSummary: selection ? selection.s && showSummary : showSummary,
    hasTranscript: selection ? selection.t && showTranscript : showTranscript,
  }
}

/**
 * 从 RawFileItem.path 中拆出最后一段作为 file_name。
 * path 形如 "/folder/audio.mp3" → "audio.mp3"。
 * 失败时回退空字符串，让调用方用默认值（"audio.mp3"）。
 */
function extractFileNameFromPath(path: string | undefined | null): string {
  if (!path) return ''
  const idx = path.lastIndexOf('/')
  return idx >= 0 ? path.slice(idx + 1) : path
}

/** 主入口 —— union type 分发到 snapshot / live 实现。 */
export function buildTabState(inputs: TabInputs): TabState {
  if (inputs.kind === 'snapshot') {
    return buildFromSnapshot(inputs.snapshot, inputs.selection)
  }
  return buildFromLive(inputs)
}