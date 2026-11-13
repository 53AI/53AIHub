/** 接入指引类型 */
export type ApiGuideType = 'studio' | 'dify' | 'wiki'

/** 图文步骤条目 */
export type ApiGuideContentItem = {
  type: 'text' | 'image'
  content: string
}
