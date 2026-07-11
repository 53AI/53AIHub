package service

import (
	"context"
	"errors"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
)

// GraphDataResponse 图谱数据响应
type GraphDataResponse struct {
	GraphMeta      *GraphMeta           `json:"graph_meta"`
	Entities       []*GraphEntityItem   `json:"entities"`
	Relations      []*GraphRelationItem `json:"relations"`
	TotalEntities  int64                `json:"total_entities"`
	TotalRelations int                  `json:"total_relations"`
}

// GraphMeta 图谱元数据
type GraphMeta struct {
	TemplateID    string           `json:"template_id"`
	TemplateName  string           `json:"template_name"`
	EntityTypes   []*EntityTypeDef `json:"entity_types"`
	RelationTypes []*RelationDef   `json:"relation_types"`
}

// EntityTypeDef 实体类型定义
type EntityTypeDef struct {
	Name       string   `json:"name"`
	Properties []string `json:"properties"`
}

// RelationDef 关系类型定义
type RelationDef struct {
	Source    string `json:"source"`
	Predicate string `json:"predicate"`
	Target    string `json:"target"`
}

// GraphEntityItem 图谱实体项
type GraphEntityItem struct {
	ID          string            `json:"id"`
	Type        string            `json:"type"`
	Name        string            `json:"name"`
	Properties  map[string]string `json:"properties"`
	ChunkIDs    []string          `json:"chunk_ids"`
	CreatedTime int64             `json:"created_time"`
}

// GraphRelationItem 图谱关系项
type GraphRelationItem struct {
	ID             string   `json:"id"`
	SourceEntityID string   `json:"source_entity_id"`
	TargetEntityID string   `json:"target_entity_id"`
	Predicate      string   `json:"predicate"`
	ChunkIDs       []string `json:"chunk_ids"`
	CreatedTime    int64    `json:"created_time"`
}

// GetFileGraphData 获取文件图谱数据
func GetFileGraphData(ctx context.Context, eid int64, fileID int64, limit int, entityType string, keyword string) (*GraphDataResponse, error) {
	// 1. 获取图谱实例
	instance, err := model.GetGraphInstanceByFileID(eid, fileID)
	if err != nil {
		return nil, errors.New("该文件尚未生成图谱")
	}

	// 2. 获取模板信息
	template, err := model.GetGraphTemplateByID(eid, instance.TemplateID)
	if err != nil {
		logger.Errorf(ctx, "获取模板失败: %v", err)
		return nil, errors.New("获取图谱模板失败")
	}

	// 3. 构建图谱元数据
	graphMeta, err := buildGraphMeta(template)
	if err != nil {
		return nil, err
	}

	// 4. 查询数据
	var entities []model.GraphEntityData
	var relations []model.GraphRelationData
	var totalEntities int64

	if keyword != "" {
		// 搜索模式
		entities, relations, err = model.SearchGraphEntities(eid, fileID, keyword)
		if err != nil {
			return nil, err
		}
		totalEntities = int64(len(entities))
	} else {
		// 默认模式
		entities, totalEntities, err = model.GetGraphEntitiesByFileID(eid, fileID, limit, entityType, "")
		if err != nil {
			return nil, err
		}

		// 获取关系
		relations, err = model.GetGraphRelationsByInstanceID(eid, instance.ID)
		if err != nil {
			return nil, err
		}

		// 默认仅返回有边实体，避免返回大量孤立点
		entities, err = filterEntitiesWithRelations(ctx, eid, fileID, entities, relations)
		if err != nil {
			return nil, err
		}
		totalEntities = int64(len(entities))
	}

	// 5. 编码ID并构建响应
	return buildGraphDataResponse(graphMeta, entities, relations, totalEntities)
}

// buildGraphMeta 构建图谱元数据
func buildGraphMeta(template *model.GraphTemplate) (*GraphMeta, error) {
	templateID, _ := hashids.Encode(template.ID)

	entityTypes, err := template.GetEntities()
	if err != nil {
		return nil, err
	}

	relationTypes, err := template.GetRelations()
	if err != nil {
		return nil, err
	}

	entityTypeDefs := make([]*EntityTypeDef, len(entityTypes))
	for i, e := range entityTypes {
		entityTypeDefs[i] = &EntityTypeDef{
			Name:       e.Name,
			Properties: e.Properties,
		}
	}

	relationDefs := make([]*RelationDef, len(relationTypes))
	for i, r := range relationTypes {
		relationDefs[i] = &RelationDef{
			Source:    r.Source,
			Predicate: r.Predicate,
			Target:    r.Target,
		}
	}

	return &GraphMeta{
		TemplateID:    templateID,
		TemplateName:  template.Name,
		EntityTypes:   entityTypeDefs,
		RelationTypes: relationDefs,
	}, nil
}

// supplementRelatedEntities 补充关联实体
func filterEntitiesWithRelations(ctx context.Context, eid int64, fileID int64, entities []model.GraphEntityData, relations []model.GraphRelationData) ([]model.GraphEntityData, error) {
	if len(relations) == 0 {
		logger.Debugf(ctx, "【图谱查询】无关系数据，返回空实体集合: eid=%d, file_id=%d", eid, fileID)
		return []model.GraphEntityData{}, nil
	}

	relatedEntityIDs := make(map[int64]bool)
	for _, r := range relations {
		relatedEntityIDs[r.SourceEntityID] = true
		relatedEntityIDs[r.TargetEntityID] = true
	}

	// 收集已有的实体ID
	existingIDs := make(map[int64]bool)
	for _, e := range entities {
		existingIDs[e.ID] = true
	}

	filterMap := make(map[int64]model.GraphEntityData, len(entities))
	for _, e := range entities {
		if !relatedEntityIDs[e.ID] {
			continue
		}
		if _, exists := filterMap[e.ID]; exists {
			continue
		}
		filterMap[e.ID] = e
	}
	filtered := make([]model.GraphEntityData, 0, len(filterMap))
	for _, e := range filterMap {
		filtered = append(filtered, e)
	}

	// 收集关联但未返回的实体ID
	missingIDs := make([]int64, 0)
	for entityID := range relatedEntityIDs {
		if !existingIDs[entityID] {
			missingIDs = append(missingIDs, entityID)
		}
	}

	logger.Debugf(ctx, "【图谱查询】关系过滤统计: eid=%d, file_id=%d, input_entities=%d, relations=%d, related_entities=%d, missing_entities=%d",
		eid, fileID, len(entities), len(relations), len(relatedEntityIDs), len(missingIDs))

	if len(missingIDs) == 0 {
		return filtered, nil
	}

	missingEntities, err := model.GetGraphEntitiesByIDs(eid, fileID, missingIDs)
	if err != nil {
		return nil, err
	}
	filtered = append(filtered, missingEntities...)
	return filtered, nil
}

// buildGraphDataResponse 构建响应
func buildGraphDataResponse(graphMeta *GraphMeta, entities []model.GraphEntityData, relations []model.GraphRelationData, totalEntities int64) (*GraphDataResponse, error) {
	// 编码实体
	entityItems := make([]*GraphEntityItem, len(entities))
	for i, e := range entities {
		id, _ := hashids.Encode(e.ID)
		chunkIDs := make([]string, len(e.ChunkIDs))
		for j, cid := range e.ChunkIDs {
			chunkIDs[j], _ = hashids.Encode(cid)
		}
		entityItems[i] = &GraphEntityItem{
			ID:          id,
			Type:        e.Type,
			Name:        e.Name,
			Properties:  e.Properties,
			ChunkIDs:    chunkIDs,
			CreatedTime: e.CreatedTime,
		}
	}

	// 编码关系
	relationItems := make([]*GraphRelationItem, len(relations))
	for i, r := range relations {
		id, _ := hashids.Encode(r.ID)
		sourceID, _ := hashids.Encode(r.SourceEntityID)
		targetID, _ := hashids.Encode(r.TargetEntityID)
		chunkIDs := make([]string, len(r.ChunkIDs))
		for j, cid := range r.ChunkIDs {
			chunkIDs[j], _ = hashids.Encode(cid)
		}
		relationItems[i] = &GraphRelationItem{
			ID:             id,
			SourceEntityID: sourceID,
			TargetEntityID: targetID,
			Predicate:      r.Predicate,
			ChunkIDs:       chunkIDs,
			CreatedTime:    r.CreatedTime,
		}
	}

	return &GraphDataResponse{
		GraphMeta:      graphMeta,
		Entities:       entityItems,
		Relations:      relationItems,
		TotalEntities:  totalEntities,
		TotalRelations: len(relationItems),
	}, nil
}
