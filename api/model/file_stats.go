package model

// FileDeletionStats 文件删除统计信息
type FileDeletionStats struct {
	FileID          int64 `json:"file_id"`
	DocumentChunks  int64 `json:"document_chunks"`
	RetrievalChunks int64 `json:"retrieval_chunks"`
	Relations       int64 `json:"relations"`
	Vectors         int64 `json:"vectors"`
	OperationLogs   int64 `json:"operation_logs"`
	FileVersions    int64 `json:"file_versions"` // 新增：文件版本数量
}

// GetFileDeletionStats 获取文件删除统计信息（统一方法）
func GetFileDeletionStats(eid int64, fileID int64) (*FileDeletionStats, error) {
	stats := &FileDeletionStats{FileID: fileID}

	// 并发统计各类数据
	type countResult struct {
		field string
		count int64
		err   error
	}

	results := make(chan countResult, 6)

	// 统计文档分块
	go func() {
		var count int64
		err := DB.Model(&DocumentChunk{}).
			Where("eid = ? AND file_id = ?", eid, fileID).Count(&count).Error
		results <- countResult{"documents", count, err}
	}()

	// 统计检索块
	go func() {
		var count int64
		err := DB.Model(&RetrievalChunk{}).
			Where("eid = ? AND file_id = ?", eid, fileID).Count(&count).Error
		results <- countResult{"retrieval", count, err}
	}()

	// 统计关联关系
	go func() {
		var count int64
		err := DB.Model(&ChunkRelation{}).
			Where("eid = ? AND file_id = ?", eid, fileID).Count(&count).Error
		results <- countResult{"relations", count, err}
	}()

	// 统计向量数量
	go func() {
		var docVectors, retrievalVectors int64
		err1 := DB.Model(&DocumentChunk{}).
			Where("eid = ? AND file_id = ? AND vector_id != ''", eid, fileID).Count(&docVectors).Error
		err2 := DB.Model(&RetrievalChunk{}).
			Where("eid = ? AND file_id = ? AND vector_id != ''", eid, fileID).Count(&retrievalVectors).Error

		var err error
		if err1 != nil {
			err = err1
		} else if err2 != nil {
			err = err2
		}
		results <- countResult{"vectors", docVectors + retrievalVectors, err}
	}()

	// 统计操作日志
	go func() {
		var count int64
		err := DB.Model(&ChunkOperationLog{}).
			Where("eid = ? AND file_id = ?", eid, fileID).Count(&count).Error
		results <- countResult{"logs", count, err}
	}()

	// 统计文件版本
	go func() {
		var count int64
		err := DB.Model(&FileBodyVersion{}).
			Where("file_id = ?", fileID).Count(&count).Error
		results <- countResult{"versions", count, err}
	}()

	// 收集结果
	for i := 0; i < 6; i++ {
		result := <-results
		if result.err != nil {
			return nil, result.err
		}

		switch result.field {
		case "documents":
			stats.DocumentChunks = result.count
		case "retrieval":
			stats.RetrievalChunks = result.count
		case "relations":
			stats.Relations = result.count
		case "vectors":
			stats.Vectors = result.count
		case "logs":
			stats.OperationLogs = result.count
		case "versions":
			stats.FileVersions = result.count
		}
	}

	return stats, nil
}

// EstimateDeletionTime 估算删除时间
func (s *FileDeletionStats) EstimateDeletionTime() string {
	totalItems := s.DocumentChunks + s.RetrievalChunks + s.Relations + s.Vectors

	switch {
	case totalItems == 0:
		return "< 1秒"
	case totalItems < 100:
		return "1-3秒"
	case totalItems < 1000:
		return "3-10秒"
	default:
		return "> 10秒"
	}
}

// ShouldUseAsync 判断是否应该使用异步删除
func (s *FileDeletionStats) ShouldUseAsync() bool {
	return s.DocumentChunks > 10 || s.RetrievalChunks > 50 || s.Vectors > 100
}

// TotalItems 获取总项目数
func (s *FileDeletionStats) TotalItems() int64 {
	return s.DocumentChunks + s.RetrievalChunks + s.Relations + s.Vectors + s.OperationLogs + s.FileVersions
}
