import service from '../config'
import { handleError } from '../error-handler'
import { GroupType, ResourceType, RESOURCE_TYPE } from '@/constants/group'

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

interface RequestType {
  resource_ids: number[] | string[]
  resource_type: ResourceType
}

// 缓存和请求去重
const groupCache = new Map<GroupType, Group[]>()
const pendingRequests = new Map<GroupType, Promise<Group[]>>()

export const groupApi = {
  async list({
    params = {},
  }: {
    params: {
      group_type: GroupType
    }
  } = {}) {
    params = JSON.parse(JSON.stringify(params))
    const { group_type } = params
    delete params.group_type

    // 检查缓存
    if (groupCache.has(group_type)) {
      return groupCache.get(group_type)!
    }

    // 检查是否有正在进行的请求，避免重复请求
    if (pendingRequests.has(group_type)) {
      return pendingRequests.get(group_type)!
    }

    // 发起请求
    const request = (async () => {
      try {
        const { data = [] } = await service
          .get(`/api/groups/type/${group_type}`, { params })
          .catch(handleError)
        const result = data || []
        groupCache.set(group_type, result)
        return result
      } finally {
        pendingRequests.delete(group_type)
      }
    })()

    pendingRequests.set(group_type, request)
    return request
  },

  // 清除缓存（在添加/删除/修改分组后调用）
  clearCache(groupType?: GroupType) {
    if (groupType !== undefined) {
      groupCache.delete(groupType)
    } else {
      groupCache.clear()
    }
  },
  async save({
    data: { group_type, groups },
  }: {
    data: { group_type: GroupType; groups: Group[] }
  }) {
    const { data = {} } = await service
      .post(`/api/groups/type/${group_type}`, { groups })
      .catch(handleError)
    return data
  },
  async single_save(data: {
    group_id?: number
    group_name?: string
    group_type?: GroupType
    sort?: number
  }) {
    const group_id = +data.group_id || 0
    delete data.group_id
    const { data: resultData = {} } = await service[group_id ? 'put' : 'post'](
      `/api/groups${group_id ? `/${group_id}` : ''}`,
      data
    ).catch(handleError)
    return resultData
  },
  async delete({ data: { group_id } }: { data: { group_id: number } }) {
    return service.delete(`/api/groups/${group_id}`).catch(handleError)
  },

  async user_list(params: {
    params: {
      group_id: number
      keyword?: string
      offset?: number
      limit?: number
    }
  }) {
    const group_id = +params.group_id || 0
    delete params.group_id
    const { data: resultData = {} } = await service
      .get(`/api/groups/${group_id}/users`, { params })
      .catch(handleError)
    return {
      total: +resultData.total || 0,
      list: (resultData.permissions || [])
        .map((item = {}) => {
          item.permission_id = +item.permission_id || +item.id || 0
          item.user = item.user || {}
          item.department = item.department || {}

          item = {
            ...item,
            ...item.user,
            ...item.department,
          }
          item.departments = item.departments || []
          item.dept_id_list = item.departments.map(item => +item.did).filter(did => did)
          item.dept_names = item.departments.map(item => item.name).join(',')
          if (item.resource_type === 'department') {
            item.dept_id_list = [+item.department.did]
            item.dept_names = item.department.name || ''
          }
          return item
        })
        .filter((item = {}) => item.user?.user_id),
    }
  },

  async remove_user(data: { group_id: number; permission_ids: number[] }) {
    const group_id = +data.group_id || 0
    delete data.group_id
    return service.delete(`/api/groups/${group_id}/users`, { data }).catch(handleError)
  },
  async batch_add_user(data: { group_id: number; department_ids: number[]; user_ids: number[] }) {
    const group_id = +data.group_id || 0
    delete data.group_id
    if (!data.department_ids) data.department_ids = []
    if (!data.user_ids) data.user_ids = []
    return service.post(`/api/groups/${group_id}/users/batch`, data).catch(handleError)
  },
  async agent_list(params: {
    params: {
      group_id: number
      keyword?: string
      offset?: number
      limit?: number
    }
  }) {
    const group_id = +params.group_id || 0
    delete params.group_id
    const { data: resultData = {} } = await service
      .get(`/api/groups/${group_id}/agents`, { params })
      .catch(handleError)
    return {
      total: +resultData.count || 0,
      list: (resultData.agents || []).map((item = {}) => {
        item.value = +item.agent_id || 0
        item.label = item.name || ''
        return item
      }),
    }
  },
  async batch_add_agent(data: { group_id: number; agent_ids: number[] }) {
    const group_id = +data.group_id || 0
    delete data.group_id
    if (!data.agent_ids) data.agent_ids = []
    return service.post(`/api/groups/${group_id}/agents`, data).catch(handleError)
  },
  async remove_agent(data: { group_id: number; agent_ids: number[] }) {
    const group_id = +data.group_id || 0
    delete data.group_id
    return service.delete(`/api/groups/${group_id}/agents`, { data }).catch(handleError)
  },
  async resource_list(data: {
    id: number
    params: {
      keyword?: string
      offset?: number
      limit?: number
      resource_type?: ResourceType
    }
  }) {
    const id = +data.id || 0
    const { data: resultData = {} } = await service
      .get(`/api/groups/${id}/resources`, { params: data.params })
      .catch(handleError)
    const list =
      data.params.resource_type === RESOURCE_TYPE.AGENT ? resultData.agents : resultData.resources
    return {
      total: +resultData.count || 0,
      list: (list || []).map((item = {}) => {
        const value =
          data.params.resource_type === RESOURCE_TYPE.AGENT
            ? +item.agent_id
            : data.params.resource_type === RESOURCE_TYPE.PROMPT
              ? +item.prompt_id
              : +item.id
        item.value = value || 0
        item.label = item.name || ''
        return item
      }),
    }
  },
  async batch_add_resource(data: { id: number; request: RequestType }) {
    const id = +data.id || 0
    return service.post(`/api/groups/${id}/resources`, data.request).catch(handleError)
  },
  async remove_resource(data: { id: number; request: RequestType }) {
    const id = +data.id || 0
    return service.delete(`/api/groups/${id}/resources`, { data: data.request }).catch(handleError)
  },
}

export default groupApi
