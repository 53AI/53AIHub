package steps

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	v2model "github.com/53AI/53AIHub/rag-pipeline-v2/model"
	"gorm.io/gorm"
)

type WikiPageGenerationProcessor interface {
	ProcessFile(ctx context.Context, in WikiPageGenerationInput) error
}

type WikiPageGenerationInput struct {
	Eid       int64
	LibraryID int64
	FileID    int64
	JobID     int64
	RunID     string
	Language  string
}

func NewWikiPageGenerationHandler(processor WikiPageGenerationProcessor) func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
	return newWikiPageGenerationHandler(processor)
}

func RecoverWikiPageGeneration(db *gorm.DB, processor WikiPageGenerationProcessor) func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
	return func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
		eid, fileID := extractEidAndFileID(job)

		var file model.File
		if err := db.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				logger.Warnf(ctx, "【流水线恢复】wiki_page_generation: 文件不存在，跳过 (eid=%d, file_id=%d)", eid, fileID)
				return nil
			}
			return err
		}

		logger.Infof(ctx, "【流水线恢复】wiki_page_generation: 重做 wiki 页面生成 (file_id=%d)", fileID)
		return NewWikiPageGenerationHandler(processor)(ctx, job, config)
	}
}

func newWikiPageGenerationHandler(processor WikiPageGenerationProcessor) func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
	return func(ctx context.Context, job *model.RagJob, stepConfig json.RawMessage) error {
		if processor == nil {
			return fmt.Errorf("wiki page generation processor is nil")
		}

		var params map[string]interface{}
		if err := json.Unmarshal([]byte(job.StartParameters), &params); err != nil {
			return fmt.Errorf("解析任务参数失败: %v", err)
		}

		if strings.TrimSpace(job.RuntimeProfile) == "" {
			profileJSON, err := resolveWikiPageGenerationRuntimeProfile(ctx, job)
			if err != nil {
				return fmt.Errorf("解析 Profile 失败: %v", err)
			}
			if strings.TrimSpace(profileJSON) == "" {
				return fmt.Errorf("解析 Profile 失败: runtime profile is empty")
			}
			job.RuntimeProfile = profileJSON
		}

		eid, fileID := extractEidAndFileID(job)
		libraryID := safeToInt64(params["library_id"])
		language := extractWikiPageGenerationLanguage(params, stepConfig)

		err := processor.ProcessFile(ctx, WikiPageGenerationInput{
			Eid:       eid,
			LibraryID: libraryID,
			FileID:    fileID,
			JobID:     job.JobID,
			RunID:     job.RunID,
			Language:  language,
		})
		return err
	}
}

func resolveWikiPageGenerationRuntimeProfile(ctx context.Context, job *model.RagJob) (string, error) {
	if job == nil {
		return "", fmt.Errorf("job is nil")
	}
	if model.DB == nil {
		return "", nil
	}

	var sourceJob model.RagJob
	if err := model.DB.WithContext(ctx).
		Select("runtime_profile_json").
		Where("eid = ? AND run_id = ? AND runtime_profile_json <> ''", job.Eid, job.RunID).
		Order("job_id DESC").
		First(&sourceJob).Error; err == nil && strings.TrimSpace(sourceJob.RuntimeProfile) != "" {
		return sourceJob.RuntimeProfile, nil
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", err
	}

	var file model.File
	if err := model.DB.WithContext(ctx).Where("eid = ? AND id = ?", job.Eid, model.ExtractFileIDFromJob(job)).First(&file).Error; err != nil {
		return "", err
	}
	_, pipelineProfile, err := model.FindHighestPriorityRagRoutingStrategyAndPipelineByFile(model.DB, &file)
	if err != nil {
		return "", err
	}
	if pipelineProfile == nil {
		return "", nil
	}

	var profile v2model.RuntimeProfile
	if err := json.Unmarshal([]byte(pipelineProfile.ProfileJSON), &profile); err != nil {
		return "", err
	}
	profile.ID = pipelineProfile.ID

	profileBytes, err := json.Marshal(profile)
	if err != nil {
		return "", err
	}
	return string(profileBytes), nil
}

func extractWikiPageGenerationLanguage(params map[string]interface{}, stepConfig json.RawMessage) string {
	language := "中文"
	if v, ok := params["language"].(string); ok {
		if trimmed := strings.TrimSpace(v); trimmed != "" {
			language = trimmed
		}
	}

	if len(stepConfig) == 0 || string(stepConfig) == "null" {
		return language
	}

	var cfg struct {
		Language string `json:"language"`
	}
	if err := json.Unmarshal(stepConfig, &cfg); err != nil {
		return language
	}
	if trimmed := strings.TrimSpace(cfg.Language); trimmed != "" {
		language = trimmed
	}
	return language
}
