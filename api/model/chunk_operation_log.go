package model

import (
	"encoding/json"
	"time"

	"gorm.io/gorm"
)

type ChunkOperationLog struct {
	ID     int64 `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid    int64 `json:"eid" gorm:"not null;index"`
	FileID int64 `json:"file_id" gorm:"not null;index" comment:"文件ID"`
	UserID int64 `json:"user_id" gorm:"not null;index" comment:"操作用户ID"`

	// 操作信息
	OperationType string `json:"operation_type" gorm:"size:30;not null;index" comment:"操作类型：merge,split,edit,auto_chunk"`
	OperationData string `json:"operation_data" gorm:"type:text" comment:"操作详情"`

	// 受影响的分块
	AffectedChunks string `json:"affected_chunks" gorm:"type:text" comment:"受影响的分块ID列表"`

	CreatedTime int64 `json:"created_time" gorm:"not null;index"`
}

// OperationData 操作数据结构
type OperationData struct {
	Description string                 `json:"description"`
	Details     map[string]interface{} `json:"details"`
}

// AffectedChunksData 受影响分块数据结构
type AffectedChunksData []int64

// TableName 设置表名
func (ChunkOperationLog) TableName() string {
	return "chunk_operation_logs"
}

// BeforeCreate 创建前钩子
func (col *ChunkOperationLog) BeforeCreate(tx *gorm.DB) error {
	if col.CreatedTime == 0 {
		col.CreatedTime = time.Now().UTC().UnixMilli()
	}
	return nil
}

// Save 创建操作日志
func (col *ChunkOperationLog) Save() error {
	if col.CreatedTime == 0 {
		col.CreatedTime = time.Now().UTC().UnixMilli()
	}

	result := DB.Create(col)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// GetOperationData 获取解析后的操作数据
func (col *ChunkOperationLog) GetOperationData() (*OperationData, error) {
	if col.OperationData == "" {
		return &OperationData{}, nil
	}

	var data OperationData
	err := json.Unmarshal([]byte(col.OperationData), &data)
	if err != nil {
		return nil, err
	}
	return &data, nil
}

// SetOperationData 设置操作数据
func (col *ChunkOperationLog) SetOperationData(data *OperationData) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}
	col.OperationData = string(jsonData)
	return nil
}

// GetAffectedChunks 获取受影响的分块ID列表
func (col *ChunkOperationLog) GetAffectedChunks() (AffectedChunksData, error) {
	if col.AffectedChunks == "" {
		return AffectedChunksData{}, nil
	}

	var chunks AffectedChunksData
	err := json.Unmarshal([]byte(col.AffectedChunks), &chunks)
	if err != nil {
		return nil, err
	}
	return chunks, nil
}

// SetAffectedChunks 设置受影响的分块ID列表
func (col *ChunkOperationLog) SetAffectedChunks(chunks AffectedChunksData) error {
	jsonData, err := json.Marshal(chunks)
	if err != nil {
		return err
	}
	col.AffectedChunks = string(jsonData)
	return nil
}

// GetChunkOperationLogsByFileID 获取文件的操作日志
func GetChunkOperationLogsByFileID(eid int64, fileID int64, limit int, offset int) ([]ChunkOperationLog, error) {
	var logs []ChunkOperationLog
	query := DB.Where("eid = ? AND file_id = ?", eid, fileID)

	if limit > 0 {
		query = query.Limit(limit)
	}
	if offset > 0 {
		query = query.Offset(offset)
	}

	if err := query.Order("created_time desc").Find(&logs).Error; err != nil {
		return nil, err
	}
	return logs, nil
}

// GetChunkOperationLogsByUserID 获取用户的操作日志
func GetChunkOperationLogsByUserID(eid int64, userID int64, limit int, offset int) ([]ChunkOperationLog, error) {
	var logs []ChunkOperationLog
	query := DB.Where("eid = ? AND user_id = ?", eid, userID)

	if limit > 0 {
		query = query.Limit(limit)
	}
	if offset > 0 {
		query = query.Offset(offset)
	}

	if err := query.Order("created_time desc").Find(&logs).Error; err != nil {
		return nil, err
	}
	return logs, nil
}

// GetChunkOperationLogsByType 根据操作类型获取日志
func GetChunkOperationLogsByType(eid int64, operationType string, limit int, offset int) ([]ChunkOperationLog, error) {
	var logs []ChunkOperationLog
	query := DB.Where("eid = ? AND operation_type = ?", eid, operationType)

	if limit > 0 {
		query = query.Limit(limit)
	}
	if offset > 0 {
		query = query.Offset(offset)
	}

	if err := query.Order("created_time desc").Find(&logs).Error; err != nil {
		return nil, err
	}
	return logs, nil
}

// CreateAutoChunkLog 创建自动分块日志
func CreateAutoChunkLog(eid int64, fileID int64, userID int64, chunkCount int, totalTokens int) error {
	operationData := &OperationData{
		Description: "自动分块处理",
		Details: map[string]interface{}{
			"chunk_count":  chunkCount,
			"total_tokens": totalTokens,
			"trigger":      "auto",
		},
	}

	log := &ChunkOperationLog{
		Eid:           eid,
		FileID:        fileID,
		UserID:        userID,
		OperationType: "auto_chunk",
	}

	if err := log.SetOperationData(operationData); err != nil {
		return err
	}

	return log.Save()
}

// CreateMergeLog 创建合并分块日志
func CreateMergeLog(eid int64, fileID int64, userID int64, sourceChunkIDs []int64, newChunkID int64) error {
	operationData := &OperationData{
		Description: "合并分块",
		Details: map[string]interface{}{
			"source_chunks": sourceChunkIDs,
			"new_chunk":     newChunkID,
			"merge_count":   len(sourceChunkIDs),
		},
	}

	// 受影响的分块包括源分块和新分块
	affectedChunks := make(AffectedChunksData, 0, len(sourceChunkIDs)+1)
	affectedChunks = append(affectedChunks, sourceChunkIDs...)
	affectedChunks = append(affectedChunks, newChunkID)

	log := &ChunkOperationLog{
		Eid:           eid,
		FileID:        fileID,
		UserID:        userID,
		OperationType: "merge",
	}

	if err := log.SetOperationData(operationData); err != nil {
		return err
	}

	if err := log.SetAffectedChunks(affectedChunks); err != nil {
		return err
	}

	return log.Save()
}

// CreateSplitLog 创建拆分分块日志
func CreateSplitLog(eid int64, fileID int64, userID int64, sourceChunkID int64, newChunkIDs []int64) error {
	operationData := &OperationData{
		Description: "拆分分块",
		Details: map[string]interface{}{
			"source_chunk": sourceChunkID,
			"new_chunks":   newChunkIDs,
			"split_count":  len(newChunkIDs),
		},
	}

	// 受影响的分块包括源分块和新分块
	affectedChunks := make(AffectedChunksData, 0, len(newChunkIDs)+1)
	affectedChunks = append(affectedChunks, sourceChunkID)
	affectedChunks = append(affectedChunks, newChunkIDs...)

	log := &ChunkOperationLog{
		Eid:           eid,
		FileID:        fileID,
		UserID:        userID,
		OperationType: "split",
	}

	if err := log.SetOperationData(operationData); err != nil {
		return err
	}

	if err := log.SetAffectedChunks(affectedChunks); err != nil {
		return err
	}

	return log.Save()
}

// CreateEditLog 创建编辑分块日志
func CreateEditLog(eid int64, fileID int64, userID int64, chunkID int64, oldContent string, newContent string) error {
	operationData := &OperationData{
		Description: "编辑分块内容",
		Details: map[string]interface{}{
			"chunk_id":        chunkID,
			"old_length":      len(oldContent),
			"new_length":      len(newContent),
			"content_changed": oldContent != newContent,
		},
	}

	affectedChunks := AffectedChunksData{chunkID}

	log := &ChunkOperationLog{
		Eid:           eid,
		FileID:        fileID,
		UserID:        userID,
		OperationType: "edit",
	}

	if err := log.SetOperationData(operationData); err != nil {
		return err
	}

	if err := log.SetAffectedChunks(affectedChunks); err != nil {
		return err
	}

	return log.Save()
}

// GetOperationStats 获取操作统计信息
func GetOperationStats(eid int64, fileID int64) (*OperationStats, error) {
	var stats OperationStats

	// 总操作数
	err := DB.Model(&ChunkOperationLog{}).
		Where("eid = ? AND file_id = ?", eid, fileID).
		Count(&stats.TotalOperations).Error
	if err != nil {
		return nil, err
	}

	// 按操作类型统计
	var typeStats []struct {
		OperationType string `json:"operation_type"`
		Count         int64  `json:"count"`
	}

	err = DB.Model(&ChunkOperationLog{}).
		Select("operation_type, COUNT(*) as count").
		Where("eid = ? AND file_id = ?", eid, fileID).
		Group("operation_type").
		Scan(&typeStats).Error
	if err != nil {
		return nil, err
	}

	stats.OperationsByType = make(map[string]int64)
	for _, stat := range typeStats {
		stats.OperationsByType[stat.OperationType] = stat.Count
	}

	// 最近操作时间
	var lastLog ChunkOperationLog
	err = DB.Where("eid = ? AND file_id = ?", eid, fileID).
		Order("created_time desc").
		First(&lastLog).Error
	if err == nil {
		stats.LastOperationTime = lastLog.CreatedTime
	}

	return &stats, nil
}

// OperationStats 操作统计信息
type OperationStats struct {
	TotalOperations   int64            `json:"total_operations"`
	OperationsByType  map[string]int64 `json:"operations_by_type"`
	LastOperationTime int64            `json:"last_operation_time"`
}

// DeleteChunkOperationLogsByFileID 删除文件的所有操作日志
func DeleteChunkOperationLogsByFileID(eid int64, fileID int64) error {
	return DB.Where("eid = ? AND file_id = ?", eid, fileID).Delete(&ChunkOperationLog{}).Error
}

// CleanupOldLogs 清理旧的操作日志（保留最近30天）
func CleanupOldLogs(eid int64) error {
	thirtyDaysAgo := time.Now().AddDate(0, 0, -30).UTC().UnixMilli()
	return DB.Where("eid = ? AND created_time < ?", eid, thirtyDaysAgo).Delete(&ChunkOperationLog{}).Error
}

// CreateSyncLog 创建同步分块到文档日志
func CreateSyncLog(eid int64, fileID int64, userID int64, contentLength int) error {
	operationData := &OperationData{
		Description: "同步分块内容到文档",
		Details: map[string]interface{}{
			"content_length": contentLength,
			"sync_time":      time.Now().UTC().UnixMilli(),
		},
	}

	log := &ChunkOperationLog{
		Eid:           eid,
		FileID:        fileID,
		UserID:        userID,
		OperationType: "sync",
	}

	if err := log.SetOperationData(operationData); err != nil {
		return err
	}

	// 同步操作不涉及特定分块，所以受影响分块为空
	if err := log.SetAffectedChunks(AffectedChunksData{}); err != nil {
		return err
	}

	return log.Save()
}
