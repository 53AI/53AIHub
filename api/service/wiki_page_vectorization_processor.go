package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/53AI/53AIHub/service/vectorstore"
	"gorm.io/gorm"
)

const wikiVectorCollectionPrefix = "wiki_eid_"
const wikiEmbeddingBatchSize = 10

// WikiPageVectorizationProcessorImpl 将一个已发布版本切分、向量化并写入企业级 Wiki 集合。
// Wiki 不复用 RetrievalChunk，页面版本和 Chunk 生命周期由 wiki_page_chunks 独立管理。
type WikiPageVectorizationProcessorImpl struct {
	db        *gorm.DB
	chunker   *WikiPageChunker
	embedding *rag.EmbeddingService
	vectorDB  vectorstore.VectorStore
}

func NewWikiPageVectorizationProcessor(db *gorm.DB) WikiPageVectorizationProcessor {
	store, err := vectorstore.GetGlobalVectorStore()
	if err != nil {
		logger.SysLogf("【Wiki向量化】获取向量库失败: %v", err)
	}
	return &WikiPageVectorizationProcessorImpl{
		db:        db,
		chunker:   NewWikiPageChunker(),
		embedding: rag.NewEmbeddingService(db),
		vectorDB:  store,
	}
}

func (s *WikiPageVectorizationProcessorImpl) Process(ctx context.Context, eid, pageID, versionID int64, force bool) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("wiki vectorization database is nil")
	}
	if eid <= 0 || pageID <= 0 || versionID <= 0 {
		return fmt.Errorf("eid, page_id and version_id are required")
	}

	var page model.WikiPage
	if err := s.db.WithContext(ctx).Where("eid = ? AND id = ?", eid, pageID).First(&page).Error; err != nil {
		return err
	}
	var version model.WikiPageVersion
	if err := s.db.WithContext(ctx).Where("eid = ? AND page_id = ? AND id = ?", eid, pageID, versionID).First(&version).Error; err != nil {
		return err
	}
	if !version.IsPublished {
		return fmt.Errorf("wiki page version is not published")
	}

	chunks, err := s.chunker.Chunk(WikiPageChunkInput{
		PageID:    page.ID,
		VersionID: version.ID,
		Title:     version.Title,
		Summary:   page.Summary,
		Body:      version.Body,
	})
	if err != nil {
		return err
	}
	if len(chunks) == 0 {
		return fmt.Errorf("wiki page has no content to vectorize")
	}

	reused, err := s.replaceChunks(ctx, eid, page.ID, version.ID, chunks, force)
	if err != nil {
		return err
	}
	if reused {
		return nil
	}
	if err := s.embedChunks(ctx, eid, page, version, chunks); err != nil {
		return err
	}
	return s.deactivatePreviousVersions(ctx, eid, page.ID, version.ID)
}

func (s *WikiPageVectorizationProcessorImpl) replaceChunks(ctx context.Context, eid, pageID, versionID int64, chunks []WikiPageChunk, force bool) (bool, error) {
	var old []model.WikiPageChunk
	if err := s.db.WithContext(ctx).Where("eid = ? AND wiki_page_id = ? AND wiki_page_version_id = ?", eid, pageID, versionID).Find(&old).Error; err != nil {
		return false, err
	}
	if !force && len(old) > 0 {
		allSucceeded := true
		for _, item := range old {
			if item.EmbeddingStatus != model.WikiPageChunkEmbeddingStatusSucceeded || item.IndexStatus != model.WikiPageChunkIndexStatusActive {
				allSucceeded = false
				break
			}
		}
		if allSucceeded {
			return true, nil
		}
	}

	if s.vectorDB != nil {
		ids := make([]interface{}, 0, len(old))
		for _, item := range old {
			if item.VectorID != "" {
				ids = append(ids, item.VectorID)
			}
		}
		if len(ids) > 0 {
			if err := s.vectorDB.Delete(ctx, wikiVectorCollectionName(eid), ids); err != nil && !vectorstore.IsNotFoundError(err) {
				return false, fmt.Errorf("delete old wiki vectors: %w", err)
			}
		}
	}

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("eid = ? AND wiki_page_id = ? AND wiki_page_version_id = ?", eid, pageID, versionID).Delete(&model.WikiPageChunk{}).Error; err != nil {
			return err
		}
		rows := make([]model.WikiPageChunk, 0, len(chunks))
		for _, item := range chunks {
			rows = append(rows, model.WikiPageChunk{
				Eid: eid, WikiPageID: pageID, WikiPageVersionID: versionID,
				ChunkID: item.ChunkID, ParentSectionID: item.ParentSectionID,
				ChunkType: item.ChunkType, ChunkIndex: item.ChunkIndex,
				HeadingPath: item.HeadingPath, OriginalStart: item.OriginalStart,
				OriginalEnd: item.OriginalEnd, Content: item.Content,
				ContentHash: item.ContentHash, TokenCount: item.TokenCount,
				Oversized: item.Oversized, EmbeddingStatus: model.WikiPageChunkEmbeddingStatusPending,
				IndexStatus: model.WikiPageChunkIndexStatusPending,
			})
		}
		return tx.Create(&rows).Error
	})
	return false, err
}

func (s *WikiPageVectorizationProcessorImpl) deactivatePreviousVersions(ctx context.Context, eid, pageID, versionID int64) error {
	var old []model.WikiPageChunk
	if err := s.db.WithContext(ctx).
		Where("eid = ? AND wiki_page_id = ? AND wiki_page_version_id <> ? AND index_status = ?", eid, pageID, versionID, model.WikiPageChunkIndexStatusActive).
		Find(&old).Error; err != nil {
		return err
	}
	if len(old) == 0 {
		return nil
	}
	if err := s.db.WithContext(ctx).Model(&model.WikiPageChunk{}).
		Where("eid = ? AND wiki_page_id = ? AND wiki_page_version_id <> ?", eid, pageID, versionID).
		Update("index_status", model.WikiPageChunkIndexStatusInactive).Error; err != nil {
		return err
	}
	if s.vectorDB == nil {
		return nil
	}
	ids := make([]interface{}, 0, len(old))
	for _, item := range old {
		if item.VectorID != "" {
			ids = append(ids, item.VectorID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	if err := s.vectorDB.Delete(ctx, wikiVectorCollectionName(eid), ids); err != nil && !vectorstore.IsNotFoundError(err) {
		return fmt.Errorf("delete previous wiki version vectors: %w", err)
	}
	logger.Infof(ctx, "【Wiki向量化】旧版本下线: eid=%d page_id=%d version_id=%d old_chunk_count=%d", eid, pageID, versionID, len(old))
	return nil
}

func (s *WikiPageVectorizationProcessorImpl) embedChunks(ctx context.Context, eid int64, page model.WikiPage, version model.WikiPageVersion, chunks []WikiPageChunk) error {
	if s.embedding == nil || s.vectorDB == nil {
		return fmt.Errorf("wiki vectorization embedding or vector store is unavailable")
	}
	// Wiki 向量集合按企业统一维护，必须使用企业级 embedding 配置，不能按知识库配置产生不同维度的向量。
	config, err := rag.NewChunkConfigService(s.db).GetEnterpriseEmbeddingConfig(eid)
	if err != nil {
		return fmt.Errorf("get embedding config: %w", err)
	}
	if config.EmbeddingChannelID == nil || *config.EmbeddingChannelID <= 0 {
		return fmt.Errorf("embedding channel is not configured")
	}
	channel, err := model.GetChannelByID(*config.EmbeddingChannelID)
	if err != nil {
		return fmt.Errorf("get embedding channel: %w", err)
	}
	modelName := ""
	if config.EmbeddingModelName != nil {
		modelName = strings.TrimSpace(*config.EmbeddingModelName)
	}
	collection := wikiVectorCollectionName(eid)
	metric := vectorstore.LoadFromEnv().DistanceMetric
	type chunkRow struct {
		item WikiPageChunk
		row  model.WikiPageChunk
	}
	eligible := make([]chunkRow, 0, len(chunks))
	for _, item := range chunks {
		var row model.WikiPageChunk
		if err := s.db.WithContext(ctx).Where("eid = ? AND chunk_id = ?", eid, item.ChunkID).First(&row).Error; err != nil {
			return err
		}
		if item.Oversized {
			if err := s.db.WithContext(ctx).Model(&row).Updates(map[string]interface{}{
				"embedding_status": model.WikiPageChunkEmbeddingStatusFailed,
				"index_status":     model.WikiPageChunkIndexStatusOversized,
				"error_message":    "chunk exceeds the configured vectorization window",
			}).Error; err != nil {
				return err
			}
			logger.Warnf(ctx, "【Wiki向量化】跳过超长特殊 Chunk: eid=%d page_id=%d chunk_id=%s token_count=%d", eid, page.ID, item.ChunkID, item.TokenCount)
			continue
		}
		eligible = append(eligible, chunkRow{item: item, row: row})
	}
	if len(eligible) == 0 {
		return nil
	}
	for _, item := range eligible {
		if err := s.db.WithContext(ctx).Model(&item.row).Updates(map[string]interface{}{
			"embedding_status": model.WikiPageChunkEmbeddingStatusProcessing,
			"index_status":     model.WikiPageChunkIndexStatusPending,
			"error_message":    "",
		}).Error; err != nil {
			return err
		}
	}
	vectorDimension := 0
	collectionReady := false
	for _, batch := range splitWikiEmbeddingBatches(eligible) {
		batchContents := make([]string, 0, len(batch))
		for _, item := range batch {
			batchContents = append(batchContents, item.item.Content)
		}
		vector64, err := s.embedding.CallEmbeddingAPIBatchWithModel(batchContents, channel, modelName, rag.NewEmptyEmbeddingContext())
		if err != nil {
			for _, item := range eligible {
				_ = s.markChunkFailed(ctx, item.row.ID, err)
			}
			return fmt.Errorf("embed wiki chunks: %w", err)
		}
		if len(vector64) != len(batch) {
			return fmt.Errorf("embed wiki chunks returned %d vectors, want %d", len(vector64), len(batch))
		}
		vectorRecords := make([]vectorstore.VectorRecord, 0, len(batch))
		for i, item := range batch {
			vector32 := make([]float32, len(vector64[i]))
			for j, value := range vector64[i] {
				vector32[j] = float32(value)
			}
			if vectorDimension == 0 {
				vectorDimension = len(vector32)
			}
			metadata := map[string]interface{}{
				"source_type": "wiki", "eid": eid, "space_id": page.SpaceID,
				"library_id": page.LibraryID, "wiki_page_id": page.ID,
				"wiki_page_version_id": version.ID, "chunk_id": item.item.ChunkID,
				"parent_section_id": item.item.ParentSectionID, "chunk_type": item.item.ChunkType,
				"heading_path": item.item.HeadingPath, "title": version.Title, "content": item.item.Content,
				"content_hash": item.item.ContentHash, "original_start": item.item.OriginalStart, "original_end": item.item.OriginalEnd,
				"status": model.WikiPageChunkIndexStatusActive,
			}
			vectorRecords = append(vectorRecords, vectorstore.VectorRecord{ID: wikiPageVectorID(item.item.ChunkID), Vector: vector32, Metadata: metadata})
		}
		if !collectionReady {
			if err := ensureWikiVectorCollection(ctx, s.vectorDB, collection, vectorDimension, metric); err != nil {
				for _, item := range eligible {
					_ = s.markChunkFailed(ctx, item.row.ID, err)
				}
				return err
			}
			collectionReady = true
		}
		if err := s.vectorDB.BatchInsert(ctx, collection, vectorRecords); err != nil {
			for _, item := range eligible {
				_ = s.markChunkFailed(ctx, item.row.ID, err)
			}
			return fmt.Errorf("index wiki chunks: %w", err)
		}
		for i, item := range batch {
			if err := s.db.WithContext(ctx).Model(&item.row).Updates(map[string]interface{}{
				"embedding_status": model.WikiPageChunkEmbeddingStatusSucceeded,
				"vector_id":        wikiPageVectorID(item.item.ChunkID), "embedding_model": modelName,
				"embedding_dimension": len(vector64[i]), "index_status": model.WikiPageChunkIndexStatusActive,
				"error_message": "",
			}).Error; err != nil {
				return err
			}
		}
	}
	logger.Infof(ctx, "【Wiki向量化】批量 Chunk 完成: eid=%d page_id=%d version_id=%d count=%d dimension=%d", eid, page.ID, version.ID, len(eligible), vectorDimension)
	return nil
}

func splitWikiEmbeddingBatches[T any](items []T) [][]T {
	if len(items) == 0 {
		return nil
	}
	batches := make([][]T, 0, (len(items)+wikiEmbeddingBatchSize-1)/wikiEmbeddingBatchSize)
	for start := 0; start < len(items); start += wikiEmbeddingBatchSize {
		end := start + wikiEmbeddingBatchSize
		if end > len(items) {
			end = len(items)
		}
		batches = append(batches, items[start:end])
	}
	return batches
}

func (s *WikiPageVectorizationProcessorImpl) markChunkFailed(ctx context.Context, id int64, err error) error {
	return s.db.WithContext(ctx).Model(&model.WikiPageChunk{}).Where("id = ?", id).Updates(map[string]interface{}{
		"embedding_status": model.WikiPageChunkEmbeddingStatusFailed,
		"index_status":     model.WikiPageChunkIndexStatusFailed,
		"error_message":    err.Error(),
	}).Error
}

func wikiVectorCollectionName(eid int64) string {
	return fmt.Sprintf("%s%d", wikiVectorCollectionPrefix, eid)
}

// wikiPageVectorID converts the internal chunk hash into a deterministic UUID.
// Qdrant accepts integer IDs or UUID strings; the 24-character chunk hash is
// neither, so passing it through directly makes every batch insert fail.
func wikiPageVectorID(chunkID string) string {
	sum := sha256.Sum256([]byte("wiki-vector:" + chunkID))
	b := sum[:]
	b[6] = (b[6] & 0x0f) | 0x50
	b[8] = (b[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(b)
	return fmt.Sprintf("%s-%s-%s-%s-%s", encoded[0:8], encoded[8:12], encoded[12:16], encoded[16:20], encoded[20:32])
}

func ensureWikiVectorCollection(ctx context.Context, store vectorstore.VectorStore, collection string, dimension int, metric string) error {
	if dimension <= 0 {
		return fmt.Errorf("embedding dimension is invalid")
	}
	if err := store.CreateCollection(ctx, vectorstore.CollectionConfig{Name: collection, Dimension: dimension, Metric: metric}); err != nil {
		if !vectorstore.IsExistsError(err) {
			return fmt.Errorf("create wiki vector collection: %w", err)
		}
		info, infoErr := store.GetCollectionInfo(ctx, collection)
		if infoErr != nil {
			return fmt.Errorf("read wiki vector collection: %w", infoErr)
		}
		if info != nil && info.Dimension > 0 && info.Dimension != dimension {
			return fmt.Errorf("wiki vector collection dimension mismatch: collection=%d embedding=%d", info.Dimension, dimension)
		}
	}
	return nil
}
