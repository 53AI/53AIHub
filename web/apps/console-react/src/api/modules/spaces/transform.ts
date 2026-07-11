import type { SpaceItem, SpaceDisplayItem } from './types'
import { getSimpleDateFormatString } from '@km/shared-utils'

export const transformSpaceItem = (item: SpaceItem): SpaceDisplayItem => ({
  ...item,
  created_time: getSimpleDateFormatString({
    date: item.created_time,
    format: 'YYYY-MM-DD hh:mm',
  }),
  updated_time: getSimpleDateFormatString({
    date: item.updated_time,
    format: 'YYYY-MM-DD hh:mm',
  }),
})

export const transformSpaceList = (items: SpaceItem[]): SpaceDisplayItem[] => {
  return items.map(transformSpaceItem)
}

export const getDefaultSpaceRequest = () => ({
  offset: 0,
  limit: 10,
  name: '',
})

