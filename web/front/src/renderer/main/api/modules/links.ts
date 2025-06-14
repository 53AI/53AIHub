import service from '../config'
import { handleError } from '../errorHandler'

export const links = {
  list(params?: { group_id?: number; keyword?: string }) {
    return service.get(`/api/ai_links/current`, { params }).catch(handleError)
  }
}
export default links
