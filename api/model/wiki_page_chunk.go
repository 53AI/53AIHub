package model

const (
	WikiPageChunkEmbeddingStatusPending    = "pending"
	WikiPageChunkEmbeddingStatusProcessing = "processing"
	WikiPageChunkEmbeddingStatusSucceeded  = "succeeded"
	WikiPageChunkEmbeddingStatusFailed     = "failed"

	WikiPageChunkIndexStatusPending   = "pending"
	WikiPageChunkIndexStatusActive    = "active"
	WikiPageChunkIndexStatusInactive  = "inactive"
	WikiPageChunkIndexStatusFailed    = "failed"
	WikiPageChunkIndexStatusOversized = "oversized"
)

// WikiPageChunk stores the versioned, searchable units of a Wiki page.
// It deliberately does not reuse RetrievalChunk because Wiki pages have their
// own version and source lifecycle.
type WikiPageChunk struct {
	ID                 int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid                int64  `json:"eid" gorm:"not null;index:idx_wiki_page_chunks_eid_page_version"`
	WikiPageID         int64  `json:"wiki_page_id" gorm:"not null;index:idx_wiki_page_chunks_page_version"`
	WikiPageVersionID  int64  `json:"wiki_page_version_id" gorm:"not null;index:idx_wiki_page_chunks_page_version"`
	ChunkID            string `json:"chunk_id" gorm:"not null;size:96;uniqueIndex:idx_wiki_page_chunks_chunk_id"`
	ParentSectionID    string `json:"parent_section_id" gorm:"size:96;index"`
	ChunkType          string `json:"chunk_type" gorm:"not null;size:32;index"`
	ChunkIndex         int    `json:"chunk_index" gorm:"not null;index"`
	HeadingPath        string `json:"heading_path" gorm:"size:1024"`
	OriginalStart      int    `json:"original_start" gorm:"not null;default:0"`
	OriginalEnd        int    `json:"original_end" gorm:"not null;default:0"`
	Content            string `json:"content" gorm:"type:text"`
	ContentHash        string `json:"content_hash" gorm:"not null;size:128;index"`
	TokenCount         int    `json:"token_count" gorm:"not null;default:0"`
	Oversized          bool   `json:"oversized" gorm:"not null;default:false;index"`
	EmbeddingStatus    string `json:"embedding_status" gorm:"not null;size:32;default:pending;index"`
	VectorID           string `json:"vector_id" gorm:"size:128;index"`
	EmbeddingModel     string `json:"embedding_model" gorm:"size:255"`
	EmbeddingDimension int    `json:"embedding_dimension" gorm:"not null;default:0"`
	IndexStatus        string `json:"index_status" gorm:"not null;size:32;default:pending;index"`
	ErrorMessage       string `json:"error_message" gorm:"type:text"`
	BaseModel
}

func (WikiPageChunk) TableName() string {
	return "wiki_page_chunks"
}
