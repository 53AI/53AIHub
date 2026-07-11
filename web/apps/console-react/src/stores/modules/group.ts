import { create } from 'zustand'
import service from '@/api/config'
import { GROUP_TYPE, type GroupType } from '@/constants/group'

export interface Group {
  group_id: number
  group_name: string
  sort: number
}

interface GroupState {
  loadListData: (opts: { data?: { group_type?: GroupType } }) => Promise<unknown>
  save: (opts: { data: { group_type: GroupType; groups: Group[] } }) => Promise<unknown>
  delete: (opts: { data: { group_id: number } }) => Promise<unknown>
}

export const useGroupStore = create<GroupState>(() => ({
  async loadListData({ data: { group_type } = {} } = {}) {
    const res = await service.get(`/api/groups/type/${group_type ?? GROUP_TYPE.INTERNAL_USER}`, { params: {} })
    const data = (res as { data?: unknown })?.data ?? []
    return { data }
  },

  async save({ data: { group_type, groups } }) {
    const res = await service.post(`/api/groups/type/${group_type}`, { groups })
    return (res as { data?: unknown })?.data
  },

  async delete({ data: { group_id } }) {
    await service.delete(`/api/groups/${group_id}`)
    return undefined
  },
}))
