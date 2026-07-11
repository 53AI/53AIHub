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

}

export default groupApi
