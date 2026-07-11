import request from '../index'

export const systemApi = {
  /**
   * 检查系统是否已初始化
   */
  init() {
    return request.get('/api/is_init')
  }
}

export default systemApi
