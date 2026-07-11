import request from '../../index'

export interface FavoriteToggleRequest {
  resource_type: number
  resource_id: string
  sandbox_output_file_id?: string
}

export interface FavoriteListParams {
  resource_type?: number // 1=library, 2=file
  page?: number
  limit?: number
  keyword?: string
}

export interface FavoriteListResponse {
  files: {
    favorite_time: number
    file: any
    library: any
    space: any
  }[]
  libraries: {
    favorite_time: number
    library: any
    space: any
  }[]
}

const favoritesApi = {
  list(params?: FavoriteListParams): Promise<FavoriteListResponse> {
    return request.get('/api/favorites', { params }).then((res) => res.data)
  },

  toggle(data: FavoriteToggleRequest) {
    return request.post('/api/favorites/toggle', data).then((res) => res.data)
  }
}

export default favoritesApi
