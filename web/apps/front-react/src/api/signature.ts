import { serialize, md5 } from '@km/shared-utils'
import { auth_key } from '@/utils/config'

export function generateSignParams(params = {}) {
  params = { ...params, timestamp: Math.floor(Date.now() / 1000), platform: 'web' }

  const strForSign = serialize(params)
  const sign = md5(strForSign + auth_key)

  return {
    sign,
    method: 'md5',
    ...params
  }
}

export function generateIbosSignParams() {
  const platform = 'web'
  const createtime = Math.floor(Date.now() / 1000)
  const token = md5(auth_key + createtime)
  return {
    token,
    platform,
    createtime
  }
}
