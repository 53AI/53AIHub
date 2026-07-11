package factory

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
	v2model "github.com/53AI/53AIHub/rag-pipeline-v2/model"
	"github.com/go-redis/redis/v8"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type JobFactory struct {
	db        *gorm.DB
	rdb       redis.Cmdable
	v1Factory *model.RagJobFactory
}

func NewJobFactory(db *gorm.DB, rdb redis.Cmdable) *JobFactory {
	return &JobFactory{
		db:        db,
		rdb:       rdb,
		v1Factory: model.NewRagJobFactory(db, rdb),
	}
}

// CreateJobsFromProfile 根据配置预创建所有步骤任务（不自动入队）
// startParameters: 初始参数 JSON 字符串
// 方案A：预创建所有步骤的 Job，但不入队，运行时通过 enqueueNextJob 依次触发
func (f *JobFactory) CreateJobsFromProfile(ctx context.Context, eid int64, profile v2model.RuntimeProfile, stepIndex int, startParameters string, runID string) ([]*model.RagJob, error) {
	// 确保 RunID 存在
	if runID == "" {
		runID = uuid.New().String()
	}

	// 序列化 Profile 用于快照
	profileBytes, err := json.Marshal(profile)
	if err != nil {
		return nil, fmt.Errorf("序列化 Profile 失败: %v", err)
	}
	profileJSON := string(profileBytes)

	// 递归创建所有步骤
	var allJobs []*model.RagJob
	for i := stepIndex; i < len(profile.Steps); i++ {
		step := profile.Steps[i]

		// 兼容逻辑：确定实际的 RunMode
		runMode := step.RunMode
		if runMode == "" {
			if step.Enabled {
				runMode = v2model.RunModeAuto
			} else {
				runMode = v2model.RunModeManual
			}
		}

		// 跳过模式：不创建 Job
		if runMode == v2model.RunModeSkip {
			continue
		}

		// 注入 profile_step_index 到启动参数中
		var paramsMap map[string]interface{}
		if startParameters != "" {
			if err := json.Unmarshal([]byte(startParameters), &paramsMap); err != nil {
				paramsMap = make(map[string]interface{})
			}
		} else {
			paramsMap = make(map[string]interface{})
		}
		paramsMap["__profile_step_index"] = i

		newStartParams, err := json.Marshal(paramsMap)
		if err != nil {
			return nil, fmt.Errorf("序列化启动参数失败: %v", err)
		}

		// 创建任务（不入队）
		job, err := f.v1Factory.CreateJobWithoutQueue(ctx, eid, step.StepKey, string(newStartParams))
		if err != nil {
			return nil, fmt.Errorf("创建任务失败: %v", err)
		}

		// 确定任务状态
		// 第一步骤如果是自动模式，状态为 pending
		// 后续所有步骤（无论是自动还是手动），初始状态都是 paused
		status := model.RagJobStatusPaused
		if i == stepIndex && runMode == v2model.RunModeAuto {
			status = model.RagJobStatusPending
		}

		// 更新快照和RunID
		updates := map[string]interface{}{
			"runtime_profile_json": profileJSON,
			"run_id":               runID,
			"pipeline_id":          profile.ID,
			"status":               status,
		}
		if err := f.db.Model(job).Updates(updates).Error; err != nil {
			return nil, fmt.Errorf("更新任务信息失败: %v", err)
		}
		job.RunID = runID
		job.Status = status
		job.RuntimeProfile = profileJSON
		job.PipelineID = profile.ID

		allJobs = append(allJobs, job)
	}

	// 如果第一个步骤是自动模式，直接入队（启动流程）
	if len(allJobs) > 0 && allJobs[0].Status == model.RagJobStatusPending {
		if err := f.enqueueJob(ctx, allJobs[0]); err != nil {
			return nil, fmt.Errorf("第一步骤入队失败: %v", err)
		}
	}

	return allJobs, nil
}

// enqueueJob 将任务推入 Redis 队列
func (f *JobFactory) enqueueJob(ctx context.Context, job *model.RagJob) error {
	if f.rdb == nil {
		return nil
	}

	wrapper := model.JobWrapper{
		JobID:      job.JobID,
		Eid:        job.Eid,
		Type:       job.Type,
		EnqueuedAt: time.Now(),
		Retries:    0,
	}

	payload, err := json.Marshal(wrapper)
	if err != nil {
		return err
	}

	// 队列名称规则：rag:job:queue:<step_key>
	queueName := fmt.Sprintf("rag:job:queue:%s", job.Type)
	return f.rdb.LPush(ctx, queueName, string(payload)).Err()
}

// CreateJobsForFile 根据文件自动匹配策略并创建任务
func (f *JobFactory) CreateJobsForFile(ctx context.Context, eid int64, fileID int64, startParameters string) ([]*model.RagJob, error) {
	// 1. 获取文件信息
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		return nil, fmt.Errorf("获取文件失败: %v", err)
	}

	// 2. 查找匹配的策略和 Pipeline
	strategy, pipelineProfile, err := model.FindHighestPriorityRagRoutingStrategyAndPipelineByFile(f.db, file)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("未找到文件 %d 的匹配路由策略", fileID)
		}
		return nil, fmt.Errorf("查找路由策略失败: %v", err)
	}

	// 3. 解析 Profile
	var profile v2model.RuntimeProfile
	if err := json.Unmarshal([]byte(pipelineProfile.ProfileJSON), &profile); err != nil {
		return nil, fmt.Errorf("解析 Profile 失败: %v", err)
	}
	profile.ID = pipelineProfile.ID

	// 记录日志，表明命中了哪个策略
	fmt.Printf("File %d matched strategy '%s' (Pipeline: %s)\n",
		fileID, strategy.Name, pipelineProfile.Name)

	// 4. 将完整的清洗规则信息添加到启动参数中
	var paramsMap map[string]interface{}
	if startParameters != "" {
		if err := json.Unmarshal([]byte(startParameters), &paramsMap); err != nil {
			paramsMap = make(map[string]interface{})
		}
	} else {
		paramsMap = make(map[string]interface{})
	}

	// 添加完整的清洗规则信息到参数中
	cleaningRuleInfo := map[string]interface{}{
		"id":   strategy.ID,
		"name": strategy.Name,
		"icon": strategy.Icon,
	}
	paramsMap["cleaning_rule"] = cleaningRuleInfo
	paramsMap["file_id"] = float64(fileID) // 确保file_id存在

	newStartParams, err := json.Marshal(paramsMap)
	if err != nil {
		return nil, fmt.Errorf("序列化启动参数失败: %v", err)
	}

	// 5. 创建任务
	runID := uuid.New().String()

	// 构造完整的 FileCleaningRuleInfo（含策略/流水线字段）
	strategyID, _ := hashids.Encode(strategy.ID)
	pipelineID, _ := hashids.Encode(pipelineProfile.ID)
	initInfo := model.FileCleaningRuleInfo{
		StrategyID:   strategyID,
		StrategyName: strategy.Name,
		StrategyIcon: strategy.Icon,
		PipelineID:   pipelineID,
		PipelineName: pipelineProfile.Name,
		PipelineIcon: pipelineProfile.Icon,
		RunID:        runID,
		Status:       "pending",
		Progress:     0,
		SuccessCount: 0,
		FailureCount: 0,
		TotalSteps:   profile.RequiredStepsCount(),
		StartTime:    0,
		EndTime:      0,
	}
	if initBytes, err := json.Marshal(initInfo); err == nil {
		if err := f.db.Model(&model.File{}).Where("id = ?", fileID).Update("cleaning_rule_info", string(initBytes)).Error; err != nil {
			fmt.Printf("Warning: Failed to initialize cleaning rule info detail for file %d: %v\n", fileID, err)
		}
	} else {
		fmt.Printf("Warning: Failed to marshal cleaning rule info detail for file %d: %v\n", fileID, err)
	}

	jobs, createErr := f.CreateJobsFromProfile(ctx, eid, profile, 0, string(newStartParams), runID)
	if err := model.UpdateFileCleaningRuleInfoHelper(f.db, fileID, runID, ""); err != nil {
		fmt.Printf("Warning: Failed to initialize cleaning rule info for file %d: %v\n", fileID, err)
	}

	return jobs, createErr
}

func (f *JobFactory) CreateJobFromProfileStep(ctx context.Context, eid int64, profile v2model.RuntimeProfile, stepIndex int, startParameters string, runID string) (*model.RagJob, error) {
	if stepIndex < 0 || stepIndex >= len(profile.Steps) {
		return nil, fmt.Errorf("invalid step index")
	}
	if runID == "" {
		runID = uuid.New().String()
	}

	step := profile.Steps[stepIndex]
	runMode := step.RunMode
	if runMode == "" {
		if step.Enabled {
			runMode = v2model.RunModeAuto
		} else {
			runMode = v2model.RunModeManual
		}
	}
	if runMode == v2model.RunModeSkip {
		return nil, fmt.Errorf("cannot create job for skipped step")
	}

	var paramsMap map[string]interface{}
	if startParameters != "" {
		if err := json.Unmarshal([]byte(startParameters), &paramsMap); err != nil {
			paramsMap = make(map[string]interface{})
		}
	} else {
		paramsMap = make(map[string]interface{})
	}
	paramsMap["__profile_step_index"] = stepIndex

	newStartParams, err := json.Marshal(paramsMap)
	if err != nil {
		return nil, fmt.Errorf("序列化启动参数失败: %v", err)
	}

	profileBytes, err := json.Marshal(profile)
	if err != nil {
		return nil, fmt.Errorf("序列化 Profile 失败: %v", err)
	}
	profileJSON := string(profileBytes)

	job, err := f.v1Factory.CreateJobWithoutQueue(ctx, eid, step.StepKey, string(newStartParams))
	if err != nil {
		return nil, fmt.Errorf("创建任务失败: %v", err)
	}

	updates := map[string]interface{}{
		"runtime_profile_json": profileJSON,
		"run_id":               runID,
		"pipeline_id":          profile.ID,
	}
	if err := f.db.Model(job).Updates(updates).Error; err != nil {
		return nil, fmt.Errorf("更新任务信息失败: %v", err)
	}
	job.RuntimeProfile = profileJSON
	job.RunID = runID
	job.PipelineID = profile.ID

	return job, nil
}

// GetJobsByRunID 根据 RunID 查询同一运行的所有 Job，按 step_index 排序
func (f *JobFactory) GetJobsByRunID(ctx context.Context, runID string) ([]model.RagJob, error) {
	var jobs []model.RagJob
	err := f.db.WithContext(ctx).
		Where("run_id = ?", runID).
		Order("job_id ASC").
		Find(&jobs).Error
	return jobs, err
}

// EnqueueNextJob 将下一个自动步骤推入队列
// currentStepIndex: 当前步骤的索引
// runID: 运行ID
func (f *JobFactory) EnqueueNextJob(ctx context.Context, runID string, currentStepIndex int) error {
	var nextJob model.RagJob
	err := f.db.WithContext(ctx).
		Where("run_id = ? AND status = ?", runID, model.RagJobStatusPaused).
		First(&nextJob).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil // 没有下一步骤
		}
		return err
	}

	// 解析参数获取步骤索引
	var params map[string]interface{}
	json.Unmarshal([]byte(nextJob.StartParameters), &params)
	var nextStepIndex int = -1
	if val, ok := params["__profile_step_index"]; ok {
		if idx, ok := val.(float64); ok {
			nextStepIndex = int(idx)
		}
	}

	// 找到下一个步骤（索引大于当前步骤的）
	if nextStepIndex <= currentStepIndex {
		return nil
	}

	// 解析 Profile 检查步骤的 RunMode
	var profile v2model.RuntimeProfile
	if err := json.Unmarshal([]byte(nextJob.RuntimeProfile), &profile); err != nil {
		return fmt.Errorf("解析 Profile 失败: %v", err)
	}

	if nextStepIndex < 0 || nextStepIndex >= len(profile.Steps) {
		return fmt.Errorf("无效的步骤索引: %d", nextStepIndex)
	}

	step := profile.Steps[nextStepIndex]
	runMode := step.RunMode
	if runMode == "" {
		if step.Enabled {
			runMode = v2model.RunModeAuto
		} else {
			runMode = v2model.RunModeManual
		}
	}

	// 只有自动步骤才入队，手动步骤保持 paused 状态
	if runMode == v2model.RunModeAuto {
		// 先更新 DB，再入队 Redis
		// 若 Redis 入队失败，回滚 DB 状态，避免 job 卡在 pending 但没入队
		oldStatus := nextJob.Status
		if err := f.db.Model(&nextJob).Update("status", model.RagJobStatusPending).Error; err != nil {
			return err
		}
		if err := f.enqueueJob(ctx, &nextJob); err != nil {
			// 回滚 DB 状态到原来的 paused
			f.db.Model(&nextJob).Update("status", oldStatus)
			return fmt.Errorf("入队失败: %w", err)
		}
		return nil
	}

	return nil
}
