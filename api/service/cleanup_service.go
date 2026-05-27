package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/53AI/53AIHub/service/vectorstore"
	"gorm.io/gorm"
)

// CleanupService 数据清理服务
type CleanupService struct {
	db *gorm.DB
}

var ErrPermissionDenied = errors.New("permission denied")

// NewCleanupService 创建清理服务实例
func NewCleanupService(db *gorm.DB) *CleanupService {
	return &CleanupService{
		db: db,
	}
}

// CleanupFileRelatedData 清理文件相关数据
func (s *CleanupService) CleanupFileRelatedData(eid int64, fileID int64) error {
	fmt.Printf("开始清理文件相关数据 (FileID: %d)\n", fileID)

	vectorInfos, err := s.collectVectorIDs(eid, fileID)
	if err != nil {
		fmt.Printf("收集向量ID失败 (FileID: %d): %v\n", fileID, err)
	}

	err = s.cleanupDatabaseData(eid, fileID)
	if err != nil {
		return fmt.Errorf("清理数据库数据失败: %v", err)
	}

	if len(vectorInfos) > 0 {
		if err := s.deleteVectorsByInfos(eid, vectorInfos); err != nil {
			fmt.Printf("删除向量数据失败 (FileID: %d): %v\n", fileID, err)
		} else {
			fmt.Printf("成功删除 %d 个向量 (FileID: %d)\n", len(vectorInfos), fileID)
		}
	}

	fmt.Printf("文件相关数据清理完成 (FileID: %d)\n", fileID)
	return nil
}

// collectVectorIDs 收集文件相关的所有向量ID及其库ID
func (s *CleanupService) collectVectorIDs(eid int64, fileID int64) ([]vectorInfo, error) {
	var infos []vectorInfo

	var retrievalChunks []model.RetrievalChunk
	err := s.db.Where("eid = ? AND file_id = ? AND vector_id != ''", eid, fileID).
		Select("vector_id, library_id").Find(&retrievalChunks).Error
	if err != nil {
		return nil, err
	}

	for _, chunk := range retrievalChunks {
		if chunk.VectorID != "" {
			infos = append(infos, vectorInfo{
				vectorID:  chunk.VectorID,
				libraryID: chunk.LibraryID,
			})
		}
	}

	return infos, nil
}

type vectorInfo struct {
	vectorID  string
	libraryID int64
}

// cleanupDatabaseData 清理数据库中的相关数据
func (s *CleanupService) cleanupDatabaseData(eid int64, fileID int64) error {
	// 开启事务
	tx := s.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 删除分块关联关系
	err := tx.Where("eid = ? AND file_id = ?", eid, fileID).Delete(&model.ChunkRelation{}).Error
	if err != nil {
		tx.Rollback()
		return fmt.Errorf("删除分块关联关系失败: %v", err)
	}

	// 删除检索块
	err = tx.Where("eid = ? AND file_id = ?", eid, fileID).Delete(&model.RetrievalChunk{}).Error
	if err != nil {
		tx.Rollback()
		return fmt.Errorf("删除检索块失败: %v", err)
	}

	// 删除文档分块
	err = tx.Where("eid = ? AND file_id = ?", eid, fileID).Delete(&model.DocumentChunk{}).Error
	if err != nil {
		tx.Rollback()
		return fmt.Errorf("删除文档分块失败: %v", err)
	}

	// 删除操作日志
	err = tx.Where("eid = ? AND file_id = ?", eid, fileID).Delete(&model.ChunkOperationLog{}).Error
	if err != nil {
		tx.Rollback()
		return fmt.Errorf("删除操作日志失败: %v", err)
	}

	// 删除文件内容
	err = tx.Where("eid = ? AND file_id = ?", eid, fileID).Delete(&model.FileBody{}).Error
	if err != nil {
		tx.Rollback()
		return fmt.Errorf("删除文件内容失败: %v", err)
	}

	err = tx.Where("file_id = ?", fileID).Delete(&model.FileBodyVersion{}).Error
	if err != nil {
		tx.Rollback()
		return fmt.Errorf("删除文件版本记录失败: %v", err)
	}

	err = tx.Where("eid = ? AND file_id = ?", eid, fileID).Delete(&model.EntityChunkRelation{}).Error
	if err != nil {
		tx.Rollback()
		return fmt.Errorf("删除实体关联关系失败: %v", err)
	}

	// 提交事务
	return tx.Commit().Error
}

// deleteVectorsByInfos 使用预收集的向量信息删除向量
func (s *CleanupService) deleteVectorsByInfos(eid int64, infos []vectorInfo) error {
	if len(infos) == 0 {
		return nil
	}

	config := vectorstore.LoadFromEnv()
	store, err := vectorstore.NewVectorStore(config)
	if err != nil {
		return fmt.Errorf("创建向量存储失败: %v", err)
	}

	ctx := context.Background()
	if err := store.Connect(ctx); err != nil {
		return fmt.Errorf("连接向量存储失败: %v", err)
	}
	defer store.Disconnect(ctx)

	type LibraryVectors struct {
		LibraryUUID string
		VectorIDs   []string
	}
	libraryVectorsMap := make(map[int64]*LibraryVectors)

	for _, info := range infos {
		if _, exists := libraryVectorsMap[info.libraryID]; !exists {
			library, err := model.GetLibraryByID(eid, info.libraryID)
			if err != nil {
				logger.SysLogf("警告: 清理向量时获取库信息失败 - EID:%d LibraryID:%d Err:%v", eid, info.libraryID, err)
				continue
			}
			libraryVectorsMap[info.libraryID] = &LibraryVectors{
				LibraryUUID: library.UUID,
				VectorIDs:   []string{},
			}
		}
		if lv, ok := libraryVectorsMap[info.libraryID]; ok {
			lv.VectorIDs = append(lv.VectorIDs, info.vectorID)
		}
	}

	for _, libVectors := range libraryVectorsMap {
		collection := model.GetVectorCollectionName(libVectors.LibraryUUID)
		ids := make([]interface{}, len(libVectors.VectorIDs))
		for i, id := range libVectors.VectorIDs {
			ids[i] = id
		}
		if err := store.Delete(ctx, collection, ids); err != nil {
			logger.SysLogf("警告: 从向量数据库删除失败 - EID:%d Collection:%s Count:%d Err:%v",
				eid, collection, len(ids), err)
		}
	}

	return nil
}

// deleteVectorsFromDB 从向量数据库删除向量
func (s *CleanupService) deleteVectorsFromDB(eid int64, vectorIDs []string) error {
	if len(vectorIDs) == 0 {
		return nil
	}

	// 从环境变量加载向量数据库配置
	config := vectorstore.LoadFromEnv()

	// 创建向量存储实例
	store, err := vectorstore.NewVectorStore(config)
	if err != nil {
		return fmt.Errorf("创建向量存储失败: %v", err)
	}

	// 连接向量存储
	ctx := context.Background()
	if err := store.Connect(ctx); err != nil {
		return fmt.Errorf("连接向量存储失败: %v", err)
	}
	defer store.Disconnect(ctx)

	// 通过向量ID获取库信息构建集合名
	// 由于可能涉及多个库，需要按库分组删除
	type LibraryVectors struct {
		LibraryUUID string
		VectorIDs   []string
	}

	libraryVectorsMap := make(map[int64]*LibraryVectors)

	// 查询所有向量对应的库信息
	var chunks []model.RetrievalChunk
	if err := s.db.Where("eid = ? AND vector_id IN ?", eid, vectorIDs).Find(&chunks).Error; err != nil {
		return fmt.Errorf("查询向量对应的分块信息失败: %v", err)
	}

	// 按库分组向量ID
	for _, chunk := range chunks {
		if _, exists := libraryVectorsMap[chunk.LibraryID]; !exists {
			library, err := model.GetLibraryByID(eid, chunk.LibraryID)
			if err != nil {
				// 记录无法获取库信息的错误，但继续处理其他库
				logger.SysLogf("警告: 清理向量时获取库信息失败 - EID:%d LibraryID:%d VectorID:%s Err:%v",
					eid, chunk.LibraryID, chunk.VectorID, err)
				continue
			}
			libraryVectorsMap[chunk.LibraryID] = &LibraryVectors{
				LibraryUUID: library.UUID,
				VectorIDs:   []string{},
			}
		}
		libraryVectorsMap[chunk.LibraryID].VectorIDs = append(libraryVectorsMap[chunk.LibraryID].VectorIDs, chunk.VectorID)
	}

	// 按库分别删除向量
	for _, libVectors := range libraryVectorsMap {
		collection := model.GetVectorCollectionName(libVectors.LibraryUUID)

		// 转换为interface{}切片
		ids := make([]interface{}, len(libVectors.VectorIDs))
		for i, id := range libVectors.VectorIDs {
			ids[i] = id
		}

		// 删除向量
		if err := store.Delete(ctx, collection, ids); err != nil {
			logger.SysLogf("警告: 从向量数据库删除失败 - EID:%d Collection:%s Count:%d Err:%v",
				eid, collection, len(ids), err)
			// 继续处理其他库，不因单库失败而整体失败
		}
	}

	return nil
}

// CleanupOrphanedData 清理孤儿数据（定期清理任务）
func (s *CleanupService) CleanupOrphanedData(eid int64) error {
	logger.SysLogf("开始清理孤儿数据 (EID: %d)", eid)

	// 清理孤儿文档分块
	orphanedChunks, err := s.findOrphanedDocumentChunks(eid)
	if err != nil {
		return fmt.Errorf("查找孤儿文档分块失败: %v", err)
	}

	if len(orphanedChunks) > 0 {
		logger.SysLogf("发现 %d 个孤儿文档分块，开始清理...", len(orphanedChunks))
		err = s.deleteDocumentChunks(eid, orphanedChunks)
		if err != nil {
			return fmt.Errorf("删除孤儿文档分块失败: %v", err)
		}
		fmt.Printf("成功清理 %d 个孤儿文档分块\n", len(orphanedChunks))
	}

	// 清理孤儿检索分块
	orphanedRetrievalChunks, err := s.findOrphanedRetrievalChunks(eid)
	if err != nil {
		return fmt.Errorf("查找孤儿检索分块失败: %v", err)
	}

	if len(orphanedRetrievalChunks) > 0 {
		fmt.Printf("发现 %d 个孤儿检索分块，开始清理...\n", len(orphanedRetrievalChunks))
		err = s.deleteRetrievalChunks(eid, orphanedRetrievalChunks)
		if err != nil {
			return fmt.Errorf("删除孤儿检索分块失败: %v", err)
		}
		fmt.Printf("成功清理 %d 个孤儿检索分块\n", len(orphanedRetrievalChunks))
	}

	fmt.Printf("孤儿数据清理完成 (EID: %d)\n", eid)
	return nil
}

type EntityVectorRepairService struct {
	db *gorm.DB
}

func NewEntityVectorRepairService(db *gorm.DB) *EntityVectorRepairService {
	return &EntityVectorRepairService{db: db}
}

type EntityVectorRepairResult struct {
	Total   int64 `json:"total"`
	Indexed int64 `json:"indexed"`
	Failed  int64 `json:"failed"`
}

func (s *EntityVectorRepairService) RepairEntityVectorIndex(ctx context.Context, eid int64) (*EntityVectorRepairResult, error) {
	if eid <= 0 {
		return nil, errors.New("eid is empty")
	}

	result := &EntityVectorRepairResult{}
	svc := rag.NewEntityVectorService(s.db)

	// 先删除整个向量集合以实现完全重建
	collection := model.GetEntityVectorCollectionName(eid)
	if err := svc.DeleteCollection(ctx, collection); err != nil {
		// 记录日志但不终止，因为集合可能不存在
		logger.Warn(ctx, fmt.Sprintf("重建向量索引前删除集合失败: eid=%d collection=%s err=%v", eid, collection, err))
	}

	// 预先获取配置和渠道信息，避免批次间重复查询
	configService := rag.NewChunkConfigService(s.db)
	chunkConfig, err := configService.GetConfig(eid, nil, model.ChunkTypeDefault)
	if err != nil {
		return result, fmt.Errorf("获取分块配置失败: %v", err)
	}

	if chunkConfig.EmbeddingChannelID == nil {
		return result, fmt.Errorf("未配置向量化渠道")
	}

	channel, err := model.GetChannelByID(*chunkConfig.EmbeddingChannelID)
	if err != nil {
		return result, fmt.Errorf("获取渠道信息失败: %v", err)
	}

	const batchSize = 200
	var lastID int64
	for {
		var entities []model.Entity
		q := s.db.Select("id", "type", "name", "status").
			Where("eid = ? AND status = ?", eid, "active")
		if lastID > 0 {
			q = q.Where("id > ?", lastID)
		}
		if err := q.Order("id asc").Limit(batchSize).Find(&entities).Error; err != nil {
			return result, err
		}
		if len(entities) == 0 {
			break
		}

		// 批量索引
		result.Total += int64(len(entities))
		indexed, err := svc.BatchIndexEntities(eid, entities, chunkConfig, channel)
		if err != nil {
			logger.Error(ctx, fmt.Sprintf("BatchIndexEntities failed for batch starting at %d: %v", lastID, err))
			// 如果批量处理失败，我们假设全部失败，或者依靠 indexed 返回值
			// BatchIndexEntities 即使报错也可能返回部分成功数量
		}

		result.Indexed += int64(indexed)
		result.Failed += int64(len(entities) - indexed)

		lastID = entities[len(entities)-1].ID
	}
	return result, nil
}

// findOrphanedDocumentChunks 查找孤儿文档分块
func (s *CleanupService) findOrphanedDocumentChunks(eid int64) ([]int64, error) {
	var orphanedIDs []int64
	err := s.db.Raw(`
		SELECT dc.id 
		FROM document_chunks dc 
		LEFT JOIN files f ON dc.file_id = f.id AND dc.eid = f.eid
		WHERE dc.eid = ? AND f.id IS NULL
	`, eid).Pluck("id", &orphanedIDs).Error

	return orphanedIDs, err
}

// findOrphanedRetrievalChunks 查找孤儿检索分块
func (s *CleanupService) findOrphanedRetrievalChunks(eid int64) ([]int64, error) {
	var orphanedIDs []int64
	err := s.db.Raw(`
		SELECT rc.id 
		FROM retrieval_chunks rc 
		LEFT JOIN document_chunks dc ON rc.document_chunk_id = dc.id AND rc.eid = dc.eid
		WHERE rc.eid = ? AND dc.id IS NULL
	`, eid).Pluck("id", &orphanedIDs).Error

	return orphanedIDs, err
}

// deleteDocumentChunks 删除文档分块
func (s *CleanupService) deleteDocumentChunks(eid int64, chunkIDs []int64) error {
	if len(chunkIDs) == 0 {
		return nil
	}

	return s.db.Where("eid = ? AND id IN ?", eid, chunkIDs).Delete(&model.DocumentChunk{}).Error
}

// deleteRetrievalChunks 删除检索分块
func (s *CleanupService) deleteRetrievalChunks(eid int64, chunkIDs []int64) error {
	if len(chunkIDs) == 0 {
		return nil
	}

	// 先获取这些检索分块的向量ID，用于从向量数据库中删除
	var vectorIDs []string
	err := s.db.Model(&model.RetrievalChunk{}).
		Where("eid = ? AND id IN ? AND vector_id IS NOT NULL AND vector_id != ''", eid, chunkIDs).
		Pluck("vector_id", &vectorIDs).Error
	if err != nil {
		return fmt.Errorf("获取向量ID失败: %v", err)
	}

	// 从向量数据库删除
	if len(vectorIDs) > 0 {
		err = s.deleteVectorsFromDB(eid, vectorIDs)
		if err != nil {
			fmt.Printf("警告: 从向量数据库删除向量失败: %v\n", err)
			// 不因向量删除失败而阻止数据库记录删除
		}
	}

	// 从数据库删除检索分块记录
	return s.db.Where("eid = ? AND id IN ?", eid, chunkIDs).Delete(&model.RetrievalChunk{}).Error
}
