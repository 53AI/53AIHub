import service from '../config'
import { handleError } from '../error-handler'
import { useEnterpriseStore } from '@/stores'
import { suite_id } from '@/utils/config'
import { ENTERPRISE_SYNC_FROM, type EnterpriseSyncFrom } from '@/constants/enterprise'

export const getRootDepartmentData = async () => {
  const enterpriseStore = useEnterpriseStore.getState()
  if (!enterpriseStore.info.eid) await enterpriseStore.loadSelfInfo()
  return {
    did: 0,
    value: 0,
    name: enterpriseStore.info.name,
    label: enterpriseStore.info.name,
    index: 0,
    lastIndex: 0,
    children: [],
  }
}

export const departmentApi = {
  async fetch_department_tree(
    params: {
      from: EnterpriseSyncFrom
      keyword?: string
      offset?: number
      limit?: number
    } = {
      from: '0',
    }
  ) {
    let {
      data: { tree: treeData = [] },
    } = await service.get('/api/departments/tree', { params }).catch(handleError)
    const findData = (data: any = {}) => {
      data = {
        ...data,
        children: data.children || [],
        ...(data.department || {}),
      }
      data.label = data.name || ''
      data.value = data.did || 0
      data.children = data.children.map((item, index) => {
        item = findData(item)
        item.index = index
        item.lastIndex = data.children.length - 1
        return item
      })
      return data
    }
    treeData = treeData.map((item, index) => {
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
    return await service[did ? 'put' : 'post'](
      `/api/departments${did ? `/${did}` : ''}`,
      data
    ).catch(handleError)
  },

  async delete(did: number) {
    return await service.delete(`/api/departments/${did}`).catch(handleError)
  },
  tree(from: EnterpriseSyncFrom) {
    return service.get('/api/departments/tree', { params: { from } }).catch(handleError)
  },
  sync(
    from: EnterpriseSyncFrom,
    data = {
      suite_id: from === ENTERPRISE_SYNC_FROM.WECOM ? suite_id : '',
    }
  ) {
    return service.post(`/api/departments/sync/${from}`, data).catch(handleError)
  },
  bind_member(data: { bid: number; user_id: number; from: EnterpriseSyncFrom }) {
    return service.post('/api/departments/bind-member', data).catch(handleError)
  },
  unbind_member(data: { user_id: number; from: EnterpriseSyncFrom }) {
    return service.delete('/api/departments/bind-member', { data }).catch(handleError)
  },
  sync_progress(from: EnterpriseSyncFrom) {
    return service.get(`/api/sync-progress/${from}`).catch(handleError)
  },
}

export default departmentApi
