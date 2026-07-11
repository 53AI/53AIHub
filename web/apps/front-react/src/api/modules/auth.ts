import service from '../config'
import { handleError } from '../errorHandler'

const checkAccountMap = new Map()

export const authApi = {
  async checkAccount({ data = {} } = {}) {
    data = {
      account: '',
      ...data
    }
    if (checkAccountMap.has(data.account)) return checkAccountMap.get(data.account)
    const { data: resultData = {} } = await service
      .post(`/api/saas/auth/check_account`, data)
      .catch(handleError)
    checkAccountMap.set(data.account, resultData)
    return resultData
  }
}

export default authApi
