import { useEffect, useRef } from 'react'
import { extractDescriptionFromPageJson, extractDescriptionFromSummary } from './useRecordingList'
import { STAGE_STATUS } from '../constants/recordingStatus'

/**
 * hook 只需要这两个字段；外层（AudioView/RecordingPreview）实际传入的是 PreviewFile，
 * 这里用最小结构类型避免与上游 FileItem 类型不匹配导致 as any。
 */
export interface FileWithListId {
  id: string
  rawData?: { _listId?: string }
}

/**
 * 解析结果 → 描述文本提取
 *
 * 监听 `insightPageStatus` 变化，当页面编排从"未完成"转为"completed/failed"（降级）时，
 * 提取首段描述并回调给父组件，更新左侧列表的预览文本。
 *
 * 复用 `useRecordingList` 已有的提取函数，避免在此处重复实现描述解析逻辑。
 */
export function useInsightDescriptionUpdate(params: {
  file: FileWithListId | undefined
  insightPageStatus: string
  insightsStatus: string
  insightPageJson: Record<string, any> | null
  insightSummary: Record<string, any>
  onUpdate?: (fileId: string, description: string) => void
}) {
  const { file, insightPageStatus, insightsStatus, insightPageJson, insightSummary, onUpdate } = params

  // 用 ref 跟踪每个文件上一次的 status，跳过"刷新页面时初始就是完成态"的场景
  const prevStatusRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    if (!onUpdate || !file?.id) return

    const fileId = file.id
    const prevStatus = prevStatusRef.current.get(fileId)

    // 首次渲染：记录初始状态后直接返回
    if (prevStatus === undefined) {
      prevStatusRef.current.set(fileId, insightPageStatus)
      return
    }

    const isDone = insightPageStatus === STAGE_STATUS.Completed
    const isFallback = insightPageStatus === STAGE_STATUS.Failed && insightsStatus === STAGE_STATUS.Completed
    const wasNotDone = prevStatus !== STAGE_STATUS.Completed && prevStatus !== STAGE_STATUS.Failed

    // 状态没从未完成转为完成/降级 → 仅记录，跳过
    if (!wasNotDone || !(isDone || isFallback)) {
      prevStatusRef.current.set(fileId, insightPageStatus)
      return
    }

    // 页面编排完成但 pageJson 还没加载到 → 等下一次渲染（不更新 ref）
    if (isDone && !insightPageJson) {
      return
    }

    // 优先用 pageJson 提取；没有则用 insightSummary 降级
    let desc = ''
    if (insightPageJson) {
      const raw = insightPageJson._markdown ? insightPageJson._markdown : JSON.stringify(insightPageJson)
      desc = extractDescriptionFromPageJson(raw)
    }
    if (!desc && insightSummary && Object.keys(insightSummary).length > 0) {
      const raw = insightSummary._markdown ? insightSummary._markdown : JSON.stringify(insightSummary)
      desc = extractDescriptionFromSummary(raw)
    }
    if (desc) {
      // 使用左侧列表的 ID（数字字符串）回调，确保 useRecordingList 能匹配到
      const listId = file.rawData?._listId || file.id
      onUpdate(listId, desc)
    }
    prevStatusRef.current.set(fileId, insightPageStatus)
  }, [insightPageStatus, insightsStatus, insightPageJson, insightSummary, onUpdate, file])
}

/**
 * 纪要生成完成时回调一次（用于让父组件按纪要标题重命名录音文件）
 */
export function useMeetingMinutesRename(params: {
  file: FileWithListId | undefined
  status: string
  onRename?: (fileId: string) => void
}) {
  const { file, status, onRename } = params
  const prevStatusRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    if (!onRename || !file?.id) return
    const fid = file.id
    const prev = prevStatusRef.current.get(fid)
    // 首次渲染：若初始就是 completed，触发一次回调；否则仅记录
    if (prev === undefined) {
      prevStatusRef.current.set(fid, status)
      if (status !== STAGE_STATUS.Completed) return
      onRename(fid)
      return
    }
    // 已在上一次触发过则跳过
    if (prev === STAGE_STATUS.Completed || status !== STAGE_STATUS.Completed) {
      prevStatusRef.current.set(fid, status)
      return
    }
    onRename(fid)
    prevStatusRef.current.set(fid, status)
  }, [status, onRename, file])
}