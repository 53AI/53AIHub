import { useCallback } from "react";
import type { ChunkItem, RagStats } from "../types";
import { parseJson } from "./useChatStream";
import { formatFileInfo } from '@km/shared-utils';

type RagChunk = ChunkItem;


export function useRagStats() {


  const formatRagStats = useCallback(
    (ragStats: any, processRecords: any[] = []): RagStats | null => {
      const knowledgeSearchRecord = processRecords.find(
        (record: any) => record.step_code === "knowledge_search" && record.status === "completed"
      );
      const knowledgeSearchData = parseJson(
        knowledgeSearchRecord?.data || '{"sources":[]}',
        { sources: [] }
      );

      const chunks = ragStats ? ragStats.document_search?.chunks || [] : [];
      const document_quotations = ragStats ? ragStats.document_quotations || [] : [];
      const file_quotations = ragStats ? ragStats.file_quotations || [] : [];

      const validChunkTypes = [
        "web_search",
        "web_page",
        "knowledge",
        "knowledge_search",
        "summary",
        "knowledge_map",
        "graph_result",
      ];

      const filesSearch = chunks
        .filter((item: any) => validChunkTypes.includes(item.chunk_type))
        .map((chunk: any) => {
          const file = formatFileInfo(chunk.file_name || chunk.file_path || "");
          const sourceChunk =
            knowledgeSearchData?.sources?.find(
              (source: any) => source.source_key === chunk.source_key
            ) || {};

          return {
            ...chunk,
            ...sourceChunk,
            library_id: String(chunk.library_id),
            file_id: String(chunk.file_id),
            file_name: file.fname || chunk.file_name,
            file_icon: file.icon,
          };
        });

      const fileIds = [...new Set(filesSearch.map((chunk: any) => chunk.file_id))];
      const libraryIds = [...new Set(filesSearch.map((chunk: any) => chunk.library_id))];

      const documentQuotations = document_quotations
        .map((chunk_id: any) => filesSearch.find((item: any) => item.chunk_id === String(chunk_id)))
        .filter(Boolean);

      const fileQuotations = file_quotations
        .map((file_id: any) =>
          filesSearch.find((chunk: any) => chunk.file_id === String(file_id))
        )
        .filter(Boolean);

      const librarySearch = libraryIds
        .map((id: any) => filesSearch.find((chunk: any) => chunk.library_id === id))
        .filter(Boolean);

      const filesSearchResult = fileIds
        .map((id: any) => filesSearch.find((chunk: any) => chunk.file_id === id))
        .filter(Boolean);

      return ragStats
        ? {
            ...ragStats,
            chunks: filesSearch,
            library_search: librarySearch,
            files_search: filesSearchResult,
            document_quotations: documentQuotations,
            file_quotations: fileQuotations,
          }
        : null;
    },
    [formatFileInfo]
  );

  return { formatRagStats };
}

export default useRagStats;
