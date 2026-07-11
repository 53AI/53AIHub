import service from '../../config'
import { handleError } from '../../errorHandler'

const promptApi = {
  list(params: {
    keyword?: string
    group_id?: string
    group_type?: number
    offset?: number
    limit?: number
  }) {
    return service
      .get('/api/prompts', { params })
      .then(res => res.data)
      .catch(handleError)
  }
}

export default promptApi
