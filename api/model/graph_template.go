package model

import (
	"encoding/json"
	"errors"
	"strings"

	"gorm.io/gorm"
)

const (
	DefaultGraphTemplateName        = "会议记录"
	DefaultGraphTemplateDescription = "软件行业的会议纪要"
)

// EntityDefinition 实体定义结构
type EntityDefinition struct {
	Name       string   `json:"name"`
	Properties []string `json:"properties"`
	OrderNum   int      `json:"order_num"`
}

// RelationDefinition 关系定义结构
type RelationDefinition struct {
	Source    string `json:"source"`
	Predicate string `json:"predicate"`
	Target    string `json:"target"`
}

// GraphTemplate 图谱模板表
type GraphTemplate struct {
	ID          int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid         int64  `json:"eid" gorm:"not null;index;uniqueIndex:idx_eid_name,priority:1"`
	Name        string `json:"name" gorm:"size:100;not null;uniqueIndex:idx_eid_name,priority:2"`
	Description string `json:"description" gorm:"size:500"`
	Logo        string `json:"logo" gorm:"size:255;default:'';comment:模板图标URL"`

	// 使用 TEXT 类型 + 手动序列化（兼容 MySQL 5.6）
	Entities  string `json:"entities" gorm:"type:text"`
	Relations string `json:"relations" gorm:"type:text"`

	BaseModel
}

// GraphTemplateBrief 图谱模板轻量信息，用于候选选择
type GraphTemplateBrief struct {
	ID          int64  `json:"id"`
	Eid         int64  `json:"eid"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Relations   string `json:"relations"`
}

// TableName 设置表名
func (GraphTemplate) TableName() string {
	return "graph_templates"
}

// GetEntities 获取解析后的实体定义列表
func (t *GraphTemplate) GetEntities() ([]*EntityDefinition, error) {
	if t.Entities == "" {
		return []*EntityDefinition{}, nil
	}
	var entities []*EntityDefinition
	err := json.Unmarshal([]byte(t.Entities), &entities)
	if err != nil {
		return nil, err
	}
	return entities, nil
}

// SetEntities 设置实体定义列表
func (t *GraphTemplate) SetEntities(entities []*EntityDefinition) error {
	if entities == nil {
		t.Entities = ""
		return nil
	}
	data, err := json.Marshal(entities)
	if err != nil {
		return err
	}
	t.Entities = string(data)
	return nil
}

// GetRelations 获取解析后的关系定义列表
func (t *GraphTemplate) GetRelations() ([]*RelationDefinition, error) {
	if t.Relations == "" {
		return []*RelationDefinition{}, nil
	}
	var relations []*RelationDefinition
	err := json.Unmarshal([]byte(t.Relations), &relations)
	if err != nil {
		return nil, err
	}
	return relations, nil
}

// SetRelations 设置关系定义列表
func (t *GraphTemplate) SetRelations(relations []*RelationDefinition) error {
	if relations == nil {
		t.Relations = ""
		return nil
	}
	data, err := json.Marshal(relations)
	if err != nil {
		return err
	}
	t.Relations = string(data)
	return nil
}

// Save 创建模板
func (t *GraphTemplate) Save() error {
	result := DB.Create(t)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// Update 更新模板
func (t *GraphTemplate) Update() error {
	result := DB.Model(t).Updates(map[string]interface{}{
		"name":        t.Name,
		"description": t.Description,
		"logo":        t.Logo,
		"entities":    t.Entities,
		"relations":   t.Relations,
	})
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// GetGraphTemplateByID 根据ID获取模板
func GetGraphTemplateByID(eid int64, id int64) (*GraphTemplate, error) {
	var template GraphTemplate
	err := DB.Where("eid = ? AND id = ?", eid, id).First(&template).Error
	if err != nil {
		return nil, err
	}
	return &template, nil
}

// GetGraphTemplateByName 根据名称获取模板
func GetGraphTemplateByName(eid int64, name string) (*GraphTemplate, error) {
	var template GraphTemplate
	err := DB.Where("eid = ? AND name = ?", eid, name).First(&template).Error
	if err != nil {
		return nil, err
	}
	return &template, nil
}

// GetGraphTemplateBriefList 获取模板轻量候选列表
func GetGraphTemplateBriefList(eid int64) ([]*GraphTemplateBrief, error) {
	var templates []*GraphTemplateBrief
	err := DB.Model(&GraphTemplate{}).
		Select("id, eid, name, description, relations").
		Where("eid = ?", eid).
		Order("id ASC").
		Find(&templates).Error
	if err != nil {
		return nil, err
	}
	return templates, nil
}

// GetGraphTemplateList 获取模板列表
func GetGraphTemplateList(eid int64, offset, limit int, keyword string) ([]*GraphTemplate, int64, error) {
	var templates []*GraphTemplate
	var total int64

	query := DB.Model(&GraphTemplate{}).Where("eid = ?", eid)

	// 关键词搜索
	if keyword != "" {
		keyword = strings.TrimSpace(keyword)
		query = query.Where("name LIKE ?", "%"+keyword+"%")
	}

	// 获取总数
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// 分页查询
	if err := query.Order("id DESC").Offset(offset).Limit(limit).Find(&templates).Error; err != nil {
		return nil, 0, err
	}

	return templates, total, nil
}

// DeleteGraphTemplate 删除模板
func DeleteGraphTemplate(eid int64, id int64) error {
	result := DB.Where("eid = ? AND id = ?", eid, id).Delete(&GraphTemplate{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return errors.New("template not found")
	}
	return nil
}

// ExistsByName 检查模板名称是否存在（排除指定ID）
func ExistsByName(eid int64, name string, excludeID int64) (bool, error) {
	var count int64
	query := DB.Model(&GraphTemplate{}).Where("eid = ? AND name = ?", eid, name)

	if excludeID > 0 {
		query = query.Where("id != ?", excludeID)
	}

	if err := query.Count(&count).Error; err != nil {
		return false, err
	}

	return count > 0, nil
}

// ValidateEntities 校验实体定义
func ValidateEntities(entities []*EntityDefinition) error {
	if len(entities) == 0 {
		return errors.New("entities cannot be empty")
	}

	entityNames := make(map[string]bool)
	for _, entity := range entities {
		// 检查实体名称
		entity.Name = strings.TrimSpace(entity.Name)
		if entity.Name == "" {
			return errors.New("entity name cannot be empty")
		}

		// 检查实体名称唯一性
		if entityNames[entity.Name] {
			return errors.New("entity name duplicated: " + entity.Name)
		}
		entityNames[entity.Name] = true

		// 检查属性列表
		if len(entity.Properties) == 0 {
			return errors.New("entity properties cannot be empty: " + entity.Name)
		}
	}

	return nil
}

// ValidateRelations 校验关系定义
func ValidateRelations(relations []*RelationDefinition, entityNames map[string]bool) error {
	if len(relations) == 0 {
		return nil
	}

	relationMap := make(map[string]bool)
	for _, rel := range relations {
		// 检查字段完整性
		rel.Source = strings.TrimSpace(rel.Source)
		rel.Predicate = strings.TrimSpace(rel.Predicate)
		rel.Target = strings.TrimSpace(rel.Target)

		if rel.Source == "" || rel.Predicate == "" || rel.Target == "" {
			return errors.New("relation source/predicate/target cannot be empty")
		}

		// 检查源实体是否存在
		if !entityNames[rel.Source] {
			return errors.New("relation source entity not found: " + rel.Source)
		}

		// 检查目标实体是否存在
		if !entityNames[rel.Target] {
			return errors.New("relation target entity not found: " + rel.Target)
		}

		// 检查关系唯一性（source + predicate + target）
		key := rel.Source + "|" + rel.Predicate + "|" + rel.Target
		if relationMap[key] {
			return errors.New("relation duplicated: " + rel.Source + " -> " + rel.Predicate + " -> " + rel.Target)
		}
		relationMap[key] = true
	}

	return nil
}

// CreateGraphTemplate 创建模板（含完整校验）
func CreateGraphTemplate(eid int64, name, description, logo string, entities []*EntityDefinition, relations []*RelationDefinition) (*GraphTemplate, error) {
	// 校验名称
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("template name cannot be empty")
	}

	// 校验实体
	if err := ValidateEntities(entities); err != nil {
		return nil, err
	}

	// 构建实体名称集合
	entityNames := make(map[string]bool)
	for _, entity := range entities {
		entityNames[entity.Name] = true
	}

	// 校验关系
	if err := ValidateRelations(relations, entityNames); err != nil {
		return nil, err
	}

	// 创建模板对象
	template := &GraphTemplate{
		Eid:         eid,
		Name:        name,
		Description: description,
		Logo:        strings.TrimSpace(logo),
	}

	// 设置实体和关系
	if err := template.SetEntities(entities); err != nil {
		return nil, err
	}
	if err := template.SetRelations(relations); err != nil {
		return nil, err
	}

	// 保存到数据库
	if err := template.Save(); err != nil {
		return nil, err
	}

	return template, nil
}

func UpdateGraphTemplateWithDB(db *gorm.DB, eid, templateID int64, name, description, logo string, entities []*EntityDefinition, relations []*RelationDefinition) (*GraphTemplate, error) {
	template, err := GetGraphTemplateByID(eid, templateID)
	if err != nil {
		return nil, err
	}

	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("template name cannot be empty")
	}

	exists, err := ExistsByName(eid, name, templateID)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, errors.New("template name already exists")
	}

	if err := ValidateEntities(entities); err != nil {
		return nil, err
	}

	entityNames := make(map[string]bool)
	for _, entity := range entities {
		entityNames[entity.Name] = true
	}

	if err := ValidateRelations(relations, entityNames); err != nil {
		return nil, err
	}

	template.Name = name
	template.Description = description
	template.Logo = strings.TrimSpace(logo)
	if err := template.SetEntities(entities); err != nil {
		return nil, err
	}
	if err := template.SetRelations(relations); err != nil {
		return nil, err
	}

	if db != nil {
		if err := db.Model(template).Updates(map[string]interface{}{
			"name":        template.Name,
			"description": template.Description,
			"logo":        template.Logo,
			"entities":    template.Entities,
			"relations":   template.Relations,
		}).Error; err != nil {
			return nil, err
		}
	} else {
		if err := template.Update(); err != nil {
			return nil, err
		}
	}

	return template, nil
}

type SuggestRelationsRequest struct {
	Entities []*EntityDefinition `json:"entities" binding:"required,min=2,max=100,dive"`
	Context  string              `json:"context"`
}

type SuggestRelationsResponse struct {
	Relations []*RelationDefinition `json:"relations"`
}
