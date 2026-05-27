package model

import (
	"crypto/md5"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/utils"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// RetrievalChunk 检索块模型 - 专门用于向量检索的分块
type RetrievalChunk struct {
	ID        int64 `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid       int64 `json:"eid" gorm:"not null;index:idx_retrieval_chunks_eid_fileid,priority:1;uniqueIndex:idx_retrieval_chunks_unique,priority:1"`
	FileID    int64 `json:"file_id" gorm:"not null;index:idx_retrieval_chunks_eid_fileid,priority:2;uniqueIndex:idx_retrieval_chunks_unique,priority:2" comment:"文件ID"`
	LibraryID int64 `json:"library_id" gorm:"not null" comment:"知识库ID"`

	// 关联的知识点分块
	KnowledgeChunkID int64 `json:"knowledge_chunk_id" gorm:"not null;uniqueIndex:idx_retrieval_chunks_unique,priority:3" comment:"关联的知识点分块ID"`

	// 检索块内容
	Content     string `json:"content" gorm:"not null" comment:"检索块内容"`
	ContentHash string `json:"content_hash" gorm:"type:varchar(64);not null" comment:"内容哈希值"`

	// 检索块元数据
	ChunkIndex int    `json:"chunk_index" gorm:"not null;uniqueIndex:idx_retrieval_chunks_unique,priority:4" comment:"在同一知识点下的检索块序号"`
	ChunkType  string `json:"chunk_type" gorm:"type:varchar(20);not null;uniqueIndex:idx_retrieval_chunks_unique,priority:5;default:'retrieval'" comment:"分块类型：retrieval,summary,question"`

	// 位置信息
	StartPosition int `json:"start_position" gorm:"not null;default:0" comment:"在原文档中的起始位置"`
	EndPosition   int `json:"end_position" gorm:"not null;default:0" comment:"在原文档中的结束位置"`

	// Token信息
	TokenCount int `json:"token_count" gorm:"not null;default:0" comment:"Token数量"`

	// 状态
	Status         string `json:"status" gorm:"type:varchar(20);not null;default:'enabled'" comment:"状态：enabled,disabled"`
	IsManualEdited bool   `json:"is_manual_edited" gorm:"not null;default:false" comment:"是否人工编辑过"`

	// 向量化信息
	EmbeddingStatus string `json:"embedding_status" gorm:"type:varchar(20);not null;default:'pending'" comment:"向量化状态：pending,parsing,normal,failed;兼容历史completed"`
	VectorID        string `json:"vector_id" gorm:"type:varchar(255)" comment:"向量数据库中的ID"`
	ErrorReason     string `json:"error_reason" gorm:"type:text" comment:"向量化失败原因"`

	// 检索优化
	SearchKeywords string  `json:"search_keywords" gorm:"type:text" comment:"搜索关键词"`
	SearchWeight   float64 `json:"search_weight" gorm:"not null;default:1" comment:"检索权重"`

	// 字符统计字段
	CharacterCount int `json:"character_count" gorm:"not null;default:0;comment:'字符数'"`

	// 关联信息（仅在查询时填充）
	KnowledgeChunk *DocumentChunk `json:"knowledge_chunk,omitempty" gorm:"-" comment:"关联的知识点分块"`

	BaseModel
}

// TableName 设置表名
func (RetrievalChunk) TableName() string {
	return "retrieval_chunks"
}

const (
	RetrievalChunkEmbeddingStatusPending  = FileParsingStatusPending  // 排队中
	RetrievalChunkEmbeddingStatusIndexing = FileParsingStatusParsing  // 索引中
	RetrievalChunkEmbeddingStatusNormal   = FileParsingStatusNormal   // 索引完成
	RetrievalChunkEmbeddingStatusFailed   = FileParsingStatusFail     // 索引失败

	// Deprecated: 兼容历史数据中的 completed 成功状态
	RetrievalChunkEmbeddingStatusCompleted = "completed"
)

// RetrievalChunkEmbeddingSuccessStatuses 返回成功态（含历史兼容值）
func RetrievalChunkEmbeddingSuccessStatuses() []string {
	return []string{
		RetrievalChunkEmbeddingStatusNormal,
		RetrievalChunkEmbeddingStatusCompleted,
	}
}

// IsRetrievalChunkEmbeddingSucceeded 判断是否为成功态（含历史兼容值）
func IsRetrievalChunkEmbeddingSucceeded(status string) bool {
	for _, s := range RetrievalChunkEmbeddingSuccessStatuses() {
		if status == s {
			return true
		}
	}
	return false
}

// RetrievalChunkEmbeddingInProgressStatuses 返回排队/索引中的状态集合
func RetrievalChunkEmbeddingInProgressStatuses() []string {
	return []string{
		RetrievalChunkEmbeddingStatusPending,
		RetrievalChunkEmbeddingStatusIndexing,
	}
}

// Save 创建检索块
func (rc *RetrievalChunk) Save() error {
	// 计算字符数统计
	rc.CharacterCount = utils.CountCharacters(rc.Content)

	result := DB.Create(rc)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// Update 更新检索块
func (rc *RetrievalChunk) Update() error {
	// 更新内容哈希
	rc.ContentHash = rc.GenerateContentHash()

	// 计算字符数统计
	rc.CharacterCount = utils.CountCharacters(rc.Content)

	result := DB.Model(rc).Updates(rc)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// GenerateContentHash 生成内容哈希
func (rc *RetrievalChunk) GenerateContentHash() string {
	data := fmt.Sprintf("%d:%s:%d:%d", rc.FileID, rc.Content, rc.KnowledgeChunkID, rc.ChunkIndex)
	hash := md5.Sum([]byte(data))
	return fmt.Sprintf("%x", hash)
}

// IsContentChanged 检查内容是否发生变化
func (rc *RetrievalChunk) IsContentChanged() bool {
	return rc.ContentHash != rc.GenerateContentHash()
}

// GetSearchKeywords 获取解析后的搜索关键词
func (rc *RetrievalChunk) GetSearchKeywords() ([]string, error) {
	if rc.SearchKeywords == "" {
		return []string{}, nil
	}

	var keywords []string
	err := json.Unmarshal([]byte(rc.SearchKeywords), &keywords)
	if err != nil {
		return nil, err
	}
	return keywords, nil
}

// SetSearchKeywords 设置搜索关键词
func (rc *RetrievalChunk) SetSearchKeywords(keywords []string) error {
	data, err := json.Marshal(keywords)
	if err != nil {
		return err
	}
	rc.SearchKeywords = string(data)
	return nil
}

// GetRetrievalChunkByID 根据ID获取检索块
func GetRetrievalChunkByID(eid int64, id int64) (*RetrievalChunk, error) {
	var chunk RetrievalChunk
	if err := DB.Where("eid = ? AND id = ?", eid, id).First(&chunk).Error; err != nil {
		return nil, err
	}
	return &chunk, nil
}

// GetRetrievalChunkByVectorID 根据向量ID获取检索块
func GetRetrievalChunkByVectorID(eid int64, vectorID interface{}) (*RetrievalChunk, error) {
	var chunk RetrievalChunk
	// 使用双引号包裹保留关键字以兼容PostgreSQL
	if err := DB.Where("eid = ? AND vector_id = ?", eid, vectorID).First(&chunk).Error; err != nil {
		return nil, err
	}
	return &chunk, nil
}

// GetRetrievalChunksByKnowledgeID 根据知识点分块ID获取所有检索块
func GetRetrievalChunksByKnowledgeID(eid int64, knowledgeChunkID int64) ([]RetrievalChunk, error) {
	var chunks []RetrievalChunk
	err := DB.Where("eid = ? AND knowledge_chunk_id = ?", eid, knowledgeChunkID).
		Order("chunk_index asc").Find(&chunks).Error
	return chunks, err
}

// GetRetrievalChunksByFileID 根据文件ID获取所有检索块
func GetRetrievalChunksByFileID(eid int64, fileID int64) ([]RetrievalChunk, error) {
	var chunks []RetrievalChunk
	err := DB.Joins("JOIN files ON retrieval_chunks.file_id = files.id AND retrieval_chunks.eid = files.eid").
		Where("retrieval_chunks.eid = ? AND retrieval_chunks.file_id = ? AND files.parsing_status != ?", eid, fileID, FileParsingStatusDisabled).
		Order("knowledge_chunk_id asc, chunk_index asc").Find(&chunks).Error
	return chunks, err
}

// GetRetrievalChunksByFileIDWithKnowledge 获取文件的所有检索块并包含知识点信息
func GetRetrievalChunksByFileIDWithKnowledge(eid int64, fileID int64) ([]RetrievalChunk, error) {
	var chunks []RetrievalChunk
	err := DB.Preload("KnowledgeChunk").
		Joins("JOIN files ON retrieval_chunks.file_id = files.id AND retrieval_chunks.eid = files.eid").
		Where("retrieval_chunks.eid = ? AND retrieval_chunks.file_id = ? AND files.parsing_status != ?", eid, fileID, FileParsingStatusDisabled).
		Order("knowledge_chunk_id asc, chunk_index asc").
		Find(&chunks).Error
	return chunks, err
}

// DeleteRetrievalChunksByKnowledgeID 删除知识点分块的所有检索块
func DeleteRetrievalChunksByKnowledgeID(eid int64, knowledgeChunkID int64) error {
	return DB.Where("eid = ? AND knowledge_chunk_id = ?", eid, knowledgeChunkID).
		Delete(&RetrievalChunk{}).Error
}

// DeleteRetrievalChunksByFileID 删除文件的所有检索块
func DeleteRetrievalChunksByFileID(eid int64, fileID int64) error {
	return DB.Where("eid = ? AND file_id = ?", eid, fileID).
		Delete(&RetrievalChunk{}).Error
}

// UpdateRetrievalChunkEmbeddingStatus 更新检索块向量化状态
func UpdateRetrievalChunkEmbeddingStatus(eid int64, chunkID int64, status string, vectorID string, errorReason string) error {
	updates := map[string]interface{}{
		"embedding_status": status,
	}

	if vectorID != "" {
		updates["vector_id"] = vectorID
	}
	if errorReason != "" || IsRetrievalChunkEmbeddingSucceeded(status) {
		updates["error_reason"] = errorReason
	}

	return DB.Model(&RetrievalChunk{}).
		Where("eid = ? AND id = ?", eid, chunkID).
		Updates(updates).Error
}

// GetPendingEmbeddingRetrievalChunks 获取待向量化的检索块
func GetPendingEmbeddingRetrievalChunks(eid int64, limit int) ([]RetrievalChunk, error) {
	var chunks []RetrievalChunk
	query := DB.Where("eid = ? AND embedding_status = ?", eid, RetrievalChunkEmbeddingStatusPending)

	if limit > 0 {
		query = query.Limit(limit)
	}

	if err := query.Order("created_time asc").Find(&chunks).Error; err != nil {
		return nil, err
	}
	return chunks, nil
}

// GetRetrievalChunkStats 获取检索块统计信息
func GetRetrievalChunkStats(eid int64, fileID int64) (*RetrievalChunkStats, error) {
	var stats RetrievalChunkStats

	// 总检索块数
	err := DB.Model(&RetrievalChunk{}).
		Where("eid = ? AND file_id = ?", eid, fileID).
		Count(&stats.TotalChunks).Error
	if err != nil {
		return nil, err
	}

	// 已向量化的检索块数
	err = DB.Model(&RetrievalChunk{}).
		Where("eid = ? AND file_id = ? AND embedding_status IN ?", eid, fileID, RetrievalChunkEmbeddingSuccessStatuses()).
		Count(&stats.EmbeddedChunks).Error
	if err != nil {
		return nil, err
	}

	// 总Token数
	var totalTokens int64
	err = DB.Model(&RetrievalChunk{}).
		Select("SUM(token_count)").
		Where("eid = ? AND file_id = ?", eid, fileID).
		Scan(&totalTokens).Error
	if err != nil {
		return nil, err
	}
	stats.TotalTokens = totalTokens

	// 平均分块大小
	if stats.TotalChunks > 0 {
		stats.AvgChunkSize = float64(stats.TotalTokens) / float64(stats.TotalChunks)
	}

	// 按知识点分组统计
	var groupStats []struct {
		KnowledgeChunkID int64 `json:"knowledge_chunk_id"`
		Count            int64 `json:"count"`
	}

	err = DB.Model(&RetrievalChunk{}).
		Select("knowledge_chunk_id, COUNT(*) as count").
		Where("eid = ? AND file_id = ?", eid, fileID).
		Group("knowledge_chunk_id").
		Scan(&groupStats).Error
	if err != nil {
		return nil, err
	}

	stats.ChunksByKnowledge = make(map[int64]int64)
	for _, stat := range groupStats {
		stats.ChunksByKnowledge[stat.KnowledgeChunkID] = stat.Count
	}

	return &stats, nil
}

// RetrievalChunkStats 检索块统计信息
type RetrievalChunkStats struct {
	TotalChunks       int64           `json:"total_chunks"`
	EmbeddedChunks    int64           `json:"embedded_chunks"`
	TotalTokens       int64           `json:"total_tokens"`
	AvgChunkSize      float64         `json:"avg_chunk_size"`
	ChunksByKnowledge map[int64]int64 `json:"chunks_by_knowledge"`
}

// BatchCreateRetrievalChunks 批量创建检索块
func BatchCreateRetrievalChunks(chunks []RetrievalChunk) error {
	return BatchCreateRetrievalChunksWithDB(DB, chunks)
}

// SaveRetrievalChunksDelegate 可由外部包注入以替代默认的批量保存实现（避免包循环依赖）
var SaveRetrievalChunksDelegate func(db *gorm.DB, chunks []RetrievalChunk) error

// BatchCreateRetrievalChunksWithDB 使用指定数据库连接批量创建检索块，改为逐条保存或委托外部实现
func BatchCreateRetrievalChunksWithDB(db *gorm.DB, chunks []RetrievalChunk) error {
	if len(chunks) == 0 {
		return nil
	}

	// 如果外部注入了委托实现，优先使用委托
	if SaveRetrievalChunksDelegate != nil {
		return SaveRetrievalChunksDelegate(db, chunks)
	}

	log.Printf("开始逐条创建检索块，总数: %d", len(chunks))

	// 生成内容哈希
	for i := range chunks {
		if chunks[i].ContentHash == "" {
			chunks[i].ContentHash = chunks[i].GenerateContentHash()
		}
	}

	// 改为逐条保存，避免批量保存问题（保留向后兼容的本地实现）
	for i, chunk := range chunks {
		// 使用带重试机制的保存方法
		err := saveRetrievalChunkWithRetry(db, &chunk, 5, time.Millisecond*100)
		if err != nil {
			log.Printf("保存检索块失败，索引: %d, 错误: %v", i, err)
			return fmt.Errorf("保存检索块失败，索引: %d, 错误: %v", i, err)
		}

		log.Printf("成功保存检索块，索引: %d, ID: %d", i, chunk.ID)
	}

	log.Printf("成功逐条创建 %d 个检索块", len(chunks))
	return nil
}

// saveRetrievalChunkWithRetry 带重试机制的保存方法
func saveRetrievalChunkWithRetry(db *gorm.DB, chunk *RetrievalChunk, maxRetries int, retryDelay time.Duration) error {
	var err error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		err = db.Clauses(clause.OnConflict{
			Columns: []clause.Column{
				{Name: "eid"},
				{Name: "file_id"},
				{Name: "knowledge_chunk_id"},
				{Name: "chunk_index"},
				{Name: "chunk_type"},
			},
			DoUpdates: clause.Assignments(map[string]interface{}{
				"content":          gorm.Expr("VALUES(content)"),
				"chunk_type":       gorm.Expr("VALUES(chunk_type)"),
				"start_position":   gorm.Expr("VALUES(start_position)"),
				"end_position":     gorm.Expr("VALUES(end_position)"),
				"token_count":      gorm.Expr("VALUES(token_count)"),
				"status":           gorm.Expr("VALUES(status)"),
				"is_manual_edited": gorm.Expr("VALUES(is_manual_edited)"),
				"embedding_status": gorm.Expr("VALUES(embedding_status)"),
				"vector_id":        gorm.Expr("VALUES(vector_id)"),
				"search_keywords":  gorm.Expr("VALUES(search_keywords)"),
				"search_weight":    gorm.Expr("VALUES(search_weight)"),
				"updated_time":     gorm.Expr("VALUES(updated_time)"),
				"content_hash":     gorm.Expr("VALUES(content_hash)"),
			}),
		}).Create(chunk).Error

		if err == nil {
			return nil // 成功保存
		}

		// 非锁相关错误不重试
		if !isRetryableError(err) {
			return err
		}

		log.Printf("保存检索块可重试错误 - 尝试: %d, 错误: %v", attempt, err)
		// 增加延迟时间，采用指数退避策略
		time.Sleep(retryDelay * time.Duration(attempt*attempt))
	}

	return fmt.Errorf("保存检索块失败，已达到最大重试次数 %d: %v", maxRetries, err)
}

// isRetryableError 检查是否为可重试的数据库错误
func isRetryableError(err error) bool {
	if err == nil {
		return false
	}

	errStr := err.Error()
	if strings.Contains(errStr, "Lock wait timeout") ||
		strings.Contains(errStr, "deadlock") ||
		strings.Contains(errStr, "try restarting transaction") {
		return true
	}
	return false
}

// UpdateRetrievalChunkIndexes 更新检索块索引
func UpdateRetrievalChunkIndexes(eid int64, knowledgeChunkID int64) error {
	var chunks []RetrievalChunk
	err := DB.Where("eid = ? AND knowledge_chunk_id = ?", eid, knowledgeChunkID).
		Order("id asc").Find(&chunks).Error
	if err != nil {
		return err
	}

	// 重新分配索引
	for i := range chunks {
		chunks[i].ChunkIndex = i
	}

	// 批量更新
	for _, chunk := range chunks {
		err = DB.Model(&chunk).Update("chunk_index", chunk.ChunkIndex).Error
		if err != nil {
			return err
		}
	}

	return nil
}

// GetPendingEmbeddingRetrievalChunksByFileID 获取文件的待向量化检索块
func GetPendingEmbeddingRetrievalChunksByFileID(eid int64, fileID int64) ([]RetrievalChunk, error) {
	var chunks []RetrievalChunk
	err := DB.Where("eid = ? AND file_id = ? AND embedding_status = ?",
		eid, fileID, RetrievalChunkEmbeddingStatusPending).Find(&chunks).Error
	if err != nil {
		return nil, err
	}
	return chunks, nil
}

// BatchGetRetrievalChunksByVectorIDs 批量根据向量ID获取检索块
func BatchGetRetrievalChunksByVectorIDs(eid int64, vectorIDs []interface{}) ([]RetrievalChunk, error) {
	if len(vectorIDs) == 0 {
		return []RetrievalChunk{}, nil
	}

	var chunks []RetrievalChunk
	if err := DB.Where("eid = ? AND vector_id IN ?", eid, vectorIDs).
		Find(&chunks).Error; err != nil {
		return nil, err
	}
	return chunks, nil
}

func UpdateRetrievalChunksStatusToFailedByFileID(eid int64, fileID int64, errorReason string) (int64, error) {
	updates := map[string]interface{}{
		"embedding_status": RetrievalChunkEmbeddingStatusFailed,
		"updated_time":     time.Now(),
	}
	if errorReason != "" {
		updates["error_reason"] = errorReason
	}

	result := DB.Model(&RetrievalChunk{}).
		Where("eid = ? AND file_id = ? AND embedding_status IN ?",
			eid, fileID, RetrievalChunkEmbeddingInProgressStatuses()).
		Updates(updates)

	log.Printf("[UpdateRetrievalChunksStatusToFailedByFileID] eid=%d fileID=%d errorReason=%s rows=%d\n", eid, fileID, errorReason, result.RowsAffected)

	if result.Error != nil {
		return 0, result.Error
	}

	return result.RowsAffected, nil
}

// CountPendingEmbeddingRetrievalChunksByFileID 统计文件待向量化检索块数量
func CountPendingEmbeddingRetrievalChunksByFileID(eid, fileID int64) (int64, error) {
	var count int64
	err := DB.Model(&RetrievalChunk{}).
		Where("eid = ? AND file_id = ? AND embedding_status IN ?",
			eid, fileID, RetrievalChunkEmbeddingInProgressStatuses()).
		Count(&count).Error
	return count, err
}
