import service from '../config'
import { handleError } from '../errorHandler'
import { qyy_host } from '@/utils/config'

export const commonApi = {
  sendcode(data: { mobile: string; source: '53ai' }) {
    return service.post(`${qyy_host}/v3/users/sendcode`, data, {
      code_sign: true,
      baseURL: '',
    }).catch(handleError)
  },
	verifycode(data: { mobile: string; verifycode: string; type: '1' }) {
    return service.post(`${qyy_host}/v4/xbot/checkverificationcode`, data, {
      ibos_sign: true,
      baseURL: '',
    }).then((res) => {
      if (res.code !== 0)
        return Promise.reject({ response: { data: res } })

      return res
    }).catch(handleError)
  },
}
export default commonApi

export type { commonApi }
