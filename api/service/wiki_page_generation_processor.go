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
	enableKnowledgeGraph, enableDynamicKnowledge := resolveWikiSpaceConfig(ctx, p.db, in.Eid, libraryID)
	enableDynamicKnowledge = enableKnowledgeGraph && enableDynamicKnowledge

	usageRecorder := NewWikiPromptUsageRecorder()
	wikiRunner := NewWikiPromptLLMRunner(p.db, generationConfig, WithWikiPromptUsageRecorder(usageRecorder))
	wikiSvc := NewWikiIngestV2Service(p.db, wikiRunner)
	defer func() {
		if in.JobID <= 0 {
			return
		}
		summary := usageRecorder.Snapshot()
		if summary.PromptTokens == 0 && summary.CompletionTokens == 0 && summary.TotalTokens == 0 && summary.CallCount == 0 {
			return
		}
		if updateErr := model.UpdateRagJobWikiUsage(p.db.WithContext(ctx), in.JobID, summary); updateErr != nil {
			logger.Warnf(ctx, "更新 wiki job 使用量失败: job_id=%d err=%v", in.JobID, updateErr)
		}
	}()

	_, err = wikiSvc.ProcessDocument(ctx, WikiIngestV2MapDocumentInput{
		Eid:                        in.Eid,
		LibraryID:                  libraryID,
		FileID:                     in.FileID,
		Title:                      title,
		Content:                    content,
		Language:                   in.Language,
		EnableWikiKnowledgeGraph:   enableKnowledgeGraph,
		EnableWikiDynamicKnowledge: enableDynamicKnowledge,
	})
	return err
}

// resolveWikiSpaceConfig 根据文件所在的空间解析 wiki 功能开关
func resolveWikiSpaceConfig(ctx context.Context, db *gorm.DB, eid, libraryID int64) (enableKnowledgeGraph, enableDynamicKnowledge bool) {
	if db == nil || libraryID <= 0 {
		return false, false
	}
	var library model.Library
	if err := db.WithContext(ctx).Where("eid = ? AND id = ?", eid, libraryID).First(&library).Error; err != nil {
		return false, false
	}
	if library.SpaceID <= 0 {
		return false, false
	}
	space, err := model.GetSpaceByID(eid, library.SpaceID)
	if err != nil || space == nil {
		return false, false
	}
	return space.EnableWikiKnowledgeGraph, space.EnableWikiDynamicKnowledge
}

func selectWikiPageGenerationConfig(ctx context.Context, db *gorm.DB, eid, libraryID, fileID int64) (*rag.ChunkConfig, error) {
	configService := rag.NewChunkConfigService(db)
	if _, err := configService.GetConfigWithFileID(eid, &libraryID, &fileID); err != nil {
		logger.Warnf(ctx, "获取 wiki 页面生成分块配置失败，将继续使用企业默认逻辑推理配置: %v", err)
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
