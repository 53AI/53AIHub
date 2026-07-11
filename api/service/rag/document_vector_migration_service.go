package rag

import (
	"context"
	"time"

	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/vectorstore"
	"gorm.io/gorm"
)

// DocumentVectorMigrationScope 文档向量迁移范围
type DocumentVectorMigrationScope struct {
	Eid        int64
	SpaceIDs   []int64
	LibraryIDs []int64
	FileIDs    []int64
}

// DocumentVectorMigrationDryRunResult 预检结果
type DocumentVectorMigrationDryRunResult struct {
	RetrievalChunkCount int64
	DocumentChunkCount  int64
}

// DocumentVectorMigrationService 文档向量迁移服务
// 支持预检（dry-run）和实际重建
type DocumentVectorMigrationService struct {
	db       *gorm.DB
	vectorDB vectorstore.VectorStore
}

// NewDocumentVectorMigrationService 创建迁移服务
func NewDocumentVectorMigrationService(db *gorm.DB, vectorDB vectorstore.VectorStore) *DocumentVectorMigrationService {
	return &DocumentVectorMigrationService{db: db, vectorDB: vectorDB}
}

// DryRun 预检：统计指定范围内的 chunk 数量
func (s *DocumentVectorMigrationService) DryRun(ctx context.Context, scope DocumentVectorMigrationScope) (*DocumentVectorMigrationDryRunResult, error) {
	query := s.db.Model(&model.RetrievalChunk{}).Where("eid = ?", scope.Eid)
	if len(scope.LibraryIDs) > 0 {
		query = query.Where("library_id IN ?", scope.LibraryIDs)
	}
	if len(scope.FileIDs) > 0 {
		query = query.Where("file_id IN ?", scope.FileIDs)
	}
	var retrievalCount int64
	if err := query.Count(&retrievalCount).Error; err != nil {
		return nil, err
	}

	docQuery := s.db.Model(&model.DocumentChunk{}).Where("eid = ?", scope.Eid)
	if len(scope.LibraryIDs) > 0 {
		docQuery = docQuery.Where("library_id IN ?", scope.LibraryIDs)
	}
	if len(scope.FileIDs) > 0 {
		docQuery = docQuery.Where("file_id IN ?", scope.FileIDs)
	}
	var docCount int64
	if err := docQuery.Count(&docCount).Error; err != nil {
		return nil, err
	}

	return &DocumentVectorMigrationDryRunResult{
		RetrievalChunkCount: retrievalCount,
		DocumentChunkCount:  docCount,
	}, nil
}

// RollbackEnterpriseCollection 清除企业级 collection（仅用于回滚场景）
func (s *DocumentVectorMigrationService) RollbackEnterpriseCollection(ctx context.Context, eid int64) error {
	collection := model.GetDocumentVectorCollectionName(eid)
	return s.vectorDB.DeleteCollection(ctx, collection)
}

// VerifyEnterpriseCollectionIntegrity 校验企业级 collection 数据完整性
// 比较 DB chunk 数量和向量 collection 点数（注意：在大规模数据下可能不完全精确）
func (s *DocumentVectorMigrationService) VerifyEnterpriseCollectionIntegrity(ctx context.Context, eid int64) (bool, error) {
	var dbCount int64
	if err := s.db.Model(&model.RetrievalChunk{}).Where("eid = ?", eid).Count(&dbCount).Error; err != nil {
		return false, err
	}

	collection := model.GetDocumentVectorCollectionName(eid)
	info, err := s.vectorDB.GetCollectionInfo(ctx, collection)
	if err != nil {
		return false, err
	}

	return dbCount == info.VectorCount, nil
}

// ArchiveLegacyCollectionInfo 归档旧 collection 统计信息（清理前记录）
type LegacyCollectionInfo struct {
	Collection string `json:"collection"`
	PointCount int64  `json:"point_count"`
	Error      string `json:"error,omitempty"`
	ArchivedAt int64  `json:"archived_at"`
}

func (s *DocumentVectorMigrationService) ArchiveLegacyCollectionInfo(ctx context.Context, eid int64, libraryIDs []int64) ([]LegacyCollectionInfo, error) {
	var libraries []model.Library
	if err := s.db.Where("eid = ? AND id IN ?", eid, libraryIDs).Find(&libraries).Error; err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	infos := make([]LegacyCollectionInfo, 0, len(libraries))
	for _, lib := range libraries {
		collection := model.GetVectorCollectionName(lib.UUID)
		colInfo, err := s.vectorDB.GetCollectionInfo(ctx, collection)
		legacyInfo := LegacyCollectionInfo{
			Collection: collection,
			ArchivedAt: now,
		}
		if err != nil {
			legacyInfo.Error = err.Error()
			legacyInfo.PointCount = -1
		} else {
			legacyInfo.PointCount = colInfo.VectorCount
		}
		infos = append(infos, legacyInfo)
	}
	return infos, nil
}
