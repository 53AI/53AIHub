import service from '../config'
import { handleError } from '../errorHandler'

import { RESPONSE_CODE } from '../code'

export const commonApi = {
  sendcode(data: { mobile: string }) {
    return service.post(`/api/sms/sendcode`, data, {
      code_sign: true,
    }).catch(handleError)
  },
	verifycode(data: { mobile: string; verifycode: string; }) {
    return service.get(`/api/sms/verify`, {
      params: {
        mobile: data.mobile,
        code: data.verifycode
      }
    }).then((res) => {
      if (res.code !== RESPONSE_CODE.SUCCESS)
        return Promise.reject({ response: { data: { ...res, message: data.mobile + ' ' + res.message } } })

      return data
    }).catch(handleError)
  },
  sendEmailCode(data: { email: string }) {
    return service.post('/api/email/send_verification', data).catch(handleError)
  },
  verifyEmailcode(data: { email: string; code: string }, id: string) {
    return service.patch(`/api/users/${id}/email`, data).then((res) => {
      if (res.code !== RESPONSE_CODE.SUCCESS) {
        return Promise.reject({ response: { data: { message: 'auth failed: verification code expired or invalid' } } })
      }
      return res
    }).catch(err => handleError({ response: { data: { message: 'auth failed: verification code expired or invalid' } } }, { ignoreStatus: true }))
  },
  version() {
    return service.get('/api/version').then((res) => res.data).catch(handleError)
  }
}
export default commonApi
