/**
 * System Log 模块常量定义
 * 集中管理所有魔法值
 */

/** 默认分页大小 */
export const DEFAULT_PAGE_SIZE = 10

/** 分页大小选项 */
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

/** 日期格式 */
export const DATE_FORMAT = 'YYYY-MM-DD hh:mm'

/** 空值显示颜色 */
export const EMPTY_TEXT_COLOR = '#9B9B9B'

/** 表格列宽度 */
export const COLUMN_WIDTH = {
  ACTION_TIME: 180,
  ACTION: 120,
  MODULE: 140,
  OPERATOR: 140,
  IP: 160,
} as const
