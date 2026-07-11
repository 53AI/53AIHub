import { md5 } from '@km/shared-utils'

const DEFAULT_AUTH_KEY = 'c3a39e4eeacf4542d6a488e19037fa45'

function serialize(params: Record<string, any>): string {
  return Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&')
}

export function generateSignParams(params: Record<string, any> = {}, authKey: string = DEFAULT_AUTH_KEY) {
  const signParams = { ...params, timestamp: Math.floor(Date.now() / 1000), platform: 'web' }
  const strForSign = serialize(signParams)
  const sign = md5(strForSign + authKey)

  return {
    sign,
    method: 'md5',
    ...signParams,
  }
}

export function generateIbosSignParams(authKey: string = DEFAULT_AUTH_KEY) {
  const platform = 'web'
  const createtime = Math.floor(Date.now() / 1000)
  const token = md5(authKey + createtime)
  return {
    token,
    platform,
    createtime,
  }
}

