package steps

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"gorm.io/gorm"
)

// generateFileSummaryAndFAQ 生成文件级摘要和常见问法（强制执行，无 toggle）
// 在 document_chunking 步骤中调用，失败会导致 chunking 步骤失败。
func generateFileSummaryAndFAQ(ctx context.Context, db *gorm.DB, eid, fileID int64, content string, chunkConfig *rag.ChunkConfig) (string, []string, error) {
	logger.Infof(ctx, "【文件摘要】开始生成文件摘要和常见问法: file_id=%d", fileID)

	configService := rag.NewChunkConfigService(db)
	enterpriseConfig, err := configService.GetConfig(eid, nil, model.ChunkTypeDefault)
	if err != nil {
		return "", nil, fmt.Errorf("获取企业默认分块配置失败: %v", err)
	}

	// 优先使用 chunkConfig 的 LLM 配置，否则用企业配置
	generationConfig := enterpriseConfig
	if chunkConfig != nil && chunkConfig.LogicChannel != nil && chunkConfig.LogicModelName != nil {
		generationConfig = chunkConfig
	}

	if generationConfig.LogicChannel == nil || generationConfig.LogicModelName == nil {
		return "", nil, fmt.Errorf("未配置逻辑推理渠道或模型，无法生成摘要和问法")
	}

	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		return "", nil, fmt.Errorf("获取文件失败: %v", err)
	}

	rootTitle := ""
	if err := file.LoadUploadFile(); err == nil && file.UploadFile != nil && file.UploadFile.FileName != "" {
		rootTitle = file.UploadFile.FileName
	}

	contentGenerator := rag.NewContentGeneratorService(db)
	startTime := time.Now()
	resp, _, err := contentGenerator.GenerateSummaryQuestionsKnowledgeMap(ctx, eid, generationConfig, &rag.GenerateSummaryQuestionsKnowledgeMapRequest{
		Content:              content,
		RootTitle:            rootTitle,
		GenerateSummary:      true,
		GenerateQuestions:    true,
		GenerateKnowledgeMap: false,
	})
	elapsed := time.Since(startTime).Milliseconds()

	if err != nil {
		return "", nil, fmt.Errorf("生成摘要和问法失败: %v", err)
	}

	summaryText := ""
	var questions []string
	if resp != nil {
		summaryText = resp.Summary
		questions = resp.Questions
	}

	questionsJSON, _ := json.Marshal(questions)
	updates := map[string]interface{}{
		"summary":               summaryText,
		"questions":             string(questionsJSON),
		"ai_generate_sq_status": model.AIGenerateSQStatusNormal,
	}
	if err := db.Model(&model.File{}).Where("id = ?", fileID).Updates(updates).Error; err != nil {
		return "", nil, fmt.Errorf("更新文件摘要/问法字段失败: %v", err)
	}

	if strings.TrimSpace(summaryText) != "" {
		svc := rag.NewGeneratedContentService(db)
		if err := svc.UpsertSummaryChunks(eid, file, summaryText, generationConfig); err != nil {
			logger.Warnf(ctx, "【文件摘要】更新摘要分块失败(非致命): %v", err)
		}
	}

	logger.Infof(ctx, "【文件摘要】生成完成: file_id=%d, 耗时=%dms, 摘要长度=%d, 问法数=%d",
		fileID, elapsed, len(summaryText), len(questions))

	return summaryText, questions, nil
}

// extractEntities 对文件进行实体抽取（强制执行，无 toggle）
// 在 document_chunking 步骤中调用，失败会导致 chunking 步骤失败。
func extractEntities(ctx context.Context, db *gorm.DB, eid, fileID int64, content string) error {
	logger.Infof(ctx, "【实体抽取】开始: file_id=%d", fileID)

	extractor := rag.NewEntityExtractionService(db)
	if err := extractor.ExtractAndStoreForFileContent(ctx, eid, fileID, content); err != nil {
		return fmt.Errorf("内容实体抽取失败: %v", err)
	}
	if err := extractor.ExtractAndStoreForFileMeta(ctx, eid, fileID); err != nil {
		return fmt.Errorf("元信息实体抽取失败: %v", err)
	}

	logger.Infof(ctx, "【实体抽取】完成: file_id=%d", fileID)
	return nil
}
