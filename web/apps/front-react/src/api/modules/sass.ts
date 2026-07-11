import request from '../index'

export const saasApi = {
  product: {
    /**
     * 获取产品列表
     */
    list() {
      return request.get('/api/saas/products')
    },

    /**
     * 获取指定版本的产品信息
     */
    find(version: string) {
      return request.get(`/api/saas/products/${version}`)
    }
  }
}

export default saasApi
