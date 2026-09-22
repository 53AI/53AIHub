import service from '../config'
import { handleError } from '../errorHandler'

import { RESPONSE_CODE } from '../code'

/** 图形验证码图片（人机校验） */
export interface CaptchaImage {
  /** 本次验证码凭据 ID，生命周期 5 分钟 */
  captcha_id: string
  /** 带 Base64 Data URI 前缀的 PNG，可直接赋值给 <img> 的 src */
  image_base64: string
}

/** 发送短信验证码时携带的人机校验参数 */
export interface CaptchaVerifyPayload {
  captcha_id?: string
  captcha_answer?: string
}

export const commonApi = {
  /**
   * 获取图形验证码（无需登录）。
   * 发送短信验证码前必须先调用本接口拿到 captcha_id。
   */
  getCaptcha(): Promise<CaptchaImage> {
    return service.get('/api/captcha').then((res: any) => {
      const data = res?.data
      if (!data?.captcha_id || !data?.image_base64) {
        return Promise.reject({ response: { data: res } }) as Promise<never>
      }
      return data as CaptchaImage
    })
  },
  sendcode(data: { mobile: string; source?: string } & CaptchaVerifyPayload) {
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
