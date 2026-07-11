import request from '../index'

export type DefaultLinkItem = {
  name: string
  logo: string
  url: string
  description: string
  sort: number
}

export type DefaultLinkRequest = {
  links: {
    ai_link: DefaultLinkItem[]
    delete: boolean
  }
}

export const settingApi = {
  /**
   * 获取设置列表
   */
  list() {
    return request.get('/api/settings')
  },

  /**
   * 根据 key 获取设置
   */
  get(key: string, params: { library_id?: string } = {}) {
    return request.get(`/api/settings/key/${key}`, { params }).then((res) => res.data)
  },

  /**
   * 获取分组设置详情
   */
  detail(group_name: string) {
    return request.get(`/api/settings/group/${group_name}`)
  },

  /**
   * 创建设置
   */
  create(data: { key: string; value: string; library_id?: string }) {
    return request.post('/api/settings', data)
  },

  /**
   * 更新设置
   */
  update(setting_id: number, data: { key: string; value: string; library_id?: string }) {
    return request.put(`/api/settings/${setting_id}`, data)
  },

  /**
   * 删除设置
   */
  delete(setting_id: number) {
    return request.delete(`/api/settings/${setting_id}`)
  },

  default_links: {
    /**
     * 获取默认链接列表
     */
    list() {
      return request.get('/api/settings/default_links')
    },

    /**
     * 保存默认链接
     */
    save(data: DefaultLinkRequest) {
      return request.post('/api/settings/default_links', data)
    }
  },

  group: {
    /**
     * 获取分组设置
     */
    get(group_name: 'third_party_statistic') {
      return request.get(`/api/settings/group/${group_name}`)
    }
  },

  payment: {
    /**
     * 获取支付设置
     */
    async get() {
      const {
        data: { pay_settings = [] } = {}
      } = await request.get('/api/pay_settings')

      return pay_settings.map((item: any = {}) => {
        item.pay_setting_id = +item.pay_setting_id || 0
        item.pay_type = +item.pay_type || 0
        item.pay_status = !!+item.pay_status
        item.pay_config = item.pay_config || '{}'
        item.pay_config =
          typeof item.pay_config === 'string' ? JSON.parse(item.pay_config) : item.pay_config
        item.extra_config = item.extra_config || '{}'
        item.extra_config =
          typeof item.extra_config === 'string'
            ? JSON.parse(item.extra_config)
            : item.extra_config
        item.created_time = +item.created_time || 0
        item.updated_time = +item.updated_time || 0
        return item
      })
    }
  },

  documentApp: {
    /**
     * 获取文档应用 Agent 列表
     */
    agentAppList(key: string) {
      return request.get('/api/settings/by-key', { params: { key } })
    }
  }
}

export default settingApi
