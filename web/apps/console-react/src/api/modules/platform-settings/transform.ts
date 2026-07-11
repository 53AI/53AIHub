import type { RawPlatformSetting, PlatformSetting } from './types'

export function transformPlatformSetting(rawSetting: RawPlatformSetting): PlatformSetting {
  return {
    ...rawSetting,
    setting: JSON.parse(rawSetting.setting),
  }
}

