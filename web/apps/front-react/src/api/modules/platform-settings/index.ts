import request from '../../index'
import type { PlatformSetting, RawPlatformSetting, PlatformSettingStatus } from './types'

const platformSettingsApi = {
  /**
   * 查找平台设置
   */
  find(params: { platform_key?: string } = {}): Promise<RawPlatformSetting[]> {
    return request.get('/api/platform-settings', { params }).then((res) => res.data)
  },

  /**
   * 获取单个平台设置
   */
  get(id: string): Promise<RawPlatformSetting> {
    return request.get(`/api/platform-settings/${id}`).then((res) => res.data)
  },

  /**
   * 创建平台设置
   */
  create(data: { platform_key: string; setting: string; external_id?: string }): Promise<void> {
    return request.post('/api/platform-settings', data).then((res) => res.data)
  },

  /**
   * 更新平台设置
   */
  update(
    id: string,
    data: { platform_key: string; setting: string; external_id?: string }
  ): Promise<PlatformSetting> {
    return request.put(`/api/platform-settings/${id}`, data).then((res) => res.data)
  },

  /**
   * 删除平台设置
   */
  delete(id: string): Promise<void> {
    return request.delete(`/api/platform-settings/${id}`).then((res) => res.data)
  },

  /**
   * 获取平台设置状态
   */
  status(platform_key: string): Promise<PlatformSettingStatus> {
    return request
      .get(`/api/platform-settings/${platform_key}/status`)
      .then((res) => res.data)
  }
}

export default platformSettingsApi
