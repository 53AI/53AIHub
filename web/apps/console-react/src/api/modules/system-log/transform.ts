import type { SystemLogItem, SystemLogDisplayItem } from './types'
import { getSimpleDateFormatString } from '@km/shared-utils'

export const transformSystemLogItem = (item: SystemLogItem): SystemLogDisplayItem => ({
  ...item,
  action_time: getSimpleDateFormatString({
    date: item.action_time,
    format: 'YYYY-MM-DD hh:mm',
  }),
})

export const transformSystemLogList = (items: SystemLogItem[]): SystemLogDisplayItem[] => {
  return items.map(transformSystemLogItem)
}

export const getDefaultSystemLogRequest = () => ({
  offset: 0,
  limit: 10,
  user_id: null,
  start_time: null,
  end_time: null,
  module: undefined,
  action: undefined,
})

