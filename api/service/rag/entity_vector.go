package rag

import (
	"context"
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/vectorstore"
	"gorm.io/gorm"
)

type EntityVectorService struct {
	db        *gorm.DB
	vectorDB  vectorstore.VectorStore
	embedding *EmbeddingService
}

func NewEntityVectorService(db *gorm.DB) *EntityVectorService {
	config := vectorstore.LoadFromEnv()
	store, err := vectorstore.NewVectorStore(config)
	if err != nil {
		logger.SysLogf("创建向量存储失败: %v", err)
		store = nil
	}
	if store != nil {
		ctx := context.Background()
		if err := store.Connect(ctx); err != nil {
			logger.SysLogf("连接向量存储失败: %v", err)
			store = nil
		}
	}
	return &EntityVectorService{
		db:        db,
		vectorDB:  store,
		embedding: NewEmbeddingService(db),
	}
}

func (s *EntityVectorService) IndexEntity(eid int64, entity *model.Entity) error {
	if entity == nil || entity.ID <= 0 {
		return fmt.Errorf("invalid entity")
	}
	if s.vectorDB == nil {
		return nil
	}
	configService := NewChunkConfigService(s.db)
	config, err := configService.GetConfig(eid, nil, model.ChunkTypeDefault)
	if err != nil {
		return err
	}
	if config.EmbeddingChannelID == nil {
		return fmt.Errorf("未配置向量化渠道")
	}
	channel, err := model.GetChannelByID(*config.EmbeddingChannelID)
	if err != nil {
		return err
	}
	content := entity.Type + ":" + entity.Name
	vector64, err := s.embedding.GenerateEmbedding(eid, content, channel, config, nil)
	if err != nil {
		return err
	}
	vector32 := make([]float32, len(vector64))
	for i, v := range vector64 {
		vector32[i] = float32(v)
	}
	metadata := map[string]interface{}{
		"entity_id":  entity.ID,
		"eid":        eid,
		"name":       entity.Name,
		"type":       entity.Type,
		"status":     entity.Status,
		"created_at": time.Now().Unix(),
	}
	record := vectorstore.VectorRecord{
		ID:       entity.ID,
		Vector:   vector32,
		Metadata: metadata,
	}
	collection := model.GetEntityVectorCollectionName(eid)
	ctx := context.Background()
	err = s.updateWithAutoCreate(ctx, collection, record, len(vector32))
	if err != nil {
		logger.SysLogf("实体向量入库失败: eid=%d id=%d name=%s err=%v", eid, entity.ID, entity.Name, err)
		return err
	}
	return nil
}

func (s *EntityVectorService) SearchEntities(eid int64, keyword string, topK int) ([]int64, error) {
	if s.vectorDB == nil {
		return nil, fmt.Errorf("vector store unavailable")
	}
	if topK <= 0 {
		topK = 20
	}
	configService := NewChunkConfigService(s.db)
	config, err := configService.GetConfig(eid, nil, model.ChunkTypeDefault)
	if err != nil {
		return nil, err
	}
	if config.EmbeddingChannelID == nil {
		return nil, fmt.Errorf("未配置向量化渠道")
	}
	queryVec64, err := s.embedding.GetQueryEmbedding(eid, keyword, *config.EmbeddingChannelID, config)
	if err != nil {
		return nil, err
	}
	queryVec := make([]float32, len(queryVec64))
	for i, v := range queryVec64 {
		queryVec[i] = float32(v)
	}
	req := vectorstore.SearchRequest{
		Collection:     model.GetEntityVectorCollectionName(eid),
		Vector:         queryVec,
		TopK:           topK,
		ScoreThreshold: 0,
	}
	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	res, err := s.vectorDB.Search(ctx, req)
	cancel()
	if err != nil || res == nil {
		return nil, err
	}
	seen := make(map[int64]struct{})
	var ids []int64
	for _, r := range res.Results {
		if r.Metadata != nil {
			if v, ok := r.Metadata["entity_id"]; ok {
				switch vv := v.(type) {
				case float64:
					id := int64(vv)
					if _, ok := seen[id]; !ok {
						ids = append(ids, id)
						seen[id] = struct{}{}
					}
				case int64:
					if _, ok := seen[vv]; !ok {
						ids = append(ids, vv)
						seen[vv] = struct{}{}
					}
				case int:
					id := int64(vv)
					if _, ok := seen[id]; !ok {
						ids = append(ids, id)
						seen[id] = struct{}{}
					}
				}
			}
		}
	}
	return ids, nil
}

// EntitySearchHit 实体搜索命中结果
type EntitySearchHit struct {
	EntityID int64   `json:"entity_id"`
	Name     string  `json:"name"`
	Type     string  `json:"type"`
	Score    float32 `json:"score"`
	FileIDs  []int64 `json:"file_ids"`
}

// SearchEntityFiles 根据实体名称搜索向量库，返回命中的文件ID列表和分数
func (s *EntityVectorService) SearchEntityFiles(eid int64, name string, topK int) ([]EntitySearchHit, error) {
	if s.vectorDB == nil {
		return nil, fmt.Errorf("vector store unavailable")
	}
	if topK <= 0 {
		topK = 10
	}

	// 1. 生成搜索向量
	configService := NewChunkConfigService(s.db)
	config, err := configService.GetConfig(eid, nil, model.ChunkTypeDefault)
	if err != nil {
		return nil, err
	}
	if config.EmbeddingChannelID == nil {
		return nil, fmt.Errorf("未配置向量化渠道")
	}

	// 实体向量内容格式为 "Type:Name"，由于输入只有 name，我们搜索时也按此逻辑
	// 如果需要更精准，可以考虑只针对 Name 生成向量，或者尝试匹配所有可能的 Type
	// 这里目前采用通用的关键词 Embedding
	queryVec64, err := s.embedding.GetQueryEmbedding(eid, name, *config.EmbeddingChannelID, config)
	if err != nil {
		return nil, err
	}
	queryVec := make([]float32, len(queryVec64))
	for i, v := range queryVec64 {
		queryVec[i] = float32(v)
	}

	// 2. 向量库搜索
	req := vectorstore.SearchRequest{
		Collection:     model.GetEntityVectorCollectionName(eid),
		Vector:         queryVec,
		TopK:           topK,
		ScoreThreshold: 0,
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	res, err := s.vectorDB.Search(ctx, req)
	cancel()
	if err != nil {
		// 如果集合不存在，说明没有索引数据，直接返回空
		if vectorstore.IsNotFoundError(err) {
			return []EntitySearchHit{}, nil
		}
		return nil, err
	}
	if res == nil {
		return nil, fmt.Errorf("search result is nil")
	}

	// 3. 聚合结果并查询关联的文件ID
	var hits []EntitySearchHit
	for _, r := range res.Results {
		if r.Metadata == nil {
			continue
		}

		var entityID int64
		if v, ok := r.Metadata["entity_id"]; ok {
			switch vv := v.(type) {
			case float64:
				entityID = int64(vv)
			case int64:
				entityID = vv
			case int:
				entityID = int64(vv)
			}
		}

		if entityID <= 0 {
			continue
		}

		hit := EntitySearchHit{
			EntityID: entityID,
			Score:    r.Score,
			Name:     fmt.Sprintf("%v", r.Metadata["name"]),
			Type:     fmt.Sprintf("%v", r.Metadata["type"]),
		}

		// 查询该实体关联的所有 file_id (去重)
		var fileIDs []int64
		err := s.db.Model(&model.EntityChunkRelation{}).
			Where("eid = ? AND entity_id = ? AND status = ?", eid, entityID, model.EntityRelationStatusActive).
			Where("file_id > 0").
			Distinct().
			Pluck("file_id", &fileIDs).Error
		if err != nil {
			logger.Error(context.Background(), fmt.Sprintf("查询实体关联文件失败: eid=%d entity_id=%d err=%v", eid, entityID, err))
			continue
		}
		hit.FileIDs = fileIDs
		hits = append(hits, hit)
	}

	return hits, nil
}

func (s *EntityVectorService) insertWithAutoCreate(ctx context.Context, collection string, record vectorstore.VectorRecord, dimension int) error {
	err := s.vectorDB.Insert(ctx, collection, []vectorstore.VectorRecord{record})
	if err == nil {
		return nil
	}
	if vsErr, ok := err.(*vectorstore.VectorStoreError); ok {
		if vsErr.Code == vectorstore.ErrCodeCollectionNotFound || vsErr.Code == vectorstore.ErrCodeUnknown {
			collectionConfig := vectorstore.CollectionConfig{
				Name:      collection,
				Dimension: dimension,
				Metric:    "cosine",
				IndexType: "HNSW",
			}
			if createErr := s.vectorDB.CreateCollection(ctx, collectionConfig); createErr != nil && !vectorstore.IsExistsError(createErr) {
				return createErr
			}
			if insertErr := s.vectorDB.Insert(ctx, collection, []vectorstore.VectorRecord{record}); insertErr != nil {
				return insertErr
			}
			return nil
		}
	}
	return err
}

func (s *EntityVectorService) updateWithAutoCreate(ctx context.Context, collection string, record vectorstore.VectorRecord, dimension int) error {
	err := s.vectorDB.Update(ctx, collection, []vectorstore.VectorRecord{record})
	if err == nil {
		return nil
	}
	if vsErr, ok := err.(*vectorstore.VectorStoreError); ok {
		if vsErr.Code == vectorstore.ErrCodeCollectionNotFound || vsErr.Code == vectorstore.ErrCodeUnknown {
			collectionConfig := vectorstore.CollectionConfig{
				Name:      collection,
				Dimension: dimension,
				Metric:    "cosine",
				IndexType: "HNSW",
			}
			if createErr := s.vectorDB.CreateCollection(ctx, collectionConfig); createErr != nil && !vectorstore.IsExistsError(createErr) {
				return createErr
			}
			if updateErr := s.vectorDB.Update(ctx, collection, []vectorstore.VectorRecord{record}); updateErr != nil {
				return updateErr
			}
			return nil
		}
	}
	return err
}

func (s *EntityVectorService) DeleteCollection(ctx context.Context, collection string) error {
	if s.vectorDB == nil {
		return nil
	}
	return s.vectorDB.DeleteCollection(ctx, collection)
}

// BatchIndexEntities 批量索引实体向量
func (s *EntityVectorService) BatchIndexEntities(eid int64, entities []model.Entity, config *ChunkConfig, channel *model.Channel) (int, error) {
	if len(entities) == 0 {
		return 0, nil
	}
	if s.vectorDB == nil {
		return 0, nil
	}

	// 1. 获取配置和渠道（如果未提供）
	if config == nil {
		configService := NewChunkConfigService(s.db)
		var err error
		config, err = configService.GetConfig(eid, nil, model.ChunkTypeDefault)
		if err != nil {
			return 0, err
		}
	}

	if channel == nil {
		if config.EmbeddingChannelID == nil {
			return 0, fmt.Errorf("未配置向量化渠道")
		}
		var err error
		channel, err = model.GetChannelByID(*config.EmbeddingChannelID)
		if err != nil {
			return 0, err
		}
	}

	// 2. 批量生成向量并构建记录
	var records []vectorstore.VectorRecord
	var dimension int

	for _, entity := range entities {
		content := entity.Type + ":" + entity.Name
		// 注意：此处仍为单次调用 Embedding API，因为 EmbeddingService 尚未支持批量接口
		// 但通过一次性传入 config 和 channel，避免了重复查询数据库
		vector64, err := s.embedding.GenerateEmbedding(eid, content, channel, config, nil)
		if err != nil {
			logger.SysLogf("实体向量生成失败 (跳过): eid=%d id=%d name=%s err=%v", eid, entity.ID, entity.Name, err)
			continue
		}

		vector32 := make([]float32, len(vector64))
		for i, v := range vector64 {
			vector32[i] = float32(v)
		}
		if dimension == 0 {
			dimension = len(vector32)
		}

		metadata := map[string]interface{}{
			"entity_id":  entity.ID,
			"eid":        eid,
			"name":       entity.Name,
			"type":       entity.Type,
			"status":     entity.Status,
			"created_at": time.Now().Unix(),
		}
		records = append(records, vectorstore.VectorRecord{
			ID:       entity.ID,
			Vector:   vector32,
			Metadata: metadata,
		})
	}

	if len(records) == 0 {
		return 0, nil
	}

	// 3. 批量入库
	collection := model.GetEntityVectorCollectionName(eid)
	ctx := context.Background()
	if err := s.batchUpdateWithAutoCreate(ctx, collection, records, dimension); err != nil {
		logger.SysLogf("批量实体向量入库失败: eid=%d count=%d err=%v", eid, len(records), err)
		return 0, err
	}

	return len(records), nil
}

// batchUpdateWithAutoCreate 批量更新向量，如果集合不存在则自动创建
func (s *EntityVectorService) batchUpdateWithAutoCreate(ctx context.Context, collection string, records []vectorstore.VectorRecord, dimension int) error {
	err := s.vectorDB.Update(ctx, collection, records)
	if err == nil {
		return nil
	}
	if vsErr, ok := err.(*vectorstore.VectorStoreError); ok {
		if vsErr.Code == vectorstore.ErrCodeCollectionNotFound || vsErr.Code == vectorstore.ErrCodeUnknown {
			collectionConfig := vectorstore.CollectionConfig{
				Name:      collection,
				Dimension: dimension,
				Metric:    "cosine",
				IndexType: "HNSW",
			}
			if createErr := s.vectorDB.CreateCollection(ctx, collectionConfig); createErr != nil && !vectorstore.IsExistsError(createErr) {
				return createErr
			}
			if updateErr := s.vectorDB.Update(ctx, collection, records); updateErr != nil {
				return updateErr
			}
			return nil
		}
	}
	return err
}
