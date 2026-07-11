import {
  type RecordItem,
  type RecordDisplayItem,
  THINKING_MODE,
  RESPONSE_STATUS,
  KNOWLEDGE_TYPE,
} from './types'
import { getSimpleDateFormatString } from '@km/shared-utils'

export const ThinkingModeContent = {
  [THINKING_MODE.QUICK_ANSWER]: window.$t('search-record.quick_answer'),
  [THINKING_MODE.DEEP_THINKING]: window.$t('search-record.deep_think'),
}

export const ResponseStatusContent = {
  [RESPONSE_STATUS.NORMAL]: window.$t('search-record.normal'),
  [RESPONSE_STATUS.REFUSED]: window.$t('search-record.refused'),
}

export const KnowledgeTypeContent = {
  [KNOWLEDGE_TYPE.KNOWLEDGE_BASE]: window.$t('search-record.all_knowledge_base'),
  [KNOWLEDGE_TYPE.WEB]: window.$t('search-record.online_search'),
  [KNOWLEDGE_TYPE.SPECIFIED_KNOWLEDGE_BASE]: window.$t('search-record.specified_knowledge_base'),
}

export const transformRecordItem = (item: RecordItem): RecordDisplayItem => {
  const infos =
    (typeof item.parsed_message === 'object' && Array.isArray(item.parsed_message) &&
      item.parsed_message.filter(it => it.role === 'info')) ||
    []

  let knowledge_type_value = (KnowledgeTypeContent as any)[item.knowledge_type]
  let specified_content = ''

  infos.forEach((info: any) => {
    const infoContent = JSON.parse(info.content)
    if (infoContent.type === 'specified_files') {
      knowledge_type_value = infoContent.list.map((row: any) => row.name).join(',')
    }
    if (infoContent.type === 'specified_content') {
      specified_content = infoContent.content
    }
  })

  let original_question = item.original_question
  // 处理 original_question 可能是 JSON 数组的情况
  try {
    const parsed = JSON.parse(original_question)
    if (Array.isArray(parsed)) {
      const textItem = parsed.find((p: any) => p.type === 'text')
      if (textItem) {
        original_question = textItem.content
      }
    }
  } catch (e) {
    original_question = original_question || item.message
  }

  return {
    ...item,
    thinking_mode_value: (ThinkingModeContent as any)[item.thinking_mode],
    response_status_value: (ResponseStatusContent as any)[item.response_status],
    knowledge_type_value,
    specified_content,
    updated_time: getSimpleDateFormatString({
      date: item.updated_time,
      format: 'YYYY-MM-DD hh:mm',
    }),
    nickname: '',
    original_question,
  }
}

export const transformRecordList = (items: RecordItem[]): RecordDisplayItem[] => {
  return items.map(transformRecordItem)
}

