import { useCallback } from 'react'
import { message } from 'antd'
import { t } from '@/locales'
import { cacheManager, CacheMode } from '@km/shared-utils'
import recordingApi from '@/api/modules/recording'
import { STAGE_STATUS } from '../constants/recordingStatus'
import type { PreviewFile } from '@/views/mine/types'
import type { RecordingFileSummary, TranscriptionExportResponse } from '@/api/modules/recording/types'
import type { TranscriptItem, StageStatusBag } from './useFileParse'

export type ExportKey =
  | 'export-audio'
  | 'export-insight'
  | 'export-summary'
  | 'export-transcript'
  | `export-${string}`

export interface UseExportOptions {
  file: PreviewFile
  /** 洞察概要（useFileParse 返回的是 parsePageJson 后的对象） */
  insightSummary?: Record<string, any>
  /** 决策页面编排（同样 parsePageJson 后的对象） */
  insightPageJson?: Record<string, any>
  fileSummaries?: RecordingFileSummary[]
  transcriptList?: TranscriptItem[]
  /** 各阶段完整状态包（来自 useFileParse.stageStatuses） */
  stageStatuses?: StageStatusBag
}

/** 把 parsePageJson 产物（可能是 { _markdown } 或 JSON Block 对象）序列化为可读文本 */
function stringifyInsightPayload(payload?: Record<string, any>): string {
  if (!payload || Object.keys(payload).length === 0) return ''
  if (typeof payload._markdown === 'string') {
    return payload._markdown
  }
  return JSON.stringify(payload, null, 2)
}

/** 去掉文件后缀作为 md 文件名前缀 */
function stripExt(name: string): string {
  return name.replace(/\.[^./\\]+$/, '')
}

/** 今天的 YYYY-MM-DD（导出文件名后缀） */
function todayStr(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 通用下载：Blob 触发 a.download，结束 revokeObjectURL */
function downloadBlob(content: string | Blob, filename: string): void {
  const blob =
    content instanceof Blob
      ? content
      : new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

/** 触发原生文件下载：fetch → blob，失败回退到 <a target="_blank"> */
async function downloadFileByUrl(fileUrl: string, filename: string): Promise<void> {
  try {
    const response = await fetch(fileUrl)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const blob = await response.blob()
    downloadBlob(blob, filename)
  } catch {
    const a = document.createElement('a')
    a.href = fileUrl
    a.download = filename
    a.target = '_blank'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }
}

/** i18n 键的前缀常量，集中管理便于统一改 */
const K = {
  audio: 'recording.export.audio',
  insight: 'recording.export.insight',
  summary: 'recording.export.summary',
  transcript: 'recording.export.transcript',
  transcriptExporting: 'recording.export.transcript_exporting',
  notReady: 'recording.export.not_ready_warning',
  templatePrefix: 'recording.export.template_prefix',
  success: 'status.export_success',
} as const

/** 转写导出缓存 TTL（分钟）；后端渲染较贵，避免短时间内重复拉取 */
const TRANSCRIPT_EXPORT_TTL_MIN = 5

export interface UseExportResult {
  /** 根据 menu key 派发到对应的导出函数；未知 key 静默忽略 */
  exportItem: (key: string) => Promise<void>
  /** 导出音频（独立公开，便于未来从其它入口调用） */
  exportAudio: () => Promise<void>
  /** 导出洞察（包含概要 + 决策页面） */
  exportInsight: () => void
  /** 导出系统纪要（template_id === 0） */
  exportSummary: () => void
  /** 导出转写（后端渲染 Markdown，前端缓存 + 触发下载） */
  exportTranscript: () => Promise<void>
  /** 按 summary id 导出 AI 模板总结 */
  exportTemplateSummary: (summaryId: string) => void
}

/**
 * 录音视图导出/下载逻辑聚合 hook
 * 负责：拼装 markdown、blob 下载、状态校验、错误兜底
 * 菜单 UI 与权限控制由调用方（RecordingPreview / MoreDropdown）负责
 */
export function useExport(opts: UseExportOptions): UseExportResult {
  const {
    file,
    insightSummary,
    insightPageJson,
    fileSummaries,
    stageStatuses,
  } = opts

  const baseName = () => stripExt(file.name || 'recording')
  const today = todayStr

  const exportAudio = useCallback(async () => {
    if (!file.file_url) {
      message.warning(t(K.notReady, { type: t(K.audio) }))
      return
    }
    await downloadFileByUrl(file.file_url, file.name || 'download')
    message.success(t(K.success))
  }, [file.file_url, file.name])

  const exportInsight = useCallback(() => {
    if (stageStatuses?.insights?.status !== STAGE_STATUS.Completed) {
      message.warning(t(K.notReady, { type: t(K.insight) }))
      return
    }
    const summaryText = stringifyInsightPayload(insightSummary)
    const pageText = stringifyInsightPayload(insightPageJson)
    const parts = [`# ${baseName()} - ${t(K.insight)}`, '', summaryText]
    if (pageText) parts.push('', '---', '', pageText)
    downloadBlob(parts.join('\n'), `${baseName()}-${t(K.insight)}-${today()}.md`)
    message.success(t(K.success))
  }, [stageStatuses?.insights?.status, insightSummary, insightPageJson, file.name])

  const exportSummary = useCallback(() => {
    if (stageStatuses?.meetingMinutes?.status !== STAGE_STATUS.Completed) {
      message.warning(t(K.notReady, { type: t(K.summary) }))
      return
    }
    const mm = fileSummaries?.find((s) => String(s.template_id) === '0')
    if (!mm?.summary_content) {
      message.warning(t(K.notReady, { type: t(K.summary) }))
      return
    }
    const md = [`# ${baseName()} - ${t(K.summary)}`, '', mm.summary_content].join('\n')
    downloadBlob(md, `${baseName()}-${t(K.summary)}-${today()}.md`)
    message.success(t(K.success))
  }, [stageStatuses?.meetingMinutes?.status, fileSummaries, file.name])

  const exportTranscript = useCallback(async () => {
    const fileId = file.id
    if (!fileId) {
      message.warning(t(K.notReady, { type: t(K.transcript) }))
      return
    }
    // 与 exportInsight/exportSummary 一致：转写未完成时不允许导出
    if (stageStatuses?.transcription?.status !== STAGE_STATUS.Completed) {
      message.warning(t(K.notReady, { type: t(K.transcript) }))
      return
    }
    const cacheKey = `transcript-export-${fileId}`
    const hideLoading = message.loading(t(K.transcriptExporting), 0)
    try {
      const result: TranscriptionExportResponse = await cacheManager.getOrFetch(
        cacheKey,
        () => recordingApi.exportTranscription(fileId),
        TRANSCRIPT_EXPORT_TTL_MIN,
        CacheMode.MEMORY,
      )
      // 文件名格式与 exportInsight / exportSummary / exportTemplateSummary 保持一致
      downloadBlob(result.markdown, `${baseName()}-${t(K.transcript)}-${today()}.md`)
      message.success(t(K.success))
    } catch (e: any) {
      message.error(e?.message || t(K.notReady, { type: t(K.transcript) }))
    } finally {
      hideLoading()
    }
  }, [file.id, stageStatuses?.transcription?.status, file.name])

  const exportTemplateSummary = useCallback(
    (summaryId: string) => {
      const item = fileSummaries?.find((s) => s.id === summaryId)
      const typeLabel = item?.template_name || ''
      // 旧版接口可能不返回 status，UI 默认视为 completed；与 useTemplateTabs 一致
      const isReady = !!item?.summary_content && (item.status === STAGE_STATUS.Completed || !item.status)
      if (!isReady) {
        message.warning(t(K.notReady, { type: typeLabel }))
        return
      }
      const md = [`# ${baseName()} - ${item!.template_name}`, '', item!.summary_content].join('\n')
      downloadBlob(md, `${baseName()}-${item!.template_name}-${today()}.md`)
      message.success(t(K.success))
    },
    [fileSummaries, file.name],
  )

  const exportItem = useCallback(
    async (key: string) => {
      if (key === 'export-audio') return exportAudio()
      if (key === 'export-insight') return exportInsight()
      if (key === 'export-summary') return exportSummary()
      if (key === 'export-transcript') return exportTranscript()
      if (key.startsWith('export-')) {
        return exportTemplateSummary(key.slice('export-'.length))
      }
    },
    [exportAudio, exportInsight, exportSummary, exportTranscript, exportTemplateSummary],
  )

  return {
    exportItem,
    exportAudio,
    exportInsight,
    exportSummary,
    exportTranscript,
    exportTemplateSummary,
  }
}
