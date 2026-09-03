package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"gorm.io/gorm"
)

const (
	WikiCategoryGrowthModeSmart = "smart"
	WikiCategoryGrowthModeFixed = "fixed"
	WikiCategoryStatusEnabled   = "enabled"
	WikiCategoryStatusDisabled  = "disabled"

	// WikiCategoryStylePromptTitleCustom 自定义写作风格的预设标题。
	WikiCategoryStylePromptTitleCustom = "自定义"

	WikiCategoryTargetTypePerson       = "Person"
	WikiCategoryTargetTypeOrganization = "Organization"
	WikiCategoryTargetTypeProduct      = "Product"
	WikiCategoryTargetTypeLocation     = "Location"
	WikiCategoryTargetTypeTime         = "Time"
	WikiCategoryTargetTypeEvent        = "Event"
	WikiCategoryTargetTypeDocument     = "Document"
	WikiCategoryTargetTypeConcept      = "Concept"
	WikiCategoryTargetTypeMethod       = "Method"
)

// WikiCategoryTargetTypes 允许的目标大类，顺序与对外协议保持一致。
var WikiCategoryTargetTypes = []string{
	WikiCategoryTargetTypePerson,
	WikiCategoryTargetTypeOrganization,
	WikiCategoryTargetTypeProduct,
	WikiCategoryTargetTypeLocation,
	WikiCategoryTargetTypeTime,
	WikiCategoryTargetTypeEvent,
	WikiCategoryTargetTypeDocument,
	WikiCategoryTargetTypeConcept,
	WikiCategoryTargetTypeMethod,
}

// wikiCategoryTargetAliases 大类名称的中英文别名（只含新协议定义的大类语义）。
var wikiCategoryTargetAliases = map[string]string{
	"person": WikiCategoryTargetTypePerson, "people": WikiCategoryTargetTypePerson, "human": WikiCategoryTargetTypePerson,
	"人物": WikiCategoryTargetTypePerson, "人员": WikiCategoryTargetTypePerson, "人类": WikiCategoryTargetTypePerson, "历史人物": WikiCategoryTargetTypePerson, "名人": WikiCategoryTargetTypePerson, "政治人物": WikiCategoryTargetTypePerson, "军事人物": WikiCategoryTargetTypePerson, "将领": WikiCategoryTargetTypePerson, "武将": WikiCategoryTargetTypePerson, "皇帝": WikiCategoryTargetTypePerson, "君主": WikiCategoryTargetTypePerson,
	"organization": WikiCategoryTargetTypeOrganization, "org": WikiCategoryTargetTypeOrganization, "company": WikiCategoryTargetTypeOrganization, "department": WikiCategoryTargetTypeOrganization,
	"组织": WikiCategoryTargetTypeOrganization, "公司": WikiCategoryTargetTypeOrganization, "部门": WikiCategoryTargetTypeOrganization, "机构": WikiCategoryTargetTypeOrganization,
	"product": WikiCategoryTargetTypeProduct, "system": WikiCategoryTargetTypeProduct, "service": WikiCategoryTargetTypeProduct, "platform": WikiCategoryTargetTypeProduct,
	"产品": WikiCategoryTargetTypeProduct, "系统": WikiCategoryTargetTypeProduct, "服务": WikiCategoryTargetTypeProduct, "平台": WikiCategoryTargetTypeProduct,
	"location": WikiCategoryTargetTypeLocation, "地点": WikiCategoryTargetTypeLocation, "国家": WikiCategoryTargetTypeLocation, "省市": WikiCategoryTargetTypeLocation, "园区": WikiCategoryTargetTypeLocation, "地址": WikiCategoryTargetTypeLocation,
	"time": WikiCategoryTargetTypeTime, "date": WikiCategoryTargetTypeTime, "month": WikiCategoryTargetTypeTime, "year": WikiCategoryTargetTypeTime, "时间": WikiCategoryTargetTypeTime, "日期": WikiCategoryTargetTypeTime, "月份": WikiCategoryTargetTypeTime, "年份": WikiCategoryTargetTypeTime, "时间范围": WikiCategoryTargetTypeTime,
	"event": WikiCategoryTargetTypeEvent, "发布": WikiCategoryTargetTypeEvent, "会议": WikiCategoryTargetTypeEvent, "故障": WikiCategoryTargetTypeEvent, "活动": WikiCategoryTargetTypeEvent, "事件": WikiCategoryTargetTypeEvent,
	"document": WikiCategoryTargetTypeDocument, "文档": WikiCategoryTargetTypeDocument, "制度": WikiCategoryTargetTypeDocument, "规范": WikiCategoryTargetTypeDocument, "手册": WikiCategoryTargetTypeDocument, "协议": WikiCategoryTargetTypeDocument,
	"concept": WikiCategoryTargetTypeConcept, "概念": WikiCategoryTargetTypeConcept, "术语": WikiCategoryTargetTypeConcept, "指标": WikiCategoryTargetTypeConcept, "名词性知识点": WikiCategoryTargetTypeConcept,
	"method": WikiCategoryTargetTypeMethod, "方法": WikiCategoryTargetTypeMethod, "流程": WikiCategoryTargetTypeMethod, "步骤": WikiCategoryTargetTypeMethod, "方案": WikiCategoryTargetTypeMethod, "机制": WikiCategoryTargetTypeMethod,
}

// NormalizeWikiCategoryTargetType 将分类 target_entity_type 输入规范化为英文大类。
// 接受大类英文枚举或中文别名；自由词（如"军阀"）返回 ok=false，不强行归类。
func NormalizeWikiCategoryTargetType(value string) (string, bool) {
	key := strings.ToLower(strings.TrimSpace(value))
	if key == "" {
		return "", false
	}
	if v, ok := wikiCategoryTargetAliases[key]; ok {
		return v, true
	}
	return "", false
}

// WikiCategoryTargetTypeMeta 目标大类元信息：枚举、中文名、别名、引导描述，供前端表单与 swagger 使用。
type WikiCategoryTargetTypeMeta struct {
	Type        string   `json:"type"`
	Label       string   `json:"label"`
	Aliases     []string `json:"aliases"`
	Description string   `json:"description"`
}

// GetWikiCategoryTargetTypes 返回 9 大类的枚举/中文名/别名/引导描述。
// 别名从 wikiCategoryTargetAliases 按类型派生并排序，保证响应稳定；类型与描述为唯一静态定义。
func GetWikiCategoryTargetTypes() []WikiCategoryTargetTypeMeta {
	defs := []WikiCategoryTargetTypeMeta{
		{Type: WikiCategoryTargetTypePerson, Label: "人物", Description: "人物、人员、人类等主体。"},
		{Type: WikiCategoryTargetTypeOrganization, Label: "组织", Description: "组织、公司、部门、机构等主体。"},
		{Type: WikiCategoryTargetTypeProduct, Label: "产品", Description: "产品、系统、服务、平台等主体。"},
		{Type: WikiCategoryTargetTypeLocation, Label: "地点", Description: "国家、省市、园区、地址等地理位置。"},
		{Type: WikiCategoryTargetTypeTime, Label: "时间", Description: "日期、月份、年份、时间范围等时间信息。"},
		{Type: WikiCategoryTargetTypeEvent, Label: "事件", Description: "发布、会议、故障、活动等事件。"},
		{Type: WikiCategoryTargetTypeDocument, Label: "文档", Description: "文档、制度、规范、手册、协议等内容。"},
		{Type: WikiCategoryTargetTypeConcept, Label: "概念", Description: "概念、术语、指标、名词性知识点等抽象知识。"},
		{Type: WikiCategoryTargetTypeMethod, Label: "方法", Description: "方法、流程、步骤、方案、机制等做事方式。"},
	}
	for i := range defs {
		for alias, typ := range wikiCategoryTargetAliases {
			if typ == defs[i].Type {
				defs[i].Aliases = append(defs[i].Aliases, alias)
			}
		}
		sort.Strings(defs[i].Aliases)
	}
	return defs
}

type WikiCategory struct {
	ID                   int64                         `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid                  int64                         `json:"eid" gorm:"not null;index;uniqueIndex:idx_wiki_categories_space_name,priority:1"`
	SpaceID              int64                         `json:"space_id" gorm:"not null;index;uniqueIndex:idx_wiki_categories_space_name,priority:2"`
	Name                 string                        `json:"name" gorm:"not null;size:128;uniqueIndex:idx_wiki_categories_space_name,priority:3"`
	Slug                 string                        `json:"slug" gorm:"not null;size:96;index"`
	Description          string                        `json:"description" gorm:"type:text;not null"`
	TargetEntityType     string                        `json:"target_entity_type" gorm:"not null;size:64;index"`
	OKFType              string                        `json:"okf_type" gorm:"size:128"`
	GrowthMode           string                        `json:"growth_mode" gorm:"not null;size:32;default:smart;index"`
	StylePrompt          string                        `json:"style_prompt" gorm:"type:text"`
	StylePromptTitle     string                        `json:"style_prompt_title" gorm:"size:64;default:自定义"`
	GraphDepth           int                           `json:"graph_depth" gorm:"not null;default:1"`
	Creativity           float64                       `json:"creativity" gorm:"not null;default:0.5"`
	AnchorLinksEnabled   bool                          `json:"anchor_links_enabled" gorm:"not null;default:false"`
	TemplateMarkdown     string                        `json:"template_markdown" gorm:"type:text"`
	TemplateSections     []WikiCategoryTemplateSection `json:"template_sections" gorm:"-"`
	TemplateSectionsJSON string                        `json:"-" gorm:"column:template_sections;type:text"`
	StrictFill           bool                          `json:"strict_fill" gorm:"not null;default:false"`
	Status               string                        `json:"status" gorm:"not null;size:32;default:enabled;index"`
	Sort                 int64                         `json:"sort" gorm:"not null;default:0"`
	BaseModel
}

type WikiCategoryTemplateSection struct {
	Title       string `json:"title"`
	Level       int    `json:"level"`
	Description string `json:"description"`
}

func (c *WikiCategory) BeforeSave(tx *gorm.DB) error {
	if c.TemplateSections == nil {
		return nil
	}
	data, err := json.Marshal(c.TemplateSections)
	if err != nil {
		return err
	}
	c.TemplateSectionsJSON = string(data)
	return nil
}

func (c *WikiCategory) AfterFind(tx *gorm.DB) error {
	if strings.TrimSpace(c.TemplateSectionsJSON) == "" {
		return nil
	}
	return json.Unmarshal([]byte(c.TemplateSectionsJSON), &c.TemplateSections)
}

func (WikiCategory) TableName() string { return "wiki_categories" }

type WikiPageCategory struct {
	ID                   int64   `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid                  int64   `json:"eid" gorm:"not null;index"`
	SpaceID              int64   `json:"space_id" gorm:"not null;index"`
	CategoryID           int64   `json:"category_id" gorm:"not null;uniqueIndex:idx_wiki_page_categories_category_page,priority:1;index"`
	PageID               int64   `json:"page_id" gorm:"not null;uniqueIndex:idx_wiki_page_categories_category_page,priority:2;index"`
	EntityType           string  `json:"entity_type" gorm:"size:64;index"`
	EntitySlug           string  `json:"entity_slug" gorm:"size:255;index"`
	ClassificationReason string  `json:"classification_reason" gorm:"type:text"`
	Confidence           float64 `json:"confidence" gorm:"not null;default:0"`
	BaseModel
}

func (WikiPageCategory) TableName() string { return "wiki_page_categories" }

func ValidateWikiCategory(category *WikiCategory) error {
	if category == nil {
		return errors.New("wiki category is nil")
	}
	if category.Eid <= 0 || category.SpaceID <= 0 {
		return errors.New("eid and space_id are required")
	}
	if strings.TrimSpace(category.Name) == "" {
		return errors.New("category name is required")
	}
	if strings.TrimSpace(category.TargetEntityType) == "" {
		return errors.New("target entity type is required")
	}
	if _, ok := NormalizeWikiCategoryTargetType(category.TargetEntityType); !ok {
		return fmt.Errorf("target entity type must be one of: %s", strings.Join(WikiCategoryTargetTypes, ", "))
	}
	if category.GrowthMode != WikiCategoryGrowthModeSmart && category.GrowthMode != WikiCategoryGrowthModeFixed {
		return errors.New("invalid growth mode")
	}
	if category.GraphDepth < 1 || category.GraphDepth > 3 {
		return errors.New("graph depth must be between 1 and 3")
	}
	if category.Creativity < 0 || category.Creativity > 1 {
		return errors.New("creativity must be between 0 and 1")
	}
	if category.Status != "" && category.Status != WikiCategoryStatusEnabled && category.Status != WikiCategoryStatusDisabled {
		return errors.New("invalid category status")
	}
	return nil
}
