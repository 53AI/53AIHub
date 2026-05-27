package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
	"gorm.io/gorm"
)

// GraphTemplateListResponse 模板列表响应
type GraphTemplateListResponse struct {
	Items  []*GraphTemplateListItem `json:"items"`
	Total  int64                    `json:"total"`
	Offset int                      `json:"offset"`
	Limit  int                      `json:"limit"`
}

// GraphTemplateListItem 模板列表项
type GraphTemplateListItem struct {
	ID              int64  `json:"id"`
	Eid             int64  `json:"eid"`
	Name            string `json:"name"`
	Description     string `json:"description"`
	Logo            string `json:"logo"`
	Entities        string `json:"entities"`
	Relations       string `json:"relations"`
	EntityCount     int    `json:"entity_count"`
	RelationCount   int    `json:"relation_count"`
	EntityPreview   string `json:"entity_preview"`
	RelationPreview string `json:"relation_preview"`
	CreatedTime     int64  `json:"created_time"`
	UpdatedTime     int64  `json:"updated_time"`
}

func buildGraphTemplateListItem(t *model.GraphTemplate) *GraphTemplateListItem {
	if t == nil {
		return nil
	}

	item := &GraphTemplateListItem{
		ID:          t.ID,
		Eid:         t.Eid,
		Name:        t.Name,
		Description: t.Description,
		Logo:        t.Logo,
		Entities:    t.Entities,
		Relations:   t.Relations,
		CreatedTime: t.CreatedTime,
		UpdatedTime: t.UpdatedTime,
	}

	entities, err := t.GetEntities()
	if err == nil {
		item.EntityCount = len(entities)
		item.EntityPreview = generateEntityPreview(entities)
	}

	relations, err := t.GetRelations()
	if err == nil {
		item.RelationCount = len(relations)
		item.RelationPreview = generateRelationPreview(relations)
	}

	return item
}

// 业务错误定义
var (
	ErrTemplateNameExists = errors.New("模板名称已存在")
	ErrTemplateNotFound   = errors.New("模板不存在")
)

// CreateGraphTemplate 创建模板
func CreateGraphTemplate(ctx context.Context, eid int64, name, description string,
	logo string, entities []*model.EntityDefinition, relations []*model.RelationDefinition) (*model.GraphTemplate, error) {

	// 检查模板名称唯一性
	exists, err := model.ExistsByName(eid, name, 0)
	if err != nil {
		logger.SysError(fmt.Sprintf("Failed to check template name existence: %v", err))
		return nil, err
	}
	if exists {
		return nil, ErrTemplateNameExists
	}

	// 创建模板
	template, err := model.CreateGraphTemplate(eid, name, description, logo, entities, relations)
	if err != nil {
		logger.SysError(fmt.Sprintf("Failed to create graph template: %v", err))
		return nil, err
	}

	logger.Info(ctx, fmt.Sprintf("Graph template created successfully, template_id: %d, name: %s", template.ID, name))
	return template, nil
}

// UpdateGraphTemplate 更新模板
func UpdateGraphTemplate(ctx context.Context, eid, templateID int64, name, description string,
	logo string, entities []*model.EntityDefinition, relations []*model.RelationDefinition) (*model.GraphTemplate, error) {

	// 更新模板
	template, err := model.UpdateGraphTemplateWithDB(nil, eid, templateID, name, description, logo, entities, relations)
	if err != nil {
		// 区分业务错误和系统错误
		if err.Error() == "template not found" {
			return nil, ErrTemplateNotFound
		}
		if err.Error() == "template name already exists" {
			return nil, ErrTemplateNameExists
		}
		logger.SysError(fmt.Sprintf("Failed to update graph template: %v", err))
		return nil, err
	}

	logger.Info(ctx, fmt.Sprintf("Graph template updated successfully, template_id: %d, name: %s", templateID, name))
	return template, nil
}

// GetGraphTemplateList 获取模板列表
func GetGraphTemplateList(ctx context.Context, eid int64, offset, limit int, keyword string) (*GraphTemplateListResponse, error) {
	// 参数校验
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 || limit > 200 {
		limit = 20
	}

	// 查询模板列表
	templates, total, err := model.GetGraphTemplateList(eid, offset, limit, keyword)
	if err != nil {
		logger.SysError(fmt.Sprintf("Failed to get graph template list: %v", err))
		return nil, err
	}

	// 构建响应
	items := make([]*GraphTemplateListItem, 0, len(templates))
	for _, t := range templates {
		if item := buildGraphTemplateListItem(t); item != nil {
			items = append(items, item)
		}
	}

	return &GraphTemplateListResponse{
		Items:  items,
		Total:  total,
		Offset: offset,
		Limit:  limit,
	}, nil
}

// GetGraphTemplateDetail 获取模板详情
func GetGraphTemplateDetail(ctx context.Context, eid, templateID int64) (*model.GraphTemplate, error) {
	template, err := model.GetGraphTemplateByID(eid, templateID)
	if err != nil {
		if err.Error() == "record not found" {
			return nil, ErrTemplateNotFound
		}
		logger.SysError(fmt.Sprintf("Failed to get graph template detail: %v", err))
		return nil, err
	}

	return template, nil
}

// DeleteGraphTemplate 删除模板
func DeleteGraphTemplate(ctx context.Context, eid, templateID int64) error {
	err := model.DeleteGraphTemplate(eid, templateID)
	if err != nil {
		if err.Error() == "template not found" {
			return ErrTemplateNotFound
		}
		logger.SysError(fmt.Sprintf("Failed to delete graph template: %v", err))
		return err
	}

	logger.Info(ctx, fmt.Sprintf("Graph template deleted successfully, template_id: %d", templateID))
	return nil
}

// generateEntityPreview 生成实体预览文本
// 格式: "组织、部门、角色等4个"
func generateEntityPreview(entities []*model.EntityDefinition) string {
	if len(entities) == 0 {
		return ""
	}

	preview := entities[0].Name
	if len(entities) > 1 {
		preview += "、" + entities[1].Name
	}
	if len(entities) > 2 {
		preview += fmt.Sprintf("等%d个", len(entities))
	}

	return preview
}

// generateRelationPreview 生成关系预览文本
// 格式: "包含、隶属于、担任等3个"
func generateRelationPreview(relations []*model.RelationDefinition) string {
	if len(relations) == 0 {
		return ""
	}

	preview := relations[0].Predicate
	if len(relations) > 1 {
		preview += "、" + relations[1].Predicate
	}
	if len(relations) > 2 {
		preview += fmt.Sprintf("等%d个", len(relations))
	}

	return preview
}

type suggestRelationsResponse struct {
	Relations []*model.RelationDefinition `json:"relations"`
}

// SuggestRelations 根据实体类型推荐可能的关系
func SuggestRelations(ctx context.Context, db *gorm.DB, eid int64, entities []*model.EntityDefinition, contextHint string) (*model.SuggestRelationsResponse, error) {
	chunkCfgService := rag.NewChunkConfigService(db)
	config, err := chunkCfgService.GetConfig(eid, nil, "default")
	if err != nil {
		logger.SysError(fmt.Sprintf("Failed to get LLM config: %v", err))
		return nil, fmt.Errorf("获取模型配置失败: %v", err)
	}

	if config.LogicChannel == nil || config.LogicModelName == nil {
		return nil, fmt.Errorf("未配置逻辑推理模型")
	}

	systemPrompt := buildSuggestRelationsSystemPrompt(entities)
	userPrompt := buildSuggestRelationsUserPrompt(entities, contextHint)

	timeoutCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	contentService := rag.NewContentGeneratorService(db)
	chatReq := &relaymodel.GeneralOpenAIRequest{
		Model:     *config.LogicModelName,
		MaxTokens: 2048,
		Messages: []relaymodel.Message{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
	}

	_ = timeoutCtx
	resp, err, openaiErr := contentService.TestChannel(timeoutCtx, config.LogicChannel, chatReq)
	if err != nil || openaiErr != nil {
		if err != nil {
			return nil, fmt.Errorf("LLM 调用失败: %v", err)
		}
		return nil, fmt.Errorf("LLM 调用失败: %v", openaiErr)
	}

	relations, err := parseSuggestRelationsResponse(resp)
	if err != nil {
		return nil, err
	}

	relations = validateRelations(relations, entities)

	return &model.SuggestRelationsResponse{Relations: relations}, nil
}

func buildSuggestRelationsSystemPrompt(entities []*model.EntityDefinition) string {
	var entityDescs []string
	for _, e := range entities {
		propsStr := strings.Join(e.Properties, "、")
		entityDescs = append(entityDescs, fmt.Sprintf("- %s（属性：%s）", e.Name, propsStr))
	}

	return fmt.Sprintf(`你是一个知识图谱建模专家。请根据给定的实体类型，推断它们之间可能存在的关系。

## 实体类型定义
%s

## 推断规则
1. **关系推断**：
   - 基于实体类型的语义和属性，推断合理的业务关系
   - 关系谓词应简洁明确，如"包含"、"属于"、"关联"、"签署方"等
   - 只推断有明确业务含义的关系

2. **约束条件**：
   - source 和 target 必须是上述实体类型之一
   - 不要重复相同的关系
   - 如果无法推断出合理的关系，返回空数组

## 输出格式
只输出 JSON，不要 Markdown 包裹，不要解释。格式如下：
{
  "relations": [
    {"source": "实体类型A", "predicate": "关系谓词", "target": "实体类型B"}
  ]
}`, strings.Join(entityDescs, "\n"))
}

func buildSuggestRelationsUserPrompt(entities []*model.EntityDefinition, contextHint string) string {
	entityNames := make([]string, len(entities))
	for i, e := range entities {
		entityNames[i] = e.Name
	}

	prompt := fmt.Sprintf("请为以下实体类型推断可能的关系：%s", strings.Join(entityNames, "、"))
	if contextHint != "" {
		prompt += fmt.Sprintf("\n\n上下文信息：%s", contextHint)
	}
	return prompt
}

func parseSuggestRelationsResponse(content string) ([]*model.RelationDefinition, error) {
	var resp suggestRelationsResponse
	if err := common.ParseLLMJSONInto(context.Background(), content, &resp); err != nil {
		return nil, fmt.Errorf("解析 LLM 响应失败: %v", err)
	}

	return resp.Relations, nil
}

func validateRelations(relations []*model.RelationDefinition, entities []*model.EntityDefinition) []*model.RelationDefinition {
	entityNames := make(map[string]bool)
	for _, e := range entities {
		entityNames[e.Name] = true
	}

	var validRelations []*model.RelationDefinition
	for _, r := range relations {
		if entityNames[r.Source] && entityNames[r.Target] {
			validRelations = append(validRelations, r)
		}
	}
	return validRelations
}
