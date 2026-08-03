/**
 * 最近使用资源类型常量
 *
 * 资源类型：0=空间, 1=知识库, 2=文件, 3=Wiki 页面
 * @see apps/front-react/src/api/modules/recent-used
 */
export const RECENT_USED_RESOURCE_TYPE = {
  SPACE: 0,
  LIBRARY: 1,
  FILE: 2,
  WIKI_PAGE: 3,
} as const

export type RecentUsedResourceTypeValue =
  (typeof RECENT_USED_RESOURCE_TYPE)[keyof typeof RECENT_USED_RESOURCE_TYPE]
