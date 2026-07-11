package rag

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
	"gorm.io/gorm"
)

// FatalError 致命错误，需要立即终止整个图谱生成
type FatalError struct {
	Err error
}

func (e *FatalError) Error() string {
	return e.Err.Error()
}

func (e *FatalError) Unwrap() error {
	return e.Err
}

// IsFatalError 检查是否为致命错误
func IsFatalError(err error) bool {
	_, ok := err.(*FatalError)
	return ok
}

// newFatalError 创建致命错误
func newFatalError(err error) error {
	return &FatalError{Err: err}
}

// GraphExtractionService 图谱抽取服务
type GraphExtractionService struct {
	db              *gorm.DB
	contentService  *ContentGeneratorService
	chunkCfgService *ChunkConfigService
}

// NewGraphExtractionService 创建图谱抽取服务
func NewGraphExtractionService(db *gorm.DB) *GraphExtractionService {
	return &GraphExtractionService{
		db:              db,
		contentService:  NewContentGeneratorService(db),
		chunkCfgService: NewChunkConfigService(db),
	}
}

// ExtractedGraphEntity 抽取的图谱实体
type ExtractedGraphEntity struct {
	EntityName string            `json:"entity_name"` // 实体类型名（来自模板定义）
	Name       string            `json:"name"`        // 实体实例名（原文中的表述）
	Properties map[string]string `json:"properties"`  // 属性键值对

	// 证据化字段（索引阶段只采集，不强依赖落库；后续查询层可消费）
	Aliases    []string `json:"aliases,omitempty"`
	Evidence   string   `json:"evidence,omitempty"`   // 必须来自原文的证据片段
	Confidence float64  `json:"confidence,omitempty"` // 0~1
	ChunkIDs   []int64  `json:"chunk_ids,omitempty"`  // 该实体关联的分片ID（LLM 可能返回）
}

// ExtractedGraphRelation 抽取的图谱关系
type ExtractedGraphRelation struct {
	SourceName string `json:"source_name"` // 源实体实例名
	Predicate  string `json:"predicate"`   // 关系谓词
	TargetName string `json:"target_name"` // 目标实体实例名

	Evidence   string  `json:"evidence,omitempty"`   // 必须来自原文的证据片段
	Confidence float64 `json:"confidence,omitempty"` // 0~1
	ChunkIDs   []int64 `json:"chunk_ids,omitempty"`  // 该关系关联的分片ID
}

// graphExtractionResponse LLM返回的抽取结果
type graphExtractionResponse struct {
	Entities  []ExtractedGraphEntity   `json:"entities"`
	Relations []ExtractedGraphRelation `json:"relations"`
}

const (
	graphExtractionMaxTokens       = 16384
	graphExtractionMaxContentRunes = 16384
)

// ExtractForChunk 对单个分片进行图谱抽取
func (s *GraphExtractionService) ExtractForChunk(ctx context.Context, eid int64, template *model.GraphTemplate, chunk *model.DocumentChunk) ([]ExtractedGraphEntity, []ExtractedGraphRelation, error) {
	// 获取分块配置
	cfg, err := s.loadChunkConfig(ctx, eid, chunk)
	if err != nil {
		return nil, nil, err
	}

	// 选择LLM
	selectedChannel, selectedModelName, err := s.selectLLM(cfg)
	if err != nil {
		return nil, nil, err
	}

	// 构建Prompt
	contentForExtraction := trimToMaxRunes(strings.TrimSpace(chunk.Content), graphExtractionMaxContentRunes)
	if len([]rune(strings.TrimSpace(chunk.Content))) > len([]rune(contentForExtraction)) {
		logger.Debugf(ctx, "【图谱生成】分片内容已截断: chunk_id=%d, original_runes=%d, truncated_runes=%d",
			chunk.ID, len([]rune(strings.TrimSpace(chunk.Content))), len([]rune(contentForExtraction)))
	}
	systemPrompt := s.buildGraphExtractionSystemPrompt(template)
	userPrompt := s.buildGraphExtractionUserPrompt(contentForExtraction)
	logger.Debugf(ctx, "【图谱生成】开始抽取分片: chunk_id=%d, model=%s, system_prompt_chars=%d, user_prompt_chars=%d",
		chunk.ID, selectedModelName, len(systemPrompt), len(userPrompt))

	timeoutCtx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()

	chatReq := &relaymodel.GeneralOpenAIRequest{
		Model:     selectedModelName,
		MaxTokens: graphExtractionMaxTokens,
		Messages: []relaymodel.Message{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
	}

	resp, callErr, openaiErr := s.contentService.testChannel(timeoutCtx, selectedChannel, chatReq)
	if callErr != nil || openaiErr != nil {
		if openaiErr != nil {
			errMsg := fmt.Sprintf("图谱抽取 LLM 调用失败: model: %s, message: %s, type: %s, code: %v", selectedModelName, openaiErr.Message, openaiErr.Type, openaiErr.Code)
			if isFatalOpenAIError(openaiErr) {
				return nil, nil, newFatalError(fmt.Errorf("%s", errMsg))
			}
			return nil, nil, fmt.Errorf("%s", errMsg)
		}
		errMsg := fmt.Sprintf("图谱抽取 LLM 调用失败: %v", callErr)
		if isFatalErrorMessage(callErr.Error()) {
			return nil, nil, newFatalError(fmt.Errorf("%s", errMsg))
		}
		return nil, nil, fmt.Errorf("%s", errMsg)
	}

	// 解析结果
	extracted, err := s.parseGraphExtractionResponse(ctx, resp)
	if err != nil {
		return nil, nil, err
	}

	// 清理和验证
	entities, relations := s.cleanExtractionResults(template, extracted)
	logger.Debugf(ctx, "【图谱生成】分片抽取完成: chunk_id=%d, raw_entities=%d, raw_relations=%d, cleaned_entities=%d, cleaned_relations=%d",
		chunk.ID, len(extracted.Entities), len(extracted.Relations), len(entities), len(relations))
	logger.Debugf(ctx, "【图谱生成】分片抽取结果预览: %s",
		formatGraphExtractionChunkPreviewLog(chunk.ID, entities, relations))

	return entities, relations, nil
}

// ExtractForChunks 对多个分片进行图谱抽取
func (s *GraphExtractionService) ExtractForChunks(ctx context.Context, eid int64, template *model.GraphTemplate, chunks []model.DocumentChunk) ([]ExtractedGraphEntity, []ExtractedGraphRelation, error) {
	if len(chunks) == 0 {
		return nil, nil, nil
	}

	representativeChunk := &chunks[0]
	cfg, err := s.loadChunkConfig(ctx, eid, representativeChunk)
	if err != nil {
		return nil, nil, err
	}

	selectedChannel, selectedModelName, err := s.selectLLM(cfg)
	if err != nil {
		return nil, nil, err
	}

	batch := GraphExtractionBatch{
		Chunks:   append([]model.DocumentChunk(nil), chunks...),
		ChunkIDs: make([]int64, 0, len(chunks)),
	}
	for _, chunk := range chunks {
		batch.ChunkIDs = append(batch.ChunkIDs, chunk.ID)
	}

	systemPrompt := s.buildGraphExtractionBatchSystemPrompt(template)
	userPrompt := s.buildGraphExtractionBatchUserPrompt(batch)
	logger.Debugf(ctx, "【图谱生成】开始批量抽取: chunk_count=%d, chunk_ids=%v, model=%s, system_prompt_chars=%d, user_prompt_chars=%d",
		len(chunks), batch.ChunkIDs, selectedModelName, len(systemPrompt), len(userPrompt))

	timeoutCtx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()

	chatReq := &relaymodel.GeneralOpenAIRequest{
		Model:     selectedModelName,
		MaxTokens: graphExtractionMaxTokens,
		Messages: []relaymodel.Message{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
	}

	resp, callErr, openaiErr := s.contentService.testChannel(timeoutCtx, selectedChannel, chatReq)
	if callErr != nil || openaiErr != nil {
		if openaiErr != nil {
			errMsg := fmt.Sprintf("图谱批量抽取 LLM 调用失败: model: %s, message: %s, type: %s, code: %v", selectedModelName, openaiErr.Message, openaiErr.Type, openaiErr.Code)
			if isFatalOpenAIError(openaiErr) {
				return nil, nil, newFatalError(fmt.Errorf("%s", errMsg))
			}
			return nil, nil, fmt.Errorf("%s", errMsg)
		}
		errMsg := fmt.Sprintf("图谱批量抽取 LLM 调用失败: %v", callErr)
		if isFatalErrorMessage(callErr.Error()) {
			return nil, nil, newFatalError(fmt.Errorf("%s", errMsg))
		}
		return nil, nil, fmt.Errorf("%s", errMsg)
	}

	extracted, err := s.parseGraphExtractionResponse(ctx, resp)
	if err != nil {
		return nil, nil, err
	}

	entities, relations := s.cleanExtractionResults(template, extracted)
	if err := validateGraphExtractionChunkIDs(relations, batch.ChunkIDs); err != nil {
		return nil, nil, err
	}

	logger.Debugf(ctx, "【图谱生成】批量抽取完成: chunk_count=%d, raw_entities=%d, raw_relations=%d, cleaned_entities=%d, cleaned_relations=%d",
		len(chunks), len(extracted.Entities), len(extracted.Relations), len(entities), len(relations))
	logger.Debugf(ctx, "【图谱生成】批量抽取结果预览: %s",
		formatGraphExtractionBatchPreviewLog(batch.ChunkIDs, entities, relations))

	return entities, relations, nil
}

// buildGraphExtractionSystemPrompt 构建系统提示词
func (s *GraphExtractionService) buildGraphExtractionSystemPrompt(template *model.GraphTemplate) string {
	entities, _ := template.GetEntities()
	relations, _ := template.GetRelations()

	var sb strings.Builder

	sb.WriteString(`你是知识图谱抽取助手。请仅根据给定文本提取实体和关系，禁止臆测。

## 实体类型定义
`)
	for _, e := range entities {
		fmt.Fprintf(&sb, "- %s（属性：%s）\n", e.Name, strings.Join(e.Properties, "、"))
	}

	sb.WriteString("\n## 关系类型定义\n")
	for _, r := range relations {
		fmt.Fprintf(&sb, "- %s --[%s]--> %s\n", r.Source, r.Predicate, r.Target)
	}

	sb.WriteString(`
## 抽取规则
1. 实体类型必须在上面定义中；实体名必须来自原文。
2. 关系必须严格匹配 source-predicate-target 定义；只抽明确关系，必须抽取出关系。
3. 若实体或关系在本次输出重复，保留一条即可。
4. 实体属性仅保留定义里存在且文本里有值的字段。
5. 每个关系三元组保持简洁，目标实体尽量控制在15字以内。
6. 所有实体/关系都必须提供 evidence，且 evidence 必须是原文中的直接片段（不要改写）。
7. confidence 为 0~1 的浮点数；不确定就给较低值（例如 0.5），不要留空字符串。
8. 输出最外层必须是 JSON 对象，禁止直接输出数组。即使没有关系，也必须返回 {"entities":[],"relations":[]}.

## 输出格式
只输出 JSON，不要 Markdown 包裹，不要解释。格式如下：
{
  "entities": [
    {
      "entity_name": "实体类型名",
      "name": "实体实例名（原文中的表述）",
      "properties": {
        "属性名1": "属性值1",
        "属性名2": "属性值2"
      },
      "aliases": ["别名1", "别名2"],
      "evidence": "原文中的证据片段",
      "confidence": 0.9
    }
  ],
  "relations": [
    {
      "source_name": "源实体实例名",
      "predicate": "关系谓词",
      "target_name": "目标实体实例名",
      "evidence": "原文中的证据片段",
      "confidence": 0.9
    }
  ]
}

如果文本中没有符合条件的实体或关系，返回空数组。`)

	return sb.String()
}

// buildGraphExtractionUserPrompt 构建用户提示词
func (s *GraphExtractionService) buildGraphExtractionUserPrompt(content string) string {
	content = strings.TrimSpace(content)
	return fmt.Sprintf("请从以下文本中抽取知识图谱（仅基于文本，不要臆测）：\n\n%s", content)
}

func (s *GraphExtractionService) buildGraphExtractionBatchSystemPrompt(template *model.GraphTemplate) string {
	basePrompt := s.buildGraphExtractionSystemPrompt(template)
	return basePrompt + `

## 批量分片规则
1. 输入文本由多个 XML <chunk> 组成，每个 <chunk> 都带有 chunk_id。
2. 每条关系都必须返回 chunk_ids，且只能从当前输入批次的 chunk_id 中选择。
3. 如果一条关系需要依赖多个分片才能确认，可以返回多个 chunk_ids。
4. 如果无法明确对应到当前批次内的 chunk_id，不要输出这条关系。

## 批量输出格式补充
最外层仍然必须返回 JSON 对象，禁止直接返回 entities 或 relations 的数组。
relations 中每个对象都必须包含 chunk_ids，例如：
{
  "source_name": "源实体实例名",
  "predicate": "关系谓词",
  "target_name": "目标实体实例名",
  "evidence": "原文中的证据片段",
  "confidence": 0.9,
  "chunk_ids": [123, 124]
}`
}

func (s *GraphExtractionService) buildGraphExtractionBatchUserPrompt(batch GraphExtractionBatch) string {
	return fmt.Sprintf("请从以下 XML 批次中抽取知识图谱（仅基于文本，不要臆测）：\n\n%s", buildGraphExtractionBatchXML(batch))
}

// parseGraphExtractionResponse 解析LLM返回的抽取结果
func (s *GraphExtractionService) parseGraphExtractionResponse(ctx context.Context, content string) (*graphExtractionResponse, error) {
	var resp graphExtractionResponse
	if err := common.ParseLLMJSONInto(ctx, content, &resp); err == nil {
		return &resp, nil
	} else {
		var entities []ExtractedGraphEntity
		if arrayErr := common.ParseLLMJSONInto(ctx, content, &entities); arrayErr == nil {
			logger.Debugf(ctx, "【工具执行】图谱抽取结果以数组形式返回，已按实体列表兜底解析: entities=%d", len(entities))
			return &graphExtractionResponse{
				Entities:  entities,
				Relations: []ExtractedGraphRelation{},
			}, nil
		}
		return nil, fmt.Errorf("图谱抽取结果 JSON 解析失败: %v", err)
	}
}

func validateGraphExtractionChunkIDs(relations []ExtractedGraphRelation, batchChunkIDs []int64) error {
	if len(relations) == 0 {
		return nil
	}
	allowed := make(map[int64]struct{}, len(batchChunkIDs))
	for _, id := range batchChunkIDs {
		if id > 0 {
			allowed[id] = struct{}{}
		}
	}
	for _, relation := range relations {
		if len(relation.ChunkIDs) == 0 {
			return fmt.Errorf("关系 %s-%s-%s 缺少 chunk_ids", relation.SourceName, relation.Predicate, relation.TargetName)
		}
		for _, id := range relation.ChunkIDs {
			if id <= 0 {
				return fmt.Errorf("关系 %s-%s-%s 包含非法 chunk_id", relation.SourceName, relation.Predicate, relation.TargetName)
			}
			if _, ok := allowed[id]; !ok {
				return fmt.Errorf("关系 %s-%s-%s 的 chunk_id %d 不在当前批次中", relation.SourceName, relation.Predicate, relation.TargetName, id)
			}
		}
	}
	return nil
}

// cleanExtractionResults 清理和验证抽取结果
func (s *GraphExtractionService) cleanExtractionResults(template *model.GraphTemplate, extracted *graphExtractionResponse) ([]ExtractedGraphEntity, []ExtractedGraphRelation) {
	// 获取模板定义
	templateEntities, _ := template.GetEntities()
	templateRelations, _ := template.GetRelations()

	// 构建实体类型映射
	entityTypes := make(map[string]*model.EntityDefinition)
	for _, e := range templateEntities {
		entityTypes[e.Name] = e
	}

	// 构建关系映射
	relationDefs := make(map[string]bool)
	for _, r := range templateRelations {
		key := r.Source + "|" + r.Predicate + "|" + r.Target
		relationDefs[key] = true
	}

	// 清理实体
	entityNameMap := make(map[string]string) // 实体实例名 -> 实体类型名
	var cleanedEntities []ExtractedGraphEntity
	seenEntities := make(map[string]bool)

	for _, e := range extracted.Entities {
		e.EntityName = strings.TrimSpace(e.EntityName)
		e.Name = strings.TrimSpace(e.Name)
		e.Evidence = strings.TrimSpace(e.Evidence)
		if e.Confidence < 0 || e.Confidence > 1 {
			e.Confidence = 0
		}
		if e.EntityName == "" || e.Name == "" {
			continue
		}

		// 检查实体类型是否在模板中定义
		if _, ok := entityTypes[e.EntityName]; !ok {
			continue // 跳过未定义的实体类型
		}

		// 检查实体名称长度
		if len([]rune(e.Name)) > 255 {
			continue
		}

		// 去重
		key := e.EntityName + "|" + e.Name
		if seenEntities[key] {
			continue
		}
		seenEntities[key] = true

		// 清理属性
		if e.Properties == nil {
			e.Properties = make(map[string]string)
		}
		props := e.Properties
		def := entityTypes[e.EntityName]
		validProps := make(map[string]string)
		for _, propName := range def.Properties {
			if val, ok := props[propName]; ok && strings.TrimSpace(val) != "" {
				validProps[propName] = strings.TrimSpace(val)
			}
		}
		e.Properties = validProps

		// 清理 aliases（不参与当前落库，仅用于后续查询层）
		if len(e.Aliases) > 0 {
			seenAlias := make(map[string]struct{})
			cleanedAliases := make([]string, 0, len(e.Aliases))
			for _, a := range e.Aliases {
				a = strings.TrimSpace(a)
				if a == "" {
					continue
				}
				if _, ok := seenAlias[a]; ok {
					continue
				}
				seenAlias[a] = struct{}{}
				cleanedAliases = append(cleanedAliases, a)
			}
			e.Aliases = cleanedAliases
		}

		cleanedEntities = append(cleanedEntities, e)
		entityNameMap[e.Name] = e.EntityName
	}

	// 清理关系
	mergedRelations := make(map[string]*ExtractedGraphRelation)
	relationOrder := make([]string, 0, len(extracted.Relations))

	for _, r := range extracted.Relations {
		r.SourceName = strings.TrimSpace(r.SourceName)
		r.Predicate = strings.TrimSpace(r.Predicate)
		r.TargetName = strings.TrimSpace(r.TargetName)
		r.Evidence = strings.TrimSpace(r.Evidence)
		if r.Confidence < 0 || r.Confidence > 1 {
			r.Confidence = 0
		}

		if r.SourceName == "" || r.Predicate == "" || r.TargetName == "" {
			continue
		}

		// 检查源实体和目标实体是否存在
		sourceType, sourceOk := entityNameMap[r.SourceName]
		targetType, targetOk := entityNameMap[r.TargetName]
		if !sourceOk || !targetOk {
			continue // 实体不存在，跳过
		}

		// 检查关系是否在模板中定义
		relationKey := sourceType + "|" + r.Predicate + "|" + targetType
		if !relationDefs[relationKey] {
			continue // 关系未定义，跳过
		}

		key := r.SourceName + "|" + r.Predicate + "|" + r.TargetName
		existing, ok := mergedRelations[key]
		if !ok {
			relationCopy := r
			relationCopy.ChunkIDs = normalizeChunkIDs(r.ChunkIDs)
			mergedRelations[key] = &relationCopy
			relationOrder = append(relationOrder, key)
			continue
		}
		existing.ChunkIDs = mergeChunkIDLists(existing.ChunkIDs, r.ChunkIDs)
	}

	cleanedRelations := make([]ExtractedGraphRelation, 0, len(mergedRelations))
	for _, key := range relationOrder {
		if relation, ok := mergedRelations[key]; ok {
			cleanedRelations = append(cleanedRelations, *relation)
		}
	}

	return cleanedEntities, cleanedRelations
}

// StoreExtractionResults 存储抽取结果到数据库（兼容单分片）
func (s *GraphExtractionService) StoreExtractionResults(ctx context.Context, instanceID int64, templateID int64, library *model.Library, chunk *model.DocumentChunk, entities []ExtractedGraphEntity, relations []ExtractedGraphRelation) error {
	if chunk == nil {
		return nil
	}
	return s.StoreBatchExtractionResults(ctx, instanceID, templateID, library, []model.DocumentChunk{*chunk}, entities, relations)
}

// StoreBatchExtractionResults 存储批量抽取结果到数据库
func (s *GraphExtractionService) StoreBatchExtractionResults(ctx context.Context, instanceID int64, templateID int64, library *model.Library, chunks []model.DocumentChunk, entities []ExtractedGraphEntity, relations []ExtractedGraphRelation) error {
	if len(chunks) == 0 || (len(entities) == 0 && len(relations) == 0) {
		return nil
	}

	primaryChunk := chunks[0]
	chunkByID := make(map[int64]model.DocumentChunk, len(chunks))
	for _, chunk := range chunks {
		chunkByID[chunk.ID] = chunk
	}

	tx := s.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 存储实体并建立映射：实体实例名 -> EntityChunkRelation.ID
	entityRelationMap := make(map[string]int64)
	entityRelationByChunk := make(map[int64]map[string]int64)

	entityChunkRelationsByChunk := make(map[int64][]model.EntityChunkRelation)
	for _, e := range entities {
		// 创建或获取实体
		entityModel, err := model.GetOrCreateEntityWithDB(tx, primaryChunk.Eid, e.EntityName, e.Name)
		if err != nil {
			tx.Rollback()
			return fmt.Errorf("创建实体失败: %v", err)
		}

		// 序列化属性
		propsJSON := ""
		if len(e.Properties) > 0 {
			propsBytes, _ := json.Marshal(e.Properties)
			propsJSON = string(propsBytes)
		}

		entityChunkIDs := inferEntityChunkIDs(e, chunks, primaryChunk.ID)
		for _, chunkID := range entityChunkIDs {
			chunk, ok := chunkByID[chunkID]
			if !ok {
				continue
			}

			// 创建实体分片关联
			relation := model.EntityChunkRelation{
				Eid:        primaryChunk.Eid,
				EntityID:   entityModel.ID,
				SpaceID:    library.SpaceID,
				LibraryID:  chunk.LibraryID,
				FileID:     chunk.FileID,
				ChunkID:    chunk.ID,
				ChunkType:  chunk.ChunkType,
				Status:     model.EntityRelationStatusActive,
				Confidence: clampConfidenceOrDefault(e.Confidence, 1.0),
				Source:     model.EntityRelationSourceAutoLLM,
				TemplateID: templateID,
				Properties: propsJSON,
			}
			entityChunkRelationsByChunk[chunk.ID] = append(entityChunkRelationsByChunk[chunk.ID], relation)
		}
	}

	// 批量插入实体关联
	for _, chunk := range chunks {
		entityChunkRelations := entityChunkRelationsByChunk[chunk.ID]
		if err := model.ReplaceGraphEntityRelationsByTemplate(tx, primaryChunk.Eid, templateID, library.SpaceID, chunk.LibraryID, chunk.FileID, chunk.ID, entityChunkRelations); err != nil {
			tx.Rollback()
			return fmt.Errorf("存储实体关联失败: %v", err)
		}

		// 查询刚插入的关联记录以获取ID
		var insertedRelations []model.EntityChunkRelation
		entityIDs := make([]int64, 0, len(entityChunkRelations))
		seenEntityIDs := make(map[int64]struct{}, len(entityChunkRelations))
		for _, relation := range entityChunkRelations {
			if relation.EntityID <= 0 {
				continue
			}
			if _, ok := seenEntityIDs[relation.EntityID]; ok {
				continue
			}
			seenEntityIDs[relation.EntityID] = struct{}{}
			entityIDs = append(entityIDs, relation.EntityID)
		}

		query := tx.Where("eid = ? AND space_id = ? AND library_id = ? AND file_id = ? AND chunk_id = ?",
			primaryChunk.Eid, library.SpaceID, chunk.LibraryID, chunk.FileID, chunk.ID)
		if len(entityIDs) > 0 {
			query = query.Where("entity_id IN ?", entityIDs)
		}
		if err := query.
			Find(&insertedRelations).Error; err != nil {
			tx.Rollback()
			return fmt.Errorf("查询实体关联失败: %v", err)
		}

		if entityRelationByChunk[chunk.ID] == nil {
			entityRelationByChunk[chunk.ID] = make(map[string]int64)
		}

		// 建立映射
		for _, r := range insertedRelations {
			// 需要通过 entity_id 查找对应的实体名称
			var entity model.Entity
			if err := tx.Select("name").Where("id = ?", r.EntityID).First(&entity).Error; err == nil {
				entityRelationByChunk[chunk.ID][entity.Name] = r.ID
				if _, exists := entityRelationMap[entity.Name]; !exists {
					entityRelationMap[entity.Name] = r.ID
				}
			}
		}
	}

	resolveEntityRelationID := func(entityName string, chunkID int64) (int64, bool) {
		if chunkRelations, ok := entityRelationByChunk[chunkID]; ok {
			if relationID, ok := chunkRelations[entityName]; ok {
				return relationID, true
			}
		}
		relationID, ok := entityRelationMap[entityName]
		return relationID, ok
	}

	relationGroups := make(map[int64][]model.GraphRelationInstance)
	for _, r := range relations {
		chunkIDs := normalizeChunkIDs(r.ChunkIDs)
		if len(chunkIDs) == 0 {
			chunkIDs = []int64{primaryChunk.ID}
		}

		for _, chunkID := range chunkIDs {
			sourceRelationID, sourceOk := resolveEntityRelationID(r.SourceName, chunkID)
			targetRelationID, targetOk := resolveEntityRelationID(r.TargetName, chunkID)
			if !sourceOk || !targetOk {
				continue
			}

			relationGroups[chunkID] = append(relationGroups[chunkID], model.GraphRelationInstance{
				Eid:              primaryChunk.Eid,
				InstanceID:       instanceID,
				TemplateID:       templateID,
				Predicate:        r.Predicate,
				SourceRelationID: sourceRelationID,
				TargetRelationID: targetRelationID,
				ChunkID:          chunkID,
			})
		}
	}

	for chunkID, graphRelations := range relationGroups {
		if err := model.ReplaceGraphRelationsByInstanceChunk(tx, primaryChunk.Eid, instanceID, chunkID, graphRelations); err != nil {
			tx.Rollback()
			return fmt.Errorf("存储关系实例失败: %v", err)
		}
	}

	if err := tx.Commit().Error; err != nil {
		return err
	}

	totalGraphRelations := 0
	for _, relationsForChunk := range relationGroups {
		totalGraphRelations += len(relationsForChunk)
	}

	totalEntityRelations := 0
	for _, relationsForChunk := range entityChunkRelationsByChunk {
		totalEntityRelations += len(relationsForChunk)
	}

	logger.Debugf(ctx, "【图谱生成】分片结果已落库: chunk_id=%d, 批次分片数=%d, 实体关联数=%d, 关系实例数=%d",
		primaryChunk.ID, len(chunks), totalEntityRelations, totalGraphRelations)
	if len(relations) > 0 && totalGraphRelations == 0 {
		logger.Warnf(ctx, "【图谱生成】关系抽取后未写入图谱实例: chunk_id=%d, 抽取关系=%d, 写入关系实例=%d, 可能原因=实体分片映射未命中",
			primaryChunk.ID, len(relations), totalGraphRelations)
	}
	logger.Infof(ctx, "图谱抽取完成: 分片 %d, 实体 %d 个, 关系 %d 个", primaryChunk.ID, len(entities), len(relations))
	return nil
}

func inferEntityChunkIDs(entity ExtractedGraphEntity, chunks []model.DocumentChunk, fallbackChunkID int64) []int64 {
	type scoredChunk struct {
		id    int64
		score int
	}

	candidates := entityMatchCandidates(entity)
	if len(candidates) == 0 {
		return []int64{fallbackChunkID}
	}

	matches := make([]scoredChunk, 0, len(chunks))
	for _, chunk := range chunks {
		score := scoreEntityChunkMatch(chunk.Content, candidates)
		if score > 0 {
			matches = append(matches, scoredChunk{id: chunk.ID, score: score})
		}
	}
	if len(matches) == 0 {
		return []int64{fallbackChunkID}
	}

	maxScore := 0
	for _, match := range matches {
		if match.score > maxScore {
			maxScore = match.score
		}
	}

	result := make([]int64, 0, len(matches))
	for _, chunk := range chunks {
		for _, match := range matches {
			if match.id == chunk.ID && match.score == maxScore {
				result = append(result, chunk.ID)
				break
			}
		}
	}
	if len(result) == 0 {
		return []int64{fallbackChunkID}
	}
	return normalizeChunkIDs(result)
}

type entityMatchCandidate struct {
	value string
	score int
}

func entityMatchCandidates(entity ExtractedGraphEntity) []entityMatchCandidate {
	seen := make(map[string]struct{})
	candidates := make([]entityMatchCandidate, 0, 8)
	add := func(v string, score int) {
		v = strings.TrimSpace(v)
		if v == "" {
			return
		}
		if _, ok := seen[v]; ok {
			return
		}
		seen[v] = struct{}{}
		candidates = append(candidates, entityMatchCandidate{value: v, score: score})
	}

	add(entity.Evidence, 100)
	add(entity.Name, 80)
	for _, alias := range entity.Aliases {
		add(alias, 60)
	}
	for _, val := range entity.Properties {
		add(val, 40)
	}
	return candidates
}

func scoreEntityChunkMatch(chunkContent string, candidates []entityMatchCandidate) int {
	normalizedChunk := normalizeTextForMatch(chunkContent)
	if normalizedChunk == "" {
		return 0
	}

	for _, candidate := range candidates {
		normalizedCandidate := normalizeTextForMatch(candidate.value)
		if normalizedCandidate == "" {
			continue
		}
		if strings.Contains(normalizedChunk, normalizedCandidate) && candidate.score > 0 {
			return candidate.score
		}
	}
	return 0
}

func normalizeTextForMatch(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	return strings.ToLower(strings.Join(strings.Fields(s), ""))
}

func trimToMaxRunes(s string, maxRunes int) string {
	if maxRunes <= 0 {
		return s
	}
	runes := []rune(s)
	if len(runes) <= maxRunes {
		return s
	}
	return string(runes[:maxRunes])
}

func clampConfidenceOrDefault(v float64, def float64) float64 {
	if v <= 0 || v > 1 {
		return def
	}
	return v
}

func normalizeChunkIDs(chunkIDs []int64) []int64 {
	if len(chunkIDs) == 0 {
		return []int64{}
	}
	seen := make(map[int64]struct{}, len(chunkIDs))
	result := make([]int64, 0, len(chunkIDs))
	for _, id := range chunkIDs {
		if id <= 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	return result
}

func mergeChunkIDLists(existing, incoming []int64) []int64 {
	if len(existing) == 0 {
		return normalizeChunkIDs(incoming)
	}
	merged := make([]int64, 0, len(existing)+len(incoming))
	seen := make(map[int64]struct{}, len(existing)+len(incoming))
	appendUnique := func(ids []int64) {
		for _, id := range ids {
			if id <= 0 {
				continue
			}
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			merged = append(merged, id)
		}
	}
	appendUnique(existing)
	appendUnique(incoming)
	return merged
}

func previewEntitiesForLog(entities []ExtractedGraphEntity, maxItems int) string {
	if len(entities) == 0 {
		return "[]"
	}
	if maxItems <= 0 {
		maxItems = 5
	}
	items := make([]string, 0, maxItems+1)
	limit := len(entities)
	if limit > maxItems {
		limit = maxItems
	}
	for i := 0; i < limit; i++ {
		e := entities[i]
		items = append(items, fmt.Sprintf("%s:%s", e.EntityName, e.Name))
	}
	if len(entities) > maxItems {
		items = append(items, fmt.Sprintf("...(+%d)", len(entities)-maxItems))
	}
	return "[" + strings.Join(items, ", ") + "]"
}

func formatGraphExtractionChunkPreviewLog(chunkID int64, entities []ExtractedGraphEntity, relations []ExtractedGraphRelation) string {
	return fmt.Sprintf("chunk_id=%d, entities=%d, relations=%d, entities_preview=%s, relations_preview=%s",
		chunkID, len(entities), len(relations), previewEntitiesForLog(entities, 8), previewRelationsForLog(relations, 8))
}

func formatGraphExtractionBatchPreviewLog(chunkIDs []int64, entities []ExtractedGraphEntity, relations []ExtractedGraphRelation) string {
	return fmt.Sprintf("entities=%d, relations=%d, chunk_ids=%v, entities_preview=%s, relations_preview=%s",
		len(entities), len(relations), chunkIDs, previewEntitiesForLog(entities, 8), previewRelationsForLog(relations, 8))
}

func previewRelationsForLog(relations []ExtractedGraphRelation, maxItems int) string {
	if len(relations) == 0 {
		return "[]"
	}
	if maxItems <= 0 {
		maxItems = 5
	}
	items := make([]string, 0, maxItems+1)
	limit := len(relations)
	if limit > maxItems {
		limit = maxItems
	}
	for i := 0; i < limit; i++ {
		r := relations[i]
		items = append(items, fmt.Sprintf("%s-[%s]->%s", r.SourceName, r.Predicate, r.TargetName))
	}
	if len(relations) > maxItems {
		items = append(items, fmt.Sprintf("...(+%d)", len(relations)-maxItems))
	}
	return "[" + strings.Join(items, ", ") + "]"
}

// loadChunkConfig 加载分块配置
func (s *GraphExtractionService) loadChunkConfig(ctx context.Context, eid int64, chunk *model.DocumentChunk) (*ChunkConfig, error) {
	if chunk.ChunkConfigID > 0 {
		cfg, err := s.chunkCfgService.GetConfigByID(eid, chunk.ChunkConfigID)
		if err == nil && cfg != nil {
			return cfg, nil
		}
		logger.Warnf(ctx, "获取ChunkConfig失败，降级走 GetConfigWithFileID: %v", err)
	}

	libraryID := chunk.LibraryID
	fileID := chunk.FileID
	return s.chunkCfgService.GetConfigWithFileID(eid, &libraryID, &fileID)
}

// selectLLM 选择LLM（优先级：LogicReasoning > FastReasoning）
func (s *GraphExtractionService) selectLLM(cfg *ChunkConfig) (*model.Channel, string, error) {
	if cfg == nil {
		return nil, "", fmt.Errorf("chunk config is nil")
	}
	return cfg.SelectPipelineLLM()
}

func isFatalOpenAIError(err *relaymodel.Error) bool {
	if err == nil {
		return false
	}
	fatalCodes := []string{
		"invalid_request_error",
		"authentication_error",
		"permission_denied",
		"not_found_error",
	}
	for _, code := range fatalCodes {
		if err.Type == code {
			return true
		}
	}
	return isFatalErrorMessage(err.Message)
}

func isFatalErrorMessage(msg string) bool {
	fatalMessages := []string{
		"Model Not Exist",
		"model not found",
		"invalid api key",
		"authentication failed",
		"unauthorized",
		"invalid model",
	}
	lowerMsg := strings.ToLower(msg)
	for _, m := range fatalMessages {
		if strings.Contains(lowerMsg, strings.ToLower(m)) {
			return true
		}
	}
	return false
}
