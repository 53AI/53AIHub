import { getSimpleDateFormatString } from "@km/shared-utils"

const USER_ROLE_NORMAL = 1
const USER_ROLE_ADMIN = 10
const USER_ROLE_CREATOR = 10000


export function getFormatUserData(data = {}) {
  data.expired_time = +data.expired_time || 0
  data.created_time = +data.created_time || 0
  data.add_admin_time = +data.add_admin_time || 0
  if (data.expired_time) data.expired_time = getSimpleDateFormatString({ date: data.expired_time })
  if (data.created_time) data.register_time = getSimpleDateFormatString({ date: data.created_time })
  if (data.add_admin_time)
    data.add_admin_time = getSimpleDateFormatString({ date: data.add_admin_time })

  data.role = data.role || USER_ROLE_NORMAL
  data.is_admin = data.role === USER_ROLE_ADMIN
  data.is_creator = data.role === USER_ROLE_CREATOR

  data.departments = data.departments || []
  data.dept_id_list = data.departments.map((item) => +item.did).filter((did) => did)
  data.dept_names = data.departments.map((item) => item.name).join(',')

  return data
}
