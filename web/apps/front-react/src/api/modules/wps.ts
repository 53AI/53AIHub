import request from '../index'

export const wpsApi = {
  /**
   * 获取 WPS Ticket
   */
  ticket(): Promise<{ ticket: string }> {
    return request.get('/api/wps/ticket').then((res) => res.data)
  }
}

export default wpsApi
