import { BANNER_CONFIG } from '@/constants/banner'
import type { Banner, RawBanner } from './types'

export const getDefaultBanner = (): Banner => ({
  url_list: [],
  interval: BANNER_CONFIG.DEFAULT_INTERVAL,
})

export function transformBanner(rawBanner: RawBanner): Banner {
  try {
    const banner = JSON.parse(rawBanner)
    return {
      url_list: banner.url_list,
      interval: banner.interval,
    }
  } catch {
    return getDefaultBanner()
  }
}

