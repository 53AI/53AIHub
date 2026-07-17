/**
 * Resource Scopes API
 * 资源可见范围权限检查
 */
import service from '../config'
import { handleError } from '../errorHandler'

export type ResourceType = 'agent' | 'space' | 'library'

export interface CheckScopeParams {
  resource_id: string | number
  resource_type: ResourceType
}

export const resourceScopesApi = {
  /**
   * 检查用户是否有权限访问指定资源
   * @param params.resource_id 资源的 HashID
   * @param params.resource_type 资源类型：agent | space | library
   * @returns 用户是否有权限访问该资源
   */
  async check(params: CheckScopeParams): Promise<boolean> {
    try {
      const { data } = await service.get('/api/resource-scopes/check', {
        params: {
          resource_id: params.resource_id,
          resource_type: params.resource_type,
        },
      })
      return data === true
    } catch (error) {
      handleError(error as any)
      return false
    }
  },
}

export default resourceScopesApi
