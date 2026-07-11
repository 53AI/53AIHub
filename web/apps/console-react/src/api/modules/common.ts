import service from '../config'
import { handleError } from '../error-handler'

export const commonApi = {
  sendcode(data: { mobile: string }) {
    return service
      .post('/api/sms/sendcode', data, { code_sign: true } as any)
      .catch(handleError)
  },
  sendEmailCode(data: { email: string }) {
    return service.post('/api/email/send_verification', data).catch(handleError)
  },
  verifyEmailcode(data: { email: string; code: string }, id: string) {
    return service
      .patch(`/api/users/${id}/email`, data)
      .then((res: any) => {
        if (res.code !== 0) return Promise.reject({ response: { data: res } })
        return res
      })
      .catch(handleError)
  },
  version() {
    return service.get('/api/version').catch(handleError)
  },
}

export default commonApi
