package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	v2engines "github.com/53AI/53AIHub/rag-pipeline-v2/engines"
	v2model "github.com/53AI/53AIHub/rag-pipeline-v2/model"
	"gorm.io/gorm"
)

const wikiAutoTriggerJobType = "wiki_page_generation"

type WikiAutoTriggerInput struct {
	Eid           int64
	FileID        int64
	SourceRunID   string
	Language      string
	TriggerSource string
}

type WikiAutoTriggerService struct {
	db *gorm.DB
}

func NewWikiAutoTriggerService(db *gorm.DB) *WikiAutoTriggerService {
	return &WikiAutoTriggerService{db: db}
}

func (s *WikiAutoTriggerService) MaybeEnqueueWikiGeneration(ctx context.Context, in WikiAutoTriggerInput) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("wiki auto trigger db is required")
	}
	if in.Eid <= 0 || in.FileID <= 0 {
		logger.Infof(ctx, "【Wiki生成】 跳过自动 Wiki: ID 无效 eid=%d file_id=%d", in.Eid, in.FileID)
		return nil
	}

	var file model.File
	if err := s.db.WithContext(ctx).Where("eid = ? AND id = ?", in.Eid, in.FileID).First(&file).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			logger.Infof(ctx, "【Wiki生成】 跳过自动 Wiki: 文件不存在 file_id=%d", in.FileID)
			return nil
		}
		return err
	}

	var library model.Library
	err := s.db.WithContext(ctx).Where("eid = ? AND id = ?", in.Eid, file.LibraryID).First(&library).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			logger.Infof(ctx, "【Wiki生成】 跳过自动 Wiki: 知识库不存在 file_id=%d library_id=%d", in.FileID, file.LibraryID)
			return nil
		}
		return err
	}
	if library.SpaceID <= 0 {
		logger.Infof(ctx, "【Wiki生成】 跳过自动 Wiki: 知识库未关联空间 file_id=%d library_id=%d", in.FileID, library.ID)
		return nil
	}

	var space model.Space
	if err := s.db.WithContext(ctx).Where("eid = ? AND id = ?", in.Eid, library.SpaceID).First(&space).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			logger.Infof(ctx, "【Wiki生成】 跳过自动 Wiki: 空间不存在 file_id=%d space_id=%d", in.FileID, library.SpaceID)
			return nil
		}
		return err
	}
	if !space.EnableWikiKnowledgeGraph {
		logger.Infof(ctx, "【Wiki生成】 跳过自动 Wiki: 空间开关未开启 file_id=%d space_id=%d", in.FileID, space.ID)
		return nil
	}

	// Wiki 生成范围与普通图谱范围独立维护；空范围表示该空间全部知识库。
	wikiLibraryIDs, err := model.GetSpaceKnowledgeGraphLibraryIDs(s.db.WithContext(ctx), in.Eid, library.SpaceID, model.SpaceKnowledgeGraphScopeWiki)
	if err != nil {
		return err
	}
	if len(wikiLibraryIDs) > 0 {
		matched := false
		for _, libraryID := range wikiLibraryIDs {
			if libraryID == file.LibraryID {
				matched = true
				break
			}
		}
		if !matched {
			logger.Infof(ctx, "【Wiki生成】 跳过自动 Wiki: 知识库不在 Wiki 范围 file_id=%d library_id=%d", in.FileID, file.LibraryID)
			return nil
		}
	}

	sourceRunID := strings.TrimSpace(in.SourceRunID)
	if sourceRunID == "" {
		var info model.FileCleaningRuleInfo
		if strings.TrimSpace(file.CleaningRuleInfo) != "" {
			_ = json.Unmarshal([]byte(file.CleaningRuleInfo), &info)
		}
		sourceRunID = strings.TrimSpace(info.RunID)
	}
	if sourceRunID == "" {
		logger.Warnf(ctx, "【Wiki生成】 跳过自动 Wiki: 缺少来源运行 ID file_id=%d", in.FileID)
		return nil
	}

	var existing model.RagJob
	err = s.db.WithContext(ctx).Where(
		"eid = ? AND related_id = ? AND run_id = ? AND type = ?",
		in.Eid, in.FileID, sourceRunID, wikiAutoTriggerJobType,
	).First(&existing).Error
	if err == nil {
		logger.Infof(ctx, "【Wiki生成】 跳过自动 Wiki: 已存在任务 file_id=%d run_id=%s job_id=%d", in.FileID, sourceRunID, existing.JobID)
		refreshFileRAGStatus(ctx, s.db, file.ID, sourceRunID)
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	job, err := s.createWikiGenerationJob(ctx, in.Eid, in.FileID, file.LibraryID, in.Language, in.TriggerSource, sourceRunID)
	if err != nil {
		logger.Warnf(ctx, "【Wiki生成】 创建 Wiki 管线任务失败 file_id=%d run_id=%s err=%v", in.FileID, sourceRunID, err)
		return nil
	}
	if job == nil {
		logger.Warnf(ctx, "【Wiki生成】 跳过自动 Wiki: 未找到 Wiki 管线 file_id=%d run_id=%s", in.FileID, sourceRunID)
		return nil
	}

	if err := s.enqueueWikiJob(ctx, job); err != nil {
		logger.Warnf(ctx, "【Wiki生成】 Wiki 任务入队失败 file_id=%d run_id=%s job_id=%d err=%v", in.FileID, sourceRunID, job.JobID, err)
	} else {
		logger.Infof(ctx, "【Wiki生成】 Wiki 任务已入队 file_id=%d run_id=%s job_id=%d pipeline_id=%d", in.FileID, sourceRunID, job.JobID, job.PipelineID)
	}
	refreshFileRAGStatus(ctx, s.db, file.ID, sourceRunID)

	return nil
}

func (s *WikiAutoTriggerService) createWikiGenerationJob(ctx context.Context, eid, fileID, libraryID int64, language, triggerSource, runID string) (*model.RagJob, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("wiki auto trigger db is required")
	}

	pipelineID, runtimeProfileJSON, err := s.resolveSourceRuntimeProfile(ctx, eid, fileID)
	if err != nil {
		return nil, err
	}
	if pipelineID <= 0 || strings.TrimSpace(runtimeProfileJSON) == "" {
		return nil, nil
	}

	normalizedProfileJSON, _, err := ensureWikiPageGenerationStep(runtimeProfileJSON)
	if err != nil {
		return nil, err
	}
	startParameters := map[string]any{
		"file_id":        fileID,
		"library_id":     libraryID,
		"language":       normalizeWikiAutoTriggerLanguage(language),
		"trigger_source": firstNonEmpty(strings.TrimSpace(triggerSource), "auto_after_pipeline"),
		"source_run_id":  runID,
	}
	startBytes, err := json.Marshal(startParameters)
	if err != nil {
		return nil, err
	}

	jobFactory := model.NewRagJobFactory(s.db, common.RDB)
	job, err := jobFactory.CreateJobWithoutQueue(ctx, eid, wikiAutoTriggerJobType, string(startBytes))
	if err != nil {
		return nil, err
	}
	cleanup := func(cause error) (*model.RagJob, error) {
		if deleteErr := s.db.WithContext(ctx).Delete(&model.RagJob{}, "job_id = ?", job.JobID).Error; deleteErr != nil {
			return nil, fmt.Errorf("%w; cleanup wiki job %d failed: %v", cause, job.JobID, deleteErr)
		}
		return nil, cause
	}

	result := s.db.WithContext(ctx).Model(&model.RagJob{}).Where("job_id = ?", job.JobID).Updates(map[string]interface{}{
		"pipeline_id":          pipelineID,
		"runtime_profile_json": normalizedProfileJSON,
	})
	if result.Error != nil {
		return cleanup(result.Error)
	}
	if result.RowsAffected != 1 {
		return cleanup(fmt.Errorf("wiki auto trigger runtime profile update affected %d jobs, want 1", result.RowsAffected))
	}
	job.PipelineID = pipelineID
	job.RuntimeProfile = normalizedProfileJSON
	if err := s.persistWikiStepIndex(ctx, job, normalizedProfileJSON); err != nil {
		return cleanup(err)
	}

	job.RunID = strings.TrimSpace(runID)
	result = s.db.WithContext(ctx).Model(&model.RagJob{}).Where("job_id = ?", job.JobID).Update("run_id", job.RunID)
	if result.Error != nil {
		return cleanup(result.Error)
	}
	if result.RowsAffected != 1 {
		return cleanup(fmt.Errorf("wiki auto trigger run id update affected %d jobs, want 1", result.RowsAffected))
	}
	return job, nil
}

func refreshFileRAGStatus(ctx context.Context, db *gorm.DB, fileID int64, runID string) {
	var ragJobCount int64
	if err := db.WithContext(ctx).Model(&model.RagJob{}).
		Where("related_id = ? AND run_id = ? AND type NOT IN ?", fileID, runID, []string{"wiki_page_generation", "wiki_page_vectorization", "graph_pipeline_generation", "generate_knowledge_map"}).
		Count(&ragJobCount).Error; err != nil || ragJobCount == 0 {
		return
	}
	if err := model.UpdateFileCleaningRuleInfoHelper(db.WithContext(ctx), fileID, runID, ""); err != nil {
		logger.Warnf(ctx, "【Wiki生成】 phase=auto_trigger_refresh RAG file status failed: file_id=%d run_id=%s err=%v", fileID, runID, err)
	}
}

func ensureWikiPageGenerationStep(runtimeProfileJSON string) (string, int, error) {
	var profile v2model.RuntimeProfile
	if err := json.Unmarshal([]byte(runtimeProfileJSON), &profile); err != nil {
		return "", -1, fmt.Errorf("parse wiki auto trigger runtime profile: %w", err)
	}

	stepIndex := -1
	for index := range profile.Steps {
		if profile.Steps[index].StepKey == wikiAutoTriggerJobType {
			stepIndex = index
			profile.Steps[index].Enabled = true
			profile.Steps[index].RunMode = v2model.RunModeAuto
			break
		}
	}
	if stepIndex < 0 {
		profile.Steps = append(profile.Steps, v2model.ProfileStep{
			Enabled: true,
			RunMode: v2model.RunModeAuto,
			StepKey: wikiAutoTriggerJobType,
			Config:  json.RawMessage(`{}`),
		})
		stepIndex = len(profile.Steps) - 1
	}

	normalized, err := json.Marshal(profile)
	if err != nil {
		return "", -1, fmt.Errorf("marshal wiki auto trigger runtime profile: %w", err)
	}
	return string(normalized), stepIndex, nil
}

func (s *WikiAutoTriggerService) persistWikiStepIndex(ctx context.Context, job *model.RagJob, runtimeProfileJSON string) error {
	if job == nil {
		return fmt.Errorf("wiki auto trigger job is nil")
	}

	var profile v2model.RuntimeProfile
	if err := json.Unmarshal([]byte(runtimeProfileJSON), &profile); err != nil {
		return fmt.Errorf("parse wiki auto trigger runtime profile: %w", err)
	}

	stepIndex := -1
	for index, step := range profile.Steps {
		if step.StepKey == wikiAutoTriggerJobType {
			stepIndex = index
			break
		}
	}

	var params map[string]interface{}
	if strings.TrimSpace(job.StartParameters) != "" {
		if err := json.Unmarshal([]byte(job.StartParameters), &params); err != nil {
			return fmt.Errorf("parse wiki auto trigger start parameters: %w", err)
		}
	}
	if params == nil {
		params = make(map[string]interface{})
	}
	params["__profile_step_index"] = stepIndex

	startParameters, err := json.Marshal(params)
	if err != nil {
		return fmt.Errorf("marshal wiki auto trigger start parameters: %w", err)
	}
	if err := s.db.WithContext(ctx).Model(&model.RagJob{}).Where("job_id = ?", job.JobID).Update("start_parameters", string(startParameters)).Error; err != nil {
		return err
	}
	job.StartParameters = string(startParameters)
	return nil
}

func (s *WikiAutoTriggerService) resolveSourceRuntimeProfile(ctx context.Context, eid, fileID int64) (int64, string, error) {
	if s == nil || s.db == nil {
		return 0, "", fmt.Errorf("wiki auto trigger db is required")
	}

	var file model.File
	if err := s.db.WithContext(ctx).Where("eid = ? AND id = ?", eid, fileID).First(&file).Error; err != nil {
		return 0, "", err
	}

	if file.LibraryID <= 0 {
		return 0, "", nil
	}

	_, pipelineProfile, err := model.FindHighestPriorityWikiRoutingStrategyAndPipelineByFile(s.db, &file)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, "", nil
		}
		return 0, "", err
	}
	if pipelineProfile == nil {
		return 0, "", nil
	}

	var profile v2model.RuntimeProfile
	if err := json.Unmarshal([]byte(pipelineProfile.ProfileJSON), &profile); err != nil {
		return 0, "", err
	}
	profile.ID = pipelineProfile.ID

	profileBytes, err := json.Marshal(profile)
	if err != nil {
		return 0, "", err
	}
	return pipelineProfile.ID, string(profileBytes), nil
}

func (s *WikiAutoTriggerService) enqueueWikiJob(ctx context.Context, job *model.RagJob) error {
	if job == nil {
		return fmt.Errorf("job is nil")
	}
	if !common.IsRedisEnabled() || common.RDB == nil {
		return fmt.Errorf("redis is disabled")
	}

	wrapper := v2engines.JobWrapper{
		JobID:      job.JobID,
		Eid:        job.Eid,
		Type:       job.Type,
		EnqueuedAt: time.Now(),
		Retries:    0,
	}
	wrapperBytes, err := json.Marshal(wrapper)
	if err != nil {
		return err
	}
	queueName := fmt.Sprintf("rag:job:queue:%s", job.Type)
	return common.RDB.LPush(ctx, queueName, wrapperBytes).Err()
}

func normalizeWikiAutoTriggerLanguage(language string) string {
	language = strings.TrimSpace(language)
	if language == "" {
		return "中文"
	}
	return language
}
