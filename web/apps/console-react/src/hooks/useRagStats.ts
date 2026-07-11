import { formatFileInfo } from '@/api/modules/files/transform'

function parseJson<T>(json: string): T | null {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

/**
 * RAG统计格式化 Hook
 */
export const useRagStats = () => {
  const formatRagStats = (ragStats: any, processRecords: any[] = []) => {
    const knowledgeSearch = parseJson(
      (processRecords.find((record: any) => record.step_code === 'knowledge_search' && record.status === 'completed') || { data: '{"sources":[]}' }).data,
      { sources: [] }
    )

    const chunks = ragStats ? ragStats.document_search?.chunks || [] : []
    const document_quotations = ragStats ? ragStats.document_quotations || [] : []
    const file_quotations = ragStats ? ragStats.file_quotations || [] : []

    const filesSearch = chunks
      .filter((item: any) => ['web_search', 'web_page', 'knowledge', 'knowledge_search', 'graph_result'].includes(item.chunk_type))
      .map((chunk: any) => {
        const file = formatFileInfo(chunk.file_name || chunk.file_path || '')
        const sourceChunk = knowledgeSearch?.sources?.find((source: any) => source.source_key === chunk.source_key) || {}

        return {
          ...chunk,
          ...sourceChunk,
          library_id: String(chunk.library_id),
          file_id: String(chunk.file_id),
          file_name: file.fname || chunk.file_name,
          file_icon: file.icon,
        }
      })

    const fileIds = [...new Set(filesSearch.map((chunk: any) => chunk.file_id))]
    const libraryIds = [...new Set(filesSearch.map((chunk: any) => chunk.library_id))]
    const documentQuotations = document_quotations
      .map((chunk_id: any) => filesSearch.find((item: any) => item.chunk_id === String(chunk_id)))
      .filter(Boolean)
    const fileQuotations = file_quotations
      .map((file_id: any) => filesSearch.find((chunk: any) => chunk.file_id === String(file_id)))
      .filter(Boolean)

    return ragStats
      ? {
          ...ragStats,
          chunks: filesSearch,
          library_search: libraryIds
            .map((id: any) => filesSearch.find((chunk: any) => chunk.library_id === id))
            .filter(Boolean),
          files_search: fileIds
            .map((id: any) => filesSearch.find((chunk: any) => chunk.file_id === id))
            .filter(Boolean),
          document_quotations: documentQuotations,
          file_quotations: fileQuotations,
        }
      : null
  }

  return {
    formatRagStats,
  }
}

export default useRagStats
