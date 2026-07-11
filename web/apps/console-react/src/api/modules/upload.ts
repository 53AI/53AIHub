import service from '../config'
import { handleError } from '../error-handler'

export const uploadApi = {
  upload(file: File) {
    const formData = new FormData()
    formData.append('file', file)
    return service.post('/api/upload', formData).catch(handleError)
  },
  preview(key: string) {
    return service.get(`/api/preview/${key}`).catch(handleError)
  },
}

export default uploadApi

