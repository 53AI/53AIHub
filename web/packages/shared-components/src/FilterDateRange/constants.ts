/**
 * 日期范围快捷选项的 value 取值，与 @km/shared-utils getRangeStartEndDates(time_type) 对应。
 * 各应用用此列表配合 i18n 生成 shortcuts 传入 FilterDateRange 组件。
 */
export const DATE_RANGE_OPTION_VALUES = [
  '0', // 今天
  '1', // 过去7天
  '2', // 过去4周
  '3', // 过去3月
  '4', // 过去12月
  '5', // 本月至今
  '6', // 本季度至今
  '7', // 本年至今
  '8', // 所有时间
] as const
