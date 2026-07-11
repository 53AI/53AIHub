export interface RawUserInfo {
  "user_id": number,
  "username": string,
  "nickname": string,
  "avatar": string,
  "mobile": string,
  "email": string,
  "eid": string,
  "role": number,
  "group_id": number,
  "status": number,
  "expired_time": number,
  "last_login_time": number,
  "access_token": string,
  "related_id": number,
  "type": number,
  "add_admin_time": number,
  "openid": string,
  "unionid": string,
  "departments": null,
  "memberbindings": null,
  "group_ids": number[],
  "created_time": number,
  "updated_time": number,
  "group_name": string,
  "group_icon": string,
  "group_expire_day": number,
  "group_isexpired": boolean,
  "group_expire_time": string,
  "is_internal": boolean
}

export interface UserInfo extends RawUserInfo {
  is_admin: boolean
  is_creator: boolean
  dept_id_list: number[]
  dept_names: string
  register_time: string
}

export interface UserListParams {
  offset?: number
  limit?: number
  keyword?: string
  role?: number
  status?: number
  department_id?: number
}

export interface UserListResponse {
  users: RawUserInfo[]
  total: number
}

export interface UserCreateParams {
  username: string
  password: string
  nickname?: string
  email?: string
  mobile?: string
  role?: number
  department_ids?: number[]
}

export interface UserUpdateParams extends Partial<UserCreateParams> {
  user_id: number
}
