import service from '../config'
import { handleError } from '../error-handler'

const checkAccountMap = new Map<string, unknown>()

export const authApi = {
  async checkAccount({ data = {} }: { data?: { account?: string } } = {}) {
    const d = { account: '', ...data }
    if (checkAccountMap.has(d.account!)) return checkAccountMap.get(d.account!)
    const res = await service
      .post('/api/saas/auth/check_account', d)
      .catch(handleError) as any
    const resultData = res?.data ?? {}
    checkAccountMap.set(d.account!, resultData)
    return resultData
  },
}

export default authApi
