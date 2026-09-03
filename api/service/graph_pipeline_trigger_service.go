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
		"source_run_id":        sourceRunID,
		"__profile_step_index": stepIndex,
	}
	startBytes, _ := json.Marshal(startParameters)

	jobFactory := model.NewRagJobFactory(s.db, common.RDB)
	job, err := jobFactory.CreateJobWithoutQueue(ctx, in.Eid, graphPipelineJobType, string(startBytes))
	if err != nil {
		return err
	}

	profileBytes, err := json.Marshal(profile)
	if err != nil {
		return err
	}
	profileJSON := string(profileBytes)
	result := s.db.WithContext(ctx).Model(&model.RagJob{}).Where("job_id = ?", job.JobID).Update("runtime_profile_json", profileJSON)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("graph pipeline runtime profile update affected %d jobs, want 1", result.RowsAffected)
	}
	job.RuntimeProfile = profileJSON

	// 图谱 job 使用独立 run_id（对齐 wiki 独立任务），不再复用 RAG 的 source_run_id，
	// 因此不进入文件详情 cleaning_rule_info 的统计，也不污染文件 run_status。
	job.RunID = uuid.New().String()
	result = s.db.WithContext(ctx).Model(&model.RagJob{}).Where("job_id = ?", job.JobID).Update("run_id", job.RunID)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("graph pipeline run id update affected %d jobs, want 1", result.RowsAffected)
	}

	if err := s.enqueueGraphPipelineJob(ctx, job); err != nil {
		logger.Warnf(ctx, "graph pipeline trigger enqueue failed: file_id=%d run_id=%s err=%v", in.FileID, job.RunID, err)
	}

	return nil
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
