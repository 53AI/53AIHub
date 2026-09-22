import service from '../config'
import { handleError } from '../error-handler'

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
