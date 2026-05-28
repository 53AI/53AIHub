package rag

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
	"gorm.io/gorm"
)

const graphTemplateAutogenMaxTokens = 8000

type graphTemplateAutogenExecutor interface {
	Generate(ctx context.Context, systemPrompt, userPrompt string, maxTokens int) (string, error)
}

type graphTemplateAutogenLLMExecutor struct {
	contentService *ContentGeneratorService
	channel        *model.Channel
	modelName      string
}

type graphTemplateAutogenResponse struct {
	Name        string                      `json:"name"`
	Description string                      `json:"description"`
	Entities    []*model.EntityDefinition   `json:"entities"`
	Relations   []*model.RelationDefinition `json:"relations"`
}

func (e *graphTemplateAutogenLLMExecutor) Generate(ctx context.Context, systemPrompt, userPrompt string, maxTokens int) (string, error) {
	if e == nil || e.contentService == nil || e.channel == nil {
		return "", fmt.Errorf("图谱模板自动生成执行器未初始化")
	}

	request := &relaymodel.GeneralOpenAIRequest{
		Model:     e.modelName,
		MaxTokens: maxTokens,
		Messages: []relaymodel.Message{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
	}

	resp, err, openaiErr := e.contentService.TestChannel(ctx, e.channel, request)
	if err != nil {
		return "", fmt.Errorf("图谱模板自动生成失败: %v", err)
	}
	if openaiErr != nil {
		return "", fmt.Errorf("图谱模板自动生成失败: %v", openaiErr)
	}

	return resp, nil
}

func newGraphTemplateAutogenExecutor(db *gorm.DB, eid int64) (graphTemplateAutogenExecutor, error) {
	chunkCfgService := NewChunkConfigService(db)
	config, err := chunkCfgService.GetConfig(eid, nil, "default")
	if err != nil {
		logger.SysError(fmt.Sprintf("Failed to get graph template autogen LLM config: %v", err))
		return nil, fmt.Errorf("获取模型配置失败: %v", err)
	}

	selectedChannel, selectedModelName, selectErr := config.SelectPipelineLLM()
	if selectErr != nil {
		return nil, fmt.Errorf("未配置推理模型: %v", selectErr)
	}

	return &graphTemplateAutogenLLMExecutor{
		contentService: NewContentGeneratorService(db),
		channel:        selectedChannel,
		modelName:      selectedModelName,
	}, nil
}

func buildGraphTemplateAutogenSystemPrompt() string {
	return `你是一个知识图谱模板设计专家，不是信息抽取器。
你的任务是根据业务文本先判断业务场景，再设计“图谱模板”的实体类型、属性和关系类型。
请把文本中的具体内容抽象成可复用的模板，而不是直接把原文里的名词、人名、时间、地点当成实体输出。

## 设计原则
1. 先判断文档/场景类型，例如会议纪要、合同、审批单、项目计划、需求说明。
2. 再围绕该场景设计模板实体类型，而不是抽取原文中的实例。
3. 实体应该是“类型/角色/对象/事件”，属性应该是这个类型的结构化字段。
4. 如果判断是会议场景，优先考虑设计类似“会议、参会人、议题、决议、任务、纪要”等实体类型。
5. 会议中的人名、日期、地点、具体事项通常应作为属性值或文本内容，不应直接充当模板实体。
6. 关系应该表达模板层面的语义，例如“包含、参与、形成、分配、属于、负责”，不是逐字复述原文。

## 输出要求
1. 只输出 JSON，不要输出解释、前言、Markdown 或代码块标记。
2. 必须严格输出以下结构：
{
  "name": "模板名称",
  "description": "模板说明",
  "entities": [
    {"name": "实体名", "properties": ["属性1", "属性2"], "order_num": 1}
  ],
  "relations": [
    {"source": "实体A", "predicate": "关系", "target": "实体B"}
  ]
}
3. entities 至少包含 2 个，relations 只保留有明确语义的关系。
4. relations 必须只引用本次输出的 entities 中已经存在的实体，避免出现孤立关系。
5. name 和 description 要体现“模板设计结果”，不要写成“原文抽取结果”。
6. 模板 name 必须尽量简短，建议控制在 6-12 个汉字以内，优先使用场景名或场景 + 核心对象，不要写成长句。
7. 如果文本信息不足，返回最合理的最小可用结果，不要编造无依据的内容。
8. 目标是“生成模板 JSON”，不是“抽取文本中的实体列表”。`
}

func buildGraphTemplateAutogenUserPrompt(content string, maxTokens int) string {
	content = strings.TrimSpace(content)
	if maxTokens <= 0 {
		maxTokens = graphTemplateAutogenMaxTokens
	}

	return fmt.Sprintf(`请根据以下业务文本生成图谱模板创建参数。

## 约束
- 输入文本按后端处理的安全边界控制在约 8k token（%d token）。
- 如果文本超过该边界，后端会自动分片处理，前端不会看到切分过程。
- 先判断这段文本属于什么业务场景或文档类型，再设计对应的图谱模板。
- 不要直接把原文中的人名、时间、地点、编号、具体事项当成实体类型。
- 模板 name 要短，尽量用 6-12 个汉字表达，优先用“场景名”或“场景 + 核心对象”。
- 如果内容像会议纪要，请优先围绕“会议”这个场景设计实体和属性，例如会议、参会人、议题、决议、任务、纪要。
- 输出只保留最终结果，不要输出分析过程。

## 业务文本
%s`, maxTokens, content)
}

func buildGraphTemplateAutogenChunkUserPrompt(content string, chunkIndex, chunkTotal int) string {
	return fmt.Sprintf(`## 分片信息
- 当前分片：%d/%d

%s`, chunkIndex, chunkTotal, buildGraphTemplateAutogenUserPrompt(content, graphTemplateAutogenMaxTokens))
}

func parseGraphTemplateAutogenResponse(ctx context.Context, content string) (*graphTemplateAutogenResponse, error) {
	var resp graphTemplateAutogenResponse
	if err := common.ParseLLMJSONInto(ctx, content, &resp); err != nil {
		return nil, fmt.Errorf("解析图谱模板参数失败: %w", err)
	}
	normalizeGraphTemplateAutogenResponse(&resp)
	if err := validateGraphTemplateAutogenResponse(&resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func splitTextForGraphTemplateAutogen(content string, maxTokens int) ([]string, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil, fmt.Errorf("文本内容不能为空")
	}
	if maxTokens <= 0 {
		maxTokens = graphTemplateAutogenMaxTokens
	}

	tokenizer := NewTokenizerService()
	return tokenizer.SplitTextByTokens(content, maxTokens, 0)
}

func normalizeGraphTemplateAutogenResponse(resp *graphTemplateAutogenResponse) {
	if resp == nil {
		return
	}

	resp.Name = strings.TrimSpace(resp.Name)
	resp.Description = strings.TrimSpace(resp.Description)

	entityMap := make(map[string]*model.EntityDefinition)
	entities := make([]*model.EntityDefinition, 0, len(resp.Entities))
	for idx, entity := range resp.Entities {
		if entity == nil {
			continue
		}
		entity.Name = strings.TrimSpace(entity.Name)
		if entity.Name == "" {
			continue
		}

		seenProps := make(map[string]struct{})
		props := make([]string, 0, len(entity.Properties))
		for _, prop := range entity.Properties {
			prop = strings.TrimSpace(prop)
			if prop == "" {
				continue
			}
			if _, ok := seenProps[prop]; ok {
				continue
			}
			seenProps[prop] = struct{}{}
			props = append(props, prop)
		}
		entity.Properties = props
		if entity.OrderNum <= 0 {
			entity.OrderNum = idx + 1
		}

		if existing, ok := entityMap[entity.Name]; ok {
			existing.OrderNum = minInt(existing.OrderNum, entity.OrderNum)
			existingProps := make(map[string]struct{}, len(existing.Properties))
			for _, prop := range existing.Properties {
				existingProps[prop] = struct{}{}
			}
			for _, prop := range entity.Properties {
				if _, ok := existingProps[prop]; ok {
					continue
				}
				existing.Properties = append(existing.Properties, prop)
			}
			continue
		}

		entityMap[entity.Name] = entity
		entities = append(entities, entity)
	}
	resp.Entities = entities

	relationMap := make(map[string]*model.RelationDefinition)
	relations := make([]*model.RelationDefinition, 0, len(resp.Relations))
	for _, relation := range resp.Relations {
		if relation == nil {
			continue
		}
		relation.Source = strings.TrimSpace(relation.Source)
		relation.Predicate = strings.TrimSpace(relation.Predicate)
		relation.Target = strings.TrimSpace(relation.Target)
		if relation.Source == "" || relation.Predicate == "" || relation.Target == "" {
			continue
		}
		if entityMap[relation.Source] == nil || entityMap[relation.Target] == nil {
			continue
		}

		key := relation.Source + "|" + relation.Predicate + "|" + relation.Target
		if _, ok := relationMap[key]; ok {
			continue
		}

		relationMap[key] = relation
		relations = append(relations, relation)
	}
	resp.Relations = relations
}

func validateGraphTemplateAutogenResponse(resp *graphTemplateAutogenResponse) error {
	if resp == nil {
		return fmt.Errorf("图谱模板生成结果不能为空")
	}
	if err := model.ValidateEntities(resp.Entities); err != nil {
		return err
	}

	entityNames := make(map[string]bool, len(resp.Entities))
	for _, entity := range resp.Entities {
		entityNames[entity.Name] = true
	}
	if err := model.ValidateRelations(resp.Relations, entityNames); err != nil {
		return err
	}
	return nil
}

func mergeGraphTemplateAutogenResponses(partials []*graphTemplateAutogenResponse) *graphTemplateAutogenResponse {
	merged := &graphTemplateAutogenResponse{}
	if len(partials) == 0 {
		return merged
	}

	merged.Name = partials[0].Name
	merged.Description = partials[0].Description

	entityMap := make(map[string]*model.EntityDefinition)
	relationMap := make(map[string]*model.RelationDefinition)
	for _, partial := range partials {
		if partial == nil {
			continue
		}
		if len([]rune(partial.Description)) > len([]rune(merged.Description)) {
			merged.Description = partial.Description
		}
		if merged.Name == "" {
			merged.Name = partial.Name
		}

		for _, entity := range partial.Entities {
			if entity == nil || strings.TrimSpace(entity.Name) == "" {
				continue
			}
			key := entity.Name
			if existing, ok := entityMap[key]; ok {
				existing.OrderNum = minInt(existing.OrderNum, entity.OrderNum)
				seen := make(map[string]struct{}, len(existing.Properties))
				for _, prop := range existing.Properties {
					seen[prop] = struct{}{}
				}
				for _, prop := range entity.Properties {
					prop = strings.TrimSpace(prop)
					if prop == "" {
						continue
					}
					if _, ok := seen[prop]; ok {
						continue
					}
					seen[prop] = struct{}{}
					existing.Properties = append(existing.Properties, prop)
				}
				continue
			}
			copied := *entity
			entityMap[key] = &copied
		}

		for _, relation := range partial.Relations {
			if relation == nil {
				continue
			}
			key := strings.TrimSpace(relation.Source) + "|" + strings.TrimSpace(relation.Predicate) + "|" + strings.TrimSpace(relation.Target)
			if _, ok := relationMap[key]; ok {
				continue
			}
			copied := *relation
			relationMap[key] = &copied
		}
	}

	merged.Entities = make([]*model.EntityDefinition, 0, len(entityMap))
	for _, entity := range entityMap {
		merged.Entities = append(merged.Entities, entity)
	}
	merged.Relations = make([]*model.RelationDefinition, 0, len(relationMap))
	for _, relation := range relationMap {
		merged.Relations = append(merged.Relations, relation)
	}

	return merged
}

func minInt(a, b int) int {
	if a <= 0 {
		return b
	}
	if b <= 0 {
		return a
	}
	if a < b {
		return a
	}
	return b
}

func previewTemplateText(content string, limit int) string {
	if limit <= 0 {
		limit = 240
	}

	runes := []rune(strings.TrimSpace(content))
	if len(runes) <= limit {
		return string(runes)
	}

	return string(runes[:limit]) + "..."
}

// GenerateGraphTemplateFromContent 根据业务文本自动生成并持久化图谱模板。
func GenerateGraphTemplateFromContent(ctx context.Context, db *gorm.DB, eid int64, content string) (*model.GraphTemplate, error) {
	if db == nil {
		return nil, fmt.Errorf("db is nil")
	}

	executor, err := newGraphTemplateAutogenExecutor(db, eid)
	if err != nil {
		return nil, err
	}

	chunks, err := splitTextForGraphTemplateAutogen(content, graphTemplateAutogenMaxTokens)
	if err != nil {
		return nil, err
	}

	logger.Debugf(ctx, "【工具执行】图谱模板自动生成开始: 文本字符数=%d, 分片数=%d, token上限=%d",
		len([]rune(content)), len(chunks), graphTemplateAutogenMaxTokens)

	if len(chunks) == 1 {
		respText, err := executor.Generate(ctx, buildGraphTemplateAutogenSystemPrompt(), buildGraphTemplateAutogenUserPrompt(chunks[0], graphTemplateAutogenMaxTokens), 4096)
		if err != nil {
			return nil, err
		}

		resp, err := parseGraphTemplateAutogenResponse(ctx, respText)
		if err != nil {
			return nil, err
		}

		var template model.GraphTemplate
		if err := db.Where("eid = ? AND name = ?", eid, resp.Name).First(&template).Error; err == nil {
			logger.Warnf(ctx, "【图谱生成】自动生成模板名称已存在，复用已有模板: template_id=%d, template_name=%s", template.ID, template.Name)
			return &template, nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}

		template = model.GraphTemplate{
			Eid:         eid,
			Name:        resp.Name,
			Description: resp.Description,
		}
		if err := template.SetEntities(resp.Entities); err != nil {
			return nil, err
		}
		if err := template.SetRelations(resp.Relations); err != nil {
			return nil, err
		}
		if err := db.Create(&template).Error; err != nil {
			return nil, err
		}
		return &template, nil
	}

	partials := make([]*graphTemplateAutogenResponse, 0, len(chunks))
	for idx, chunk := range chunks {
		logger.Debugf(ctx, "【工具执行】图谱模板自动生成分片处理: 分片序号=%d, 总分片数=%d, 分片字符数=%d, 分片预览=%s",
			idx+1, len(chunks), len([]rune(chunk)), previewTemplateText(chunk, 240))

		respText, err := executor.Generate(ctx, buildGraphTemplateAutogenSystemPrompt(), buildGraphTemplateAutogenChunkUserPrompt(chunk, idx+1, len(chunks)), 4096)
		if err != nil {
			return nil, err
		}

		partial, err := parseGraphTemplateAutogenResponse(ctx, respText)
		if err != nil {
			return nil, err
		}
		partials = append(partials, partial)
		logger.Debugf(ctx, "【工具执行】图谱模板自动生成分片解析完成: 分片序号=%d, 模板名=%s, 实体数=%d, 关系数=%d",
			idx+1, partial.Name, len(partial.Entities), len(partial.Relations))
	}

	merged := mergeGraphTemplateAutogenResponses(partials)
	if err := validateGraphTemplateAutogenResponse(merged); err != nil {
		return nil, err
	}

	var template model.GraphTemplate
	if err := db.Where("eid = ? AND name = ?", eid, merged.Name).First(&template).Error; err == nil {
		logger.Warnf(ctx, "【图谱生成】自动生成模板名称已存在，复用已有模板: template_id=%d, template_name=%s", template.ID, template.Name)
		return &template, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	template = model.GraphTemplate{
		Eid:         eid,
		Name:        merged.Name,
		Description: merged.Description,
	}
	if err := template.SetEntities(merged.Entities); err != nil {
		return nil, err
	}
	if err := template.SetRelations(merged.Relations); err != nil {
		return nil, err
	}
	if err := db.Create(&template).Error; err != nil {
		return nil, err
	}

	logger.Debugf(ctx, "【工具执行】图谱模板自动生成完成: 模板名=%s, 实体数=%d, 关系数=%d",
		template.Name, len(merged.Entities), len(merged.Relations))
	return &template, nil
}
