package controller

import (
	"github.com/53AI/53AIHub/model"
)

// 分块相关的请求和响应结构体

// CreateFileChunksRequest 创建文件分块请求
type CreateFileChunksRequest struct {
	ConfigID *int64 `json:"config_id" example:"1"` // 分块配置ID，可选
	Force    bool   `json:"force" example:"false"` // 是否强制重新分块
}

// CreateFileChunksResponse 创建文件分块响应
type CreateFileChunksResponse struct {
	Chunks   []ChunkInfo   `json:"chunks"`   // 分块列表
	Metadata ChunkMetadata `json:"metadata"` // 分块元数据
}

// ChunkInfo 分块信息
type ChunkInfo struct {
	ID              int64  `json:"id" example:"1"`                                           // 分块ID
	FileID          int64  `json:"file_id" example:"1"`                                      // 文件ID
	Type            string `json:"type" example:"knowledge"`                                 // 分块类型
	Content         string `json:"content" example:"这是分块内容"`                                 // 分块内容
	TokenCount      int    `json:"token_count" example:"150"`                                // Token数量
	StartPos        int    `json:"start_pos" example:"0"`                                    // 开始位置
	EndPos          int    `json:"end_pos" example:"100"`                                    // 结束位置
	EmbeddingStatus string `json:"embedding_status" example:"pending,parsing,normal,failed"` // 向量化状态
	VectorID        string `json:"vector_id" example:"vec_123"`                              // 向量ID
	IsManualEdited  bool   `json:"is_manual_edited" example:"false"`                         // 是否手动编辑
	CreatedTime     int64  `json:"created_time" example:"1672502400"`                        // 创建时间
	UpdatedTime     int64  `json:"updated_time" example:"1672502400"`                        // 更新时间
}

// ChunkMetadata 分块元数据
type ChunkMetadata struct {
	TotalChunks    int    `json:"total_chunks" example:"5"`       // 总分块数
	TotalTokens    int    `json:"total_tokens" example:"1500"`    // 总Token数
	AverageTokens  int    `json:"average_tokens" example:"300"`   // 平均Token数
	ProcessingTime int64  `json:"processing_time" example:"1500"` // 处理时间(毫秒)
	ConfigUsed     string `json:"config_used" example:"default"`  // 使用的配置
}

// SaveKnowledgeChunkResponse 保存知识点响应结构
type SaveKnowledgeChunkResponse struct {
	ChunkID int64       `json:"chunk_id"` // 主知识点分块ID
	Chunks  []ChunkInfo `json:"chunks"`   // 所有分块信息
}

// SaveKnowledgeChunkResult 保存知识点结果
type SaveKnowledgeChunkResult struct {
	MainChunkID     int64       `json:"main_chunk_id"`    // 主知识点分块ID
	Chunks          []ChunkInfo `json:"chunks"`           // 所有分块信息
	AsyncQueued     bool        `json:"async_queued"`     // 是否已异步排队处理派生内容
	RetrievalChunks int         `json:"retrieval_chunks"` // 检索块数量
	SummaryChunks   int         `json:"summary_chunks"`   // 概要块数量
	QuestionChunks  int         `json:"question_chunks"`  // 问题块数量
	RelationCount   int         `json:"relation_count"`   // 关联关系数量
}

// GetFileChunksResponse 获取文件分块列表响应
type GetFileChunksResponse struct {
	Chunks []ChunkInfo `json:"chunks"` // 分块列表
	Stats  *ChunkStats `json:"stats"`  // 统计信息
}

// ChunkStats 分块统计信息
type ChunkStats struct {
	TotalChunks        int `json:"total_chunks" example:"10"`        // 总分块数
	KnowledgeChunks    int `json:"knowledge_chunks" example:"8"`     // 知识分块数
	IndexChunks        int `json:"index_chunks" example:"2"`         // 索引分块数
	TotalTokens        int `json:"total_tokens" example:"3000"`      // 总Token数
	AverageTokens      int `json:"average_tokens" example:"300"`     // 平均Token数
	EmbeddedChunks     int `json:"embedded_chunks" example:"6"`      // 已向量化分块数
	ManualEditedChunks int `json:"manual_edited_chunks" example:"2"` // 手动编辑分块数
}

// SaveKnowledgeChunkRequest 保存知识点请求
type SaveKnowledgeChunkRequest struct {
	FileID              int64    `json:"file_id" binding:"required" example:"1"`
	LibraryID           int64    `json:"library_id" binding:"required" example:"1"`                               // 知识库ID
	Content             string   `json:"content" binding:"required" example:"知识点详细内容"`                            // 知识点内容
	Summary             []string `json:"summary" example:"[\"摘要1\",\"摘要2\"]" swaggertype:"array,string"`          // 内容概要列表
	CommonQuestions     []string `json:"common_questions" example:"[\"问题1\",\"问题2\"]" swaggertype:"array,string"` // 常见问法列表
	RelatedKnowledgeIDs []int64  `json:"related_knowledge_ids" example:"1,2,3" swaggertype:"array,integer"`       // 关联知识点ID列表
	ConfigID            *int64   `json:"config_id" example:"1"`                                                   // 分块配置ID，可选
	ChunkID             *int64   `json:"chunk_id" example:"1"`                                                    // 指定要更新的分块ID，如果提供则更新现有分块而不是创建新的
	AutoSplitRetrieval  *bool    `json:"auto_split_retrieval" example:"true"`                                     // 是否自动分检索块，新增默认true，更新默认false
}

// UpdateChunkRequest 更新分块请求
type UpdateChunkRequest struct {
	Content string `json:"content" example:"更新后的分块内容"` // 分块内容
}

// BatchUpdateChunksRequest 批量更新chunks请求结构
type BatchUpdateChunksRequest struct {
	Chunks map[int64]UpdateChunkRequest `json:"chunks"` // key: chunk ID, value: 更新内容
}

// MergeChunksRequest 合并分块请求
type MergeChunksRequest struct {
	FileID              int64   `json:"file_id" binding:"required" example:"1"`                                                 // 文件ID
	ChunkIDs            []int64 `json:"chunk_ids" binding:"required,dive,required" example:"1,2,3" swaggertype:"array,integer"` // 要合并的分块ID列表（至少2个）
	UpdateIndexes       *bool   `json:"update_indexes,omitempty" example:"false"`                                               // 是否更新其他分块索引
	ResetEmbedding      *bool   `json:"reset_embedding,omitempty" example:"false"`                                              // 是否重置向量化状态
	AutoSplitIfTooLarge *bool   `json:"auto_split_if_large,omitempty" example:"true"`                                           // 如果合并后过大是否自动拆分
}

// SplitChunkRequest 拆分分块请求
type SplitChunkRequest struct {
	SplitContents  []string `json:"split_contents" binding:"required,dive,required" example:"第一部分内容,第二部分内容" swaggertype:"array,string"` // 拆分后的内容列表（至少2个）
	UpdateIndexes  *bool    `json:"update_indexes,omitempty" example:"true"`                                                            // 是否更新其他分块索引
	ResetEmbedding *bool    `json:"reset_embedding,omitempty" example:"false"`                                                          // 是否重置向量化状态
}

// BatchSegmentRequest 批量段落操作请求
type BatchSegmentRequest struct {
	Operations           []BatchOperation              `json:"operations"`
	ContentUpdates       map[string]BatchContentUpdate `json:"content_updates"`
	UpdateRetrievalChunk *bool                         `json:"update_retrieval_chunk,omitempty"` // 是否更新检索块，默认为true
}

// BatchOperation 批量操作定义
type BatchOperation struct {
	Action           string   `json:"action" binding:"required"`     // "merge" or "split"
	Identifier       string   `json:"identifier" binding:"required"` // 主段落ID或临时ID
	OriginIdentifier string   `json:"origin_identifier,omitempty"`   // split操作的原始段落ID
	MergeIdentifiers []string `json:"merge_identifiers,omitempty"`   // merge操作的段落ID列表
}

// BatchContentUpdate 批量内容更新
type BatchContentUpdate struct {
	Content       string   `json:"content" binding:"required"`
	AppendContent []string `json:"append_content,omitempty"`
}

// RestoreDocumentRequest 还原文档请求
type RestoreDocumentRequest struct {
	FileID int64 `json:"file_id" binding:"required" example:"1"` // 文件ID
}

// RestoreDocumentResponse 还原文档响应
type RestoreDocumentResponse struct {
	Content string `json:"content"` // 还原的文档内容
	Length  int    `json:"length"`  // 内容长度
}

// SyncChunksToDocumentRequest 同步分块到文档请求
type SyncChunksToDocumentRequest struct {
	FileID int64 `json:"file_id" binding:"required" example:"1"` // 文件ID
}

// CheckDocumentStatusRequest 检查文档状态请求
type CheckDocumentStatusRequest struct {
	FileID int64 `json:"file_id" binding:"required" example:"1"` // 文件ID
}

// CheckDocumentStatusResponse 检查文档状态响应
type CheckDocumentStatusResponse struct {
	IsLocked       bool   `json:"is_locked"`       // 文档是否被锁定
	ChunkingStatus string `json:"chunking_status"` // 分块状态：chunking, embedding, completed
	CanEdit        bool   `json:"can_edit"`        // 是否可以编辑
	Message        string `json:"message"`         // 状态描述
}

// GetChunkEditStatusRequest 获取分块编辑状态请求
type GetChunkEditStatusRequest struct {
	FileID int64 `uri:"file_id" binding:"required" example:"1"` // 文件ID
}

// GetChunkEditStatusResponse 获取分块编辑状态响应
type GetChunkEditStatusResponse struct {
	FileID           int64                    `json:"file_id"`            // 文件ID
	IsDocumentLocked bool                     `json:"is_document_locked"` // 文档是否被锁定
	ChunkingStatus   string                   `json:"chunking_status"`    // 分块状态
	CanEdit          bool                     `json:"can_edit"`           // 是否可以编辑
	Message          string                   `json:"message"`            // 状态描述
	LockedChunks     []ChunkLockInfo          `json:"locked_chunks"`      // 被锁定的分块列表
	LockedRetrieval  []RetrievalChunkLockInfo `json:"locked_retrieval"`   // 被锁定的检索块列表
}

// ChunkLockInfo 分块锁定信息
type ChunkLockInfo struct {
	ChunkID  int64 `json:"chunk_id"`  // 分块ID
	IsLocked bool  `json:"is_locked"` // 是否被锁定
}

// RetrievalChunkLockInfo 检索块锁定信息
type RetrievalChunkLockInfo struct {
	ChunkID  int64 `json:"chunk_id"`  // 检索块ID
	IsLocked bool  `json:"is_locked"` // 是否被锁定
}

// BatchChunkOperationRequest 批量分块操作请求
type BatchChunkOperationRequest struct {
	ChunkIDs []int64 `json:"chunk_ids" binding:"required" example:"1,2,3"` // 分块ID列表
}

// ReindexDocumentRequest 重新索引文档请求
type ReindexDocumentRequest struct {
	FileID int64  `json:"file_id" binding:"required" example:"1"` // 文件ID
	Mode   string `json:"mode" example:"reindex_retrieval"`       // 模式: reindex_retrieval(默认) | rechunk_and_reindex
}

// PreviewChunkingRequest 预览分块请求
type PreviewChunkingRequest struct {
	FileID         int64                    `json:"file_id" binding:"required" example:"1"` // 文件ID
	ChunkingConfig model.ChunkingConfigData `json:"chunking_config" binding:"required"`     // 分块配置
	ModelConfig    *model.ModelConfigData   `json:"model_config,omitempty"`                 // 模型配置（可选）
}

// PreviewChunkingResponse 预览分块响应
type PreviewChunkingResponse struct {
	Chunks   []PreviewChunkInfo `json:"chunks"`   // 预览分块列表
	Metadata ChunkMetadata      `json:"metadata"` // 分块元数据
}

// PreviewRetrievalChunkInfo 预览检索块信息
type PreviewRetrievalChunkInfo struct {
	KnowledgeChunkIndex int    `json:"knowledge_chunk_index" example:"0"` // 关联的知识点分块索引
	Index               int    `json:"index" example:"0"`                 // 检索块索引
	Type                string `json:"type" example:"retrieval"`          // 检索块类型
	Content             string `json:"content" example:"这是检索块内容"`         // 检索块内容
	TokenCount          int    `json:"token_count" example:"150"`         // Token数量
}

// PreviewChunkInfo 预览分块信息
type PreviewChunkInfo struct {
	Index           int                         `json:"index" example:"0"`          // 分块索引
	Type            string                      `json:"type" example:"knowledge"`   // 分块类型
	Content         string                      `json:"content" example:"这是分块内容"`   // 分块内容
	TokenCount      int                         `json:"token_count" example:"150"`  // Token数量
	StartPos        int                         `json:"start_pos" example:"0"`      // 开始位置
	EndPos          int                         `json:"end_pos" example:"100"`      // 结束位置
	RetrievalChunks []PreviewRetrievalChunkInfo `json:"retrieval_chunks,omitempty"` // 检索块列表
}
