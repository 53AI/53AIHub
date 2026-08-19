import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { recordingApi } from '@/api/modules/recording'
import type { RecordingFileItem } from '@/api/modules/recording/types'
import filesApi from '@/api/modules/files'
import favoritesApi from '@/api/modules/favorites'
import { message } from 'antd'
import { t } from '@/locales'
import { getFormatTimeStamp } from '@km/shared-utils'
import { AUDIO_EXT_REGEX, AUDIO_DOUBLE_EXT_REGEX } from '@/views/mine/constants'
import { stripMarkdownCodeFence } from '@/views/recording/components/insightRenderer/markdownParser'

const PAGE_SIZE = 10

export type RecordingCategory = 'recording' | 'imported'
export type RecordingFilter = 'all' | RecordingCategory

/**
 * 录音文件 UI 项（隔离接口字段差异）
 *
 * 当前 description 占位、category 由 origin_type 衍生；后端新接口上线后，
 * 只需改 mapItem 映射，组件层无感。
 */
export interface RecordingFileItemUI {
  id: string
  name: string
  /** 描述文本：优先取 page_json.page_header.title，无则取 insight_summary.decision_question */
  description: string
  category: RecordingCategory
  createdTime: string
  updatedTime: string
  isFavorite: boolean
  groupId?: number
  rawData: RecordingFileItem
}

export interface UseRecordingListParams {
  keyword: string
  category: RecordingFilter
  sortBy?: 'updated_time' | 'created_time'
  groupId?: number
  /** 初始数据是否就绪（如分类标签加载完成），false 时不触发首次加载 */
  ready?: boolean
}

export interface UseRecordingListReturn {
  loading: boolean
  loadingMore: boolean
  fileList: RecordingFileItemUI[]
  hasMore: boolean
  loadMore: () => void
  refresh: () => void
  toggleFavorite: (id: string, isFav: boolean) => Promise<void>
  rename: (item: RecordingFileItemUI, newName: string) => Promise<void>
  remove: (item: RecordingFileItemUI) => Promise<void>
  /** 更新指定文件在列表中的描述文本（不刷新整个列表） */
  updateFileDescription: (fileId: string, description: string) => void
  /** 更新指定文件在列表中的名称（不刷新整个列表） */
  updateFileName: (fileId: string, name: string) => void
  /** 更新指定文件在列表中的分组 ID（不刷新整个列表） */
  updateFileGroup: (fileId: string, groupId: number | undefined) => void
}

/** 从 page_json 中提取描述文本
 *
 * 旧格式：JSON Block 结构 → 取 blocks[0].data.title
 * 新格式：Markdown 字符串 → 去除 Markdown 标记后取前两行
 */
export function extractDescriptionFromPageJson(pageJson?: string): string {
  if (!pageJson) return ''
  // 旧格式：JSON Block 结构
  if (pageJson.trimStart().startsWith('{')) {
    try {
      const data = JSON.parse(pageJson)
      return data.title + '。' + data.subtitle
    } catch {
      return ''
    }
  }
  // 新格式：Markdown 字符串 → 先剥掉 ``` 围栏（后端偶尔会用 markdown fence 包整段），
  // 再去除 Markdown 标记取前两行
  return stripMarkdown(stripMarkdownCodeFence(pageJson))
}

/** 去除 Markdown 标记，返回纯文本 */
function stripMarkdown(md: string): string {
  return md
    .replace(/^#+\s+/gm, '')        // 移除 # 标题
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')  // 移除 **bold**
    .replace(/__([^_\n]+)__/g, '$1')      // 移除 __bold__
    .replace(/\*([^*\n]+)\*/g, '$1')      // 移除 *italic*
    .replace(/`([^`]+)`/g, '$1')          // 移除 `code`
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // 移除 [text](url)
    .replace(/^[-*•]\s+/gm, '')      // 移除无序列表标记
    .replace(/^\d+[.)]\s+/gm, '')    // 移除有序列表标记
    .replace(/^>\s?/gm, '')          // 移除 blockquote 标记
    .replace(/[·•]/g, '')            // 移除特殊符号
    .replace(/\n{2,}/g, '\n')        // 合并多个空行为一个
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(0, 2)                     // 只取前两行
    .join('。')
}

/** 从 insight_summary 中提取描述文本
 *
 * 旧格式：JSON 结构 → 取 decision_question 前两行
 * 新格式：Markdown 字符串 → 去除 Markdown 标记后取前两行
 */
export function extractDescriptionFromSummary(insightSummary?: string): string {
  if (!insightSummary) return ''
  // 旧格式：JSON 结构
  if (insightSummary.trimStart().startsWith('{')) {
    try {
      const data = JSON.parse(insightSummary)
      // 含有 keywords 时展示 paragraph_summary
      if (Array.isArray(data.keywords)) {
        if (data.paragraph_summary) {
          return data.paragraph_summary.split('\n').filter(Boolean).slice(0, 2).join('\n')
        }
        return ''
      }
      if (data.decision_question) {
        return data.decision_question.split('\n').filter(Boolean).slice(0, 2).join('\n')
      }
    } catch {
      return ''
    }
  }
  // 新格式：Markdown 字符串
  return stripMarkdown(insightSummary)
}

/** 提取描述文本：优先取 page_json（页面编排），其次 insight_summary（决策分析） */
function extractDescription(item: RecordingFileItem): string {
  return extractDescriptionFromPageJson(item.insight_page?.page_json) || extractDescriptionFromSummary(item.insight_summary)
}

// 衍生 UI 项：name 取 path 末段去后缀；category 由 origin_type 衍生。
function mapItem(item: RecordingFileItem): RecordingFileItemUI {
  const fullName = item.path.split('/').pop() || item.path
  return {
    id: String(item.id),
    name: fullName.replace(/\.(md|m4a|webm)$/i, ''),
    description: extractDescription(item),
    category: item.origin_type === 'recording_imported' ? 'imported' : 'recording',
    createdTime: getFormatTimeStamp(item.created_time),
    updatedTime: getFormatTimeStamp(item.updated_time),
    isFavorite: item.is_favorite,
    groupId: item.group_id,
    rawData: item,
  }
}

/**
 * 安心录录音列表取数 hook（数据源隔离点）
 *
 */
export function useRecordingList({
  keyword,
  category,
  sortBy,
  groupId,
  ready = true,
}: UseRecordingListParams): UseRecordingListReturn {
  const [rawList, setRawList] = useState<RecordingFileItemUI[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  // offset 跟随后端原始记录数（非过滤后），保证分页正确
  const [offset, setOffset] = useState(0)

  const loadingRef = useRef(false)
  const loadingMoreRef = useRef(false)
  const hasLoadedRef = useRef(false)
  const requestIdRef = useRef(0)

  // category 前端过滤（all 不过滤）
  const fileList = useMemo(() => {
    if (category === 'all') return rawList
    return rawList.filter((it) => it.category === category)
  }, [rawList, category])

  const fetchPage = useCallback(
    async (pageOffset: number) => {
      const res = await recordingApi.getRecordings({
        type: 'file',
        path: '/',
        keyword: keyword || undefined,
        offset: pageOffset,
        limit: PAGE_SIZE,
        sort_by: sortBy,
        group_id: groupId,
      })
      return { files: res.data.map(mapItem), rawCount: res.data.length }
    },
    [keyword, sortBy, groupId],
  )

  const loadFiles = useCallback(
    async (forceRefresh = false) => {
      if (loadingRef.current) return
      if (!forceRefresh && hasLoadedRef.current) return
      loadingRef.current = true
      setLoading(true)
      const currentRequestId = ++requestIdRef.current
      try {
        const { files, rawCount } = await fetchPage(0)
        if (currentRequestId !== requestIdRef.current) return
        setRawList(files)
        setOffset(rawCount)
        setHasMore(rawCount >= PAGE_SIZE)
        hasLoadedRef.current = true
      } catch (e) {
        console.error('Failed to load recordings:', e)
        setRawList([])
        setHasMore(false)
      } finally {
        if (currentRequestId === requestIdRef.current) {
          setLoading(false)
          loadingRef.current = false
        }
      }
    },
    [fetchPage],
  )

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return
    if (!hasMore) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const { files, rawCount } = await fetchPage(offset)
      if (files.length > 0) {
        setRawList((prev) => {
          const existingIds = new Set(prev.map((f) => f.id))
          const newFiles = files.filter((f) => !existingIds.has(f.id))
          return [...prev, ...newFiles]
        })
      }
      setOffset((prev) => prev + rawCount)
      setHasMore(rawCount >= PAGE_SIZE)
    } catch (e) {
      console.error('Failed to load more:', e)
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [fetchPage, offset, hasMore])

  const refresh = useCallback(() => {
    hasLoadedRef.current = false
    setOffset(0)
    setHasMore(true)
    loadFiles(true)
  }, [loadFiles])

  // 过滤/排序条件变化时重新加载（ready 为 false 时跳过首次加载）
  useEffect(() => {
    if (!ready) return
    hasLoadedRef.current = false
    loadingRef.current = false
    setOffset(0)
    setHasMore(true)
    loadFiles(true)
    // biome-ignore lint/correctness/useExhaustiveDependencies: loadFiles 由 fetchPage 派生，sortBy 已显式列出，避免与间接引用重复触发
  }, [keyword, sortBy, groupId, ready])

  const toggleFavorite = useCallback(async (id: string, isFav: boolean) => {
    try {
      await favoritesApi.toggle({ resource_type: 2, resource_id: id })
      setRawList((prev) =>
        prev.map((it) => (it.id === id ? { ...it, isFavorite: !isFav } : it)),
      )
      message.success(isFav ? t('mine.unfavorited') : t('mine.favorited'))
    } catch {
      message.error(t('action.operation_failed'))
    }
  }, [])

  const rename = useCallback(
    async (item: RecordingFileItemUI, newName: string) => {
      const fullPath = item.rawData.path || ''
      const parentPath = fullPath.substring(0, fullPath.lastIndexOf('/'))
      // 保留原后缀（录音可能是双后缀 .m4a.md）
      const doubleExtMatch = fullPath.match(AUDIO_DOUBLE_EXT_REGEX)
      let ext: string
      if (doubleExtMatch) {
        ext = doubleExtMatch[0]
      } else {
        const extMatch = fullPath.match(AUDIO_EXT_REGEX)
        ext = extMatch ? extMatch[0] : '.m4a'
      }
      // 去掉用户输入中可能带的后缀，避免重复
      let trimmedName = newName
      const inputDoubleExtMatch = trimmedName.match(AUDIO_DOUBLE_EXT_REGEX)
      if (inputDoubleExtMatch) {
        trimmedName = trimmedName.substring(
          0,
          trimmedName.length - inputDoubleExtMatch[0].length,
        )
      } else {
        const inputExtMatch = trimmedName.match(AUDIO_EXT_REGEX)
        if (inputExtMatch) {
          trimmedName = trimmedName.substring(
            0,
            trimmedName.length - inputExtMatch[0].length,
          )
        }
      }
      const newPath = parentPath
        ? `${parentPath}/${trimmedName}${ext}`
        : `/${trimmedName}${ext}`
      await filesApi.rename({ id: item.id, path: newPath })
      refresh()
    },
    [refresh],
  )

  const remove = useCallback(
    async (item: RecordingFileItemUI) => {
      await filesApi.delete(item.id)
      refresh()
    },
    [refresh],
  )

  const updateFileDescription = useCallback((fileId: string, description: string) => {
    setRawList((prev) =>
      prev.map((it) => {
        if (it.id === fileId) return { ...it, description }
        return it
      }),
    )
  }, [])

  const updateFileName = useCallback((fileId: string, name: string) => {
    setRawList((prev) =>
      prev.map((it) => (it.id === fileId ? { ...it, name } : it)),
    )
  }, [])

  const updateFileGroup = useCallback(
    (fileId: string, groupId: number | undefined) => {
      setRawList((prev) =>
        prev.map((it) => {
          if (it.id !== fileId) return it
          const nextRawData = groupId === undefined
            ? it.rawData
            : { ...it.rawData, group_id: groupId }
          return { ...it, groupId, rawData: nextRawData }
        }),
      )
    },
    [],
  )

  return {
    loading,
    loadingMore,
    fileList,
    hasMore,
    loadMore,
    refresh,
    toggleFavorite,
    rename,
    remove,
    updateFileDescription,
    updateFileName,
    updateFileGroup,
  }
}
