import request from '../index'
import { handleError } from '../errorHandler'
import { useEnterpriseStore } from '@/stores/modules/enterprise'
import { suite_id } from '@/utils/config'
import type { EnterpriseSyncFrom } from '@/constants/enterprise'

export const getRootDepartmentData = async () => {
  const enterpriseStore = useEnterpriseStore.getState()
  return {
    did: 0,
    value: 0,
    name: enterpriseStore.display_name,
    label: enterpriseStore.display_name,
    index: 0,
    lastIndex: 0,
    children: [],
  }
}

export const departmentApi = {
  async fetch_department_tree(
    params: {
      from: string
      keyword?: string
      offset?: number
      limit?: number
    } = {
      from: '0',
    }
  ) {
    let {
      data: { tree: treeData = [] },
    } = await request.get('/api/departments/tree', { params, requiresAuth: true }).catch(handleError)
    const findData = (data: any = {}) => {
      data = {
        ...data,
        children: data.children || [],
        ...(data.department || {}),
      }
      data.label = data.name || ''
      data.value = data.did || 0
      data.children = data.children.map((item: any, index: number) => {
        item = findData(item)
        item.index = index
        item.lastIndex = data.children.length - 1
        return item
      })
      return data
    }
    treeData = treeData.map((item: any, index: number) => {
      item = findData(item)
      item.index = index
      item.lastIndex = treeData.length - 1
      return item
    })
    const rootData = await getRootDepartmentData()
    return [
      {
        ...rootData,
        bind_value: '0',
        children: JSON.parse(JSON.stringify(treeData)),
      },
    ]
  },
  async save(data: { did?: number; name: string; pdid?: number; sort?: number }) {
    data = JSON.parse(JSON.stringify(data))
    const did = data.did || 0
    delete data.did
    if (typeof data.sort === 'undefined') data.sort = 999999
    if (!data.pdid) data.pdid = 0
    return await request[did ? 'put' : 'post'](
      `/api/departments${did ? `/${did}` : ''}`,
      data
    ).catch(handleError)
  },

  async delete(did: number) {
    return await request.delete(`/api/departments/${did}`).catch(handleError)
  },
  tree(from: EnterpriseSyncFrom) {
    return request.get('/api/departments/tree', { params: { from }, requiresAuth: true }).catch(handleError)
  },
  sync(from: EnterpriseSyncFrom, data = { suite_id: suite_id }) {
    return request.post(`/api/departments/sync/${from}`, data).catch(handleError)
  },
  bind_member(data: { bid: number; user_id: number; from: EnterpriseSyncFrom }) {
    return request.post('/api/departments/bind-member', data).catch(handleError)
  },
  unbind_member(data: { user_id: number; from: EnterpriseSyncFrom }) {
    return request.delete('/api/departments/bind-member', { data }).catch(handleError)
  },
}

export default departmentApi
