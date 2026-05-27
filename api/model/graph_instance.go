package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"

	"gorm.io/gorm"
)

// GraphInstance 图谱实例表 - 记录每次图谱生成
type GraphInstance struct {
	ID         int64 `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid        int64 `json:"eid" gorm:"not null;index"`
	TemplateID int64 `json:"template_id" gorm:"not null;index"`

	// 关联范围
	SpaceID   int64 `json:"space_id" gorm:"index"`
	LibraryID int64 `json:"library_id" gorm:"index"`
	FileID    int64 `json:"file_id" gorm:"index"`

	// 执行信息
	RunID        string `json:"run_id" gorm:"size:64;index"`
	Status       string `json:"status" gorm:"size:20;not null;default:'pending';index"`
	ErrorMessage string `json:"error_message" gorm:"type:text"`

	BaseModel
}

func (GraphInstance) TableName() string {
	return "graph_instances"
}

// GraphInstanceStatus 图谱实例状态常量
const (
	GraphInstanceStatusPending    = "pending"    // 待处理
	GraphInstanceStatusProcessing = "processing" // 处理中
	GraphInstanceStatusCompleted  = "completed"  // 已完成
	GraphInstanceStatusFailed     = "failed"     // 失败
)

// GraphRelationInstance 图谱关系实例表 - 记录实体间的关系
type GraphRelationInstance struct {
	ID         int64 `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid        int64 `json:"eid" gorm:"not null;index"`
	InstanceID int64 `json:"instance_id" gorm:"not null;index"` // 关联 graph_instances

	// 关系定义
	TemplateID int64  `json:"template_id" gorm:"not null;index"`
	Predicate  string `json:"predicate" gorm:"size:50;not null"`

	// 关联实体（通过 EntityChunkRelation 关联）
	SourceRelationID int64 `json:"source_relation_id" gorm:"not null;index"` // EntityChunkRelation.ID
	TargetRelationID int64 `json:"target_relation_id" gorm:"not null;index"` // EntityChunkRelation.ID

	// 来源分片
	ChunkID int64 `json:"chunk_id" gorm:"index"`

	BaseModel
}

func (GraphRelationInstance) TableName() string {
	return "graph_relation_instances"
}

// CreateGraphInstance 创建图谱实例
func CreateGraphInstance(db *gorm.DB, instance *GraphInstance) error {
	return db.Create(instance).Error
}

// UpdateGraphInstanceStatus 更新图谱实例状态
func UpdateGraphInstanceStatus(db *gorm.DB, id int64, status string, errorMsg string) error {
	updates := map[string]interface{}{
		"status": status,
	}
	if errorMsg != "" {
		updates["error_message"] = errorMsg
	}
	return db.Model(&GraphInstance{}).Where("id = ?", id).Updates(updates).Error
}

// GetGraphInstanceByID 根据ID获取图谱实例
func GetGraphInstanceByID(eid int64, id int64) (*GraphInstance, error) {
	var instance GraphInstance
	err := DB.Where("eid = ? AND id = ?", eid, id).First(&instance).Error
	if err != nil {
		return nil, err
	}
	return &instance, nil
}

// GetGraphInstanceByRunID 根据RunID获取图谱实例
func GetGraphInstanceByRunID(eid int64, runID string) (*GraphInstance, error) {
	var instance GraphInstance
	err := DB.Where("eid = ? AND run_id = ?", eid, runID).First(&instance).Error
	if err != nil {
		return nil, err
	}
	return &instance, nil
}

// CreateGraphRelationInstance 创建关系实例
func CreateGraphRelationInstance(db *gorm.DB, relation *GraphRelationInstance) error {
	return db.Create(relation).Error
}

// BatchCreateGraphRelationInstances 批量创建关系实例
func BatchCreateGraphRelationInstances(db *gorm.DB, relations []GraphRelationInstance) error {
	if len(relations) == 0 {
		return nil
	}
	return db.CreateInBatches(relations, 100).Error
}

// DeleteGraphInstancesByFileID 删除文件关联的所有图谱实例和关系
func DeleteGraphInstancesByFileID(db *gorm.DB, eid int64, fileID int64) error {
	return db.Transaction(func(tx *gorm.DB) error {
		// 获取所有实例ID
		var instanceIDs []int64
		if err := tx.Model(&GraphInstance{}).
			Where("eid = ? AND file_id = ?", eid, fileID).
			Pluck("id", &instanceIDs).Error; err != nil {
			return err
		}

		if len(instanceIDs) == 0 {
			return nil
		}

		// 删除关系实例
		if err := tx.Where("eid = ? AND instance_id IN ?", eid, instanceIDs).
			Delete(&GraphRelationInstance{}).Error; err != nil {
			return err
		}

		// 删除图谱实例
		return tx.Where("eid = ? AND id IN ?", eid, instanceIDs).
			Delete(&GraphInstance{}).Error
	})
}

// GetEntityChunkRelationByEntityAndChunk 根据实体ID和分片ID获取关联记录
func GetEntityChunkRelationByEntityAndChunk(db *gorm.DB, eid int64, entityID int64, chunkID int64) (*EntityChunkRelation, error) {
	var relation EntityChunkRelation
	err := db.Where("eid = ? AND entity_id = ? AND chunk_id = ?", eid, entityID, chunkID).
		First(&relation).Error
	if err != nil {
		return nil, err
	}
	return &relation, nil
}

// CreateEntityChunkRelationWithProperties 创建带属性的实体分片关联
func CreateEntityChunkRelationWithProperties(db *gorm.DB, relation *EntityChunkRelation) error {
	return db.Create(relation).Error
}

// GetProperties 获取解析后的属性
func (r *EntityChunkRelation) GetProperties() (map[string]string, error) {
	if r.Properties == "" {
		return map[string]string{}, nil
	}
	var props map[string]string
	err := json.Unmarshal([]byte(r.Properties), &props)
	if err != nil {
		return nil, err
	}
	return props, nil
}

// SetProperties 设置属性
func (r *EntityChunkRelation) SetProperties(props map[string]string) error {
	if props == nil {
		r.Properties = ""
		return nil
	}
	data, err := json.Marshal(props)
	if err != nil {
		return err
	}
	r.Properties = string(data)
	return nil
}

// ReplaceGraphEntityRelationsByTemplate 替换模板抽取的实体关联
// 如果关联已存在则复用，不再重复插入，避免重复跑任务时打散既有关系ID
func ReplaceGraphEntityRelationsByTemplate(db *gorm.DB, eid int64, templateID int64, spaceID, libraryID, fileID, chunkID int64, relations []EntityChunkRelation) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if len(relations) == 0 {
			return nil
		}

		uniqueRelations := make([]EntityChunkRelation, 0, len(relations))
		seen := make(map[string]struct{}, len(relations))
		entityIDs := make([]int64, 0, len(relations))
		entityIDSeen := make(map[int64]struct{}, len(relations))
		for _, relation := range relations {
			if relation.Eid <= 0 || relation.EntityID <= 0 {
				continue
			}
			key := fmt.Sprintf("%d:%d:%d:%d:%d:%d", relation.Eid, relation.EntityID, relation.SpaceID, relation.LibraryID, relation.FileID, relation.ChunkID)
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			uniqueRelations = append(uniqueRelations, relation)
			if _, ok := entityIDSeen[relation.EntityID]; !ok {
				entityIDSeen[relation.EntityID] = struct{}{}
				entityIDs = append(entityIDs, relation.EntityID)
			}
		}
		if len(uniqueRelations) == 0 {
			return nil
		}

		scopeQuery := tx.Model(&EntityChunkRelation{}).
			Select("entity_id").
			Where("eid = ? AND space_id = ? AND library_id = ? AND file_id = ? AND chunk_id = ?", eid, spaceID, libraryID, fileID, chunkID)
		if len(entityIDs) > 0 {
			scopeQuery = scopeQuery.Where("entity_id IN ?", entityIDs)
		}

		var existingEntityIDs []int64
		if err := scopeQuery.Find(&existingEntityIDs).Error; err != nil {
			return err
		}
		existing := make(map[int64]struct{}, len(existingEntityIDs))
		for _, entityID := range existingEntityIDs {
			existing[entityID] = struct{}{}
		}

		missing := make([]EntityChunkRelation, 0, len(uniqueRelations))
		for _, relation := range uniqueRelations {
			if _, ok := existing[relation.EntityID]; ok {
				continue
			}
			missing = append(missing, relation)
		}
		if len(missing) == 0 {
			return nil
		}
		return tx.CreateInBatches(missing, 100).Error
	})
}

// ReplaceGraphRelationsByInstance 替换图谱实例的关系
func ReplaceGraphRelationsByInstance(db *gorm.DB, eid int64, instanceID int64, relations []GraphRelationInstance) error {
	return db.Transaction(func(tx *gorm.DB) error {
		// 删除旧数据
		if err := tx.Where("eid = ? AND instance_id = ?", eid, instanceID).
			Delete(&GraphRelationInstance{}).Error; err != nil {
			return err
		}

		// 插入新数据
		if len(relations) == 0 {
			return nil
		}
		return tx.CreateInBatches(relations, 100).Error
	})
}

// ReplaceGraphRelationsByInstanceChunk 替换图谱实例在指定分片上的关系
// 删除指定实例+分片范围的关系后重新写入，避免不同分片之间相互覆盖
func ReplaceGraphRelationsByInstanceChunk(db *gorm.DB, eid int64, instanceID int64, chunkID int64, relations []GraphRelationInstance) error {
	return db.Transaction(func(tx *gorm.DB) error {
		query := tx.Where("eid = ? AND instance_id = ?", eid, instanceID)
		if chunkID > 0 {
			query = query.Where("chunk_id = ?", chunkID)
		}

		if err := query.Delete(&GraphRelationInstance{}).Error; err != nil {
			return err
		}

		if len(relations) == 0 {
			return nil
		}
		return tx.CreateInBatches(relations, 100).Error
	})
}

// ValidateTemplateID 验证模板ID是否有效
func ValidateTemplateID(eid int64, templateID int64) error {
	if templateID <= 0 {
		return errors.New("template_id is required")
	}
	var count int64
	if err := DB.Model(&GraphTemplate{}).
		Where("eid = ? AND id = ?", eid, templateID).
		Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return errors.New("template not found")
	}
	return nil
}

// GetGraphInstanceByFileID 根据文件ID获取图谱实例
func GetGraphInstanceByFileID(eid int64, fileID int64) (*GraphInstance, error) {
	var instance GraphInstance
	err := DB.Where("eid = ? AND file_id = ? AND status = ?", eid, fileID, GraphInstanceStatusCompleted).
		Order("id DESC").
		First(&instance).Error
	if err != nil {
		return nil, err
	}
	return &instance, nil
}

// GraphEntityData 图谱实体数据（用于API返回）
type GraphEntityData struct {
	ID          int64             `json:"id"`
	Type        string            `json:"type"`
	Name        string            `json:"name"`
	Properties  map[string]string `json:"properties"`
	ChunkIDs    []int64           `json:"chunk_ids"`
	CreatedTime int64             `json:"created_time"`
}

// GraphRelationData 图谱关系数据（用于API返回）
type GraphRelationData struct {
	ID             int64   `json:"id"`
	SourceEntityID int64   `json:"source_entity_id"`
	TargetEntityID int64   `json:"target_entity_id"`
	Predicate      string  `json:"predicate"`
	ChunkIDs       []int64 `json:"chunk_ids"`
	CreatedTime    int64   `json:"created_time"`
}

// GetGraphEntitiesByFileID 获取文件的图谱实体列表
func GetGraphEntitiesByFileID(eid int64, fileID int64, limit int, entityType string, keyword string) ([]GraphEntityData, int64, error) {
	query := DB.Table("entity_chunk_relations ecr").
		Select("e.id as id, e.type as type, e.name as name, ecr.properties as properties, e.created_time as created_time").
		Joins("JOIN entities e ON e.id = ecr.entity_id").
		Where("ecr.eid = ? AND ecr.file_id = ? AND ecr.template_id > ? AND ecr.status = ?", eid, fileID, 0, EntityRelationStatusActive)

	if entityType != "" {
		query = query.Where("e.type = ?", entityType)
	}

	if keyword != "" {
		query = query.Where("e.name LIKE ?", "%"+keyword+"%")
	}

	// 获取总数
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// 分页查询
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	var results []struct {
		ID          int64  `json:"id"`
		Type        string `json:"type"`
		Name        string `json:"name"`
		Properties  string `json:"properties"`
		CreatedTime int64  `json:"created_time"`
	}

	if err := query.Order("ecr.created_time DESC").Limit(limit).Find(&results).Error; err != nil {
		return nil, 0, err
	}

	// 收集实体ID
	entityIDs := make([]int64, len(results))
	for i, r := range results {
		entityIDs[i] = r.ID
	}

	// 查询每个实体关联的分片ID
	chunkMap, err := getEntityChunkIDs(eid, fileID, entityIDs)
	if err != nil {
		return nil, 0, err
	}

	// 构建返回数据
	var entities []GraphEntityData
	for _, r := range results {
		props := make(map[string]string)
		if r.Properties != "" {
			json.Unmarshal([]byte(r.Properties), &props)
		}
		entities = append(entities, GraphEntityData{
			ID:          r.ID,
			Type:        r.Type,
			Name:        r.Name,
			Properties:  props,
			ChunkIDs:    chunkMap[r.ID],
			CreatedTime: r.CreatedTime,
		})
	}

	return entities, total, nil
}

// GetGraphEntitiesByIDs 根据实体ID列表获取图谱实体详情（限定文件范围）
func GetGraphEntitiesByIDs(eid int64, fileID int64, entityIDs []int64) ([]GraphEntityData, error) {
	if len(entityIDs) == 0 {
		return []GraphEntityData{}, nil
	}

	var rows []struct {
		ID          int64  `json:"id"`
		Type        string `json:"type"`
		Name        string `json:"name"`
		Properties  string `json:"properties"`
		CreatedTime int64  `json:"created_time"`
	}
	if err := DB.Table("entity_chunk_relations ecr").
		Select("e.id as id, e.type as type, e.name as name, ecr.properties as properties, e.created_time as created_time, ecr.created_time as rel_created_time").
		Joins("JOIN entities e ON e.id = ecr.entity_id").
		Where("ecr.eid = ? AND ecr.file_id = ? AND ecr.template_id > ? AND ecr.status = ? AND e.id IN ?",
			eid, fileID, 0, EntityRelationStatusActive, entityIDs).
		Order("rel_created_time DESC").
		Find(&rows).Error; err != nil {
		return nil, err
	}

	// 每个实体取最新一条关系属性
	uniq := make(map[int64]GraphEntityData)
	for _, r := range rows {
		if _, exists := uniq[r.ID]; exists {
			continue
		}
		props := make(map[string]string)
		if r.Properties != "" {
			_ = json.Unmarshal([]byte(r.Properties), &props)
		}
		uniq[r.ID] = GraphEntityData{
			ID:          r.ID,
			Type:        r.Type,
			Name:        r.Name,
			Properties:  props,
			CreatedTime: r.CreatedTime,
		}
	}

	ids := make([]int64, 0, len(uniq))
	for id := range uniq {
		ids = append(ids, id)
	}
	chunkMap, err := getEntityChunkIDs(eid, fileID, ids)
	if err != nil {
		return nil, err
	}

	entities := make([]GraphEntityData, 0, len(uniq))
	for _, id := range entityIDs {
		entity, ok := uniq[id]
		if !ok {
			continue
		}
		entity.ChunkIDs = chunkMap[id]
		entities = append(entities, entity)
	}
	return entities, nil
}

// getEntityChunkIDs 获取实体关联的分片ID
func getEntityChunkIDs(eid int64, fileID int64, entityIDs []int64) (map[int64][]int64, error) {
	if len(entityIDs) == 0 {
		return make(map[int64][]int64), nil
	}

	var relations []struct {
		EntityID int64 `json:"entity_id"`
		ChunkID  int64 `json:"chunk_id"`
	}
	if err := DB.Model(&EntityChunkRelation{}).
		Select("entity_id, chunk_id").
		Where("eid = ? AND file_id = ? AND entity_id IN ? AND status = ?", eid, fileID, entityIDs, EntityRelationStatusActive).
		Find(&relations).Error; err != nil {
		return nil, err
	}

	chunkMap := make(map[int64][]int64)
	for _, r := range relations {
		chunkMap[r.EntityID] = append(chunkMap[r.EntityID], r.ChunkID)
	}
	return chunkMap, nil
}

// GetGraphRelationsByInstanceID 获取图谱实例的关系列表
func GetGraphRelationsByInstanceID(eid int64, instanceID int64) ([]GraphRelationData, error) {
	var relations []GraphRelationInstance
	if err := DB.Where("eid = ? AND instance_id = ?", eid, instanceID).
		Order("created_time DESC, id DESC").
		Find(&relations).Error; err != nil {
		return nil, err
	}

	if len(relations) == 0 {
		return []GraphRelationData{}, nil
	}

	// 收集所有 relation_id
	relationIDs := make([]int64, 0, len(relations)*2)
	for _, r := range relations {
		relationIDs = append(relationIDs, r.SourceRelationID, r.TargetRelationID)
	}

	// 查询 EntityChunkRelation 获取 entity_id
	var entityRelations []struct {
		ID       int64 `json:"id"`
		EntityID int64 `json:"entity_id"`
	}
	if err := DB.Model(&EntityChunkRelation{}).
		Select("id, entity_id").
		Where("id IN ?", relationIDs).
		Find(&entityRelations).Error; err != nil {
		return nil, err
	}

	// 建立映射
	idToEntityID := make(map[int64]int64)
	for _, er := range entityRelations {
		idToEntityID[er.ID] = er.EntityID
	}

	return aggregateGraphRelationRows(relations, idToEntityID), nil
}

// SearchGraphEntities 搜索图谱实体及其关联实体
func SearchGraphEntities(eid int64, fileID int64, keyword string) ([]GraphEntityData, []GraphRelationData, error) {
	// 1. 搜索匹配的实体
	var matchedResults []struct {
		ID          int64  `json:"id"`
		Type        string `json:"type"`
		Name        string `json:"name"`
		Properties  string `json:"properties"`
		CreatedTime int64  `json:"created_time"`
	}
	if err := DB.Table("entity_chunk_relations ecr").
		Select("DISTINCT e.id, e.type, e.name, ecr.properties, e.created_time").
		Joins("JOIN entities e ON e.id = ecr.entity_id").
		Where("ecr.eid = ? AND ecr.file_id = ? AND ecr.template_id > ? AND ecr.status = ? AND e.name LIKE ?",
			eid, fileID, 0, EntityRelationStatusActive, "%"+keyword+"%").
		Find(&matchedResults).Error; err != nil {
		return nil, nil, err
	}

	if len(matchedResults) == 0 {
		return []GraphEntityData{}, []GraphRelationData{}, nil
	}

	// 收集匹配的实体ID
	matchedIDs := make([]int64, len(matchedResults))
	for i, r := range matchedResults {
		matchedIDs[i] = r.ID
	}

	// 2. 获取图谱实例ID
	instanceIDs := make([]int64, 0)
	if err := DB.Model(&GraphInstance{}).
		Select("id").
		Where("eid = ? AND file_id = ? AND status = ?", eid, fileID, GraphInstanceStatusCompleted).
		Pluck("id", &instanceIDs).Error; err != nil {
		return nil, nil, err
	}

	if len(instanceIDs) == 0 {
		return []GraphEntityData{}, []GraphRelationData{}, nil
	}

	// 3. 获取 matchedIDs 对应的 EntityChunkRelation IDs
	// source_relation_id 和 target_relation_id 存储的是 EntityChunkRelation.ID 而非 entity_id
	var entityChunkRelations []struct {
		ID       int64 `json:"id"`
		EntityID int64 `json:"entity_id"`
	}
	if err := DB.Model(&EntityChunkRelation{}).
		Select("id, entity_id").
		Where("eid = ? AND file_id = ? AND entity_id IN ? AND status = ?",
			eid, fileID, matchedIDs, EntityRelationStatusActive).
		Find(&entityChunkRelations).Error; err != nil {
		return nil, nil, err
	}

	relationEntityIDs := make([]int64, len(entityChunkRelations))
	for i, ecr := range entityChunkRelations {
		relationEntityIDs[i] = ecr.ID
	}

	// 4. 查询关系（包含匹配实体的）
	var relations []GraphRelationInstance
	if len(relationEntityIDs) > 0 {
		if err := DB.Where("eid = ? AND instance_id IN ? AND (source_relation_id IN ? OR target_relation_id IN ?)",
			eid, instanceIDs, relationEntityIDs, relationEntityIDs).
			Find(&relations).Error; err != nil {
			return nil, nil, err
		}
	}

	// 5. 收集关联的实体ID
	allEntityIDs := make(map[int64]bool)
	for _, id := range matchedIDs {
		allEntityIDs[id] = true
	}

	relationIDs := make([]int64, 0, len(relations)*2)
	for _, r := range relations {
		relationIDs = append(relationIDs, r.SourceRelationID, r.TargetRelationID)
	}

	// 查询关联的 entity_id
	var entityRelations []struct {
		ID       int64 `json:"id"`
		EntityID int64 `json:"entity_id"`
	}
	if err := DB.Model(&EntityChunkRelation{}).
		Select("id, entity_id").
		Where("id IN ?", relationIDs).
		Find(&entityRelations).Error; err != nil {
		return nil, nil, err
	}

	idToEntityID := make(map[int64]int64)
	for _, er := range entityRelations {
		idToEntityID[er.ID] = er.EntityID
		allEntityIDs[er.EntityID] = true
	}

	// 6. 查询所有相关实体
	allIDs := make([]int64, 0, len(allEntityIDs))
	for id := range allEntityIDs {
		allIDs = append(allIDs, id)
	}

	var allEntities []struct {
		ID          int64  `json:"id"`
		Type        string `json:"type"`
		Name        string `json:"name"`
		Properties  string `json:"properties"`
		CreatedTime int64  `json:"created_time"`
	}
	if err := DB.Table("entity_chunk_relations ecr").
		Select("DISTINCT e.id, e.type, e.name, ecr.properties, e.created_time").
		Joins("JOIN entities e ON e.id = ecr.entity_id").
		Where("ecr.eid = ? AND ecr.file_id = ? AND ecr.template_id > ? AND ecr.status = ? AND e.id IN ?",
			eid, fileID, 0, EntityRelationStatusActive, allIDs).
		Find(&allEntities).Error; err != nil {
		return nil, nil, err
	}

	// 查询分片ID
	chunkMap, err := getEntityChunkIDs(eid, fileID, allIDs)
	if err != nil {
		return nil, nil, err
	}

	// 7. 构建返回数据
	var entityData []GraphEntityData
	for _, r := range allEntities {
		props := make(map[string]string)
		if r.Properties != "" {
			json.Unmarshal([]byte(r.Properties), &props)
		}
		entityData = append(entityData, GraphEntityData{
			ID:          r.ID,
			Type:        r.Type,
			Name:        r.Name,
			Properties:  props,
			ChunkIDs:    chunkMap[r.ID],
			CreatedTime: r.CreatedTime,
		})
	}

	return entityData, aggregateGraphRelationRows(relations, idToEntityID), nil
}

type graphRelationAggregate struct {
	data GraphRelationData
	set  map[int64]struct{}
}

func aggregateGraphRelationRows(relations []GraphRelationInstance, idToEntityID map[int64]int64) []GraphRelationData {
	if len(relations) == 0 {
		return []GraphRelationData{}
	}

	aggregates := make(map[string]*graphRelationAggregate)
	order := make([]string, 0, len(relations))
	for _, r := range relations {
		key := fmt.Sprintf("%d|%d|%s", r.SourceRelationID, r.TargetRelationID, r.Predicate)
		aggregate, ok := aggregates[key]
		if !ok {
			aggregate = &graphRelationAggregate{
				data: GraphRelationData{
					ID:             r.ID,
					SourceEntityID: idToEntityID[r.SourceRelationID],
					TargetEntityID: idToEntityID[r.TargetRelationID],
					Predicate:      r.Predicate,
					ChunkIDs:       []int64{},
					CreatedTime:    r.CreatedTime,
				},
				set: make(map[int64]struct{}),
			}
			aggregates[key] = aggregate
			order = append(order, key)
		}

		if r.CreatedTime > aggregate.data.CreatedTime || (r.CreatedTime == aggregate.data.CreatedTime && r.ID > aggregate.data.ID) {
			aggregate.data.ID = r.ID
			aggregate.data.CreatedTime = r.CreatedTime
		}

		if r.ChunkID > 0 {
			if _, exists := aggregate.set[r.ChunkID]; !exists {
				aggregate.set[r.ChunkID] = struct{}{}
				aggregate.data.ChunkIDs = append(aggregate.data.ChunkIDs, r.ChunkID)
			}
		}
	}

	result := make([]GraphRelationData, 0, len(aggregates))
	for _, key := range order {
		aggregate, ok := aggregates[key]
		if !ok {
			continue
		}
		sort.Slice(aggregate.data.ChunkIDs, func(i, j int) bool {
			return aggregate.data.ChunkIDs[i] < aggregate.data.ChunkIDs[j]
		})
		result = append(result, aggregate.data)
	}

	return result
}

func GetRelatedEntityIDsByGraph(db *gorm.DB, eid int64, entityIDs []int64) ([]int64, error) {
	if len(entityIDs) == 0 {
		return []int64{}, nil
	}

	var relationIDs []struct {
		ID int64 `json:"id"`
	}
	err := db.Model(&EntityChunkRelation{}).
		Select("id").
		Where("eid = ? AND entity_id IN ? AND status = ?", eid, entityIDs, EntityRelationStatusActive).
		Find(&relationIDs).Error
	if err != nil {
		return nil, err
	}

	if len(relationIDs) == 0 {
		return []int64{}, nil
	}

	relationIDList := make([]int64, len(relationIDs))
	for i, r := range relationIDs {
		relationIDList[i] = r.ID
	}

	var relatedRelations []struct {
		SourceRelationID int64 `json:"source_relation_id"`
		TargetRelationID int64 `json:"target_relation_id"`
	}
	err = db.Model(&GraphRelationInstance{}).
		Select("source_relation_id, target_relation_id").
		Where("eid = ? AND (source_relation_id IN ? OR target_relation_id IN ?)", eid, relationIDList, relationIDList).
		Find(&relatedRelations).Error
	if err != nil {
		return nil, err
	}

	if len(relatedRelations) == 0 {
		return []int64{}, nil
	}

	relatedRelationIDSet := make(map[int64]bool)
	for _, r := range relatedRelations {
		relatedRelationIDSet[r.SourceRelationID] = true
		relatedRelationIDSet[r.TargetRelationID] = true
	}

	relatedRelationIDList := make([]int64, 0, len(relatedRelationIDSet))
	for id := range relatedRelationIDSet {
		relatedRelationIDList = append(relatedRelationIDList, id)
	}

	var relatedEntities []struct {
		EntityID int64 `json:"entity_id"`
	}
	err = db.Model(&EntityChunkRelation{}).
		Select("entity_id").
		Where("id IN ?", relatedRelationIDList).
		Find(&relatedEntities).Error
	if err != nil {
		return nil, err
	}

	result := make([]int64, 0, len(relatedEntities))
	for _, e := range relatedEntities {
		if e.EntityID > 0 {
			result = append(result, e.EntityID)
		}
	}

	return result, nil
}
