import service from '../config'
import { handleError } from '../error-handler'

/**
 * 文件内容（历史版本）API。
 * 供「添加到」等场景将 Markdown 内容写入知识库文件。
 */
export const fileBodiesApi = {
  /** 创建历史版本（写入文件内容） */
  create(data: { content: string; file_id: string; library_id: string }) {
    return service.post('/api/file-bodies', data).catch(handleError)
  },
}

export default fileBodiesApi
