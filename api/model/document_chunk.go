package model

import (
	"crypto/md5"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/utils"
	"github.com/53AI/53AIHub/config"
	"github.com/go-sql-driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type DocumentChunk struct {
	ID int64 `json:"id" gorm:"primaryKey;autoIncrement"`
	// 【修改点 1】Eid: 既保留原有的普通索引，又增加了 uniqueIndex // priority:1 确保它在联合索引中排在第一位
	Eid int64 `json:"eid" gorm:"not null;index:idx_document_chunks_eid_libraryid,priority:1;uniqueIndex:idx_document_chunks_unique,priority:1"`
	// 【修改点 2】FileID: 增加 uniqueIndex，排第二
	FileID    int64 `json:"file_id" gorm:"not null;uniqueIndex:idx_document_chunks_unique,priority:2" comment:"文件ID"`
	LibraryID int64 `json:"library_id" gorm:"not null;index:idx_document_chunks_eid_libraryid,priority:2" comment:"知识库ID"`

	// 分块内容
	Content         string `json:"content" gorm:"not null" comment:"分块内容"`
	ContentHash     string `json:"content_hash" gorm:"type:varchar(64);not null" comment:"内容哈希值"`
	Summary         string `json:"summary" gorm:"type:text" comment:"分块简介"`
	CommonQuestions string `json:"common_questions" gorm:"type:text" comment:"分块常见问法(JSON数组字符串)"`

	// 【修改点 3】ChunkIndex: 增加 uniqueIndex，排第三
	ChunkIndex int    `json:"chunk_index" gorm:"not null;uniqueIndex:idx_document_chunks_unique,priority:3" comment:"分块序号"`
	ChunkType  string `json:"chunk_type" gorm:"type:varchar(20);not null;default:'knowledge'" comment:"分块类型：knowledge,index"`

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

	AIGenerateDocChunkStatus string `json:"ai_generate_doc_chunk_status" gorm:"type:varchar(20);default:'parsing';comment:'AI 索引增强状态:inactive,normal,parsing,failed'"`
	// 召回统计
	RecallCount int64 `json:"recall_count" gorm:"not null;default:0" comment:"被召回次数"`

	// 字符统计字段
	CharacterCount int `json:"character_count" gorm:"not null;default:0;comment:'字符数'"`

	// 分块配置引用
	ChunkConfigID int64 `json:"chunk_config_id" gorm:"index" comment:"使用的分块配置ID"`

	// 关联信息（仅在查询时填充）
	RelatedChunks []DocumentChunk `json:"related_chunks,omitempty" gorm:"-" comment:"关联的分块"`
	RelationCount int             `json:"relation_count,omitempty" gorm:"-" comment:"关联数量"`

	// 关联的检索块数量（仅在查询时填充）
	RetrievalChunkCount int `json:"retrieval_chunk_count,omitempty" gorm:"-" comment:"关联的检索块数量"`

	BaseModel
}

// TableName 设置表名
func (DocumentChunk) TableName() string {
	return "document_chunks"
}

const (
	DocumentChunkEmbeddingStatusPending  = FileParsingStatusPending // 排队中
	DocumentChunkEmbeddingStatusIndexing = FileParsingStatusParsing // 索引中
	DocumentChunkEmbeddingStatusNormal   = FileParsingStatusNormal  // 索引完成
	DocumentChunkEmbeddingStatusFailed   = FileParsingStatusFail    // 索引失败

	// Deprecated: 兼容历史数据中的 completed 成功状态
	DocumentChunkEmbeddingStatusCompleted = "completed"
)

const (
	AIGenerateDocChunkStatusInactive = "inactive" // 未激活
	AIGenerateDocChunkStatusNormal   = "normal"   // 成功
	AIGenerateDocChunkStatusParsing  = "parsing"  // 正在解析
	AIGenerateDocChunkStatusFail     = "failed"   // 失败
)

// DocumentChunkEmbeddingSuccessStatuses 返回成功态（含历史兼容值）
func DocumentChunkEmbeddingSuccessStatuses() []string {
	return []string{
		DocumentChunkEmbeddingStatusNormal,
		DocumentChunkEmbeddingStatusCompleted,
	}
}

// IsDocumentChunkEmbeddingSucceeded 判断是否为成功态（含历史兼容值）
func IsDocumentChunkEmbeddingSucceeded(status string) bool {
	for _, s := range DocumentChunkEmbeddingSuccessStatuses() {
		if status == s {
			return true
		}
	}
	return false
}

// Save 创建文档分块
func (dc *DocumentChunk) Save() error {
	// 生成内容哈希
	dc.ContentHash = dc.GenerateContentHash()

	// 设置默认状态为enabled
	dc.Status = "enabled"

	// 计算字符数统计
	dc.CharacterCount = utils.CountCharacters(dc.Content)

	result := DB.Create(dc)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// Update 更新文档分块
func (dc *DocumentChunk) Update() error {
	// 更新内容哈希
	dc.ContentHash = dc.GenerateContentHash()

	// 计算字符数统计
	dc.CharacterCount = utils.CountCharacters(dc.Content)

	result := DB.Model(dc).Updates(dc)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// GenerateContentHash 生成内容哈希
func (dc *DocumentChunk) GenerateContentHash() string {
	data := fmt.Sprintf("%d:%s:%d", dc.FileID, dc.Content, dc.ChunkIndex)
	hash := md5.Sum([]byte(data))
	return fmt.Sprintf("%x", hash)
}

// IsContentChanged 检查内容是否发生变化
func (dc *DocumentChunk) IsContentChanged() bool {
	return dc.ContentHash != dc.GenerateContentHash()
}

// GetDocumentChunkByID 根据ID获取文档分块
func GetDocumentChunkByID(eid int64, id int64) (*DocumentChunk, error) {
	var chunk DocumentChunk
	if err := DB.Where("eid = ? AND id = ?", eid, id).First(&chunk).Error; err != nil {
		return nil, err
	}
	return &chunk, nil
}

// BatchGetDocumentChunksByIDs 批量根据ID获取文档分块
func BatchGetDocumentChunksByIDs(eid int64, ids []int64) ([]DocumentChunk, error) {
	if len(ids) == 0 {
		return []DocumentChunk{}, nil
	}

	var chunks []DocumentChunk
	if err := DB.Where("eid = ? AND id IN ?", eid, ids).
		Find(&chunks).Error; err != nil {
		return nil, err
	}
	return chunks, nil
}

// GetDocumentChunksByFileID 获取文件的所有分块
func GetDocumentChunksByFileID(eid int64, fileID int64, offset, limit int) ([]DocumentChunk, error) {
	var chunks []DocumentChunk
	query := DB.Where("eid = ? AND file_id = ?", eid, fileID).Order("chunk_index asc")
	if limit > 0 {
		query = query.Limit(limit)
	}
	if offset > 0 {
		query = query.Offset(offset)
	}
	if err := query.Find(&chunks).Error; err != nil {
		return nil, err
	}
	return chunks, nil
}

// GetDocumentChunksByFileIDWithFilters 获取文件的所有分块，支持状态和关键词筛选
func GetDocumentChunksByFileIDWithFilters(eid int64, fileID int64, offset, limit int, chunkType string, status string, keyword string) ([]DocumentChunk, error) {
	var chunks []DocumentChunk
	query := DB.Where("eid = ? AND file_id = ?", eid, fileID)

	if chunkType != "" {
		query = query.Where(map[string]any{"chunk_type": chunkType})
	}

	// 添加状态筛选
	if status != "" && (status == "enabled" || status == "disabled") {
		query = query.Where("status = ?", status)
	}

	// 添加关键词筛选
	if keyword != "" {
		query = query.Where("content LIKE ?", "%"+keyword+"%")
	}

	query = query.Order("chunk_index asc")
	if limit > 0 {
		query = query.Limit(limit)
	}
	if offset > 0 {
		query = query.Offset(offset)
	}

	if err := query.Find(&chunks).Error; err != nil {
		return nil, err
	}

	// 批量查询所有分块关联的检索块数量（ChunkType = 'retrieval'）
	if len(chunks) > 0 {
		// 收集所有分块ID
		chunkIDs := make([]int64, len(chunks))
		for i, chunk := range chunks {
			chunkIDs[i] = chunk.ID
		}

		// 批量查询关联的检索块数量
		type Result struct {
			KnowledgeChunkID int64 `json:"knowledge_chunk_id"`
			Count            int   `json:"count"`
		}

		var results []Result
		err := DB.Model(&RetrievalChunk{}).
			Select("knowledge_chunk_id, count(*) as count").
			Where("eid = ? AND knowledge_chunk_id IN ? AND chunk_type = ?", eid, chunkIDs, "retrieval").
			Group("knowledge_chunk_id").
			Scan(&results).Error

		if err != nil {
			return nil, err
		}

		// 创建映射以便快速查找
		countMap := make(map[int64]int)
		for _, result := range results {
			countMap[result.KnowledgeChunkID] = result.Count
		}

		// 将计数分配给对应的分块
		for i := range chunks {
			if count, exists := countMap[chunks[i].ID]; exists {
				chunks[i].RetrievalChunkCount = count
			} else {
				chunks[i].RetrievalChunkCount = 0
			}
		}
	}

	return chunks, nil
}

// GetDocumentChunksByLibraryID 获取知识库的所有分块
func GetDocumentChunksByLibraryID(eid int64, libraryID int64, limit int, offset int) ([]DocumentChunk, error) {
	var chunks []DocumentChunk
	query := DB.Where("eid = ? AND library_id = ?", eid, libraryID)

	if limit > 0 {
		query = query.Limit(limit)
	}
	if offset > 0 {
		query = query.Offset(offset)
	}

	if err := query.Order("created_time desc").Find(&chunks).Error; err != nil {
		return nil, err
	}
	return chunks, nil
}

// GetPendingEmbeddingChunks 获取待向量化的分块
func GetPendingEmbeddingChunks(eid int64, limit int) ([]DocumentChunk, error) {
	var chunks []DocumentChunk
	query := DB.Where("eid = ? AND embedding_status = ?", eid, DocumentChunkEmbeddingStatusPending)

	if limit > 0 {
		query = query.Limit(limit)
	}

	if err := query.Order("created_time asc").Find(&chunks).Error; err != nil {
		return nil, err
	}
	return chunks, nil
}

// UpdateChunkEmbeddingStatus 更新分块向量化状态
func UpdateChunkEmbeddingStatus(eid int64, chunkID int64, status string, vectorID string) error {
	updates := map[string]any{
		"embedding_status": status,
	}

	if vectorID != "" {
		updates["vector_id"] = vectorID
	}

	return DB.Model(&DocumentChunk{}).
		Where("eid = ? AND id = ?", eid, chunkID).
		Updates(updates).Error
}

// UpdateChunkStatus 更新分块状态
func UpdateChunkStatus(eid int64, chunkID int64, status string) error {
	return DB.Model(&DocumentChunk{}).
		Where("eid = ? AND id = ?", eid, chunkID).
		Update("status", status).Error
}

// DeleteDocumentChunk 删除文档分块（支持级联删除关联的检索块）
func DeleteDocumentChunk(eid int64, id int64) error {
	// 获取分块信息
	var chunk DocumentChunk
	err := DB.Where("eid = ? AND id = ?", eid, id).First(&chunk).Error
	if err != nil {
		return err
	}

	// 如果是知识点分块，需要级联删除关联的检索块
	if chunk.ChunkType == "knowledge" {
		// 开启事务
		tx := DB.Begin()
		defer func() {
			if r := recover(); r != nil {
				tx.Rollback()
			}
		}()

		// 删除关联的检索块
		err = tx.Where("eid = ? AND knowledge_chunk_id = ?", eid, id).
			Delete(&RetrievalChunk{}).Error
		if err != nil {
			tx.Rollback()
			return err
		}

		// 删除关联关系
		err = tx.Where("eid = ? AND knowledge_chunk_id = ?", eid, id).
			Delete(&ChunkRelation{}).Error
		if err != nil {
			tx.Rollback()
			return err
		}

		// 删除知识点分块
		err = tx.Where("eid = ? AND id = ?", eid, id).Delete(&DocumentChunk{}).Error
		if err != nil {
			tx.Rollback()
			return err
		}

		// 提交事务
		return tx.Commit().Error
	}

	// 非知识点分块，直接删除
	return DB.Where("eid = ? AND id = ?", eid, id).Delete(&DocumentChunk{}).Error
}

// DeleteDocumentChunksByFileID 删除文件的所有分块
func DeleteDocumentChunksByFileID(eid int64, fileID int64) error {
	return DB.Where("eid = ? AND file_id = ?", eid, fileID).Delete(&DocumentChunk{}).Error
}

/*
BatchCreateDocumentChunks 批量创建文档分块
改进点：
- 支持传入 db 的 BatchCreateDocumentChunksWithDB，用于在不同上下文下复用连接
- 按配置分批 (config.GetBatchSize)，并对锁等待/死锁错误进行指数退避重试，减少 1205/1213 错误
*/
func BatchCreateDocumentChunks(chunks []DocumentChunk) error {
	return BatchCreateDocumentChunksWithDB(DB, chunks)
}

// BatchCreateDocumentChunksWithDB 使用指定数据库连接批量创建文档分块，改为逐条保存
func BatchCreateDocumentChunksWithDB(db *gorm.DB, chunks []DocumentChunk) error {
	if len(chunks) == 0 {
		return nil
	}

	log.Printf("开始批量创建文档分块，总数: %d", len(chunks))

	// 生成内容哈希并设置默认状态
	for i := range chunks {
		chunks[i].ContentHash = chunks[i].GenerateContentHash()
		chunks[i].Status = "enabled"
	}

	batchSize := config.GetBatchSize(config.StrategyBatch)
	if batchSize <= 0 {
		batchSize = 50
	}

	// 进一步减小批次大小以减少锁等待时间
	// 当批次大小超过20时，强制调整为20以减少锁冲突
	if batchSize > 20 {
		batchSize = 20
	}

	maxRetries := config.CHUNK_SAVE_MAX_RETRIES
	// 增加重试次数
	if maxRetries < 10 {
		maxRetries = 10
	}
	retryDelay := time.Duration(config.CHUNK_SAVE_RETRY_DELAY) * time.Millisecond

	// 递归自适应分批插入：先尝试整批插入，失败且为可重试错误时二分重试，直到单条为止
	var insertBatchAdaptive func(batch []DocumentChunk) error
	insertBatchAdaptive = func(batch []DocumentChunk) error {
		if len(batch) == 0 {
			return nil
		}

		var err error
		for attempt := 1; attempt <= maxRetries; attempt++ {
			log.Printf("尝试保存批次，大小: %d, 尝试次数: %d", len(batch), attempt)

			// 使用 ON DUPLICATE KEY UPDATE 优化冲突处理
			// 基于 eid + file_id + chunk_index 唯一索引进行冲突检测和更新
			startTime := time.Now()
			err = db.Clauses(clause.OnConflict{
				Columns: []clause.Column{
					{Name: "eid"},
					{Name: "file_id"},
					{Name: "chunk_index"},
				},
				DoUpdates: clause.AssignmentColumns([]string{
					"content",
					"content_hash",
					"summary",
					"common_questions",
					"chunk_type",
					"start_position",
					"end_position",
					"token_count",
					"status",
					"is_manual_edited",
					"embedding_status",
					"vector_id",
					"recall_count",
					"updated_time",
				}),
			}).CreateInBatches(batch, len(batch)).Error
			duration := time.Since(startTime)

			if err == nil {
				log.Printf("成功保存批次，大小: %d, 耗时: %v", len(batch), duration)
				return nil
			}

			// 非锁相关错误不重试
			if !isRetryableDBError(err) {
				log.Printf("保存批次失败（不可重试错误），大小: %d, 错误: %v", len(batch), err)
				return err
			}

			log.Printf("BatchCreateDocumentChunks 可重试错误 - 尝试: %d, 大小: %d, 错误: %v, 耗时: %v", attempt, len(batch), err, duration)
			// 增加延迟时间
			time.Sleep(retryDelay * time.Duration(attempt*2))
		}

		// 如果批次只剩一条，执行有限次单条重试
		if len(batch) == 1 {
			return insertSingleChunkWithRetry(db, &batch[0], maxRetries, retryDelay)
		}

		// 二分拆分并重试，减少单条插入造成的性能问题
		mid := len(batch) / 2
		if err := insertBatchAdaptive(batch[:mid]); err != nil {
			return err
		}
		return insertBatchAdaptive(batch[mid:])
	}

	// 使用更小的批次大小以减少锁等待时间
	// 当批次大小超过30时，强制调整为30以减少锁冲突
	if batchSize > 30 {
		batchSize = 30
	}

	for i := 0; i < len(chunks); i += batchSize {
		end := i + batchSize
		if end > len(chunks) {
			end = len(chunks)
		}
		batch := chunks[i:end]

		if err := insertBatchAdaptive(batch); err != nil {
			return fmt.Errorf("批次 %d-%d 保存失败: %v", i, end-1, err)
		}
	}

	return nil
}

// isDuplicateKeyError 检查是否为重复键错误
func isDuplicateKeyError(err error) bool {
	if err == nil {
		return false
	}

	if me, ok := err.(*mysql.MySQLError); ok {
		// MySQL错误代码1062表示重复键错误
		return me.Number == 1062
	}

	errStr := err.Error()
	return strings.Contains(errStr, "Duplicate entry") ||
		strings.Contains(errStr, "duplicate key") ||
		strings.Contains(errStr, "UNIQUE constraint failed")
}

// insertSingleChunkWithRetry 单条记录插入重试机制
func insertSingleChunkWithRetry(db *gorm.DB, chunk *DocumentChunk, maxRetries int, retryDelay time.Duration) error {
	var err error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		// 使用 ON DUPLICATE KEY UPDATE 优化冲突处理
		// 基于 eid + file_id + chunk_index 唯一索引进行冲突检测和更新
		err = db.Clauses(clause.OnConflict{
			Columns: []clause.Column{
				{Name: "eid"},
				{Name: "file_id"},
				{Name: "chunk_index"},
			},
			DoUpdates: clause.Assignments(map[string]interface{}{
				"content":          gorm.Expr("VALUES(content)"),
				"content_hash":     gorm.Expr("VALUES(content_hash)"),
				"chunk_type":       gorm.Expr("VALUES(chunk_type)"),
				"start_position":   gorm.Expr("VALUES(start_position)"),
				"end_position":     gorm.Expr("VALUES(end_position)"),
				"token_count":      gorm.Expr("VALUES(token_count)"),
				"status":           gorm.Expr("VALUES(status)"),
				"is_manual_edited": gorm.Expr("VALUES(is_manual_edited)"),
				"embedding_status": gorm.Expr("VALUES(embedding_status)"),
				"vector_id":        gorm.Expr("VALUES(vector_id)"),
				"recall_count":     gorm.Expr("VALUES(recall_count)"),
				"updated_time":     gorm.Expr("VALUES(updated_time)"),
			}),
		}).Create(chunk).Error

		if err == nil {
			return nil
		}

		// 非锁相关错误不重试
		if !isRetryableDBError(err) {
			return err
		}

		log.Printf("单条插入可重试错误 - 尝试: %d, 错误: %v", attempt, err)
		// 增加延迟时间，采用指数退避策略
		time.Sleep(retryDelay * time.Duration(attempt*attempt))
	}

	return fmt.Errorf("单条插入失败，已达到最大重试次数 %d: %v", maxRetries, err)
}

func isRetryableDBError(err error) bool {
	if err == nil {
		return false
	}

	// MySQL specific errors
	if me, ok := err.(*mysql.MySQLError); ok {
		if me.Number == 1205 || me.Number == 1213 {
			return true
		}
	}

	// PostgreSQL and general database concurrency errors
	errStr := err.Error()
	if strings.Contains(errStr, "Lock wait timeout") ||
		strings.Contains(errStr, "deadlock") ||
		strings.Contains(errStr, "deadlock detected") ||
		strings.Contains(errStr, "could not obtain lock") {
		return true
	}

	return false
}

// GetChunkStatsByFileID 获取文件分块统计信息
// chunkType: 分块类型，如 "knowledge", "knowledge_map", "summary" 等
func GetChunkStatsByFileID(eid int64, fileID int64, chunkType string) (*ChunkStats, error) {
	var stats ChunkStats

	// 构建基础查询条件
	baseCondition := map[string]interface{}{
		"eid":     eid,
		"file_id": fileID,
	}

	// 如果指定了 chunkType，添加过滤条件
	if chunkType != "" {
		baseCondition["chunk_type"] = chunkType
	}

	// 总分块数
	err := DB.Model(&DocumentChunk{}).
		Where(baseCondition).
		Count(&stats.TotalChunks).Error
	if err != nil {
		return nil, err
	}

	// 已完成向量化的分块数
	err = DB.Model(&DocumentChunk{}).
		Where(baseCondition).Where("embedding_status IN ?", DocumentChunkEmbeddingSuccessStatuses()).
		Count(&stats.EmbeddedChunks).Error
	if err != nil {
		return nil, err
	}

	// 总Token数
	err = DB.Model(&DocumentChunk{}).
		Where(baseCondition).
		Select("COALESCE(SUM(token_count), 0)").
		Scan(&stats.TotalTokens).Error
	if err != nil {
		return nil, err
	}

	// 平均分块大小
	if stats.TotalChunks > 0 {
		stats.AvgChunkSize = float64(stats.TotalTokens) / float64(stats.TotalChunks)
	}

	return &stats, nil
}

// ChunkStats 分块统计信息
type ChunkStats struct {
	TotalChunks    int64   `json:"total_chunks"`
	EmbeddedChunks int64   `json:"embedded_chunks"`
	TotalTokens    int64   `json:"total_tokens"`
	AvgChunkSize   float64 `json:"avg_chunk_size"`
}

// SearchDocumentChunks 搜索文档分块
func SearchDocumentChunks(eid int64, query string, libraryIDs []int64, fileIDs []int64, limit int) ([]DocumentChunk, error) {
	var chunks []DocumentChunk

	dbQuery := DB.Where("eid = ? AND content LIKE ?", eid, "%"+query+"%")

	if len(libraryIDs) > 0 {
		dbQuery = dbQuery.Where("library_id IN ?", libraryIDs)
	}

	if len(fileIDs) > 0 {
		dbQuery = dbQuery.Where("file_id IN ?", fileIDs)
	}

	if limit > 0 {
		dbQuery = dbQuery.Limit(limit)
	}

	if err := dbQuery.Order("created_time desc").Find(&chunks).Error; err != nil {
		return nil, err
	}

	return chunks, nil
}

// IncrementRecallCount 批量增加召回次数
func IncrementRecallCount(eid int64, chunkIDs []int64) error {
	if len(chunkIDs) == 0 {
		return nil
	}

	return DB.Model(&DocumentChunk{}).
		Where("eid = ? AND id IN ?", eid, chunkIDs).
		Update("recall_count", gorm.Expr("recall_count + 1")).Error
}

// IncrementSingleRecallCount 增加单个分块的召回次数
func IncrementSingleRecallCount(eid int64, chunkID int64) error {
	return DB.Model(&DocumentChunk{}).
		Where("eid = ? AND id = ?", eid, chunkID).
		Update("recall_count", gorm.Expr("recall_count + 1")).Error
}

// GetTopRecalledChunks 获取召回次数最高的分块
func GetTopRecalledChunks(eid int64, libraryID int64, limit int) ([]DocumentChunk, error) {
	var chunks []DocumentChunk
	query := DB.Where("eid = ? AND status = ?", eid, "enabled")

	if libraryID > 0 {
		query = query.Where("library_id = ?", libraryID)
	}

	err := query.Order("recall_count DESC, created_time DESC").
		Limit(limit).
		Find(&chunks).Error

	if err != nil {
		return nil, err
	}

	return chunks, nil
}

// MergeDocumentChunks 合并文档分块
func MergeDocumentChunks(eid int64, chunkIDs []int64, newContent string) (*DocumentChunk, error) {
	if len(chunkIDs) < 2 {
		return nil, fmt.Errorf("至少需要2个分块才能合并")
	}

	// 获取要合并的分块
	var chunks []DocumentChunk
	err := DB.Where("eid = ? AND id IN ?", eid, chunkIDs).
		Order("chunk_index asc").Find(&chunks).Error
	if err != nil {
		return nil, err
	}

	if len(chunks) != len(chunkIDs) {
		return nil, fmt.Errorf("部分分块不存在")
	}

	// 检查分块是否属于同一文件
	fileID := chunks[0].FileID
	for _, chunk := range chunks {
		if chunk.FileID != fileID {
			return nil, fmt.Errorf("只能合并同一文件的分块")
		}
	}

	// 开启事务
	tx := DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 创建新的合并分块
	mergedChunk := &DocumentChunk{
		Eid:             eid,
		FileID:          fileID,
		LibraryID:       chunks[0].LibraryID,
		Content:         newContent,
		ChunkIndex:      chunks[0].ChunkIndex,
		ChunkType:       chunks[0].ChunkType,
		StartPosition:   chunks[0].StartPosition,
		EndPosition:     chunks[len(chunks)-1].EndPosition,
		Status:          "enabled",
		EmbeddingStatus: DocumentChunkEmbeddingStatusPending,
		IsManualEdited:  true,
	}

	// 保存新分块
	if err := tx.Create(mergedChunk).Error; err != nil {
		tx.Rollback()
		return nil, err
	}

	// 更新关联的检索块
	if err := tx.Model(&RetrievalChunk{}).
		Where("eid = ? AND knowledge_chunk_id IN ?", eid, chunkIDs).
		Update("knowledge_chunk_id", mergedChunk.ID).Error; err != nil {
		tx.Rollback()
		return nil, err
	}

	// 重新索引检索块
	if err := UpdateRetrievalChunkIndexes(eid, mergedChunk.ID); err != nil {
		tx.Rollback()
		return nil, err
	}

	// 删除原分块
	if err := tx.Where("eid = ? AND id IN ?", eid, chunkIDs).Delete(&DocumentChunk{}).Error; err != nil {
		tx.Rollback()
		return nil, err
	}

	// 提交事务
	if err := tx.Commit().Error; err != nil {
		return nil, err
	}

	return mergedChunk, nil
}

func UpdateDocumentChunksStatusToFailedByFileID(eid int64, fileID int64) (int64, error) {
	result := DB.Model(&DocumentChunk{}).
		Where("eid = ? AND file_id = ? AND embedding_status = ?",
			eid, fileID, DocumentChunkEmbeddingStatusPending).
		Updates(map[string]interface{}{
			"embedding_status": DocumentChunkEmbeddingStatusFailed,
			"updated_time":     time.Now(),
		})

	if result.Error != nil {
		return 0, result.Error
	}

	return result.RowsAffected, nil
}

// CountPendingEmbeddingDocumentChunksByFileID 统计文件待向量化文档分块数量
func CountPendingEmbeddingDocumentChunksByFileID(eid, fileID int64) (int64, error) {
	var count int64
	err := DB.Model(&DocumentChunk{}).
		Where("eid = ? AND file_id = ? AND embedding_status IN ?",
			eid, fileID, []string{DocumentChunkEmbeddingStatusPending, DocumentChunkEmbeddingStatusIndexing}).
		Count(&count).Error
	return count, err
}
