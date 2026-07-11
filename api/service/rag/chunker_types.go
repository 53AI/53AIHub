package rag

import "github.com/53AI/53AIHub/model"

// ChunkResult 分块结果
type ChunkResult struct {
	Chunks   []DocumentChunk `json:"chunks"`
	Metadata ChunkMetadata   `json:"metadata"`
	Warnings []string        `json:"warnings"`
	Errors   []string        `json:"errors"`
}

// PreviewRetrievalChunk 预览检索块（用于预览和处理）
type PreviewRetrievalChunk struct {
	Index      int    `json:"index"`
	Type       string `json:"type"`
	Content    string `json:"content"`
	TokenCount int    `json:"token_count"`
}

// RetrievalChunk 检索块（用于预览和处理）
type RetrievalChunk struct {
	Index      int    `json:"index"`
	Type       string `json:"type"`
	Content    string `json:"content"`
	TokenCount int    `json:"token_count"`
}

// DocumentChunk 知识点分块（用于预览和处理）
type DocumentChunk struct {
	Index           int              `json:"index"`
	Type            string           `json:"type"`
	Content         string           `json:"content"`
	StartPos        int              `json:"start_pos"`
	EndPos          int              `json:"end_pos"`
	TokenCount      int              `json:"token_count"`
	ContentHash     string           `json:"content_hash"`
	ChunkConfigID   int64            `json:"chunk_config_id"`            // 添加ChunkConfigID字段
	RetrievalChunks []RetrievalChunk `json:"retrieval_chunks,omitempty"` // 添加关联的检索块
}

// ChunkMetadata 分块元数据
type ChunkMetadata struct {
	TotalChunks    int     `json:"total_chunks"`
	TotalTokens    int     `json:"total_tokens"`
	AvgChunkSize   float64 `json:"avg_chunk_size"`
	ProcessingTime int64   `json:"processing_time_ms"`
}

// Parsed document structures
type ParsedContent struct {
	Content       string
	Headers       []HeaderInfo
	Paragraphs    []ParagraphInfo
	SpecialBlocks []SpecialBlock
}

type HeaderInfo struct {
	Level    int
	Title    string
	Position int
	EndPos   int
	Content  string
}

type ParagraphInfo struct {
	Content  string
	Position int
	EndPos   int
}

type SpecialBlock struct {
	Type      string // table, code, math, mermaid, image
	Content   string
	Position  int
	EndPos    int
	Protected bool
}

// DocumentSection used by analyzeDocumentStructure
type DocumentSection struct {
	Title     string
	Level     int
	StartPos  int
	EndPos    int
	Content   string
	HasHeader bool
}

// Change tracking (smart update)
type ChunkChangeType string

const (
	ChunkChangeCreate ChunkChangeType = "create"
	ChunkChangeUpdate ChunkChangeType = "update"
	ChunkChangeDelete ChunkChangeType = "delete"
	ChunkChangeNone   ChunkChangeType = "none"
)

type ChunkChange struct {
	Type       ChunkChangeType
	OldChunk   *model.DocumentChunk // old chunk from DB
	NewChunk   *DocumentChunk       // new chunk (create/update)
	ChunkIndex int                  // index
}

type ChunkChanges struct {
	Creates []ChunkChange
	Updates []ChunkChange
	Deletes []ChunkChange
}

// Update results and stats
type ChunkUpdateResult struct {
	CreatedCount int           `json:"created_count"`
	UpdatedCount int           `json:"updated_count"`
	DeletedCount int           `json:"deleted_count"`
	TotalCount   int           `json:"total_count"`
	Changes      *ChunkChanges `json:"changes"`
	Metadata     ChunkMetadata `json:"metadata"`
}

type ChunkUpdateStats struct {
	KnowledgeChunks int64 `json:"knowledge_chunks"`
	RetrievalChunks int64 `json:"retrieval_chunks"`
	Relations       int64 `json:"relations"`
	EmbeddedChunks  int64 `json:"embedded_chunks"`
}

// Batch operations DTO
type BatchOperation struct {
	Action           string   `json:"action" binding:"required"`     // "merge" or "split"
	Identifier       string   `json:"identifier" binding:"required"` // chunk id or temp id
	OriginIdentifier string   `json:"origin_identifier,omitempty"`   // for split
	MergeIdentifiers []string `json:"merge_identifiers,omitempty"`   // for merge
}

type BatchContentUpdate struct {
	Content       string   `json:"content" binding:"required"`
	AppendContent []string `json:"append_content,omitempty"`
}

type BatchSegmentRequest struct {
	Operations           []BatchOperation              `json:"operations" binding:"required"`
	ContentUpdates       map[string]BatchContentUpdate `json:"content_updates" binding:"required"`
	UpdateRetrievalChunk bool                          `json:"update_retrieval_chunk"`
}

type BatchSegmentResult struct {
	CreatedChunks []string `json:"created_chunks"`
	UpdatedChunks []string `json:"updated_chunks"`
	DeletedChunks []string `json:"deleted_chunks"`
	TotalCount    int      `json:"total_count"`
}

type SplitInfo struct {
	Index            int    `json:"index"`
	Identifier       string `json:"identifier"`
	OriginIdentifier string `json:"origin_identifier"`
}

// Merge/Split options
type MergeChunksOptions struct {
	UpdateIndexes       bool `json:"update_indexes"`
	ResetEmbedding      bool `json:"reset_embedding"`
	AutoSplitIfTooLarge bool `json:"auto_split_if_large"`
}

type SplitChunkOptions struct {
	UpdateIndexes  bool `json:"update_indexes"`
	ResetEmbedding bool `json:"reset_embedding"`
}
