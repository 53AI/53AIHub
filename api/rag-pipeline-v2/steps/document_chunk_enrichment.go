package steps

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"gorm.io/gorm"
)

const (
	documentChunkEnrichmentCacheTTL      = 30 * 24 * time.Hour
	documentChunkEnrichmentPromptVersion = "v1"
)

type documentChunkEnrichmentCacheValue struct {
	Summary         string   `json:"summary"`
	CommonQuestions []string `json:"common_questions"`
}

// EnrichDocumentChunksAsync 供异步 worker 调用的导出版本
func EnrichDocumentChunksAsync(ctx context.Context, db *gorm.DB, file *model.File, chunkConfig *rag.ChunkConfig, chunks []model.DocumentChunk) error {
	return enrichDocumentChunks(ctx, db, file, chunkConfig, chunks)
}

func enrichDocumentChunks(ctx context.Context, db *gorm.DB, file *model.File, chunkConfig *rag.ChunkConfig, chunks []model.DocumentChunk) error {
	if file == nil {
		return fmt.Errorf("文件信息不能为空")
	}
	if len(chunks) == 0 {
		return nil
	}

	generateSummary := chunkConfig != nil && strings.EqualFold(strings.TrimSpace(chunkConfig.SummaryGeneration), "ai")
	generateQuestions := chunkConfig != nil && strings.EqualFold(strings.TrimSpace(chunkConfig.QuestionGeneration), "ai")

	chunkIDs := make([]int64, 0, len(chunks))
	for _, chunk := range chunks {
		chunkIDs = append(chunkIDs, chunk.ID)
	}

	if !generateSummary && !generateQuestions {
		logger.Infof(ctx, "【工具执行】跳过块级简介/问法生成: file_id=%d, chunk_count=%d", file.ID, len(chunks))
		return updateDocumentChunkEnrichmentStatuses(db, file.Eid, file.ID, chunkIDs, model.AIGenerateDocChunkStatusInactive)
	}

	if err := updateDocumentChunkEnrichmentStatuses(db, file.Eid, file.ID, chunkIDs, model.AIGenerateDocChunkStatusParsing); err != nil {
		return fmt.Errorf("更新分块AI状态失败: %v", err)
	}

	fileTitle := strings.TrimSpace(file.GetAccurateFileName())
	if fileTitle == "" {
		fileTitle = strings.TrimSpace(file.Path)
	}
	anchorContext := buildDocumentChunkEnrichmentAnchorContext(fileTitle, len(chunks))
	generator := rag.NewContentGeneratorService(db)
	tokenizer := rag.NewTokenizerService()
	configVersion := buildDocumentChunkEnrichmentConfigVersion(chunkConfig, generateSummary, generateQuestions)

	inputs := make([]rag.ChunkEnrichmentChunkInput, 0, len(chunks))
	for _, chunk := range chunks {
		inputs = append(inputs, rag.ChunkEnrichmentChunkInput{
			ChunkID:     chunk.ID,
			ChunkIndex:  chunk.ChunkIndex,
			Content:     chunk.Content,
			ContentHash: chunk.ContentHash,
		})
	}

	if err := enrichChunkInputsRecursively(ctx, db, generator, file, fileTitle, chunkConfig, anchorContext, configVersion, tokenizer, inputs, generateSummary, generateQuestions); err != nil {
		return err
	}

	if err := syncDocumentChunkDerivedRetrievalChunks(ctx, db, file, chunkConfig, chunkIDs); err != nil {
		return err
	}

	return nil
}

func enrichChunkInputsRecursively(
	ctx context.Context,
	db *gorm.DB,
	generator *rag.ContentGeneratorService,
	file *model.File,
	fileTitle string,
	chunkConfig *rag.ChunkConfig,
	anchorContext string,
	configVersion string,
	tokenizer *rag.TokenizerService,
	inputs []rag.ChunkEnrichmentChunkInput,
	generateSummary bool,
	generateQuestions bool,
) error {
	if len(inputs) == 0 {
		return nil
	}

	pendingInputs := make([]rag.ChunkEnrichmentChunkInput, 0, len(inputs))
	for _, input := range inputs {
		cacheKey := common.GetDocumentChunkEnrichmentCacheKey(file.Eid, file.ID, input.ContentHash, configVersion, documentChunkEnrichmentPromptVersion)
		if cacheValue, ok := loadChunkEnrichmentCache(ctx, cacheKey); ok {
			if err := persistChunkEnrichmentItem(ctx, db, file, input, rag.ChunkEnrichmentItem{
				Summary:         cacheValue.Summary,
				CommonQuestions: append([]string(nil), cacheValue.CommonQuestions...),
			}, configVersion); err != nil {
				return err
			}
			continue
		}
		pendingInputs = append(pendingInputs, input)
	}

	if len(pendingInputs) == 0 {
		return nil
	}

	if chunkConfig == nil || chunkConfig.LogicChannel == nil || chunkConfig.LogicModelName == nil {
		return fmt.Errorf("未配置逻辑推理渠道，无法生成分块简介和常见问法")
	}

	batches := rag.PartitionChunkEnrichmentChunks(tokenizer, pendingInputs, 0)
	for _, batch := range batches {
		if err := enrichChunkBatchRecursively(ctx, db, generator, file, fileTitle, chunkConfig, anchorContext, configVersion, batch, generateSummary, generateQuestions); err != nil {
			return err
		}
	}
	return nil
}

func enrichChunkBatchRecursively(
	ctx context.Context,
	db *gorm.DB,
	generator *rag.ContentGeneratorService,
	file *model.File,
	fileTitle string,
	chunkConfig *rag.ChunkConfig,
	anchorContext string,
	configVersion string,
	batch []rag.ChunkEnrichmentChunkInput,
	generateSummary bool,
	generateQuestions bool,
) error {
	if len(batch) == 0 {
		return nil
	}

	if len(batch) == 1 {
		return enrichSingleChunk(ctx, db, generator, file, fileTitle, chunkConfig, anchorContext, configVersion, batch[0], generateSummary, generateQuestions)
	}

	items, err := generator.GenerateChunkEnrichmentBatch(ctx, file.Eid, chunkConfig, &rag.ChunkEnrichmentRequest{
		DocumentTitle:     fileTitle,
		AnchorContext:     anchorContext,
		GenerateSummary:   generateSummary,
		GenerateQuestions: generateQuestions,
		Chunks:            batch,
	})
	if err == nil {
		mapped := rag.MapChunkEnrichmentResults(items)
		if len(mapped) > 0 {
			savedIDs := make([]int64, 0, len(mapped))
			for _, input := range batch {
				item, ok := mapped[input.ChunkID]
				if !ok {
					continue
				}
				if err := persistChunkEnrichmentItem(ctx, db, file, input, item, configVersion); err != nil {
					return err
				}
				savedIDs = append(savedIDs, input.ChunkID)
			}

			if len(savedIDs) == len(batch) {
				return nil
			}

			missing := missingChunkInputs(batch, savedIDs)
			if len(missing) == 0 {
				return nil
			}
			if len(missing) == len(batch) {
				// 模型没有返回任何有效项，退化为拆分重试。
			} else {
				return enrichChunkBatchRecursively(ctx, db, generator, file, fileTitle, chunkConfig, anchorContext, configVersion, missing, generateSummary, generateQuestions)
			}
		}
	}

	left, right := splitChunkEnrichmentBatch(batch)
	leftErr := enrichChunkBatchRecursively(ctx, db, generator, file, fileTitle, chunkConfig, anchorContext, configVersion, left, generateSummary, generateQuestions)
	rightErr := enrichChunkBatchRecursively(ctx, db, generator, file, fileTitle, chunkConfig, anchorContext, configVersion, right, generateSummary, generateQuestions)
	if leftErr != nil && rightErr != nil {
		return fmt.Errorf("块级简介生成失败: %v; %v", leftErr, rightErr)
	}
	if leftErr != nil {
		return leftErr
	}
	return rightErr
}

func enrichSingleChunk(
	ctx context.Context,
	db *gorm.DB,
	generator *rag.ContentGeneratorService,
	file *model.File,
	fileTitle string,
	chunkConfig *rag.ChunkConfig,
	anchorContext string,
	configVersion string,
	chunk rag.ChunkEnrichmentChunkInput,
	generateSummary bool,
	generateQuestions bool,
) error {
	items, err := generator.GenerateChunkEnrichmentBatch(ctx, file.Eid, chunkConfig, &rag.ChunkEnrichmentRequest{
		DocumentTitle:     fileTitle,
		AnchorContext:     anchorContext,
		GenerateSummary:   generateSummary,
		GenerateQuestions: generateQuestions,
		Chunks:            []rag.ChunkEnrichmentChunkInput{chunk},
	})
	if err != nil {
		_ = updateDocumentChunkEnrichmentStatuses(db, file.Eid, file.ID, []int64{chunk.ChunkID}, model.AIGenerateDocChunkStatusFail)
		return err
	}

	mapped := rag.MapChunkEnrichmentResults(items)
	item, ok := mapped[chunk.ChunkID]
	if !ok {
		_ = updateDocumentChunkEnrichmentStatuses(db, file.Eid, file.ID, []int64{chunk.ChunkID}, model.AIGenerateDocChunkStatusFail)
		return fmt.Errorf("块 %d 未返回简介或常见问法", chunk.ChunkID)
	}
	return persistChunkEnrichmentItem(ctx, db, file, chunk, item, configVersion)
}

func persistChunkEnrichmentItem(ctx context.Context, db *gorm.DB, file *model.File, input rag.ChunkEnrichmentChunkInput, item rag.ChunkEnrichmentItem, configVersion string) error {
	questionsJSON, err := json.Marshal(item.CommonQuestions)
	if err != nil {
		return fmt.Errorf("序列化常见问法失败: %v", err)
	}

	if err := db.Model(&model.DocumentChunk{}).
		Where("eid = ? AND file_id = ? AND id = ?", file.Eid, file.ID, item.ChunkID).
		Updates(map[string]interface{}{
			"summary":                      strings.TrimSpace(item.Summary),
			"common_questions":             string(questionsJSON),
			"ai_generate_doc_chunk_status": model.AIGenerateDocChunkStatusNormal,
			"updated_time":                 time.Now().UTC().UnixMilli(),
		}).Error; err != nil {
		return fmt.Errorf("保存分块简介失败: %v", err)
	}

	if common.IsRedisEnabled() {
		cacheKey := common.GetDocumentChunkEnrichmentCacheKey(file.Eid, file.ID, input.ContentHash, configVersion, documentChunkEnrichmentPromptVersion)
		cacheValue := documentChunkEnrichmentCacheValue{
			Summary:         strings.TrimSpace(item.Summary),
			CommonQuestions: append([]string(nil), item.CommonQuestions...),
		}
		cacheJSON, marshalErr := json.Marshal(cacheValue)
		if marshalErr == nil {
			if err := common.RedisSet(cacheKey, string(cacheJSON), documentChunkEnrichmentCacheTTL); err != nil {
				logger.Warnf(ctx, "【工具执行】缓存分块增强结果失败: chunk_id=%d, err=%v", item.ChunkID, err)
			}
		}
	}

	return nil
}

func syncDocumentChunkDerivedRetrievalChunks(ctx context.Context, db *gorm.DB, file *model.File, chunkConfig *rag.ChunkConfig, chunkIDs []int64) error {
	if len(chunkIDs) == 0 {
		return nil
	}

	var chunks []model.DocumentChunk
	if err := db.Where("eid = ? AND file_id = ? AND id IN ?", file.Eid, file.ID, chunkIDs).
		Order("chunk_index asc").
		Find(&chunks).Error; err != nil {
		return fmt.Errorf("加载已生成简介的分块失败: %v", err)
	}
	if len(chunks) == 0 {
		return nil
	}

	retrievalService := rag.NewRetrievalChunkService(db)
	savedCount := 0
	for _, chunk := range chunks {
		derivedChunks, err := buildDocumentChunkDerivedRetrievalChunks(retrievalService, &chunk, chunkConfig)
		if err != nil {
			return err
		}
		if len(derivedChunks) == 0 {
			continue
		}

		if err := db.Transaction(func(tx *gorm.DB) error {
			if err := deleteDerivedRetrievalChunksForKnowledge(tx, file.Eid, chunk.ID); err != nil {
				return err
			}
			if err := rag.SaveRetrievalChunksWithDB(tx, file.Eid, file.ID, derivedChunks); err != nil {
				return err
			}
			return nil
		}); err != nil {
			return fmt.Errorf("保存分块派生检索块失败 (chunk %d): %v", chunk.ID, err)
		}
		savedCount++
	}

	if savedCount > 0 {
		logger.Infof(ctx, "【工具执行】分块派生检索块已同步: file_id=%d, saved_chunks=%d", file.ID, savedCount)
	}

	return nil
}

func buildDocumentChunkDerivedRetrievalChunks(retrievalService *rag.RetrievalChunkService, chunk *model.DocumentChunk, chunkConfig *rag.ChunkConfig) ([]model.RetrievalChunk, error) {
	if retrievalService == nil {
		retrievalService = rag.NewRetrievalChunkService(nil)
	}
	if chunk == nil {
		return nil, fmt.Errorf("分块信息不能为空")
	}

	summary := strings.TrimSpace(chunk.Summary)
	questions, err := parseDocumentChunkCommonQuestions(chunk.CommonQuestions)
	if err != nil {
		return nil, fmt.Errorf("解析分块常见问法失败 (chunk %d): %v", chunk.ID, err)
	}

	if summary == "" && len(questions) == 0 {
		return nil, nil
	}

	summaries := make([]string, 0, 1)
	if summary != "" {
		summaries = append(summaries, summary)
	}

	return retrievalService.CreateAdditionalRetrievalChunks(chunk.Eid, chunk, summaries, questions, chunkConfig, 0), nil
}

func parseDocumentChunkCommonQuestions(raw string) ([]string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return []string{}, nil
	}

	var questions []string
	if err := json.Unmarshal([]byte(raw), &questions); err != nil {
		return nil, err
	}
	normalized := make([]string, 0, len(questions))
	for _, question := range questions {
		question = strings.TrimSpace(question)
		if question != "" {
			normalized = append(normalized, question)
		}
	}
	return normalized, nil
}

func deleteDerivedRetrievalChunksForKnowledge(tx *gorm.DB, eid, knowledgeChunkID int64) error {
	var retrievalChunkIDs []int64
	if err := tx.Model(&model.RetrievalChunk{}).
		Where("eid = ? AND knowledge_chunk_id = ? AND chunk_type IN ?", eid, knowledgeChunkID, []string{"summary", "question"}).
		Pluck("id", &retrievalChunkIDs).Error; err != nil {
		return fmt.Errorf("查询旧派生检索块失败: %v", err)
	}

	if len(retrievalChunkIDs) > 0 {
		if err := tx.Where("eid = ? AND retrieval_chunk_id IN ?", eid, retrievalChunkIDs).
			Delete(&model.ChunkRelation{}).Error; err != nil {
			return fmt.Errorf("删除派生检索块关联失败: %v", err)
		}
	}

	if err := tx.Where("eid = ? AND knowledge_chunk_id = ? AND chunk_type IN ?", eid, knowledgeChunkID, []string{"summary", "question"}).
		Delete(&model.RetrievalChunk{}).Error; err != nil {
		return fmt.Errorf("删除旧派生检索块失败: %v", err)
	}
	return nil
}

func loadChunkEnrichmentCache(ctx context.Context, cacheKey string) (*documentChunkEnrichmentCacheValue, bool) {
	if !common.IsRedisEnabled() {
		return nil, false
	}

	cacheText, err := common.RedisGet(cacheKey)
	if err != nil {
		if err != common.ErrRedisNil {
			logger.Warnf(ctx, "【工具执行】读取分块增强缓存失败: key=%s, err=%v", cacheKey, err)
		}
		return nil, false
	}

	var cacheValue documentChunkEnrichmentCacheValue
	if err := json.Unmarshal([]byte(cacheText), &cacheValue); err != nil {
		logger.Warnf(ctx, "【工具执行】解析分块增强缓存失败: key=%s, err=%v", cacheKey, err)
		return nil, false
	}
	return &cacheValue, true
}

func updateDocumentChunkEnrichmentStatuses(db *gorm.DB, eid, fileID int64, chunkIDs []int64, status string) error {
	if len(chunkIDs) == 0 {
		return nil
	}

	return db.Model(&model.DocumentChunk{}).
		Where("eid = ? AND file_id = ? AND id IN ?", eid, fileID, chunkIDs).
		Updates(map[string]interface{}{
			"ai_generate_doc_chunk_status": status,
			"updated_time":                 time.Now().UTC().UnixMilli(),
		}).Error
}

func buildDocumentChunkEnrichmentAnchorContext(fileTitle string, chunkCount int) string {
	if fileTitle == "" {
		fileTitle = "未知文档"
	}
	return fmt.Sprintf("文档标题：%s\n分块数量：%d\n生成要求：仅基于当前块自身内容生成简介和常见问法，不要跨块拼接，不要编造未出现的信息。", fileTitle, chunkCount)
}

func buildDocumentChunkEnrichmentConfigVersion(chunkConfig *rag.ChunkConfig, generateSummary, generateQuestions bool) string {
	if chunkConfig == nil {
		return "unknown"
	}
	return fmt.Sprintf("%d:%d:%s:%t:%t:%s:%s", chunkConfig.ID, chunkConfig.UpdatedTime, chunkConfig.Type, generateSummary, generateQuestions, chunkConfig.SummaryGeneration, chunkConfig.QuestionGeneration)
}

func missingChunkInputs(batch []rag.ChunkEnrichmentChunkInput, savedIDs []int64) []rag.ChunkEnrichmentChunkInput {
	if len(batch) == 0 {
		return nil
	}
	seen := make(map[int64]struct{}, len(savedIDs))
	for _, id := range savedIDs {
		seen[id] = struct{}{}
	}
	missing := make([]rag.ChunkEnrichmentChunkInput, 0, len(batch))
	for _, chunk := range batch {
		if _, ok := seen[chunk.ChunkID]; !ok {
			missing = append(missing, chunk)
		}
	}
	return missing
}

func splitChunkEnrichmentBatch(batch []rag.ChunkEnrichmentChunkInput) ([]rag.ChunkEnrichmentChunkInput, []rag.ChunkEnrichmentChunkInput) {
	if len(batch) <= 1 {
		return batch, nil
	}
	mid := len(batch) / 2
	left := append([]rag.ChunkEnrichmentChunkInput(nil), batch[:mid]...)
	right := append([]rag.ChunkEnrichmentChunkInput(nil), batch[mid:]...)
	return left, right
}
