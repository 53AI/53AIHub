package rag

import "fmt"

func buildChunkResolutionDebugMessage(
	stage string,
	query string,
	searchType string,
	docChunkID int64,
	retrievalChunkID int64,
	fileID int64,
	libraryID int64,
	docChunkType string,
	retrievalChunkType string,
	resolvedChunkType string,
	filePath string,
	score float64,
) string {
	return fmt.Sprintf(
		"【RAG检索】%s结果: query=%q, search_type=%s, doc_chunk_id=%d, retrieval_chunk_id=%d, file_id=%d, library_id=%d, doc_chunk_type=%q, retrieval_chunk_type=%q, resolved_chunk_type=%q, score=%.6f, file_path=%q",
		stage,
		truncateForDebug(query, 256),
		searchType,
		docChunkID,
		retrievalChunkID,
		fileID,
		libraryID,
		docChunkType,
		retrievalChunkType,
		resolvedChunkType,
		score,
		filePath,
	)
}
