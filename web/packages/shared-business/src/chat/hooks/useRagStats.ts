import { useCallback } from "react";
import type { ChunkItem, ChunkType, RagStats } from "../types";
import { parseJson } from "./useChatStream";
import { formatFileInfo } from '@km/shared-utils';

type RagChunk = ChunkItem;

/** ChunkType 的运行时 source of truth：所有合法 chunk 类型字面量 */
export const validChunkTypes: ChunkType[] = [
  'web_search',
  'web_page',
  'knowledge',
  'knowledge_search',
  'summary',
  'knowledge_map',
  'graph_result',
  'wiki',
];

/**
 * 把后端返回的 rag_stats + process_records 规范化成渲染层需要的 RagStats。
 * 纯函数，可独立调用，便于在 hook 外（例如历史消息回放）复用。
 */
export function formatRagStats(
  ragStats: any,
  processRecords: any[] = []
): RagStats | null {
  const knowledgeSearchRecord = processRecords.find(
    (record: any) => record.step_code === "knowledge_search" && record.status === "completed"
  );
  const knowledgeSearchData = parseJson(
    knowledgeSearchRecord?.data || '{"sources":[]}',
    { sources: [] }
  );

  let chunks: any[] = ragStats ? ragStats.document_search?.chunks || [] : [];
  const document_quotations = ragStats ? ragStats.document_quotations || [] : [];
  let file_quotations: any[] = ragStats ? ragStats.file_quotations || [] : [];
  const wiki_quotations: any[] = ragStats ? ragStats.wiki_page_quotations || [] : [];

  // 补充 wiki sources：后端只把 wiki 数据放在 processRecords[knowledge_search].data.sources，
  // 不会写进 rag_stats.document_search.chunks，所以这里从 processRecords 补回来（去重）。
  const wikiSourcesFromRecords = (knowledgeSearchData?.sources || []).filter(
    (s: any) => s?.chunk_type === ("wiki" as const)
  );

  if (wikiSourcesFromRecords.length > 0) {
    chunks = [...(chunks as any[]), ...wikiSourcesFromRecords] as any;
  }

  const filesSearch = chunks
    .filter((item: any) => validChunkTypes.includes(item.chunk_type))
    .map((chunk: any) => {
      const isWiki = chunk.chunk_type === ("wiki" as const);
      const file = formatFileInfo(chunk.file_name || chunk.file_path || "");
      const sourceChunk =
        knowledgeSearchData?.sources?.find(
          (source: any) => source.source_key === chunk.source_key
        ) || {};

      return {
        ...chunk,
        ...sourceChunk,
        library_id: String(chunk.library_id ?? chunk.knowledge_base_id ?? ""),
        file_id: String(chunk.file_id ?? chunk.wiki_page_id ?? ""),
        file_name: isWiki
          ? chunk.title
          : file.fname || chunk.file_name,
        file_icon: file.icon,
      };
    });

  const fileIds = [...new Set(filesSearch.map((chunk: any) => chunk.file_id))];
  const wikiIds = [...new Set(filesSearch.map((chunk: any) => chunk.wiki_page_id))];
  const libraryIds = [...new Set(filesSearch.map((chunk: any) => chunk.library_id))];

  const documentQuotations = document_quotations
    .map((chunk_id: any) => filesSearch.find((item: any) => item.chunk_id === String(chunk_id)))
    .filter(Boolean);

  const fileQuotations = file_quotations
    .map((file_id: any) =>
      filesSearch.find((chunk: any) => chunk.file_id === String(file_id))
    )
    .filter(Boolean);

  const wikiQuotations = wiki_quotations
    .map((page_id: any) => {
      return filesSearch.find((chunk: any) => chunk.wiki_page_id === String(page_id))
    }).filter(Boolean)

  const librarySearch = libraryIds
    .map((id: any) => filesSearch.find((chunk: any) => chunk.library_id === id))
    .filter(Boolean);

  const filesSearchResult = [
    ...fileIds.map((id: any) => filesSearch.find((chunk: any) => chunk.file_id === id)).filter(Boolean),
    ...wikiIds.map((id: any) => filesSearch.find((chunk: any) => chunk.wiki_page_id === id)).filter(Boolean)
  ]

  return ragStats
    ? {
        ...ragStats,
        chunks: filesSearch,
        library_search: librarySearch,
        files_search: filesSearchResult,
        document_quotations: documentQuotations,
        file_quotations: [...fileQuotations, ...wikiQuotations],
      }
    : null;
}

export function useRagStats() {
  const formatRagStatsCallback = useCallback(
    (ragStats: any, processRecords: any[] = []) => formatRagStats(ragStats, processRecords),
    []
  );

  return { formatRagStats: formatRagStatsCallback };
}

export default useRagStats;