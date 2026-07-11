import request from '../index'
import { handleError } from '../errorHandler'

export const navigationApi = {
  async list(
    params: {
      keyword?: string
      offset?: number
      limit?: number
    } = {}
  ) {
    let { data = [] } = await request.get(`/api/navigations`, { params }).catch(handleError)
    return { total: data.length, list: data }
  },

  async detail({ navigation_id }: { navigation_id: number }) {
    const { data = {} } = await request.get(`/api/navigations/${navigation_id}`).catch(handleError)
    return data
  },

}
export default navigationApi
