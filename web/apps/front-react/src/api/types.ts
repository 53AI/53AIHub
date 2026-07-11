// 基础响应类型
export interface BaseResponse<T = any> {
  code: number
  message: string
  data: T
}
