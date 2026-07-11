import { create } from 'zustand'
import { useEnterpriseStore } from './enterprise'
import { domainApi } from '@/api/modules/domain'
import {
  transformDomainList,
  formatDomain,
  validateIndependentConfig,
  getDefaultExclusiveDomain,
  getDefaultIndependentDomain,
} from '@/api/modules/domain/transform'
import type {
  DomainListResponse,
  ExclusiveDomainData,
  IndependentDomainData,
  DomainInfo,
} from '@/api/modules/domain/types'

interface DomainState {
  domainList: DomainListResponse | null
  loading: boolean
  exclusiveDomains: () => DomainInfo[]
  independentDomains: () => DomainInfo[]
  totalDomains: () => number
  loadListData: () => Promise<DomainListResponse>
  saveExclusiveDomain: (data: { domain_id?: number; domain: string }) => Promise<unknown>
  saveIndependentDomain: (data: { domain_id?: number } & IndependentDomainData) => Promise<unknown>
  deleteIndependentDomain: (domainId: number) => Promise<void>
  findDomainById: (domainId: number, type: 'exclusive' | 'independent') => DomainInfo | undefined
  isDomainExists: (domain: string, excludeId?: number) => boolean
  getDefaultExclusiveDomain: typeof getDefaultExclusiveDomain
  getDefaultIndependentDomain: typeof getDefaultIndependentDomain
  resetState: () => void
}

export const useDomainStore = create<DomainState>((set, get) => ({
  domainList: null,
  loading: false,

  exclusiveDomains() {
    return get().domainList?.exclusive_domains || []
  },

  independentDomains() {
    return get().domainList?.independent_domains || []
  },

  totalDomains() {
    const exclusive = get().domainList?.exclusive_domains?.length || 0
    const independent = get().domainList?.independent_domains?.length || 0
    return exclusive + independent
  },

  async loadListData() {
    set({ loading: true })
    try {
      const rawData = await domainApi.list()
      const transformedData = transformDomainList(rawData)
      set({ domainList: transformedData })
      return transformedData
    } finally {
      set({ loading: false })
    }
  },

  async saveExclusiveDomain(data) {
    const formattedDomain = formatDomain(data.domain)
    const domainData: ExclusiveDomainData = { domain: formattedDomain }

    let result
    if (data.domain_id) {
      result = await domainApi.updateExclusive(data.domain_id, domainData)
    } else {
      result = await domainApi.createExclusive(domainData)
    }

    // 刷新企业信息和域名列表
    await get()._refreshAfterSave()
    return result
  },

  async saveIndependentDomain(data) {
    // 验证配置
    if (!validateIndependentConfig(data.config)) {
      throw new Error('域名配置验证失败')
    }

    const formattedData: IndependentDomainData = {
      domain: formatDomain(data.domain),
      config: data.config,
    }

    let result
    if (data.domain_id) {
      result = await domainApi.updateIndependent(data.domain_id, formattedData)
    } else {
      result = await domainApi.createIndependent(formattedData)
    }

    // 刷新企业信息和域名列表
    await get()._refreshAfterSave()
    return result
  },

  async deleteIndependentDomain(domainId) {
    await domainApi.deleteIndependent(domainId)
    await get()._refreshAfterSave()
  },

  findDomainById(domainId, type) {
    const domains = type === 'exclusive' ? get().exclusiveDomains() : get().independentDomains()
    return domains.find(domain => domain.domain_id === domainId)
  },

  isDomainExists(domain, excludeId) {
    const formattedDomain = formatDomain(domain)
    const allDomains = [...get().exclusiveDomains(), ...get().independentDomains()]

    return allDomains.some(
      d => formatDomain(d.domain) === formattedDomain && d.domain_id !== excludeId,
    )
  },

  getDefaultExclusiveDomain,
  getDefaultIndependentDomain,

  async _refreshAfterSave() {
    const enterpriseStore = useEnterpriseStore.getState()
    await Promise.all([enterpriseStore.loadSelfInfo(), get().loadListData()])
  },

  resetState() {
    set({ domainList: null, loading: false })
  },
}))
