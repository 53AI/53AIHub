import type { FeedbackItem, FeedbackDisplayItem } from './types'
import { getSimpleDateFormatString } from '@km/shared-utils'
import { JSONParse } from '@/utils'
import {
  serializeSkillRunItems,
  extractReasoningFromItems,
  applyProcessStep,
  type SkillRunItem,
  type ProcessStep,
  parseJson
} from '@/hooks/useChatStream'
import { getPublicPath } from '@/utils/config'

export const transformFeedbackItem = (item: FeedbackItem): FeedbackDisplayItem => ({
  ...item,
  updated_time: getSimpleDateFormatString({
    date: item.updated_time,
    format: 'YYYY-MM-DD hh:mm',
  }),
  model_name: item?.message_info?.model_name ?? '',
  nickname: item.user_info.nickname,
  original_question: item?.message_info?.original_question ?? '',
})

export const transformFeedbackList = (items: FeedbackItem[]): FeedbackDisplayItem[] => {
  return items.map(transformFeedbackItem)
}

export const formatFileInfo = (fileName: string): { ext: string; fname: string; icon: string } => {
  let file_ext = ''
  const file_name = fileName.split('/').pop() || ''

  let displayName = file_name
  const parts = file_name.split('.')

  if (parts.length >= 3) {
    const lastPart = parts[parts.length - 1]
    const secondLastPart = parts[parts.length - 2]
    const commonExtensions = [
      'pdf',
      'doc',
      'docx',
      'xls',
      'xlsx',
      'ppt',
      'pptx',
      'txt',
      'jpg',
      'png',
      'gif',
      'htm',
      'html',
      'csv',
    ]

    if (lastPart === 'md' && commonExtensions.includes(secondLastPart)) {
      file_ext = secondLastPart
      displayName = parts.slice(0, -1).join('.')
    } else {
      file_ext = lastPart
      displayName = parts.slice(0, -1).join('.')
    }
  } else {
    file_ext = parts.slice(-1)[0] || ''
    displayName = file_name
  }

  return {
    ext: file_ext,
    fname: displayName,
    icon: getPublicPath(`/images/file/${file_ext}.png`),
  }
}

export const formatRagStats = (stats: any) => {
  const ragStats = typeof stats === 'string' ? JSON.parse(stats) : stats
  const chunks = ragStats ? ragStats.document_search?.chunks || [] : []
  const document_quotations = ragStats ? ragStats.document_quotations || [] : []
  const file_quotations = ragStats ? ragStats.file_quotations || [] : []

  const filesSearch = chunks.map((chunk: any) => {
    // 优先使用 file_name，如果没有则使用 file_path
    const fileName = chunk.file_name || chunk.file_path?.split('/').pop() || ''
    const file = formatFileInfo(fileName)
    return {
      ...chunk,
      file_name: file.fname || fileName,
      file_icon: file.icon,
    }
  })
  const fileIds = [...new Set(filesSearch.map((chunk: any) => chunk.file_id))]
  const libraryIds = [...new Set(filesSearch.map((chunk: any) => chunk.library_id))]
  const documentQuotations = document_quotations.map((chunk_id: any) =>
    filesSearch.find((item: any) => item.chunk_id === chunk_id),
  )
  const fileQuotations = file_quotations.map((file_id: any) =>
    filesSearch.find((chunk: any) => chunk.file_id === file_id),
  )

  return ragStats
    ? {
        ...ragStats,
        chunks: filesSearch,
        library_search: libraryIds.map((id: any) =>
          filesSearch.find((chunk: any) => chunk.library_id === id),
        ),
        files_search: fileIds.map((id: any) => filesSearch.find((chunk: any) => chunk.file_id === id)),
        document_quotations: documentQuotations,
        file_quotations: fileQuotations,
      }
    : null
}

/**
 * 处理 process_records 生成 skillRunItems
 */
function processRecordsToSkillRunItems(records: any[]) {
  let skillRunItems: SkillRunItem[] = []
  const outputFiles = []

  for (const record of records || []) {
    const step: ProcessStep = {
      step_code: String(record.step_code ?? ''),
      status: record.status as 'start' | 'completed' | 'success',
      message: String(record.message ?? ''),
      data: record.data ? parseJson(record.data) : undefined
    }

    const { items, hasUpdate } = applyProcessStep(step, skillRunItems)
    if (hasUpdate) {
      skillRunItems = items
    }

    if (record.step_code === 'output_files' && record.status === 'completed' && record.data) {
      const data = typeof record.data === 'string' ? parseJson(record.data) : record.data
      const files = data?.files
      if (Array.isArray(files) && files.length > 0) {
        outputFiles.push(
          ...files.map((file: any) => ({
            id: file.id,
            file_name: file.file_name,
            url: file.url
          }))
        )
      }
    }
  }

  return { skillRunItems, outputFiles }
}

export const formtMessage = (info: any) => {
  const message = JSONParse(info.message, [])
  const userInfo = message.find((item: any) => item.role === 'info')
  if (userInfo) {
    let userInfoContent: any = {}
    try {
      userInfoContent = JSON.parse(userInfo.content)
    } catch {
      userInfoContent = {}
    }
    const data = {
      specified_files: [],
      specified_content: '',
    }
    if (userInfoContent.type === 'specified_content') {
      data.specified_content = userInfoContent.content
    }
    return data
  }
  return {}
}

export const getMessageList = (info: any, question: string) => {
  // 解析 message 获取用户消息内容
  const message = JSONParse(info.message, [])
  const userMessage =  Array.isArray(message) ? message.find((item: any) => item.role === 'user') : { content: '' }

  let questionText = ''
  let uploadedFiles: any[] = []
  let specifiedFiles: any[] = []
  let specifiedContent = ''

  // 解析用户消息内容
  const userContent = JSONParse(userMessage.content, null)
  if (Array.isArray(userContent)) {
    // 新格式：包含文本和文件
    const textItem = userContent.find((item: any) => item?.type === 'text')
    questionText = textItem?.content || ''
    uploadedFiles = userContent
      .filter((item: any) => item != null && item.type === 'file')
      .map((fileItem: any) => {
        const fileId = fileItem.content?.replace('file_id:', '') || ''
        return {
          id: fileId,
          name: fileItem.filename || `文件 ${fileId}`,
          size: fileItem.size,
          mime_type: fileItem.mime_type,
          preview_key: fileItem.preview_key
        }
      })
  } else {
    // 旧格式：纯文本或对象
    const content = userMessage.content;
    questionText = (typeof content === "string" ? content : (content?.text || content?.content || "")) || question;
  }

  // 解析 role='info' 消息，提取 specified_files 和 specified_content
  const infoMessages =  Array.isArray(message) ? message.filter((item: any) => item.role === 'info') : []
  for (const userInfo of infoMessages) {
    const userInfoContent = JSONParse(userInfo.content, {})
    const infoType = userInfoContent?.type

    if (infoType === 'specified_files' && Array.isArray(userInfoContent?.list)) {
      specifiedFiles = userInfoContent.list.map((fileItem: any) => {
        const file = formatFileInfo(fileItem.name || '')
        return {
          icon: file.icon,
          ...fileItem
        }
      })
    } else if (infoType === 'specified_content') {
      specifiedContent = userInfoContent.content || ''
    }
  }

  // 解析技能名格式 "/技能名 问题"
  let skill = { skill_name: '', display_name: '' }
  const skillMatch = questionText?.match(/^\/([^\s]+)\s+([\s\S]*)/)
  if (skillMatch) {
    skill.display_name = skillMatch[1]
    skill.skill_name = skillMatch[1]
    questionText = skillMatch[2]
  }

  // 处理 process_records 生成 skillRunItems 和渲染内容
  let answer = info.answer || ''
  let outputFiles: any[] = []

  if (info.process_records?.length > 0) {
    const result = processRecordsToSkillRunItems(info.process_records)
    outputFiles = result.outputFiles
    if (result.skillRunItems.length > 0) {
      const reasoningBlock = extractReasoningFromItems(result.skillRunItems)
      const skillRunBlock = serializeSkillRunItems(result.skillRunItems)
      // 如果 answer 中已包含 skill-run 块，先移除
      const cleanAnswer = answer.replace(/[\s\S]*?```skill-run\n[\s\S]*?\n```\n?/g, '')
      answer = reasoningBlock + skillRunBlock + cleanAnswer
    }
  }

  // 检测错误
  const error = answer.includes('Access denied') || answer.includes('InvalidApiKey') || false

  return [
    {
      ...info,
      question: questionText,
      skill,
      specified_files: specifiedFiles,
      specified_content: specifiedContent,
      uploaded_files: uploadedFiles,
      answer,
      rag_stats: formatRagStats(info.rag_stats),
      outputFiles,
      error,
    },
  ]
}
