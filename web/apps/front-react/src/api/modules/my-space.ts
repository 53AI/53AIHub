import request from '../index'

// 个人空间上下文
export interface MySpaceContext {
  space_id: string
  space_name: string
  library_id: string
  library_name: string
}

// 文件来源字段
export interface FileOrigin {
  origin_type?: 'personal_upload' | 'manual_create' | 'ai_generated'
  origin_ref_id?: string
  origin_source?: 'local' | 'direct' | ''
}

// 上传文件信息
export interface UploadFileInfo {
  id: string
  file_name: string
  extension: string
  mime_type?: string
  size: number
  status: string
}

// 文件项
export interface MyUploadsFileItem extends FileOrigin {
  id: string
  path: string
  type: number // 0=文件夹, 1=文件
  library_id: string
  eid: string
  upload_file_id?: string
  is_favorite: boolean
  is_deleted: boolean
  conversion_status?: string
  parsing_status?: string
  user_id: string
  created_time: number
  updated_time: number
  upload_file?: UploadFileInfo
}

// 上传列表响应
export interface MyUploadsResponse {
  count: number
  data: MyUploadsFileItem[]
}

// 上传列表请求参数
export interface MyUploadsParams {
  type: 'file' | 'dir'
  path?: string
  keyword?: string
  offset?: number
  limit?: number
}

// 收藏列表请求参数
export interface MyFavoritesParams {
  resource_type?: number // 1=library, 2=file
  offset?: number
  limit?: number
  keyword?: string
}

// 收藏项
export interface MyFavoriteItem {
  resource_type: number // 1=library, 2=file
  resource_id: string
  file?: any // resource_type=2 时存在
  library_id?: string
  space_id?: string
  creator_id?: string
  favorite_time: number
  is_favorite?: boolean
}

// 收藏列表 includes
export interface MyFavoritesIncludes {
  libraries?: Record<string, any>
  spaces?: Record<string, any>
  users?: Record<string, any>
}

// 收藏列表响应
export interface MyFavoritesResponse {
  items: MyFavoriteItem[]
  includes: MyFavoritesIncludes
}

// 最近访问请求参数
export interface MyRecentlyParams {
  resource_type?: number // 1=library, 2=file
  offset?: number
  limit?: number
  keyword?: string
}

// 最近访问项
export interface MyRecentlyItem {
  resource_type: number // 1=library, 2=file
  resource_id: string
  file?: any // resource_type=2 时存在
  library_id?: string
  space_id?: string
  creator_id?: string
  recent_time: number
  is_favorite?: boolean
}

// 最近访问响应
export interface MyRecentlyResponse {
  items: MyRecentlyItem[]
  includes: MyFavoritesIncludes
}

// AI生成列表请求参数
export interface MyAIGeneratedParams {
  path?: string
  type?: 'file' | 'dir'
  keyword?: string
  offset?: number
  limit?: number
}

// AI生成列表响应
export interface MyAIGeneratedResponse {
  count: number
  data: MyUploadsFileItem[]
}

export interface FavoriteCheckRequest {
  resource_type: number // 1=知识库, 2=文件，9999=上传文件(用 uploadfile 查 file 再查收藏)
  ids: string[] // hashID 字符串数组，最多 100 个
}

export interface FavoriteCheckResponse {
  favorited_ids: string[] // 已收藏的 hashID 列表
}

const mySpaceApi = {
  // 获取个人空间上下文
  getContext(): Promise<MySpaceContext> {
    return request.get('/api/my-space/context').then((res) => res.data)
  },

  // 查询"我上传的"文件列表
  getUploads(params: MyUploadsParams): Promise<MyUploadsResponse> {
    const { offset = 0, limit = 30, ...restParams } = params
    return request.get('/api/my-space/uploads', {
      params: { offset, limit, ...restParams }
    }).then((res) => res.data)
  },

  // 查询"我的收藏"列表
  getFavorites(params?: MyFavoritesParams): Promise<MyFavoritesResponse> {
    return request.get('/api/my-space/favorites', { params }).then((res) => res.data)
  },

  // 查询"最近访问"列表
  getRecently(params?: MyRecentlyParams): Promise<MyRecentlyResponse> {
    return request.get('/api/my-space/recently', { params }).then((res) => res.data)
  },

  // 查询"AI生成的"文件列表
  getAIGenerated(params?: MyAIGeneratedParams): Promise<MyAIGeneratedResponse> {
    const { offset = 0, limit = 30, ...restParams } = params || {}
    return request.get('/api/my-space/ai-generated', {
      params: { offset, limit, ...restParams }
    }).then((res) => res.data)
  },

  // 批量查询文件或知识库是否被当前用户收藏
  check(data: FavoriteCheckRequest): Promise<FavoriteCheckResponse> {
    return request.post('/api/my-space/favorites/check', data).then((res) => res.data)
  }
}

export default mySpaceApi
