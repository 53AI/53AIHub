import service from '../../config'
import { handleError } from '../../error-handler'
import type { PlatformSetting, RawPlatformSetting, PlatformSettingStatus } from './types'

const platformSettingsApi = {
  find(params: { platform_key?: string } = {}): Promise<RawPlatformSetting[]> {
    return service
      .get('/api/platform-settings', { params })
      .then((res: any) => res.data)
      .catch(handleError)
  },
  get(id: string): Promise<RawPlatformSetting> {
    return service
      .get(`/api/platform-settings/${id}`)
      .then((res: any) => res.data)
      .catch(handleError)
  },
  create(data: {
    platform_key: string
    setting: string
    external_id?: string
    status?: string
  }): Promise<void> {
    return service
      .post('/api/platform-settings', data)
      .then((res: any) => res.data)
      .catch(handleError)
  },
  update(
    id: string,
    data: { platform_key: string; setting: string; external_id?: string },
  ): Promise<PlatformSetting> {
    return service
      .put(`/api/platform-settings/${id}`, data)
      .then((res: any) => res.data)
      .catch(handleError)
  },
  delete(id: string): Promise<void> {
    return service
      .delete(`/api/platform-settings/${id}`)
      .then((res: any) => res.data)
      .catch(handleError)
  },
  test(id: string, platform_key: string): Promise<void> {
    return service
      .post(`/api/platform-settings/${id}/test-${platform_key}-search`)
      .then((res: any) => res.data)
      .catch(handleError)
  },
  status(platform_key: string): Promise<PlatformSettingStatus> {
    return service
      .get(`/api/platform-settings/${platform_key}/status`)
      .then((res: any) => res.data)
      .catch(handleError)
  },
}

export default platformSettingsApi
export * from './types'
export * from './transform'

