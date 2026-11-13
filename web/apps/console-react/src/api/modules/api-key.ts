import service from '../config'
import { handleError } from '../error-handler'

export interface ScopedApiKey {
  id: number
  name: string
  description: string
  eid: number
  creator_id: number
  status: number
  created_time: number
  updated_time: number
  expires_at: number | null
  key: string
}

interface ApiKeyRequest {
  name: string
  description?: string
}

interface ApiKeyListResponse {
  api_keys: ScopedApiKey[]
}

interface ApiKeyCreateResponse {
  key: string
  id: number
}

export const spaceApiKeysApi = {
  list(spaceId: string): Promise<ScopedApiKey[]> {
    return service
      .get(`/api/spaces/${spaceId}/api-keys`)
      .then((res: any) => (res.data as ApiKeyListResponse).api_keys || [])
      .catch((error) => handleError(error))
  },

  create(spaceId: string, data: ApiKeyRequest): Promise<ApiKeyCreateResponse> {
    return service
      .post(`/api/spaces/${spaceId}/api-keys`, data)
      .then((res: any) => res.data as ApiKeyCreateResponse)
      .catch((error) => handleError(error))
  },

  delete(spaceId: string, keyId: number): Promise<void> {
    return service
      .delete(`/api/spaces/${spaceId}/api-keys/${keyId}`)
      .then(() => undefined)
      .catch((error) => handleError(error))
  },
}
