export interface BaseResponse<T = any> {
  code: number
  message: string
  data: T
}

