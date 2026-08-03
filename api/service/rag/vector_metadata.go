package rag

// DocumentVectorMetadataInput 文档向量 metadata 输入参数
type DocumentVectorMetadataInput struct {
	Eid                int64
	SpaceID            int64
	LibraryID          int64
	FileID             int64
	ChunkID            int64
	KnowledgeChunkID   int64
	ChunkType          string
	Content            string
	TokenCount         int
	Status             string
	EmbeddingModel     string
	EmbeddingChannelID int64
}

// buildDocumentVectorMetadata 构建文档向量的 metadata map
// 包含企业级 collection 过滤所需的完整 payload 字段
func buildDocumentVectorMetadata(input DocumentVectorMetadataInput) map[string]interface{} {
	status := input.Status
	if status == "" {
		status = "enabled"
	}
	metadata := map[string]interface{}{
		"eid":                  input.Eid,
		"space_id":             input.SpaceID,
		"library_id":           input.LibraryID,
		"file_id":              input.FileID,
		"chunk_id":             input.ChunkID,
		"chunk_type":           input.ChunkType,
		"content":              input.Content,
		"token_count":          input.TokenCount,
		"status":               status,
		"embedding_model":      input.EmbeddingModel,
		"embedding_channel_id": input.EmbeddingChannelID,
	}
	if input.KnowledgeChunkID > 0 {
		metadata["knowledge_chunk_id"] = input.KnowledgeChunkID
	}
	return metadata
}
