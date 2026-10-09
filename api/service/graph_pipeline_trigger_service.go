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
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// graphPipelineJobType 图谱管线任务的独立 job type。
// 与 RAG 管线内的 graph_generation 步骤隔离：幂等去重、队列、恢复均按该 type 独立，
// 且不设置 pipeline_id，避免引擎统计写入 RAG 管线表。
const graphPipelineJobType = "graph_pipeline_generation"
const graphPipelineStartLockTTL = time.Minute

var ErrGraphPipelineAlreadyRunning = errors.New("graph pipeline job is already running")
var ErrInvalidGraphPipelineStart = errors.New("invalid graph pipeline start request")

type GraphPipelineStartInput struct {
	Eid         int64
	FileID      int64
	PipelineID  int64
	StrategyID  int64
	SourceJobID int64
	Config      json.RawMessage
}

// GraphPipelineTriggerInput 图谱管线自动触发输入
type GraphPipelineTriggerInput struct {
	Eid           int64
	FileID        int64
	SourceRunID   string
	TriggerSource string
}

// GraphPipelineTriggerService 在 RAG 管线自动步骤跑完后触发图谱管线处理
type GraphPipelineTriggerService struct {
	db *gorm.DB
}

func NewGraphPipelineTriggerService(db *gorm.DB) *GraphPipelineTriggerService {
	return &GraphPipelineTriggerService{db: db}
}

func (s *GraphPipelineTriggerService) StartGraphGeneration(ctx context.Context, in GraphPipelineStartInput) (*model.RagJob, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("graph pipeline trigger db is required")
	}
	if in.Eid <= 0 || in.FileID <= 0 {
		return nil, fmt.Errorf("%w: eid and file_id are required", ErrInvalidGraphPipelineStart)
	}
	releaseStartLock, locked, err := acquireGraphPipelineStartLock(ctx, in.Eid, in.FileID)
	if err != nil {
		return nil, err
	}
	if !locked {
		return nil, ErrGraphPipelineAlreadyRunning
	}
	defer releaseStartLock()

	var file model.File
	if err := s.db.WithContext(ctx).Where("eid = ? AND id = ?", in.Eid, in.FileID).First(&file).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("%w: graph pipeline file not found", ErrInvalidGraphPipelineStart)
		}
		return nil, err
	}
	var library model.Library
	if err := s.db.WithContext(ctx).Where("eid = ? AND id = ?", in.Eid, file.LibraryID).First(&library).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("%w: graph pipeline library not found", ErrInvalidGraphPipelineStart)
		}
		return nil, err
	}
	if library.SpaceID <= 0 {
		return nil, fmt.Errorf("%w: file is not in a knowledge graph space", ErrInvalidGraphPipelineStart)
	}
	var space model.Space
	if err := s.db.WithContext(ctx).Where("eid = ? AND id = ?", in.Eid, library.SpaceID).First(&space).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("%w: graph pipeline space not found", ErrInvalidGraphPipelineStart)
		}
		return nil, err
	}
	if !space.EnableKnowledgeGraph {
		return nil, fmt.Errorf("%w: knowledge graph is disabled for the space", ErrInvalidGraphPipelineStart)
	}
	libraryIDs, err := model.GetSpaceKnowledgeGraphLibraryIDs(s.db.WithContext(ctx), in.Eid, library.SpaceID, model.SpaceKnowledgeGraphScopeNormal)
	if err != nil {
		return nil, err
	}
	if len(libraryIDs) > 0 && !containsID(libraryIDs, file.LibraryID) {
		return nil, fmt.Errorf("%w: file library is outside the graph scope", ErrInvalidGraphPipelineStart)
	}

	if in.SourceJobID > 0 {
		var sourceJob model.RagJob
		if err := s.db.WithContext(ctx).Where(
			"job_id = ? AND eid = ? AND related_id = ? AND type = ?",
			in.SourceJobID, in.Eid, in.FileID, "graph_generation",
		).First(&sourceJob).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, fmt.Errorf("%w: legacy graph source job is invalid", ErrInvalidGraphPipelineStart)
			}
			return nil, err
		}
	}

	var running model.RagJob
	err = s.db.WithContext(ctx).Where(
		"eid = ? AND related_id = ? AND type = ? AND status IN ?",
		in.Eid, in.FileID, graphPipelineJobType, []string{model.RagJobStatusPending, model.RagJobStatusProcessing},
	).First(&running).Error
	if err == nil {
		return nil, ErrGraphPipelineAlreadyRunning
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	strategy, pipeline, err := s.resolveGraphPipelineForStart(ctx, &file, in)
	if err != nil {
		return nil, err
	}
	var profile v2model.RuntimeProfile
	if err := json.Unmarshal([]byte(pipeline.ProfileJSON), &profile); err != nil {
		return nil, fmt.Errorf("%w: parse graph pipeline profile failed: %v", ErrInvalidGraphPipelineStart, err)
	}
	stepIndex := -1
	for index, step := range profile.Steps {
		if step.StepKey == "graph_generation" {
			stepIndex = index
			if !graphPipelineStepEnabled(step) {
				return nil, fmt.Errorf("%w: graph_generation step is disabled", ErrInvalidGraphPipelineStart)
			}
			break
		}
	}
	if stepIndex < 0 {
		return nil, fmt.Errorf("%w: graph pipeline has no graph_generation step", ErrInvalidGraphPipelineStart)
	}
	if len(in.Config) > 0 {
		if err := mergeGraphGenerationConfig(&profile.Steps[stepIndex], in.Config); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrInvalidGraphPipelineStart, err)
		}
		if !graphPipelineStepEnabled(profile.Steps[stepIndex]) {
			return nil, fmt.Errorf("%w: graph_generation step is disabled", ErrInvalidGraphPipelineStart)
		}
	}
	profileJSON, err := json.Marshal(profile)
	if err != nil {
		return nil, fmt.Errorf("%w: serialize graph pipeline profile failed: %v", ErrInvalidGraphPipelineStart, err)
	}
	if templateID, err := model.GraphPipelineTemplateIDFromProfile(string(profileJSON)); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidGraphPipelineStart, err)
	} else if templateID > 0 {
		var template model.GraphTemplate
		if err := s.db.WithContext(ctx).Where("eid = ? AND id = ?", in.Eid, templateID).First(&template).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, fmt.Errorf("%w: graph template is invalid", ErrInvalidGraphPipelineStart)
			}
			return nil, err
		}
	}

	startParameters := map[string]any{
		"eid":                  in.Eid,
		"file_id":              in.FileID,
		"library_id":           file.LibraryID,
		"user_id":              file.UserID,
		"trigger_source":       "legacy_retry",
		"__profile_step_index": stepIndex,
	}
	if in.SourceJobID > 0 {
		startParameters["source_job_id"] = in.SourceJobID
	}
	if strategy != nil {
		startParameters["strategy_id"] = strategy.ID
	}
	return s.createAndEnqueueGraphPipelineJob(ctx, in.Eid, profile, startParameters)
}

func mergeGraphGenerationConfig(step *v2model.ProfileStep, override json.RawMessage) error {
	var base, updates map[string]json.RawMessage
	if len(step.Config) > 0 {
		if err := json.Unmarshal(step.Config, &base); err != nil || base == nil {
			return errors.New("graph_generation config must be an object")
		}
	}
	if err := json.Unmarshal(override, &updates); err != nil || updates == nil {
		return errors.New("graph_generation config override must be an object")
	}
	if base == nil {
		base = make(map[string]json.RawMessage, len(updates))
	}
	for key, value := range updates {
		base[key] = value
	}
	if rawEnabled, ok := base["enabled"]; ok {
		var enabled bool
		if err := json.Unmarshal(rawEnabled, &enabled); err != nil || !enabled {
			return errors.New("graph_generation enabled must remain true")
		}
	}
	config, err := json.Marshal(base)
	if err != nil {
		return err
	}
	step.Config = config
	return nil
}

func (s *GraphPipelineTriggerService) resolveGraphPipelineForStart(ctx context.Context, file *model.File, in GraphPipelineStartInput) (*model.RagRoutingStrategy, *model.RagPipelineProfile, error) {
	var strategy *model.RagRoutingStrategy
	if in.StrategyID > 0 {
		var selected model.RagRoutingStrategy
		if err := s.db.WithContext(ctx).Where("eid = ? AND id = ? AND kind = ? AND enabled = ?", in.Eid, in.StrategyID, model.PipelineKindGraph, true).First(&selected).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, nil, fmt.Errorf("%w: graph routing strategy is invalid", ErrInvalidGraphPipelineStart)
			}
			return nil, nil, err
		}
		strategy = &selected
		if in.PipelineID > 0 && strategy.PipelineID != in.PipelineID {
			return nil, nil, fmt.Errorf("%w: graph strategy and pipeline do not match", ErrInvalidGraphPipelineStart)
		}
	}

	if in.PipelineID == 0 && strategy == nil {
		resolvedStrategy, pipeline, err := model.FindHighestPriorityGraphRoutingStrategyAndPipelineByFile(s.db.WithContext(ctx), file)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, nil, fmt.Errorf("%w: graph routing strategy not found", ErrInvalidGraphPipelineStart)
			}
			return nil, nil, err
		}
		strategy = resolvedStrategy
		if strategy == nil || pipeline == nil || strategy.Eid != in.Eid || strategy.Kind != model.PipelineKindGraph || !strategy.Enabled || pipeline.Eid != in.Eid || pipeline.Kind != model.PipelineKindGraph || pipeline.Status != model.RagPipelineStatusEnabled {
			return nil, nil, fmt.Errorf("%w: graph routing resolved an invalid or disabled pipeline", ErrInvalidGraphPipelineStart)
		}
		return strategy, pipeline, nil
	}

	pipelineID := in.PipelineID
	if pipelineID == 0 {
		pipelineID = strategy.PipelineID
	}
	var pipeline model.RagPipelineProfile
	if err := s.db.WithContext(ctx).Where(
		"eid = ? AND id = ? AND kind = ? AND status = ?",
		in.Eid, pipelineID, model.PipelineKindGraph, model.RagPipelineStatusEnabled,
	).First(&pipeline).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, fmt.Errorf("%w: graph pipeline is invalid or disabled", ErrInvalidGraphPipelineStart)
		}
		return nil, nil, err
	}
	return strategy, &pipeline, nil
}

func containsID(ids []int64, target int64) bool {
	for _, id := range ids {
		if id == target {
			return true
		}
	}
	return false
}

// MaybeEnqueueGraphGeneration 空间图谱开关开启且文件在知识库范围内时，
// 匹配启用的图谱策略（含兜底），使用命中图谱管线创建独立图谱任务。
func (s *GraphPipelineTriggerService) MaybeEnqueueGraphGeneration(ctx context.Context, in GraphPipelineTriggerInput) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("graph pipeline trigger db is required")
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

	var library model.Library
	if err := s.db.WithContext(ctx).Where("eid = ? AND id = ?", in.Eid, file.LibraryID).First(&library).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if library.SpaceID <= 0 {
		return nil
	}

	var space model.Space
	if err := s.db.WithContext(ctx).Where("eid = ? AND id = ?", in.Eid, library.SpaceID).First(&space).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	// 图谱总开关（空间级，手动开关）：关闭则本空间文件不触发图谱
	if !space.EnableKnowledgeGraph {
		return nil
	}

	// 知识库范围（关联表 type=normal）：空 = 全部
	libraryIDs, err := model.GetSpaceKnowledgeGraphLibraryIDs(s.db.WithContext(ctx), in.Eid, library.SpaceID, model.SpaceKnowledgeGraphScopeNormal)
	if err != nil {
		logger.Warnf(ctx, "graph pipeline trigger skip: read library scope failed space_id=%d err=%v", library.SpaceID, err)
		return nil
	}
	if len(libraryIDs) > 0 {
		within := false
		for _, id := range libraryIDs {
			if id == file.LibraryID {
				within = true
				break
			}
		}
		if !within {
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
		logger.Warnf(ctx, "graph pipeline trigger skipped: missing source run id, file_id=%d", in.FileID)
		return nil
	}
	releaseStartLock, locked, err := acquireGraphPipelineStartLock(ctx, in.Eid, in.FileID)
	if err != nil {
		return fmt.Errorf("acquire graph pipeline start lock: %w", err)
	}
	if !locked {
		return nil
	}
	defer releaseStartLock()

	// 幂等：同一文件已有运行中的图谱任务则跳过（图谱 job 使用独立 run_id，按 run 判断不再适用）
	var running model.RagJob
	err = s.db.WithContext(ctx).Where(
		"eid = ? AND related_id = ? AND type = ? AND status IN ?",
		in.Eid, in.FileID, graphPipelineJobType, []string{model.RagJobStatusPending, model.RagJobStatusProcessing},
	).First(&running).Error
	if err == nil {
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	// 匹配图谱策略（含兜底；兜底开关 = 默认图谱策略的 enabled）
	strategy, pipeline, err := model.FindHighestPriorityGraphRoutingStrategyAndPipelineByFile(s.db, &file)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if strategy == nil || pipeline == nil {
		return nil
	}

	// 解析图谱管线 profile，定位 graph_generation 步骤
	var profile v2model.RuntimeProfile
	if err := json.Unmarshal([]byte(pipeline.ProfileJSON), &profile); err != nil {
		return fmt.Errorf("parse graph pipeline profile failed: pipeline_id=%d err=%w", pipeline.ID, err)
	}
	stepIndex := -1
	for index, step := range profile.Steps {
		if step.StepKey == "graph_generation" {
			stepIndex = index
			break
		}
	}
	if stepIndex < 0 {
		logger.Warnf(ctx, "graph pipeline trigger skipped: no graph_generation step, pipeline_id=%d", pipeline.ID)
		return nil
	}
	// 管线开关：graph_generation 步骤 config.enabled（缺失默认开启，兼容旧数据）
	if !graphPipelineStepEnabled(profile.Steps[stepIndex]) {
		logger.Warnf(ctx, "graph pipeline trigger skipped: graph_generation step disabled, pipeline_id=%d", pipeline.ID)
		return nil
	}

	startParameters := map[string]any{
		"eid":                  in.Eid,
		"file_id":              in.FileID,
		"library_id":           file.LibraryID,
		"user_id":              file.UserID,
		"trigger_source":       firstNonEmpty(strings.TrimSpace(in.TriggerSource), "auto_after_pipeline"),
		"__profile_step_index": stepIndex,
	}
	startParameters["source_run_id"] = sourceRunID
	if _, err := s.createAndEnqueueGraphPipelineJob(ctx, in.Eid, profile, startParameters); err != nil {
		logger.Warnf(ctx, "graph pipeline trigger enqueue failed: file_id=%d source_run_id=%s err=%v", in.FileID, sourceRunID, err)
	}

	return nil
}

func acquireGraphPipelineStartLock(ctx context.Context, eid, fileID int64) (func(), bool, error) {
	if common.RDB == nil {
		return func() {}, true, nil
	}
	key := fmt.Sprintf("rag:job:graph-pipeline:start:%d:%d", eid, fileID)
	token := uuid.NewString()
	locked, err := common.RDB.SetNX(ctx, key, token, graphPipelineStartLockTTL).Result()
	if err != nil {
		return nil, false, err
	}
	if !locked {
		return nil, false, nil
	}
	return func() {
		_, _ = common.RDB.Eval(ctx, "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", []string{key}, token).Result()
	}, true, nil
}

func (s *GraphPipelineTriggerService) createAndEnqueueGraphPipelineJob(ctx context.Context, eid int64, profile v2model.RuntimeProfile, startParameters map[string]any) (*model.RagJob, error) {
	startBytes, err := json.Marshal(startParameters)
	if err != nil {
		return nil, err
	}
	profileBytes, err := json.Marshal(profile)
	if err != nil {
		return nil, err
	}
	jobFactory := model.NewRagJobFactory(s.db, common.RDB)
	job, err := jobFactory.CreateJobWithoutQueue(ctx, eid, graphPipelineJobType, string(startBytes))
	if err != nil {
		return nil, err
	}
	job.RunID = uuid.New().String()
	job.RuntimeProfile = string(profileBytes)
	result := s.db.WithContext(ctx).Model(&model.RagJob{}).Where("job_id = ?", job.JobID).Updates(map[string]any{
		"run_id":               job.RunID,
		"runtime_profile_json": job.RuntimeProfile,
	})
	if result.Error != nil {
		return nil, s.markGraphPipelineJobFailed(ctx, job.JobID, result.Error)
	}
	if result.RowsAffected != 1 {
		return nil, s.markGraphPipelineJobFailed(ctx, job.JobID, fmt.Errorf("graph pipeline job update affected %d jobs, want 1", result.RowsAffected))
	}
	if err := s.enqueueGraphPipelineJob(ctx, job); err != nil {
		return nil, s.markGraphPipelineJobFailed(ctx, job.JobID, err)
	}
	return job, nil
}

func (s *GraphPipelineTriggerService) markGraphPipelineJobFailed(ctx context.Context, jobID int64, cause error) error {
	if err := s.db.WithContext(ctx).Model(&model.RagJob{}).Where("job_id = ?", jobID).Updates(map[string]any{
		"status":         model.RagJobStatusFailed,
		"failure_reason": cause.Error(),
	}).Error; err != nil {
		return fmt.Errorf("%w; marking graph job failed also failed: %v", cause, err)
	}
	return cause
}

func (s *GraphPipelineTriggerService) enqueueGraphPipelineJob(ctx context.Context, job *model.RagJob) error {
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

// graphPipelineStepEnabled 图谱管线 graph_generation 步骤开关：
// 读取步骤 config.enabled（缺失时默认开启，兼容旧数据 run_mode=auto 种子）。
func graphPipelineStepEnabled(step v2model.ProfileStep) bool {
	if len(step.Config) == 0 {
		return true
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(step.Config, &raw); err != nil {
		return true
	}
	rawEnabled, ok := raw["enabled"]
	if !ok {
		return true
	}
	var enabled bool
	if err := json.Unmarshal(rawEnabled, &enabled); err != nil {
		return true
	}
	return enabled
}
