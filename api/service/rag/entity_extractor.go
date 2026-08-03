package rag

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/tokenlimit"
	"github.com/53AI/53AIHub/model"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
	"gorm.io/gorm"
)

type EntityExtractionService struct {
	db              *gorm.DB
	contentService  *ContentGeneratorService
	chunkCfgService *ChunkConfigService
}

func NewEntityExtractionService(db *gorm.DB) *EntityExtractionService {
	return &EntityExtractionService{
		db:              db,
		contentService:  NewContentGeneratorService(db),
		chunkCfgService: NewChunkConfigService(db),
	}
}

type ExtractedEntity struct {
	Type       string  `json:"type"`
	Name       string  `json:"name"`
	Confidence float64 `json:"confidence"`
}

type entityExtractionResponse struct {
	Entities []ExtractedEntity `json:"entities"`
}

func (s *EntityExtractionService) ExtractAndStoreForChunk(ctx context.Context, eid int64, chunk *model.DocumentChunk) error {
	if chunk == nil {
		return fmt.Errorf("chunk is nil")
	}
	if chunk.ChunkType != "knowledge" {
		return nil
	}

	cfg, err := s.loadChunkConfig(ctx, eid, chunk)
	if err != nil {
		return err
	}

	selectedChannel, selectedModelName, err := s.selectLLM(cfg)
	if err != nil {
		return err
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	systemPrompt := s.buildEntityExtractionSystemPrompt()
	userPrompt := s.buildEntityExtractionUserPrompt(chunk.Content)

	chatReq := &relaymodel.GeneralOpenAIRequest{
		Model:     selectedModelName,
		MaxTokens: 0, // 不限制输出，由模型自由生成
		Messages: []relaymodel.Message{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
	}

	_ = timeoutCtx
	resp, callErr, openaiErr := s.contentService.testChannel(ctx, selectedChannel, chatReq)
	if callErr != nil || openaiErr != nil {
		if callErr != nil {
			return fmt.Errorf("entity extraction llm call failed: %v", callErr)
		}
		return fmt.Errorf("entity extraction llm call failed: %v", openaiErr)
	}

	extracted, err := s.parseEntityExtractionResponse(resp)
	if err != nil {
		return err
	}
	extracted = s.cleanEntities(extracted)

	return s.persistEntities(ctx, eid, chunk, extracted)
}

func (s *EntityExtractionService) loadChunkConfig(ctx context.Context, eid int64, chunk *model.DocumentChunk) (*ChunkConfig, error) {
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

func (s *EntityExtractionService) selectLLM(cfg *ChunkConfig) (*model.Channel, string, error) {
	if cfg == nil {
		return nil, "", fmt.Errorf("chunk config is nil")
	}
	return cfg.SelectPipelineLLM()
}

func (s *EntityExtractionService) buildEntityExtractionSystemPrompt() string {
	return fmt.Sprintf(`你是一个信息抽取 system。你的任务是从给定文本中抽取“实体（Entity）”。

实体类型必须从下面枚举中选择，且必须严格使用这些英文标签：
- %s: 人物（真实的人名）
- %s: 组织/公司/部门/机构
- %s: 产品/系统/服务/平台名称（软件、硬件、业务产品）
- %s: 地点（国家、省市、园区、地址等）
- %s: 时间（日期、月份、年份、时间点、时间范围）
- %s: 事件（发布、会议、故障、活动等有发生含义的事件）
- %s: 文档/制度/规范/手册/协议/文件名等
- %s: 概念/术语/指标/名词性知识点
- %s: 方法/流程/步骤/方案/机制

抽取规则：`,
		model.EntityTypePerson,
		model.EntityTypeOrganization,
		model.EntityTypeProduct,
		model.EntityTypeLocation,
		model.EntityTypeTime,
		model.EntityTypeEvent,
		model.EntityTypeDocument,
		model.EntityTypeConcept,
		model.EntityTypeMethod,
	) + `
1) 只抽取文本中明确出现的实体，不要猜测或补全。
2) 实体名必须是原文中的连续片段，保持原文大小写与中文全角半角。
3) 去重：同一 type + name 只能出现一次。
4) 如果不确定类型，优先用 Concept；不要发明新类型。
5) 高频基础实体补充：当文本中某个复合实体（例如“火星导弹”）重复出现时，需要补充抽取其基础组成实体（例如“火星”“导弹”），基础实体也必须满足规则 1) 和 2)。

输出要求：
只输出 JSON，不要 Markdown，不要解释。
格式如下：
{
  "entities": [
    {"type": "Person", "name": "张三", "confidence": 0.86}
  ]
}
confidence 取值范围 0-1。`
}

func (s *EntityExtractionService) buildEntityExtractionUserPrompt(content string) string {
	content = strings.TrimSpace(content)
	return fmt.Sprintf("文本如下：\n%s", content)
}

func (s *EntityExtractionService) parseEntityExtractionResponse(content string) ([]ExtractedEntity, error) {
	var resp entityExtractionResponse
	if err := common.ParseLLMJSONInto(context.Background(), content, &resp); err != nil {
		return nil, fmt.Errorf("entity extraction json parse failed: %v", err)
	}
	return resp.Entities, nil
}

func (s *EntityExtractionService) cleanEntities(entities []ExtractedEntity) []ExtractedEntity {
	if len(entities) == 0 {
		return nil
	}

	allowed := map[string]struct{}{
		model.EntityTypePerson:       {},
		model.EntityTypeOrganization: {},
		model.EntityTypeProduct:      {},
		model.EntityTypeLocation:     {},
		model.EntityTypeTime:         {},
		model.EntityTypeEvent:        {},
		model.EntityTypeDocument:     {},
		model.EntityTypeConcept:      {},
		model.EntityTypeMethod:       {},
	}

	seen := make(map[string]struct{}, len(entities))
	var out []ExtractedEntity

	for _, e := range entities {
		e.Type = strings.TrimSpace(e.Type)
		e.Name = strings.TrimSpace(e.Name)
		if e.Type == "" || e.Name == "" {
			continue
		}
		if _, ok := allowed[e.Type]; !ok {
			e.Type = model.EntityTypeConcept
		}
		if e.Confidence <= 0 {
			e.Confidence = 0.5
		}
		if e.Confidence > 1 {
			e.Confidence = 1
		}
		if len([]rune(e.Name)) > 255 {
			continue
		}
		key := e.Type + "\n" + e.Name
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, e)
		if len(out) >= 50 {
			break
		}
	}

	return out
}

func (s *EntityExtractionService) persistEntities(ctx context.Context, eid int64, chunk *model.DocumentChunk, entities []ExtractedEntity) error {
	tx := s.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	var library model.Library
	if err := tx.Select("id", "space_id").
		Where("eid = ? AND id = ?", eid, chunk.LibraryID).
		First(&library).Error; err != nil {
		tx.Rollback()
		return err
	}

	var relations []model.EntityChunkRelation
	const minAutoLLMConfidence = 0.85
	seenEntityIDs := make(map[int64]struct{})
	createdEntities := make(map[int64]*model.Entity)
	for _, e := range entities {
		if e.Confidence < minAutoLLMConfidence {
			continue
		}
		entityModel, created, err := model.GetOrCreateEntityWithDBAndCreated(tx, eid, e.Type, e.Name)
		if err != nil {
			tx.Rollback()
			return err
		}
		if created {
			createdEntities[entityModel.ID] = entityModel
		}
		if _, ok := seenEntityIDs[entityModel.ID]; ok {
			continue
		}
		seenEntityIDs[entityModel.ID] = struct{}{}

		relations = append(relations, model.EntityChunkRelation{
			Eid:        eid,
			EntityID:   entityModel.ID,
			SpaceID:    library.SpaceID,
			LibraryID:  chunk.LibraryID,
			FileID:     chunk.FileID,
			ChunkID:    chunk.ID,
			ChunkType:  chunk.ChunkType,
			Status:     model.EntityRelationStatusActive,
			Confidence: e.Confidence,
			Source:     model.EntityRelationSourceAutoLLM,
		})
	}

	if err := model.ReplaceEntityChunkRelationsBySourceWithDB(tx, eid, chunk.ID, model.EntityRelationSourceAutoLLM, relations); err != nil {
		tx.Rollback()
		return err
	}

	if err := tx.Commit().Error; err != nil {
		return err
	}
	if len(createdEntities) > 0 {
		go func(enterpriseID int64, entities map[int64]*model.Entity) {
			svc := NewEntityVectorService(s.db)
			for _, e := range entities {
				_ = svc.IndexEntity(enterpriseID, e)
			}
		}(eid, createdEntities)
	}
	return nil
}

func (s *EntityExtractionService) ExtractAndStoreForFileMeta(ctx context.Context, eid int64, fileID int64) error {
	if fileID <= 0 {
		return fmt.Errorf("file_id is empty")
	}

	var file model.File
	if err := s.db.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error; err != nil {
		return err
	}
	if file.Type == model.FILE_TYPE_DIR {
		return nil
	}

	var library model.Library
	if err := s.db.Where("eid = ? AND id = ?", eid, file.LibraryID).First(&library).Error; err != nil {
		return err
	}

	var space model.Space
	if library.SpaceID > 0 {
		_ = s.db.Where("eid = ? AND id = ?", eid, library.SpaceID).First(&space).Error
	}

	baseName := filepath.Base(file.Path)
	baseNoExt := strings.TrimSuffix(baseName, filepath.Ext(baseName))

	var candidates []string
	if strings.TrimSpace(space.Name) != "" {
		candidates = append(candidates, space.Name)
	}
	if strings.TrimSpace(library.Name) != "" {
		candidates = append(candidates, library.Name)
	}
	if strings.TrimSpace(baseNoExt) != "" {
		candidates = append(candidates, baseNoExt)
	}
	if strings.TrimSpace(baseName) != "" {
		candidates = append(candidates, baseName)
	}
	if strings.TrimSpace(file.Path) != "" {
		candidates = append(candidates, file.Path)
	}

	names := extractMetaEntityNames(candidates)
	if len(names) == 0 {
		return nil
	}

	tx := s.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	var relations []model.EntityChunkRelation
	seenEntityIDs := make(map[int64]struct{})
	createdEntities := make(map[int64]*model.Entity)
	for _, name := range names {
		entityModel, created, err := model.GetOrCreateEntityWithDBAndCreated(tx, eid, model.EntityTypeDocument, name)
		if err != nil {
			tx.Rollback()
			return err
		}
		if created {
			createdEntities[entityModel.ID] = entityModel
		}
		if _, ok := seenEntityIDs[entityModel.ID]; ok {
			continue
		}
		seenEntityIDs[entityModel.ID] = struct{}{}

		relations = append(relations, model.EntityChunkRelation{
			Eid:        eid,
			EntityID:   entityModel.ID,
			SpaceID:    library.SpaceID,
			LibraryID:  file.LibraryID,
			FileID:     file.ID,
			ChunkID:    0,
			ChunkType:  "knowledge",
			Status:     model.EntityRelationStatusActive,
			Confidence: 1.0,
			Source:     model.EntityRelationSourceAutoMeta,
		})
	}

	if err := model.ReplaceEntityScopeRelationsBySourceWithDB(tx, eid, library.SpaceID, file.LibraryID, file.ID, 0, model.EntityRelationSourceAutoMeta, relations); err != nil {
		tx.Rollback()
		return err
	}

	if err := tx.Commit().Error; err != nil {
		return err
	}
	if len(createdEntities) > 0 {
		go func(enterpriseID int64, entities map[int64]*model.Entity) {
			svc := NewEntityVectorService(s.db)
			for _, e := range entities {
				_ = svc.IndexEntity(enterpriseID, e)
			}
		}(eid, createdEntities)
	}
	return nil
}

func (s *EntityExtractionService) ExtractAndStoreForFileContent(ctx context.Context, eid int64, fileID int64, content string) error {
	content = strings.TrimSpace(content)
	if fileID <= 0 {
		return fmt.Errorf("file_id is empty")
	}
	if content == "" {
		return nil
	}

	// 处理长文档截断（统一使用共享的 tokenlimit 截断，默认 6000 token 预算）
	content = tokenlimit.TruncateContent(content, 6000)

	var file model.File
	if err := s.db.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error; err != nil {
		return err
	}
	if file.Type == model.FILE_TYPE_DIR {
		return nil
	}

	var library model.Library
	if err := s.db.Select("id", "space_id").
		Where("eid = ? AND id = ?", eid, file.LibraryID).
		First(&library).Error; err != nil {
		return err
	}

	libraryID := file.LibraryID
	cfg, err := s.chunkCfgService.GetConfigWithFileID(eid, &libraryID, &fileID)
	if err != nil {
		return err
	}

	selectedChannel, selectedModelName, err := s.selectLLM(cfg)
	if err != nil {
		return err
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	systemPrompt := s.buildEntityExtractionSystemPrompt()
	userPrompt := s.buildEntityExtractionUserPrompt(content)

	// 使用统一预算模型：caller_requested=8192，stepMaxInput=6000
	budget := tokenlimit.ComputeBudget(ctx, selectedChannel.ChannelID, selectedChannel.Config, selectedModelName, 0, 8192, 6000)
	content = tokenlimit.TruncateContent(content, budget.InputAvailable)

	chatReq := &relaymodel.GeneralOpenAIRequest{
		Model:     selectedModelName,
		MaxTokens: 0, // 不限制输出，由模型自由生成
		Messages: []relaymodel.Message{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
	}

	callStart := time.Now()
	resp, callErr, openaiErr := s.contentService.testChannel(timeoutCtx, selectedChannel, chatReq)
	callElapsed := time.Since(callStart)
	logger.Infof(ctx, "【诊断-实体抽取LLM】file_id=%d LLM调用耗时=%v input_tokens=%d model=%s",
		fileID, callElapsed, budget.InputAvailable, selectedModelName)
	if callErr != nil || openaiErr != nil {
		if callErr != nil {
			return fmt.Errorf("entity extraction llm call failed: %v", callErr)
		}
		return fmt.Errorf("entity extraction llm call failed: %v", openaiErr)
	}

	extracted, err := s.parseEntityExtractionResponse(resp)
	if err != nil {
		return err
	}
	extracted = s.cleanEntities(extracted)
	if len(extracted) == 0 {
		return nil
	}

	tx := s.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	var relations []model.EntityChunkRelation
	const minAutoLLMConfidence = 0.85
	seenEntityIDs := make(map[int64]struct{})
	createdEntities := make(map[int64]*model.Entity)
	for _, e := range extracted {
		if e.Confidence < minAutoLLMConfidence {
			continue
		}
		entityModel, created, err := model.GetOrCreateEntityWithDBAndCreated(tx, eid, e.Type, e.Name)
		if err != nil {
			tx.Rollback()
			return err
		}
		if created {
			createdEntities[entityModel.ID] = entityModel
		}
		if _, ok := seenEntityIDs[entityModel.ID]; ok {
			continue
		}
		seenEntityIDs[entityModel.ID] = struct{}{}

		relations = append(relations, model.EntityChunkRelation{
			Eid:        eid,
			EntityID:   entityModel.ID,
			SpaceID:    library.SpaceID,
			LibraryID:  file.LibraryID,
			FileID:     file.ID,
			ChunkID:    0,
			ChunkType:  "knowledge",
			Status:     model.EntityRelationStatusActive,
			Confidence: e.Confidence,
			Source:     model.EntityRelationSourceAutoLLM,
		})
	}

	if err := model.ReplaceEntityScopeRelationsBySourceWithDB(tx, eid, library.SpaceID, file.LibraryID, file.ID, 0, model.EntityRelationSourceAutoLLM, relations); err != nil {
		tx.Rollback()
		return err
	}

	if err := tx.Commit().Error; err != nil {
		return err
	}
	if len(createdEntities) > 0 {
		go func(enterpriseID int64, entities map[int64]*model.Entity) {
			svc := NewEntityVectorService(s.db)
			for _, e := range entities {
				_ = svc.IndexEntity(enterpriseID, e)
			}
		}(eid, createdEntities)
	}
	return nil
}

func (s *EntityExtractionService) StoreForFileExtractedEntities(ctx context.Context, eid int64, fileID int64, extracted []ExtractedEntity) error {
	if fileID <= 0 {
		return fmt.Errorf("file_id is empty")
	}
	if len(extracted) == 0 {
		return nil
	}

	var file model.File
	if err := s.db.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error; err != nil {
		return err
	}
	if file.Type == model.FILE_TYPE_DIR {
		return nil
	}

	var library model.Library
	if err := s.db.Select("id", "space_id").
		Where("eid = ? AND id = ?", eid, file.LibraryID).
		First(&library).Error; err != nil {
		return err
	}

	extracted = s.cleanEntities(extracted)
	if len(extracted) == 0 {
		return nil
	}

	tx := s.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	var relations []model.EntityChunkRelation
	const minAutoLLMConfidence = 0.85
	seenEntityIDs := make(map[int64]struct{})
	createdEntities := make(map[int64]*model.Entity)
	for _, e := range extracted {
		if e.Confidence < minAutoLLMConfidence {
			continue
		}
		entityModel, created, err := model.GetOrCreateEntityWithDBAndCreated(tx, eid, e.Type, e.Name)
		if err != nil {
			tx.Rollback()
			return err
		}
		if created {
			createdEntities[entityModel.ID] = entityModel
		}
		if _, ok := seenEntityIDs[entityModel.ID]; ok {
			continue
		}
		seenEntityIDs[entityModel.ID] = struct{}{}

		relations = append(relations, model.EntityChunkRelation{
			Eid:        eid,
			EntityID:   entityModel.ID,
			SpaceID:    library.SpaceID,
			LibraryID:  file.LibraryID,
			FileID:     file.ID,
			ChunkID:    0,
			ChunkType:  "knowledge",
			Status:     model.EntityRelationStatusActive,
			Confidence: e.Confidence,
			Source:     model.EntityRelationSourceAutoLLM,
		})
	}

	if err := model.ReplaceEntityScopeRelationsBySourceWithDB(tx, eid, library.SpaceID, file.LibraryID, file.ID, 0, model.EntityRelationSourceAutoLLM, relations); err != nil {
		tx.Rollback()
		return err
	}

	if err := tx.Commit().Error; err != nil {
		return err
	}
	if len(createdEntities) > 0 {
		go func(enterpriseID int64, entities map[int64]*model.Entity) {
			svc := NewEntityVectorService(s.db)
			for _, e := range entities {
				_ = svc.IndexEntity(enterpriseID, e)
			}
		}(eid, createdEntities)
	}
	return nil
}

func extractMetaEntityNames(parts []string) []string {
	seen := make(map[string]struct{})
	var out []string

	ignoreLower := map[string]struct{}{
		"md":   {},
		"pdf":  {},
		"doc":  {},
		"docx": {},
		"ppt":  {},
		"pptx": {},
		"xls":  {},
		"xlsx": {},
		"txt":  {},
	}

	push := func(name string) {
		name = strings.TrimSpace(name)
		if name == "" {
			return
		}
		runes := []rune(name)
		if len(runes) < 2 {
			return
		}
		if len(runes) > 128 {
			return
		}
		lower := strings.ToLower(name)
		if _, ok := ignoreLower[lower]; ok {
			return
		}
		if isAllDigits(name) && len(runes) >= 7 {
			return
		}
		if _, ok := seen[name]; ok {
			return
		}
		seen[name] = struct{}{}
		out = append(out, name)
	}

	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		for _, t := range splitMetaTokens(part) {
			push(t)
		}
	}

	if len(out) > 50 {
		out = out[:50]
	}
	return out
}

func splitMetaTokens(s string) []string {
	var tokens []string
	var buf []rune

	flush := func() {
		if len(buf) == 0 {
			return
		}
		tokens = append(tokens, string(buf))
		buf = buf[:0]
	}

	for _, r := range s {
		if isMetaTokenRune(r) {
			buf = append(buf, r)
			continue
		}
		flush()
	}
	flush()

	return tokens
}

func isMetaTokenRune(r rune) bool {
	if r == '_' || r == '-' {
		return false
	}
	if unicode.IsLetter(r) || unicode.IsDigit(r) {
		return true
	}
	if unicode.In(r, unicode.Han) {
		return true
	}
	return false
}

func isAllDigits(s string) bool {
	for _, r := range s {
		if !unicode.IsDigit(r) {
			return false
		}
	}
	return s != ""
}
