export interface FileShareCreateRequest {
  file_id: string
  // 过期时间
  expire_time: number
}

export interface FileShareCreateResponse {
  share_id: number
  expire_time: string
}

export interface FileShareGetResponse {
  id: number,
  sort: number
  path: string
  type: number
  library_id: number,
  eid: number,
  config_id: number | null,
  upload_file_id: number,
  created_time: number,
  updated_time: number,
  upload_file: UploadFile | null
}

interface UploadFile {
  id: number
  file_name: string
  key: string
  size: number
  extension: string
  mime_type: string
}
