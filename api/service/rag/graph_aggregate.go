package rag

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

const (
	GraphAggregateReferenceID      = "G-1"
	GraphAggregateChunkType        = "graph_result"
	graphAggregateSyntheticChunkID = int64(900000000000000001)
	graphAggregateMaxEntities      = 100
	graphAggregateMaxRelations     = 100
)

type GraphAggregateEdge struct {
	RelationID          int64
	SourceRelationID    int64
	TargetRelationID    int64
	SourceEntityID      int64
	TargetEntityID      int64
	SourceName          string
	Predicate           string
	TargetName          string
	ChunkIDs            []int64
	RelationChunkIDs    []int64
	FileIDs             []int64
	RelationChunkID     int64
	RelationCreatedTime int64
}

type GraphAggregateResult struct {
	Content                      string
	SupportingChunkIDs           []int64
	SupportingFileIDs            []int64
	EntityCount                  int
	EntitySupportingChunkCount   int
	RelationSupportingChunkCount int
	SupportingChunkCountTotal    int
	Edges                        []GraphAggregateEdge
	Graph                        *GraphAggregateGraph
}

type GraphAggregateScope struct {
	LibraryIDs []int64
	FileIDs    []int64
	UserID     *int64
}

type GraphAggregateService struct {
	db *gorm.DB
}

func NewGraphAggregateService(db *gorm.DB) *GraphAggregateService {
	return &GraphAggregateService{db: db}
}

func (s *GraphAggregateService) BuildAggregateSourceByKeywords(eid int64, keywords []string, scope *GraphAggregateScope) (*SourceReference, *GraphAggregateResult, error) {
	if s == nil || s.db == nil {
		return nil, nil, nil
	}

	scope = s.normalizeScope(eid, scope)
	if scope == nil {
		logger.SysLogf("【图谱检索】聚合跳过: eid=%d, 关键词=%v, 原因=无有效范围或无可用权限", eid, keywords)
		return nil, nil, nil
	}

	logger.SysLogf("【图谱检索】开始聚合: eid=%d, 关键词=%v, library_ids=%v, file_ids=%v",
		eid, keywords, scope.LibraryIDs, scope.FileIDs)

	edges, err := s.queryAggregateEdgesByKeywords(eid, keywords, scope)
	if err != nil {
		return nil, nil, err
	}

	result := buildGraphAggregateResult(edges)
	if result == nil {
		logger.SysLogf("【图谱检索】聚合未命中: eid=%d, 关键词=%v, %s", eid, keywords, BuildGraphAggregateLogSummary(nil))
		return nil, nil, nil
	}

	graph, err := s.buildGraphAggregateGraph(eid, result.Edges, scope)
	if err != nil {
		return nil, nil, err
	}
	result.Graph = graph
	if result.Graph != nil {
		result.EntityCount = len(result.Graph.Entities)
	}

	return buildGraphAggregateSource(result), result, nil
}

func (s *GraphAggregateService) normalizeScope(eid int64, scope *GraphAggregateScope) *GraphAggregateScope {
	if scope == nil {
		return nil
	}
	if scope.UserID == nil || *scope.UserID <= 0 {
		return nil
	}

	normalized := &GraphAggregateScope{
		LibraryIDs: uniqueSortedInt64(scope.LibraryIDs),
		FileIDs:    uniqueSortedInt64(scope.FileIDs),
		UserID:     scope.UserID,
	}

	searchService := &SearchService{db: s.db}
	if len(normalized.LibraryIDs) > 0 {
		filteredLibraryIDs, err := searchService.filterLibraryIDsByPermission(eid, normalized.LibraryIDs, *scope.UserID)
		if err != nil {
			logger.SysLogf("【图谱检索】过滤知识库权限失败: eid=%d, user_id=%d, err=%v", eid, *scope.UserID, err)
		}
		normalized.LibraryIDs = uniqueSortedInt64(filteredLibraryIDs)
	}
	if len(normalized.FileIDs) > 0 {
		filteredFileIDs, err := searchService.filterFileIDsByPermission(eid, normalized.FileIDs, *scope.UserID)
		if err != nil {
			logger.SysLogf("【图谱检索】过滤文件权限失败: eid=%d, user_id=%d, err=%v", eid, *scope.UserID, err)
		}
		normalized.FileIDs = uniqueSortedInt64(filteredFileIDs)
	}

	if len(normalized.LibraryIDs) == 0 && len(normalized.FileIDs) == 0 {
		return nil
	}
	return normalized
}

func (s *GraphAggregateService) applyScopeFilter(query *gorm.DB, scope *GraphAggregateScope) *gorm.DB {
	if query == nil || scope == nil {
		return query
	}

	switch {
	case len(scope.LibraryIDs) > 0 && len(scope.FileIDs) > 0:
		query = query.Where(s.db.Where("ecr.library_id IN ?", scope.LibraryIDs).Or("ecr.file_id IN ?", scope.FileIDs))
	case len(scope.LibraryIDs) > 0:
		query = query.Where("ecr.library_id IN ?", scope.LibraryIDs)
	case len(scope.FileIDs) > 0:
		query = query.Where("ecr.file_id IN ?", scope.FileIDs)
	}
	return query
}

func (s *GraphAggregateService) queryAggregateEdgesByKeywords(eid int64, keywords []string, scope *GraphAggregateScope) ([]GraphAggregateEdge, error) {
	if s.db == nil {
		return nil, nil
	}

	normalized := normalizeEntityKeywords(keywords)
	if len(normalized) == 0 {
		logger.SysLogf("【图谱检索】聚合跳过: eid=%d, 关键词为空", eid)
		return nil, nil
	}

	searchService := &SearchService{db: s.db}
	seeds := searchService.likeMatchEntitiesByKeywordsScoped(eid, normalized, scope.LibraryIDs, scope.FileIDs)
	if len(seeds) == 0 {
		logger.SysLogf("【图谱检索】未命中种子实体: eid=%d, 关键词=%v", eid, normalized)
		return nil, nil
	}

	seedEntityIDs := make([]int64, 0, len(seeds))
	seedEntityIDSet := make(map[int64]struct{}, len(seeds))
	for _, entity := range seeds {
		if entity.ID <= 0 {
			continue
		}
		seedEntityIDs = append(seedEntityIDs, entity.ID)
		seedEntityIDSet[entity.ID] = struct{}{}
	}
	if len(seedEntityIDs) == 0 {
		logger.SysLogf("【图谱检索】种子实体ID为空: eid=%d, 关键词=%v", eid, normalized)
		return nil, nil
	}

	type entityRelationRow struct {
		ID          int64
		EntityID    int64
		FileID      int64
		ChunkID     int64
		Properties  string
		CreatedTime int64
	}

	var seedRelations []entityRelationRow
	if err := s.applyScopeFilter(s.db.Table("entity_chunk_relations ecr").
		Select("id, entity_id, file_id, chunk_id, properties, created_time").
		Where("eid = ? AND status = ? AND entity_id IN ?", eid, model.EntityRelationStatusActive, seedEntityIDs), scope).
		Find(&seedRelations).Error; err != nil {
		return nil, err
	}
	if len(seedRelations) == 0 {
		logger.SysLogf("【图谱检索】未命中实体关联分片: eid=%d, 关键词=%v, 种子实体数=%d", eid, normalized, len(seedEntityIDs))
		return nil, nil
	}

	seedRelationIDs := make([]int64, 0, len(seedRelations))
	for _, relation := range seedRelations {
		seedRelationIDs = append(seedRelationIDs, relation.ID)
	}

	var graphRelations []model.GraphRelationInstance
	if err := s.db.
		Where("eid = ? AND (source_relation_id IN ? OR target_relation_id IN ?)", eid, seedRelationIDs, seedRelationIDs).
		Find(&graphRelations).Error; err != nil {
		return nil, err
	}
	if len(graphRelations) == 0 {
		logger.SysLogf("【图谱检索】未命中一跳关系: eid=%d, 关键词=%v, 种子分片数=%d", eid, normalized, len(seedRelations))
		return nil, nil
	}

	allRelationIDs := make([]int64, 0, len(graphRelations)*2)
	for _, relation := range graphRelations {
		allRelationIDs = append(allRelationIDs, relation.SourceRelationID, relation.TargetRelationID)
	}
	allRelationIDs = uniqueSortedInt64(allRelationIDs)

	var relatedEntityRelations []entityRelationRow
	if err := s.applyScopeFilter(s.db.Table("entity_chunk_relations ecr").
		Select("id, entity_id, file_id, chunk_id, properties, created_time").
		Where("id IN ?", allRelationIDs), scope).
		Find(&relatedEntityRelations).Error; err != nil {
		return nil, err
	}
	if len(relatedEntityRelations) == 0 {
		logger.SysLogf("【图谱检索】未命中关系实体映射: eid=%d, 关键词=%v, 关系数=%d", eid, normalized, len(graphRelations))
		return nil, nil
	}

	relationByID := make(map[int64]entityRelationRow, len(relatedEntityRelations))
	allEntityIDs := make([]int64, 0, len(relatedEntityRelations))
	for _, relation := range relatedEntityRelations {
		relationByID[relation.ID] = relation
		allEntityIDs = append(allEntityIDs, relation.EntityID)
	}
	allEntityIDs = uniqueSortedInt64(allEntityIDs)

	var entities []model.Entity
	if err := s.db.Model(&model.Entity{}).
		Select("id, name").
		Where("eid = ? AND id IN ?", eid, allEntityIDs).
		Find(&entities).Error; err != nil {
		return nil, err
	}

	entityNameByID := make(map[int64]string, len(entities))
	for _, entity := range entities {
		entityNameByID[entity.ID] = entity.Name
	}

	edgeMap := make(map[string]*GraphAggregateEdge)
	for _, relation := range graphRelations {
		sourceRelation, sourceOK := relationByID[relation.SourceRelationID]
		targetRelation, targetOK := relationByID[relation.TargetRelationID]
		if !sourceOK || !targetOK {
			continue
		}

		if _, sourceSeed := seedEntityIDSet[sourceRelation.EntityID]; !sourceSeed {
			if _, targetSeed := seedEntityIDSet[targetRelation.EntityID]; !targetSeed {
				continue
			}
		}

		sourceName := strings.TrimSpace(entityNameByID[sourceRelation.EntityID])
		targetName := strings.TrimSpace(entityNameByID[targetRelation.EntityID])
		predicate := strings.TrimSpace(relation.Predicate)
		if sourceName == "" || targetName == "" || predicate == "" {
			continue
		}

		key := fmt.Sprintf("%d|%s|%d", sourceRelation.EntityID, predicate, targetRelation.EntityID)
		edge := edgeMap[key]
		if edge == nil {
			edge = &GraphAggregateEdge{
				RelationID:          relation.ID,
				SourceRelationID:    sourceRelation.ID,
				TargetRelationID:    targetRelation.ID,
				SourceEntityID:      sourceRelation.EntityID,
				TargetEntityID:      targetRelation.EntityID,
				SourceName:          sourceName,
				Predicate:           predicate,
				TargetName:          targetName,
				RelationChunkID:     relation.ChunkID,
				RelationCreatedTime: relation.CreatedTime,
				ChunkIDs:            []int64{},
				RelationChunkIDs:    []int64{},
				FileIDs:             []int64{},
			}
			edgeMap[key] = edge
		}

		if edge.RelationID <= 0 || relation.ID < edge.RelationID {
			edge.RelationID = relation.ID
			edge.RelationChunkID = relation.ChunkID
			edge.RelationCreatedTime = relation.CreatedTime
		}
		edge.ChunkIDs = append(edge.ChunkIDs, sourceRelation.ChunkID, targetRelation.ChunkID)
		edge.RelationChunkIDs = append(edge.RelationChunkIDs, relation.ChunkID)
		edge.FileIDs = append(edge.FileIDs, sourceRelation.FileID, targetRelation.FileID)
	}

	edges := make([]GraphAggregateEdge, 0, len(edgeMap))
	for _, edge := range edgeMap {
		edge.ChunkIDs = uniqueSortedInt64(edge.ChunkIDs)
		edge.RelationChunkIDs = uniqueSortedInt64(edge.RelationChunkIDs)
		edge.FileIDs = uniqueSortedInt64(edge.FileIDs)
		edges = append(edges, *edge)
	}

	sort.Slice(edges, func(i, j int) bool {
		return graphAggregateLine(edges[i]) < graphAggregateLine(edges[j])
	})

	return edges, nil
}

func buildGraphAggregateResult(edges []GraphAggregateEdge) *GraphAggregateResult {
	if len(edges) == 0 {
		return nil
	}

	merged := make(map[string]*GraphAggregateEdge)
	for _, edge := range edges {
		sourceEntityID := edge.SourceEntityID
		targetEntityID := edge.TargetEntityID
		sourceName := strings.TrimSpace(edge.SourceName)
		predicate := strings.TrimSpace(edge.Predicate)
		targetName := strings.TrimSpace(edge.TargetName)
		if sourceName == "" || predicate == "" || targetName == "" {
			continue
		}

		key := fmt.Sprintf("%d|%s|%d", sourceEntityID, predicate, targetEntityID)
		current := merged[key]
		if current == nil {
			current = &GraphAggregateEdge{
				RelationID:          edge.RelationID,
				SourceRelationID:    edge.SourceRelationID,
				TargetRelationID:    edge.TargetRelationID,
				SourceEntityID:      sourceEntityID,
				TargetEntityID:      targetEntityID,
				SourceName:          sourceName,
				Predicate:           predicate,
				TargetName:          targetName,
				RelationChunkID:     edge.RelationChunkID,
				RelationCreatedTime: edge.RelationCreatedTime,
				ChunkIDs:            []int64{},
				RelationChunkIDs:    []int64{},
				FileIDs:             []int64{},
			}
			merged[key] = current
		}
		if current.RelationID <= 0 || (edge.RelationID > 0 && edge.RelationID < current.RelationID) {
			current.RelationID = edge.RelationID
			current.SourceRelationID = edge.SourceRelationID
			current.TargetRelationID = edge.TargetRelationID
			current.RelationChunkID = edge.RelationChunkID
			current.RelationCreatedTime = edge.RelationCreatedTime
		}
		current.ChunkIDs = append(current.ChunkIDs, edge.ChunkIDs...)
		current.RelationChunkIDs = append(current.RelationChunkIDs, edge.RelationChunkIDs...)
		current.FileIDs = append(current.FileIDs, edge.FileIDs...)
	}

	if len(merged) == 0 {
		return nil
	}

	resultEdges := make([]GraphAggregateEdge, 0, len(merged))
	for _, edge := range merged {
		edge.ChunkIDs = uniqueSortedInt64(edge.ChunkIDs)
		edge.RelationChunkIDs = uniqueSortedInt64(edge.RelationChunkIDs)
		edge.FileIDs = uniqueSortedInt64(edge.FileIDs)
		resultEdges = append(resultEdges, *edge)
	}

	sort.Slice(resultEdges, func(i, j int) bool {
		return graphAggregateLine(resultEdges[i]) < graphAggregateLine(resultEdges[j])
	})

	selectedEdges := selectGraphAggregateEdges(resultEdges)
	if len(selectedEdges) == 0 {
		return nil
	}

	entityChunkIDs, relationChunkIDs, supportingChunkIDs := collectGraphAggregateChunkIDs(selectedEdges)
	var supportingFileIDs []int64
	for _, edge := range selectedEdges {
		supportingFileIDs = append(supportingFileIDs, edge.FileIDs...)
	}

	lines := make([]string, 0, len(resultEdges))
	for _, edge := range selectedEdges {
		lines = append(lines, graphAggregateLine(edge))
	}
	content := strings.TrimSpace(strings.Join(lines, "\n"))
	if content == "" {
		return nil
	}

	return &GraphAggregateResult{
		Content:                      content,
		SupportingChunkIDs:           supportingChunkIDs,
		SupportingFileIDs:            uniqueSortedInt64(supportingFileIDs),
		EntitySupportingChunkCount:   len(entityChunkIDs),
		RelationSupportingChunkCount: len(relationChunkIDs),
		SupportingChunkCountTotal:    len(supportingChunkIDs),
		Edges:                        selectedEdges,
	}
}

func buildGraphAggregateSource(result *GraphAggregateResult) *SourceReference {
	if result == nil || strings.TrimSpace(result.Content) == "" {
		return nil
	}

	return &SourceReference{
		ReferenceID:                  GraphAggregateReferenceID,
		ChunkID:                      graphAggregateSyntheticChunkID,
		FileID:                       0,
		FileName:                     "图谱搜索结果",
		ChunkType:                    GraphAggregateChunkType,
		Content:                      result.Content,
		Score:                        1.0,
		KnowledgeBaseName:            "图谱搜索结果",
		SourceKey:                    "[Source:G-1]",
		EntityCount:                  result.EntityCount,
		EntitySupportingChunkCount:   result.EntitySupportingChunkCount,
		RelationSupportingChunkCount: result.RelationSupportingChunkCount,
		SupportingChunkCountTotal:    result.SupportingChunkCountTotal,
		Graph:                        result.Graph,
	}
}

func BuildGraphAggregateLogSummary(result *GraphAggregateResult) string {
	if result == nil {
		return "边数=0, 图实体数=0, 图关系数=0, 实体支撑分片数=0, 关系支撑分片数=0, 总支撑分片数=0, 支撑文件数=0, 内容长度=0"
	}

	graphEntities := 0
	graphRelations := 0
	if result.Graph != nil {
		graphEntities = len(result.Graph.Entities)
		graphRelations = len(result.Graph.Relations)
	}
	return fmt.Sprintf(
		"边数=%d, 图实体数=%d, 图关系数=%d, 实体支撑分片数=%d, 关系支撑分片数=%d, 总支撑分片数=%d, 支撑文件数=%d, 内容长度=%d",
		len(result.Edges),
		graphEntities,
		graphRelations,
		result.EntitySupportingChunkCount,
		result.RelationSupportingChunkCount,
		result.SupportingChunkCountTotal,
		len(result.SupportingFileIDs),
		len([]rune(result.Content)),
	)
}

func collectGraphAggregateChunkIDs(edges []GraphAggregateEdge) ([]int64, []int64, []int64) {
	entityChunkIDs := make([]int64, 0)
	relationChunkIDs := make([]int64, 0)
	supportingChunkIDs := make([]int64, 0)

	for _, edge := range edges {
		entityChunkIDs = append(entityChunkIDs, edge.ChunkIDs...)
		relationChunkIDs = append(relationChunkIDs, edge.RelationChunkIDs...)
		supportingChunkIDs = append(supportingChunkIDs, edge.ChunkIDs...)
		supportingChunkIDs = append(supportingChunkIDs, edge.RelationChunkIDs...)
		if edge.RelationChunkID > 0 {
			relationChunkIDs = append(relationChunkIDs, edge.RelationChunkID)
			supportingChunkIDs = append(supportingChunkIDs, edge.RelationChunkID)
		}
	}

	return uniqueSortedInt64(entityChunkIDs), uniqueSortedInt64(relationChunkIDs), uniqueSortedInt64(supportingChunkIDs)
}

func graphAggregateLine(edge GraphAggregateEdge) string {
	return strings.TrimSpace(edge.SourceName) + strings.TrimSpace(edge.Predicate) + strings.TrimSpace(edge.TargetName)
}

func selectGraphAggregateEdges(edges []GraphAggregateEdge) []GraphAggregateEdge {
	if len(edges) == 0 {
		return []GraphAggregateEdge{}
	}

	selected := make([]GraphAggregateEdge, 0, len(edges))
	selectedEntityIDs := make(map[int64]struct{})
	for _, edge := range edges {
		if len(selected) >= graphAggregateMaxRelations {
			break
		}

		if edge.SourceEntityID <= 0 || edge.TargetEntityID <= 0 {
			continue
		}

		newEntityCount := 0
		if _, exists := selectedEntityIDs[edge.SourceEntityID]; !exists {
			newEntityCount++
		}
		if _, exists := selectedEntityIDs[edge.TargetEntityID]; !exists {
			newEntityCount++
		}
		if len(selectedEntityIDs)+newEntityCount > graphAggregateMaxEntities {
			continue
		}

		selected = append(selected, edge)
		selectedEntityIDs[edge.SourceEntityID] = struct{}{}
		selectedEntityIDs[edge.TargetEntityID] = struct{}{}
	}

	return selected
}

type graphAggregateEntityRow struct {
	EntityID    int64
	Type        string
	Name        string
	Properties  string
	ChunkID     int64
	CreatedTime int64
}

func (s *GraphAggregateService) buildGraphAggregateGraph(eid int64, edges []GraphAggregateEdge, scope *GraphAggregateScope) (*GraphAggregateGraph, error) {
	if s == nil || s.db == nil || len(edges) == 0 {
		return nil, nil
	}

	selectedEntityRelationIDs := make([]int64, 0, len(edges)*2)
	for _, edge := range edges {
		if edge.SourceRelationID > 0 {
			selectedEntityRelationIDs = append(selectedEntityRelationIDs, edge.SourceRelationID)
		}
		if edge.TargetRelationID > 0 {
			selectedEntityRelationIDs = append(selectedEntityRelationIDs, edge.TargetRelationID)
		}
	}
	selectedEntityRelationIDs = uniqueSortedInt64(selectedEntityRelationIDs)
	if len(selectedEntityRelationIDs) == 0 {
		return nil, nil
	}

	var relationRows []graphAggregateEntityRow
	if err := s.applyScopeFilter(s.db.Table("entity_chunk_relations ecr").
		Select("ecr.entity_id as entity_id, e.type as type, e.name as name, ecr.properties as properties, ecr.chunk_id as chunk_id, e.created_time as created_time").
		Joins("JOIN entities e ON e.id = ecr.entity_id").
		Where("ecr.eid = ? AND ecr.status = ? AND ecr.id IN ?", eid, model.EntityRelationStatusActive, selectedEntityRelationIDs).
		Order("ecr.created_time ASC, ecr.id ASC"), scope).
		Find(&relationRows).Error; err != nil {
		return nil, err
	}
	if len(relationRows) == 0 {
		return nil, nil
	}

	entityMetaByID := make(map[int64]*model.Entity, len(relationRows))
	entityIDSet := make(map[int64]struct{}, len(relationRows))
	entityIDs := make([]int64, 0, len(relationRows))
	for _, row := range relationRows {
		if row.EntityID <= 0 {
			continue
		}
		if _, exists := entityIDSet[row.EntityID]; !exists {
			entityIDSet[row.EntityID] = struct{}{}
			entityIDs = append(entityIDs, row.EntityID)
		}
	}
	if len(entityIDs) == 0 {
		return nil, nil
	}

	var entities []model.Entity
	if err := s.db.Model(&model.Entity{}).
		Select("id, type, name").
		Where("eid = ? AND id IN ? AND status = ?", eid, entityIDs, model.EntityRelationStatusActive).
		Find(&entities).Error; err != nil {
		return nil, err
	}
	for i := range entities {
		entity := entities[i]
		entityMetaByID[entity.ID] = &entity
	}

	entityGraphMap := make(map[int64]*GraphAggregateGraphEntity)
	for _, row := range relationRows {
		entityMeta := entityMetaByID[row.EntityID]
		if entityMeta == nil {
			continue
		}

		entity := entityGraphMap[row.EntityID]
		if entity == nil {
			entity = &GraphAggregateGraphEntity{
				ID:          encodeGraphAggregateID(row.EntityID),
				Type:        entityMeta.Type,
				Name:        entityMeta.Name,
				Properties:  map[string]string{},
				ChunkIDs:    []string{},
				CreatedTime: row.CreatedTime,
			}
			entityGraphMap[row.EntityID] = entity
		}

		if entity.CreatedTime == 0 || (row.CreatedTime > 0 && row.CreatedTime < entity.CreatedTime) {
			entity.CreatedTime = row.CreatedTime
		}
		if row.Properties != "" && len(entity.Properties) == 0 {
			props := map[string]string{}
			if err := json.Unmarshal([]byte(row.Properties), &props); err == nil {
				entity.Properties = props
			}
		}
		if row.ChunkID > 0 {
			entity.ChunkIDs = append(entity.ChunkIDs, encodeGraphAggregateID(row.ChunkID))
		}
	}

	entityItems := make([]*GraphAggregateGraphEntity, 0, len(entityGraphMap))
	for _, entity := range entityGraphMap {
		entity.ChunkIDs = uniqueSortedString(entity.ChunkIDs)
		entityItems = append(entityItems, entity)
	}
	sort.Slice(entityItems, func(i, j int) bool {
		if entityItems[i].Name == entityItems[j].Name {
			return entityItems[i].ID < entityItems[j].ID
		}
		return entityItems[i].Name < entityItems[j].Name
	})

	relationItems := make([]*GraphAggregateGraphRelation, 0, len(edges))
	seenRelationIDs := make(map[int64]struct{}, len(edges))
	for _, edge := range edges {
		if edge.RelationID <= 0 {
			continue
		}
		if _, exists := seenRelationIDs[edge.RelationID]; exists {
			continue
		}
		seenRelationIDs[edge.RelationID] = struct{}{}
		relationItems = append(relationItems, &GraphAggregateGraphRelation{
			ID:             encodeGraphAggregateID(edge.RelationID),
			SourceEntityID: encodeGraphAggregateID(edge.SourceEntityID),
			TargetEntityID: encodeGraphAggregateID(edge.TargetEntityID),
			Predicate:      edge.Predicate,
			ChunkIDs:       encodeGraphAggregateIDs(uniqueSortedInt64([]int64{edge.RelationChunkID})),
			CreatedTime:    edge.RelationCreatedTime,
		})
	}

	sort.Slice(relationItems, func(i, j int) bool {
		if relationItems[i].Predicate == relationItems[j].Predicate {
			return relationItems[i].ID < relationItems[j].ID
		}
		return relationItems[i].Predicate < relationItems[j].Predicate
	})

	return &GraphAggregateGraph{
		Entities:  entityItems,
		Relations: relationItems,
	}, nil
}

func encodeGraphAggregateID(id int64) string {
	if id <= 0 {
		return ""
	}
	if hashedID, err := hashids.Encode(id); err == nil {
		return hashedID
	}
	return fmt.Sprintf("%d", id)
}

func encodeGraphAggregateIDs(ids []int64) []string {
	if len(ids) == 0 {
		return []string{}
	}
	result := make([]string, 0, len(ids))
	for _, id := range ids {
		if id <= 0 {
			continue
		}
		result = append(result, encodeGraphAggregateID(id))
	}
	return result
}

func uniqueSortedString(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	set := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := set[value]; exists {
			continue
		}
		set[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func uniqueSortedInt64(values []int64) []int64 {
	if len(values) == 0 {
		return []int64{}
	}

	set := make(map[int64]struct{}, len(values))
	result := make([]int64, 0, len(values))
	for _, value := range values {
		if value <= 0 {
			continue
		}
		if _, exists := set[value]; exists {
			continue
		}
		set[value] = struct{}{}
		result = append(result, value)
	}

	sort.Slice(result, func(i, j int) bool { return result[i] < result[j] })
	return result
}
