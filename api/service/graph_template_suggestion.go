package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
	"gorm.io/gorm"
)

const (
	graphTemplateSuggestionMaxTokens = 8000
)

// SuggestTemplateParamsResponse 图谱模板参数生成结果
type SuggestTemplateParamsResponse struct {
	Name        string                      `json:"name"`
	Description string                      `json:"description"`
	Entities    []*model.EntityDefinition   `json:"entities"`
	Relations   []*model.RelationDefinition `json:"relations"`
}

func parseSuggestTemplateParamsResponse(content string) (*SuggestTemplateParamsResponse, error) {
	return parseSuggestTemplateParamsResponseWithContext(context.Background(), content)
}

func parseSuggestTemplateParamsResponseWithContext(ctx context.Context, content string) (*SuggestTemplateParamsResponse, error) {
	var resp SuggestTemplateParamsResponse
	if err := common.ParseLLMJSONInto(ctx, content, &resp); err != nil {
		return nil, fmt.Errorf("解析图谱模板参数失败: %w", err)
	}
	normalizeSuggestTemplateParamsResponse(&resp)
	filterSuggestTemplateRelations(ctx, &resp)
	if err := validateSuggestTemplateParamsEntities(&resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func splitTextForTemplateSuggestion(content string, maxTokens int) ([]string, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil, fmt.Errorf("文本内容不能为空")
	}
	if maxTokens <= 0 {
		maxTokens = graphTemplateSuggestionMaxTokens
	}

	tokenizer := rag.NewTokenizerService()
	return tokenizer.SplitTextByTokens(content, maxTokens, 0)
}

func buildSuggestTemplateSystemPrompt() string {
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
7. 必须返回 name 字段，不能留空；如果一时无法起更准确的名字，也要基于本次输出的实体名称组合出一个最小可用名称。
8. 如果文本信息不足，返回最合理的最小可用结果，不要编造无依据的内容。
9. 目标是“生成模板 JSON”，不是“抽取文本中的实体列表”。`
}

func buildSuggestTemplateUserPrompt(content string, maxTokens int) string {
	content = strings.TrimSpace(content)
	if maxTokens <= 0 {
		maxTokens = graphTemplateSuggestionMaxTokens
	}

	return fmt.Sprintf(`请根据以下业务文本生成图谱模板创建参数。

## 约束
- 输入文本按后端处理的安全边界控制在约 8k token（%d token）。
- 如果文本超过该边界，后端会自动分片处理，前端不会看到切分过程。
- 先判断这段文本属于什么业务场景或文档类型，再设计对应的图谱模板。
- 不要直接把原文中的人名、时间、地点、编号、具体事项当成实体类型。
- 模板 name 要短，尽量用 6-12 个汉字表达，优先用“场景名”或“场景 + 核心对象”。
- 如果内容像会议纪要，请优先围绕“会议”这个场景设计实体和属性，例如会议、参会人、议题、决议、任务、纪要。
- 必须返回 name 字段，不能留空；如果一时无法起更准确的名字，也要基于本次输出的实体名称组合出一个最小可用名称。
- 输出只保留最终结果，不要输出分析过程。

## 业务文本
%s`, maxTokens, content)
}

type graphTemplateSuggestionExecutor interface {
	Generate(ctx context.Context, systemPrompt, userPrompt string, maxTokens int) (string, error)
}

type graphTemplateSuggestionLLMExecutor struct {
	contentService *rag.ContentGeneratorService
	channel        *model.Channel
	modelName      string
}

func (e *graphTemplateSuggestionLLMExecutor) Generate(ctx context.Context, systemPrompt, userPrompt string, maxTokens int) (string, error) {
	if e == nil || e.contentService == nil || e.channel == nil {
		return "", fmt.Errorf("图谱模板生成执行器未初始化")
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
		return "", fmt.Errorf("图谱模板参数生成失败: %v", err)
	}
	if openaiErr != nil {
		return "", fmt.Errorf("图谱模板参数生成失败: %v", openaiErr)
	}

	return resp, nil
}

// SuggestTemplateParams 根据长文本生成图谱模板创建参数。
func SuggestTemplateParams(ctx context.Context, db *gorm.DB, eid int64, content string) (*SuggestTemplateParamsResponse, error) {
	executor, err := newGraphTemplateSuggestionExecutor(db, eid)
	if err != nil {
		return nil, err
	}

	return suggestTemplateParamsWithExecutor(ctx, content, executor)
}

func newGraphTemplateSuggestionExecutor(db *gorm.DB, eid int64) (graphTemplateSuggestionExecutor, error) {
	chunkCfgService := rag.NewChunkConfigService(db)
	config, err := chunkCfgService.GetConfig(eid, nil, "default")
	if err != nil {
		logger.SysError(fmt.Sprintf("Failed to get graph template suggestion LLM config: %v", err))
		return nil, fmt.Errorf("获取模型配置失败: %v", err)
	}

	if config.LogicChannel == nil || config.LogicModelName == nil {
		return nil, fmt.Errorf("未配置逻辑推理模型")
	}

	return &graphTemplateSuggestionLLMExecutor{
		contentService: rag.NewContentGeneratorService(db),
		channel:        config.LogicChannel,
		modelName:      *config.LogicModelName,
	}, nil
}

func suggestTemplateParamsWithExecutor(ctx context.Context, content string, executor graphTemplateSuggestionExecutor) (*SuggestTemplateParamsResponse, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	content = strings.TrimSpace(content)
	if content == "" {
		return nil, fmt.Errorf("文本内容不能为空")
	}
	if executor == nil {
		return nil, fmt.Errorf("图谱模板生成执行器不能为空")
	}

	chunks, err := splitTextForTemplateSuggestion(content, graphTemplateSuggestionMaxTokens)
	if err != nil {
		return nil, err
	}

	logger.Debugf(ctx, "【工具执行】图谱模板参数生成开始: 文本字符数=%d, 分片数=%d, token上限=%d",
		len([]rune(content)), len(chunks), graphTemplateSuggestionMaxTokens)

	if len(chunks) == 1 {
		logger.Debugf(ctx, "【工具执行】图谱模板参数生成使用单分片路径")
		respText, err := executor.Generate(ctx, buildSuggestTemplateSystemPrompt(), buildSuggestTemplateUserPrompt(chunks[0], graphTemplateSuggestionMaxTokens), 4096)
		if err != nil {
			return nil, err
		}

		resp, err := parseSuggestTemplateParamsResponseWithContext(ctx, respText)
		if err != nil {
			return nil, err
		}
		if err := finalizeSuggestTemplateParamsResponse(resp); err != nil {
			return nil, err
		}

		logger.Debugf(ctx, "【工具执行】图谱模板参数生成完成: 模板名=%s, 实体数=%d, 关系数=%d",
			resp.Name, len(resp.Entities), len(resp.Relations))
		return resp, nil
	}

	partials := make([]*SuggestTemplateParamsResponse, 0, len(chunks))
	for idx, chunk := range chunks {
		logger.Debugf(ctx, "【工具执行】图谱模板参数分片处理: 分片序号=%d, 总分片数=%d, 分片字符数=%d, 分片预览=%s",
			idx+1, len(chunks), len([]rune(chunk)), previewTemplateText(chunk, 240))

		respText, err := executor.Generate(ctx, buildSuggestTemplateSystemPrompt(), buildSuggestTemplateChunkUserPrompt(chunk, idx+1, len(chunks)), 4096)
		if err != nil {
			return nil, err
		}

		partial, err := parseSuggestTemplateParamsResponseWithContext(ctx, respText)
		if err != nil {
			return nil, err
		}
		partials = append(partials, partial)
		logger.Debugf(ctx, "【工具执行】图谱模板参数分片解析完成: 分片序号=%d, 模板名=%s, 实体数=%d, 关系数=%d",
			idx+1, partial.Name, len(partial.Entities), len(partial.Relations))
	}

	merged := mergeSuggestTemplateParamsResponses(partials)
	mergedJSON, err := json.MarshalIndent(merged, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("合并图谱模板候选结果失败: %v", err)
	}

	logger.Debugf(ctx, "【工具执行】图谱模板参数候选合并完成: 模板名=%s, 实体数=%d, 关系数=%d",
		merged.Name, len(merged.Entities), len(merged.Relations))

	respText, err := executor.Generate(ctx, buildSuggestTemplateSynthesisSystemPrompt(), buildSuggestTemplateSynthesisUserPrompt(string(mergedJSON), len(partials)), 4096)
	if err != nil {
		logger.Debugf(ctx, "【工具执行】图谱模板参数汇总调用失败，回退使用合并结果: err=%v", err)
		if err := validateSuggestTemplateParamsResponse(merged); err != nil {
			return nil, err
		}
		return merged, nil
	}

	resp, parseErr := parseSuggestTemplateParamsResponseWithContext(ctx, respText)
	if parseErr != nil {
		logger.Debugf(ctx, "【工具执行】图谱模板参数汇总解析失败，回退使用合并结果: err=%v", parseErr)
		if err := finalizeSuggestTemplateParamsResponse(merged); err != nil {
			return nil, err
		}
		return merged, nil
	}

	if err := finalizeSuggestTemplateParamsResponse(resp); err != nil {
		logger.Debugf(ctx, "【工具执行】图谱模板参数汇总名称补全失败，回退使用合并结果: err=%v", err)
		if err := finalizeSuggestTemplateParamsResponse(merged); err != nil {
			return nil, err
		}
		return merged, nil
	}

	logger.Debugf(ctx, "【工具执行】图谱模板参数生成完成: 模板名=%s, 实体数=%d, 关系数=%d",
		resp.Name, len(resp.Entities), len(resp.Relations))
	return resp, nil
}

func buildSuggestTemplateChunkUserPrompt(content string, chunkIndex, chunkTotal int) string {
	return fmt.Sprintf(`## 分片信息
- 当前分片：%d/%d

%s`, chunkIndex, chunkTotal, buildSuggestTemplateUserPrompt(content, graphTemplateSuggestionMaxTokens))
}

func buildSuggestTemplateSynthesisSystemPrompt() string {
	return `你是一个知识图谱模板结果汇总专家。
请根据分片候选结果，合并、去重、排序并输出最终可创建图谱模板的 JSON。
请保持“模板设计”视角，不要退回到原文实体抽取。
模板 name 要短，尽量保留为场景名或场景 + 核心对象，不要拼接长句。
输出要求与字段结构与前置生成阶段一致，只输出 JSON，不要输出解释。`
}

func buildSuggestTemplateSynthesisUserPrompt(candidateJSON string, chunkCount int) string {
	return fmt.Sprintf(`以下是 %d 个文本分片得到的候选结果，请汇总为一个最终模板参数。

## 汇总要求
1. 合并重复实体与重复关系。
2. 保留更完整、更具体的命名与属性。
3. name 和 description 只输出最终结果，不要保留分片痕迹。
4. 只输出最终 JSON，不要解释。

## 分片候选结果
%s`, chunkCount, candidateJSON)
}

func normalizeSuggestTemplateParamsResponse(resp *SuggestTemplateParamsResponse) {
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

		key := relation.Source + "|" + relation.Predicate + "|" + relation.Target
		if _, ok := relationMap[key]; ok {
			continue
		}
		relationMap[key] = relation
		relations = append(relations, relation)
	}

	resp.Relations = relations
}

func filterSuggestTemplateRelations(ctx context.Context, resp *SuggestTemplateParamsResponse) {
	if resp == nil {
		return
	}

	entityNames := make(map[string]struct{}, len(resp.Entities))
	for _, entity := range resp.Entities {
		if entity == nil {
			continue
		}
		name := strings.TrimSpace(entity.Name)
		if name == "" {
			continue
		}
		entityNames[name] = struct{}{}
	}

	filtered := make([]*model.RelationDefinition, 0, len(resp.Relations))
	for _, relation := range resp.Relations {
		if relation == nil {
			continue
		}

		source := strings.TrimSpace(relation.Source)
		predicate := strings.TrimSpace(relation.Predicate)
		target := strings.TrimSpace(relation.Target)
		if source == "" || predicate == "" || target == "" {
			continue
		}
		if _, ok := entityNames[source]; !ok {
			logger.Debugf(ctx, "【工具执行】丢弃无效关系: source 不存在, source=%s, predicate=%s, target=%s", source, predicate, target)
			continue
		}
		if _, ok := entityNames[target]; !ok {
			logger.Debugf(ctx, "【工具执行】丢弃无效关系: target 不存在, source=%s, predicate=%s, target=%s", source, predicate, target)
			continue
		}

		relation.Source = source
		relation.Predicate = predicate
		relation.Target = target
		filtered = append(filtered, relation)
	}

	resp.Relations = filtered
}

func validateSuggestTemplateParamsResponse(resp *SuggestTemplateParamsResponse) error {
	if resp == nil {
		return fmt.Errorf("图谱模板生成结果不能为空")
	}
	resp.Name = strings.TrimSpace(resp.Name)
	resp.Description = strings.TrimSpace(resp.Description)
	if resp.Name == "" {
		return fmt.Errorf("模板名称不能为空")
	}

	if err := model.ValidateEntities(resp.Entities); err != nil {
		return err
	}

	return nil
}

func validateSuggestTemplateParamsEntities(resp *SuggestTemplateParamsResponse) error {
	if resp == nil {
		return fmt.Errorf("图谱模板生成结果不能为空")
	}

	return model.ValidateEntities(resp.Entities)
}

func finalizeSuggestTemplateParamsResponse(resp *SuggestTemplateParamsResponse) error {
	if resp == nil {
		return fmt.Errorf("图谱模板生成结果不能为空")
	}

	normalizeSuggestTemplateParamsResponse(resp)
	if resp.Name == "" {
		resp.Name = buildSuggestTemplateFallbackName(resp.Entities)
	}
	if resp.Name == "" {
		return fmt.Errorf("模板名称不能为空")
	}

	if err := model.ValidateEntities(resp.Entities); err != nil {
		return err
	}

	return nil
}

func mergeSuggestTemplateParamsResponses(partials []*SuggestTemplateParamsResponse) *SuggestTemplateParamsResponse {
	merged := &SuggestTemplateParamsResponse{}

	entityMap := make(map[string]*model.EntityDefinition)
	relationMap := make(map[string]*model.RelationDefinition)

	for _, partial := range partials {
		if partial == nil {
			continue
		}

		if merged.Name == "" && strings.TrimSpace(partial.Name) != "" {
			merged.Name = strings.TrimSpace(partial.Name)
		}
		if merged.Description == "" && strings.TrimSpace(partial.Description) != "" {
			merged.Description = strings.TrimSpace(partial.Description)
		}

		for _, entity := range partial.Entities {
			if entity == nil {
				continue
			}
			entityName := strings.TrimSpace(entity.Name)
			if entityName == "" {
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

			if existing, ok := entityMap[entityName]; ok {
				existingProps := make(map[string]struct{}, len(existing.Properties))
				for _, prop := range existing.Properties {
					existingProps[prop] = struct{}{}
				}
				for _, prop := range props {
					if _, ok := existingProps[prop]; ok {
						continue
					}
					existing.Properties = append(existing.Properties, prop)
				}
				if entity.OrderNum > 0 && (existing.OrderNum <= 0 || entity.OrderNum < existing.OrderNum) {
					existing.OrderNum = entity.OrderNum
				}
				continue
			}

			cloned := &model.EntityDefinition{
				Name:       entityName,
				Properties: props,
				OrderNum:   entity.OrderNum,
			}
			entityMap[entityName] = cloned
			merged.Entities = append(merged.Entities, cloned)
		}

		for _, relation := range partial.Relations {
			if relation == nil {
				continue
			}

			source := strings.TrimSpace(relation.Source)
			predicate := strings.TrimSpace(relation.Predicate)
			target := strings.TrimSpace(relation.Target)
			if source == "" || predicate == "" || target == "" {
				continue
			}

			key := source + "|" + predicate + "|" + target
			if _, ok := relationMap[key]; ok {
				continue
			}

			cloned := &model.RelationDefinition{
				Source:    source,
				Predicate: predicate,
				Target:    target,
			}
			relationMap[key] = cloned
			merged.Relations = append(merged.Relations, cloned)
		}
	}

	normalizeSuggestTemplateParamsResponse(merged)
	return merged
}

func buildSuggestTemplateFallbackName(entities []*model.EntityDefinition) string {
	names := make([]string, 0, 2)
	seen := make(map[string]struct{})

	for _, entity := range entities {
		if entity == nil {
			continue
		}

		name := strings.TrimSpace(entity.Name)
		if name == "" {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		names = append(names, name)
		if len(names) >= 2 {
			break
		}
	}

	if len(names) == 0 {
		return ""
	}

	return strings.Join(names, "、") + "模板"
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
