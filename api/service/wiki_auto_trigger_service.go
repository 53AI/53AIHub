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
		return nil
	}

	var file model.File
	if err := s.db.WithContext(ctx).Where("eid = ? AND id = ?", in.Eid, in.FileID).First(&file).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}

	library, err := model.GetLibraryByID(in.Eid, file.LibraryID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if library == nil || library.SpaceID <= 0 {
		return nil
	}

	var space model.Space
	if err := s.db.WithContext(ctx).Where("eid = ? AND id = ?", in.Eid, library.SpaceID).First(&space).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if !space.EnableWikiKnowledgeGraph {
		return nil
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
		logger.Warnf(ctx, "wiki auto trigger skipped: missing source run id, file_id=%d", in.FileID)
		return nil
	}

	var existing model.RagJob
	err = s.db.WithContext(ctx).Where(
		"eid = ? AND related_id = ? AND run_id = ? AND type = ?",
		in.Eid, in.FileID, sourceRunID, wikiAutoTriggerJobType,
	).First(&existing).Error
	if err == nil {
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	jobFactory := model.NewRagJobFactory(s.db, common.RDB)
	startParameters := map[string]any{
		"file_id":        in.FileID,
		"library_id":     file.LibraryID,
		"language":       normalizeWikiAutoTriggerLanguage(in.Language),
		"trigger_source": firstNonEmpty(strings.TrimSpace(in.TriggerSource), "auto_after_pipeline"),
		"source_run_id":  sourceRunID,
	}
	startBytes, _ := json.Marshal(startParameters)

	job, err := jobFactory.CreateJobWithoutQueue(ctx, in.Eid, wikiAutoTriggerJobType, string(startBytes))
	if err != nil {
		return err
	}

	if runtimeProfileJSON, err := s.resolveSourceRuntimeProfile(ctx, in.Eid, file.ID, sourceRunID); err != nil {
		logger.Warnf(ctx, "wiki auto trigger resolve runtime profile failed: file_id=%d run_id=%s err=%v", in.FileID, sourceRunID, err)
	} else if strings.TrimSpace(runtimeProfileJSON) != "" {
		normalizedProfileJSON, _, normalizeErr := ensureWikiPageGenerationStep(runtimeProfileJSON)
		if normalizeErr != nil {
			return normalizeErr
		}
		result := s.db.WithContext(ctx).Model(&model.RagJob{}).Where("job_id = ?", job.JobID).Update("runtime_profile_json", normalizedProfileJSON)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return fmt.Errorf("wiki auto trigger runtime profile update affected %d jobs, want 1", result.RowsAffected)
		}
		job.RuntimeProfile = normalizedProfileJSON
		if err := s.persistWikiStepIndex(ctx, job, normalizedProfileJSON); err != nil {
			return err
		}
	}

	job.RunID = sourceRunID
	result := s.db.WithContext(ctx).Model(&model.RagJob{}).Where("job_id = ?", job.JobID).Update("run_id", sourceRunID)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("wiki auto trigger run id update affected %d jobs, want 1", result.RowsAffected)
	}

	if err := s.enqueueWikiJob(ctx, job); err != nil {
		logger.Warnf(ctx, "wiki auto trigger enqueue failed: file_id=%d run_id=%s err=%v", in.FileID, sourceRunID, err)
	}

	if err := model.UpdateFileCleaningRuleInfoHelper(s.db.WithContext(ctx), file.ID, sourceRunID, ""); err != nil {
		logger.Warnf(ctx, "wiki auto trigger refresh file status failed: file_id=%d run_id=%s err=%v", file.ID, sourceRunID, err)
	}

	return nil
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

func (s *WikiAutoTriggerService) resolveSourceRuntimeProfile(ctx context.Context, eid, fileID int64, sourceRunID string) (string, error) {
	if s == nil || s.db == nil {
		return "", fmt.Errorf("wiki auto trigger db is required")
	}

	sourceRunID = strings.TrimSpace(sourceRunID)
	if sourceRunID != "" {
		var sourceJob model.RagJob
		err := s.db.WithContext(ctx).
			Select("runtime_profile_json").
			Where("eid = ? AND related_id = ? AND run_id = ? AND runtime_profile_json <> ''", eid, fileID, sourceRunID).
			Order("job_id DESC").
			First(&sourceJob).Error
		if err == nil && strings.TrimSpace(sourceJob.RuntimeProfile) != "" {
			return sourceJob.RuntimeProfile, nil
		}
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return "", err
		}
	}

	var file model.File
	if err := s.db.WithContext(ctx).Where("eid = ? AND id = ?", eid, fileID).First(&file).Error; err != nil {
		return "", err
	}

	if file.LibraryID <= 0 {
		return "", nil
	}

	_, pipelineProfile, err := model.FindHighestPriorityRagRoutingStrategyAndPipelineByFile(s.db, &file)
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
