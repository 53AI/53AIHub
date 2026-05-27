package steps

import (
	"context"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	ragservice "github.com/53AI/53AIHub/service/rag"
)

type graphBatchExtractionRunner interface {
	ExtractForChunks(ctx context.Context, eid int64, template *model.GraphTemplate, chunks []model.DocumentChunk) ([]ragservice.ExtractedGraphEntity, []ragservice.ExtractedGraphRelation, error)
	StoreBatchExtractionResults(ctx context.Context, instanceID int64, templateID int64, library *model.Library, chunks []model.DocumentChunk, entities []ragservice.ExtractedGraphEntity, relations []ragservice.ExtractedGraphRelation) error
}

type graphBatchTemplateRetryFunc func(ctx context.Context) (*model.GraphTemplate, error)

func collectGraphGenerationKnowledgeChunks(chunks []model.DocumentChunk) ([]model.DocumentChunk, int) {
	filtered := make([]model.DocumentChunk, 0, len(chunks))
	skipped := 0
	for _, chunk := range chunks {
		if chunk.ChunkType != "knowledge" {
			skipped++
			continue
		}
		if len([]rune(strings.TrimSpace(chunk.Content))) < 40 {
			skipped++
			continue
		}
		filtered = append(filtered, chunk)
	}
	return filtered, skipped
}

func runGraphGenerationBatchFlow(ctx context.Context, runner graphBatchExtractionRunner, eid int64, template *model.GraphTemplate, instanceID int64, templateID int64, library *model.Library, chunks []model.DocumentChunk, skippedChunks int, retryTemplateResolver graphBatchTemplateRetryFunc) (processedChunks, totalSkippedChunks, totalEntities, totalRelations, errorCount int, finalTemplate *model.GraphTemplate, err error) {
	if runner == nil {
		return 0, skippedChunks, 0, 0, 0, template, fmt.Errorf("graph batch runner is nil")
	}
	if len(chunks) == 0 {
		return 0, skippedChunks, 0, 0, 0, template, nil
	}

	batches := ragservice.BuildGraphExtractionBatches(chunks, ragservice.GraphExtractionBatchTokenBudget())
	if len(batches) == 0 {
		return 0, skippedChunks, 0, 0, 0, template, nil
	}

	activeTemplate := template
	activeTemplateID := templateID
	firstBatch := batches[0]
	firstBatchEntities, firstBatchRelations, extractErr := runner.ExtractForChunks(ctx, eid, activeTemplate, firstBatch.Chunks)
	if extractErr != nil || len(firstBatchRelations) == 0 {
		if retryTemplateResolver == nil {
			logger.Warnf(ctx, "【图谱生成】首批抽取未通过闸门且未开启智能生成重试: template_id=%d, chunk_ids=%v, err=%v, relations=%d",
				activeTemplate.ID, firstBatch.ChunkIDs, extractErr, len(firstBatchRelations))
			return 0, skippedChunks, 0, 0, 1, activeTemplate, nil
		}

		logger.Warnf(ctx, "【图谱生成】首批抽取未通过闸门，尝试智能生成新模板重试: template_id=%d, chunk_ids=%v, err=%v, relations=%d",
			activeTemplate.ID, firstBatch.ChunkIDs, extractErr, len(firstBatchRelations))
		generatedTemplate, generateErr := retryTemplateResolver(ctx)
		if generateErr != nil || generatedTemplate == nil {
			logger.Warnf(ctx, "【图谱生成】智能生成模板失败，终止当前图谱生成: template_id=%d, err=%v", activeTemplate.ID, generateErr)
			return 0, skippedChunks, 0, 0, 1, activeTemplate, nil
		}

		activeTemplate = generatedTemplate
		activeTemplateID = generatedTemplate.ID
		firstBatchEntities, firstBatchRelations, extractErr = runner.ExtractForChunks(ctx, eid, activeTemplate, firstBatch.Chunks)
		if extractErr != nil || len(firstBatchRelations) == 0 {
			logger.Warnf(ctx, "【图谱生成】智能生成模板首批重试仍未通过闸门，终止当前图谱生成: template_id=%d, err=%v, relations=%d",
				activeTemplate.ID, extractErr, len(firstBatchRelations))
			return 0, skippedChunks, 0, 0, 1, activeTemplate, nil
		}
	}

	if err := runner.StoreBatchExtractionResults(ctx, instanceID, activeTemplateID, library, firstBatch.Chunks, firstBatchEntities, firstBatchRelations); err != nil {
		errorCount++
		logger.SysErrorf("【图谱生成】保存实体关系错误： %v", err)
	} else {
		processedChunks += len(firstBatch.Chunks)
		totalEntities += len(firstBatchEntities)
		totalRelations += len(firstBatchRelations)
	}

	for _, batch := range batches[1:] {
		entities, relations, extractErr := runner.ExtractForChunks(ctx, eid, activeTemplate, batch.Chunks)
		if extractErr != nil {
			errorCount++
			if ragservice.IsFatalError(extractErr) {
				return processedChunks, skippedChunks, totalEntities, totalRelations, errorCount, activeTemplate, extractErr
			}
			continue
		}

		if err := runner.StoreBatchExtractionResults(ctx, instanceID, activeTemplateID, library, batch.Chunks, entities, relations); err != nil {
			errorCount++
			continue
		}

		processedChunks += len(batch.Chunks)
		totalEntities += len(entities)
		totalRelations += len(relations)
	}

	return processedChunks, skippedChunks, totalEntities, totalRelations, errorCount, activeTemplate, nil
}
