import type { LibraryItem, LibraryDisplayItem } from './types'
import { getSimpleDateFormatString, cacheManager as cache } from '@km/shared-utils'
import { userApi } from '../user'

export const transformLibraryItem = (item: LibraryItem): LibraryDisplayItem => ({
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

const loadInternalUser = async () => {
  const userList: Record<number, { nickname: string; avatar: string }> = {}
  const res: any = await cache.getOrFetch('internal_user_list', () =>
    userApi.fetch_internal_user({
      status: -1,
      offset: 0,
      limit: 999,
    } as any),
  )
  const list: any[] = res?.list || res?.data?.list || res?.data?.users || []
  list.forEach((item: any) => {
    const user_id = Number(item.user_id ?? item.id ?? 0)
    if (!user_id) return
    userList[user_id] = {
      nickname: item.nickname || '',
      avatar: item.avatar || '',
    }
  })
  return userList
}

export const transformLibraryList = async (items: LibraryItem[]): Promise<any[]> => {
  const userList = await loadInternalUser()
  return items.map(item => ({
    ...transformLibraryItem(item),
    creator_name:
      item.creator_id === 0 ? window.$t('space.system') : userList[item.creator_id]?.nickname || '',
    creator_avatar: item.creator_id === 0 ? '' : userList[item.creator_id]?.avatar || '',
  }))
}

export const getDefaultLibraryRequest = (space_id: number) => ({
  space_id,
  offset: 0,
  limit: 10,
  keyword: '',
})

