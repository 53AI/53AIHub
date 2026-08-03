import request from '../index'
import { handleError } from '../errorHandler'

export type GroupListRequest = {
  params: {
    group_type: number
  }
}

export type GroupListResponse = {
  id: number
  name: string
}[]

export interface Group {
  group_id: number
  group_name: string
  sort: number
}

export const DEFAULT_GROUP_DATA = {
  group_id: -Date.now(),
  group_name: '',
  sort: 0,
}

export const groupApi = {
  list(params: GroupListRequest): Promise<GroupListResponse> {
    return request
      .get(`/api/groups/type/${ params.params.group_type }`)
      .then((res: any) => res.data)
      .catch(handleError)
  },
  current_list(group_type: number) {
    return request.get(`/api/groups/type/current/${group_type}`).then((res: any) => res.data).catch(handleError)
  },
  save(data: { group_type: number; groups: Group[] }) {
    return request.post(`/api/groups/type/${data.group_type}`, { groups: data.groups }).then((res: any) => res.data).catch(handleError)
  },
  delete(data: { group_id: number }) {
    return request.delete(`/api/groups/${data.group_id}`).catch(handleError)
  },
  clearCache(groupType?: number) {
    // no-op: front groupApi doesn't cache
  },
  user: {
    list(params: GroupListRequest): Promise<GroupListResponse> {
      return request
        .get(`/api/user/groups/type/${ params.params.group_type }`)
        .then((res: any) => res.data)
        .catch(handleError)
    },
    save(data: { group_type: number; groups: Group[] }) {
      return request.post(`/api/user/groups/type/${data.group_type}`, { groups: data.groups }).then((res: any) => res.data).catch(handleError)
    },
    delete(data: { group_id: number }) {
      return request.delete(`/api/user/groups/${data.group_id}`).catch(handleError)
    },
  }
}

export default groupApi
