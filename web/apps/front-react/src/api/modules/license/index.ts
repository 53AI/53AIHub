import request from '../../index'

export default {
  features: () =>
    request.get('/api/v1/license/features')
}
