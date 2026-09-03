package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	v2steps "github.com/53AI/53AIHub/rag-pipeline-v2/steps"
	"github.com/53AI/53AIHub/service/rag"
	"gorm.io/gorm"
)

type wikiPageGenerationProcessor struct {
	db *gorm.DB
}

func NewWikiPageGenerationProcessor(db *gorm.DB) v2steps.WikiPageGenerationProcessor {
	return &wikiPageGenerationProcessor{db: db}
}

func (p *wikiPageGenerationProcessor) ProcessFile(ctx context.Context, in v2steps.WikiPageGenerationInput) error {
	if p == nil || p.db == nil {
		return fmt.Errorf("wiki page generation processor is nil")
	}
	guard := newWikiFileGenerationGuard(p.db, in.Eid, in.FileID)
	if err := guard(ctx, p.db); err != nil {
		return err
	}

	var file model.File
	if err := p.db.WithContext(ctx).Where("eid = ? AND id = ?", in.Eid, in.FileID).First(&file).Error; err != nil {
		return fmt.Errorf("获取文件信息失败: %v", err)
	}

	libraryID := in.LibraryID
	if libraryID <= 0 {
		libraryID = file.LibraryID
	}

	title := strings.TrimSpace(file.Path)
	if err := file.LoadUploadFile(); err == nil && file.UploadFile != nil {
		title = firstNonEmpty(file.UploadFile.FileName, title)
	}
	title = firstNonEmpty(title, fmt.Sprintf("file-%d", file.ID))

	fileBody, err := model.GetLastFileBodyByFileID(in.Eid, in.FileID)
	if err != nil {
		return fmt.Errorf("获取文件内容失败: %v", err)
	}
	if fileBody == nil {
		return fmt.Errorf("文件内容为空，无法生成 wiki 页面")
	}

	content, err := fileBody.GetContent()
	if err != nil {
		return fmt.Errorf("读取文件内容失败: %v", err)
	}
	if strings.TrimSpace(content) == "" {
		return nil
	}

	generationConfig, err := selectWikiPageGenerationConfig(ctx, p.db, in.Eid, libraryID, in.FileID)
	if err != nil {
		return err
	}

	// 解析空间 wiki 配置
	enableKnowledgeGraph, enableDynamicKnowledge, wikiGenerationMode := resolveWikiSpaceConfig(ctx, p.db, in.Eid, libraryID)
	enableDynamicKnowledge = enableKnowledgeGraph && enableDynamicKnowledge

	usageRecorder := NewWikiPromptUsageRecorder()
	wikiRunner := NewWikiPromptLLMRunner(p.db, generationConfig, WithWikiPromptUsageRecorder(usageRecorder))
	wikiSvc := NewWikiIngestV2Service(p.db, wikiRunner)
	wikiSvc.fileGuard = newWikiFileGenerationGuard(p.db, in.Eid, in.FileID)
	defer func() {
		summary := usageRecorder.Snapshot()
		status := "success"
		if err != nil {
			status = "failed"
		}
		recordWikiGenerationObservation(ctx, WikiGenerationObservation{Eid: in.Eid, FileID: in.FileID, JobID: in.JobID, Phase: "llm", Status: status, Reason: "usage_summary", LLMCalls: summary.CallCount, PromptTokens: summary.PromptTokens, CompletionTokens: summary.CompletionTokens, TotalTokens: summary.TotalTokens, Data: map[string]interface{}{"type": "usage_summary"}})
		logger.Infof(ctx, "【Wiki生成】 phase=usage 文档生成 token 汇总 file_id=%d library_id=%d job_id=%d prompt_tokens=%d completion_tokens=%d total_tokens=%d call_count=%d",
			in.FileID, libraryID, in.JobID, summary.PromptTokens, summary.CompletionTokens, summary.TotalTokens, summary.CallCount)
		if in.JobID <= 0 {
			return
		}
		if summary.PromptTokens == 0 && summary.CompletionTokens == 0 && summary.TotalTokens == 0 && summary.CallCount == 0 {
			return
		}
		if updateErr := model.UpdateRagJobWikiUsage(p.db.WithContext(ctx), in.JobID, summary); updateErr != nil {
			logger.Warnf(ctx, "【Wiki生成】 phase=usage 更新 Wiki 任务使用量失败: job_id=%d err=%v", in.JobID, updateErr)
		}
	}()

	_, err = wikiSvc.ProcessDocument(ctx, WikiIngestV2MapDocumentInput{
		Eid:                        in.Eid,
		LibraryID:                  libraryID,
		FileID:                     in.FileID,
		JobID:                      in.JobID,
		Title:                      title,
		Content:                    content,
		Language:                   in.Language,
		EnableWikiKnowledgeGraph:   enableKnowledgeGraph,
		EnableWikiDynamicKnowledge: enableDynamicKnowledge,
		WikiGenerationMode:         wikiGenerationMode,
	})
	return err
}

// resolveWikiSpaceConfig 根据文件所在的空间解析 wiki 功能开关
func resolveWikiSpaceConfig(ctx context.Context, db *gorm.DB, eid, libraryID int64) (enableKnowledgeGraph, enableDynamicKnowledge bool, generationMode string) {
	if db == nil || libraryID <= 0 {
		return false, false, model.WikiGenerationModeLazy
	}
	var library model.Library
	if err := db.WithContext(ctx).Where("eid = ? AND id = ?", eid, libraryID).First(&library).Error; err != nil {
		return false, false, model.WikiGenerationModeLazy
	}
	if library.SpaceID <= 0 {
		return false, false, model.WikiGenerationModeLazy
	}
	space, err := model.GetSpaceByID(eid, library.SpaceID)
	if err != nil || space == nil {
		return false, false, model.WikiGenerationModeLazy
	}
	return space.EnableWikiKnowledgeGraph, space.EnableWikiDynamicKnowledge, model.NormalizeWikiGenerationMode(space.WikiGenerationMode)
}

func selectWikiPageGenerationConfig(ctx context.Context, db *gorm.DB, eid, libraryID, fileID int64) (*rag.ChunkConfig, error) {
	configService := rag.NewChunkConfigService(db)
	if _, err := configService.GetConfigWithFileID(eid, &libraryID, &fileID); err != nil {
		logger.Warnf(ctx, "【Wiki生成】 phase=config 获取 Wiki 页面生成分块配置失败，将继续使用企业默认逻辑推理配置: %v", err)
	}

	enterpriseConfig, enterpriseErr := configService.GetEnterpriseEmbeddingConfig(eid)
	if enterpriseErr != nil {
		return nil, fmt.Errorf("获取企业默认分块配置失败: %v", enterpriseErr)
	}

	if enterpriseConfig == nil {
		return nil, fmt.Errorf("未配置企业默认逻辑推理渠道，无法生成 wiki 页面")
	}
	if enterpriseConfig.LogicChannel == nil {
		return nil, fmt.Errorf("未配置企业默认逻辑推理渠道，无法生成 wiki 页面")
	}
	if enterpriseConfig.LogicModelName == nil || strings.TrimSpace(*enterpriseConfig.LogicModelName) == "" {
		return nil, fmt.Errorf("未配置企业默认逻辑推理模型，无法生成 wiki 页面")
	}
	return enterpriseConfig, nil
}
