package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/model"
	v2engines "github.com/53AI/53AIHub/rag-pipeline-v2/engines"
	v2factory "github.com/53AI/53AIHub/rag-pipeline-v2/factory"
	v2model "github.com/53AI/53AIHub/rag-pipeline-v2/model"
	v2steps "github.com/53AI/53AIHub/rag-pipeline-v2/steps"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

var (
	// V2 引擎实例
	ragJobEngineV2  *v2engines.RagJobEngineV2
	ragJobFactoryV2 *v2factory.JobFactory
	initOnce        sync.Once // 修改变量名，避免与manager.go中的once冲突
)

// GetRagJobFactoryV2 获取V2任务工厂实例
func GetRagJobFactoryV2() *v2factory.JobFactory {
	return ragJobFactoryV2
}

// InitRAGJobEngine 初始化RAG任务引擎
func InitRAGJobEngine() {
	initOnce.Do(func() {
		if !common.IsRedisEnabled() {
			logger.SysLog("Redis not enabled, skipping RAG job engine initialization")
			return
		}

		// 初始化 V2 引擎
		ragJobFactoryV2 = v2factory.NewJobFactory(model.DB, common.RDB)
		ragJobEngineV2 = v2engines.NewRagJobEngineV2(common.RDB, model.DB, ragJobFactoryV2)

		// 注册 V2 Handler
		ragJobEngineV2.RegisterHandler("document_parsing", v2steps.NewDocumentParsingHandler(model.DB))
		ragJobEngineV2.RegisterHandler("content_cleaning", func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
			logger.Info(ctx, "V2 Handler: content_cleaning executed")
			return nil
		})
		ragJobEngineV2.RegisterHandler("summary_generation", v2steps.NewSummaryGenerationHandler(model.DB))
		ragJobEngineV2.RegisterHandler("document_chunking", v2steps.NewDocumentChunkingHandler(model.DB))
		ragJobEngineV2.RegisterHandler("vector_indexing", v2steps.NewVectorIndexingHandler(model.DB))
		ragJobEngineV2.RegisterHandler("graph_generation", v2steps.NewGraphGenerationHandler(model.DB))

		// 注册 V2 Recovery Handler
		ragJobEngineV2.RegisterRecoveryHandler("document_parsing", v2steps.RecoverDocumentParsing(model.DB))
		ragJobEngineV2.RegisterRecoveryHandler("content_cleaning", v2steps.RecoverContentCleaning())
		ragJobEngineV2.RegisterRecoveryHandler("summary_generation", v2steps.RecoverSummaryGeneration(model.DB))
		ragJobEngineV2.RegisterRecoveryHandler("document_chunking", v2steps.RecoverDocumentChunking(model.DB))
		ragJobEngineV2.RegisterRecoveryHandler("vector_indexing", v2steps.RecoverVectorIndexing(model.DB))
		ragJobEngineV2.RegisterRecoveryHandler("graph_generation", v2steps.RecoverGraphGeneration(model.DB))

		// 在后台执行恢复+启动 Worker，不阻塞主流程启动
		go func() {
			ragJobEngineV2.RecoverStuckJobs(context.Background())
			rag.StartSiteEmbeddingReindexCoordinator(context.Background(), model.DB, 30*time.Second)
			ragJobEngineV2.StartWorkers()
			// 每小时清理一次超过 24h 无心跳的死 job
			ragJobEngineV2.StartStaleJobCleaner(context.Background(), 1*time.Hour)
			logger.SysLog("RAG job engine recovery, workers, and stale-job cleaner started (background)")
		}()

		logger.SysLog("RAG job engine initialized (recovery running in background)")
	})
}

type RetryJobStepOptionsV2 struct {
	Continue    bool
	SkipCleanup bool
}

type BatchRetryJobStepItemV2 struct {
	JobID  int64
	Config json.RawMessage
}

var ErrInvalidBatchRetryRequest = errors.New("invalid batch retry request")
var ErrJobNotCancelable = errors.New("job status does not allow cancel")
var ErrJobProcessing = errors.New("job is currently processing")
var batchRetryJobStepExecutor = RetryJobStepV2
var batchRetryJobStepAsync = true

var ErrInvalidBatchRunRequest = errors.New("invalid batch run request")

type BatchRunContextV2 struct {
	RelatedID       int64
	StrategyID      int64
	PipelineID      int64
	RunID           string
	StartParameters json.RawMessage
}

type BatchRunJobStepItemV2 struct {
	StepKey   string
	StepIndex *int
	Config    json.RawMessage
	RunMode   string
}

func RetryJobStepV2(ctx context.Context, jobID int64, newConfig json.RawMessage) error {
	return RetryJobStepV2WithOptions(ctx, jobID, newConfig, RetryJobStepOptionsV2{})
}

func RetryJobStepV2WithOptions(ctx context.Context, jobID int64, newConfig json.RawMessage, options RetryJobStepOptionsV2) error {
	var job model.RagJob
	if err := model.DB.First(&job, jobID).Error; err != nil {
		return err
	}

	lockKey := fmt.Sprintf("rag:job:lock:%d", jobID)
	locked, err := common.RDB.SetNX(ctx, lockKey, 1, 10*time.Second).Result()
	if err != nil {
		return fmt.Errorf("redis error: %v", err)
	}
	if !locked {
		return fmt.Errorf("job is currently being retried or processed")
	}
	defer common.RDB.Del(ctx, lockKey)

	if job.Status == model.RagJobStatusProcessing {
		return fmt.Errorf("job is currently processing")
	}

	var profile v2model.RuntimeProfile
	if err := json.Unmarshal([]byte(job.RuntimeProfile), &profile); err != nil {
		return fmt.Errorf("invalid runtime profile: %v", err)
	}

	params, currentIndex, err := parseProfileStepIndexFromParameters(job.StartParameters)
	if err != nil {
		return err
	}

	if currentIndex == -1 || currentIndex >= len(profile.Steps) {
		return fmt.Errorf("invalid step index")
	}

	step := &profile.Steps[currentIndex]

	if step.RunMode == v2model.RunModeSkip {
		return fmt.Errorf("cannot retry a skipped step")
	}

	if len(newConfig) > 0 {
		step.Config = newConfig
		newProfileBytes, _ := json.Marshal(profile)
		job.RuntimeProfile = string(newProfileBytes)
	}

	// 确保移除单步执行标志，让引擎能够触发后续步骤
	delete(params, "__single_step_execution")

	// 手动 retry 时清除 reindex 引用，防止 guard 用已取消的 run_id 拦截
	delete(params, "embedding_reindex_run_id")
	delete(params, "embedding_reindex_batch_run_id")
	delete(params, "embedding_reindex_new_model")
	delete(params, "embedding_reindex_new_channel_id")

	if options.Continue && !options.SkipCleanup {
		// Continue 模式：清理后续已执行的步骤，保留 pending/paused 状态的步骤
		if err := cleanupRunJobsForRetry(ctx, job, currentIndex); err != nil {
			return err
		}
	}

	newParamsBytes, _ := json.Marshal(params)
	job.StartParameters = string(newParamsBytes)

	job.Status = model.RagJobStatusPending
	job.FailureReason = ""
	if err := model.DB.Save(&job).Error; err != nil {
		return err
	}

	if err := resetJobStepResults(ctx, job.JobID); err != nil {
		return err
	}

	wrapper := v2engines.JobWrapper{
		JobID:      job.JobID,
		Eid:        job.Eid,
		Type:       job.Type,
		EnqueuedAt: time.Now(),
		Retries:    0,
	}

	wrapperBytes, _ := json.Marshal(wrapper)
	queueName := fmt.Sprintf("rag:job:queue:%s", job.Type)

	if err := common.RDB.LPush(ctx, queueName, wrapperBytes).Err(); err != nil {
		return err
	}

	fileID := model.ExtractFileIDFromJob(&job)
	if fileID > 0 {
		if err := model.UpdateFileCleaningRuleInfoHelper(model.DB.WithContext(ctx), fileID, job.RunID, ""); err != nil {
			return err
		}

		// 清理该文件的 dedup key，防止旧的 dedup 阻塞新的入队
		if common.IsRedisEnabled() && common.RDB != nil {
			var chunkIDs []int64
			model.DB.WithContext(ctx).Model(&model.RetrievalChunk{}).
				Where("eid = ? AND file_id = ?", job.Eid, fileID).
				Pluck("id", &chunkIDs)
			if len(chunkIDs) > 0 {
				pipe := common.RDB.Pipeline()
				for _, cid := range chunkIDs {
					pipe.Del(ctx, rag.DedupKey(job.Eid, cid))
				}
				pipe.Exec(ctx)
			}
		}
	}

	if options.Continue {
		logger.Infof(ctx, "Retrying job %d (step: %s) in continue mode", job.JobID, step.StepKey)
		return nil
	}
	logger.Infof(ctx, "Retrying job %d (step: %s) in single step mode", job.JobID, step.StepKey)
	return nil
}

func BatchRetryJobStepsV2(ctx context.Context, items []BatchRetryJobStepItemV2) error {
	if len(items) == 0 {
		return fmt.Errorf("%w: empty jobs", ErrInvalidBatchRetryRequest)
	}

	jobIDs := make([]int64, 0, len(items))
	seen := make(map[int64]struct{}, len(items))
	for _, item := range items {
		if item.JobID == 0 {
			return fmt.Errorf("%w: invalid job id", ErrInvalidBatchRetryRequest)
		}
		if _, ok := seen[item.JobID]; ok {
			return fmt.Errorf("%w: duplicated job id", ErrInvalidBatchRetryRequest)
		}
		seen[item.JobID] = struct{}{}
		jobIDs = append(jobIDs, item.JobID)
	}

	var jobs []model.RagJob
	if err := model.DB.WithContext(ctx).Where("job_id IN ?", jobIDs).Find(&jobs).Error; err != nil {
		return err
	}
	if len(jobs) != len(jobIDs) {
		return fmt.Errorf("%w: job not found", ErrInvalidBatchRetryRequest)
	}

	jobMap := make(map[int64]model.RagJob, len(jobs))
	for _, job := range jobs {
		jobMap[job.JobID] = job
	}

	runID := ""
	prevIndex := -1
	for _, item := range items {
		job, ok := jobMap[item.JobID]
		if !ok {
			return fmt.Errorf("%w: job not found", ErrInvalidBatchRetryRequest)
		}
		if job.RunID == "" {
			return fmt.Errorf("%w: run id is empty", ErrInvalidBatchRetryRequest)
		}
		if runID == "" {
			runID = job.RunID
		} else if runID != job.RunID {
			return fmt.Errorf("%w: different run id", ErrInvalidBatchRetryRequest)
		}

		index, ok := extractProfileStepIndex(job.StartParameters)
		if !ok || index < 0 {
			return fmt.Errorf("%w: invalid step index", ErrInvalidBatchRetryRequest)
		}
		if prevIndex != -1 && index <= prevIndex {
			return fmt.Errorf("%w: step order must be increasing", ErrInvalidBatchRetryRequest)
		}
		prevIndex = index
	}

	if !batchRetryJobStepAsync {
		for _, item := range items {
			if err := batchRetryJobStepExecutor(ctx, item.JobID, item.Config); err != nil {
				return err
			}
		}
		return nil
	}

	if err := batchRetryJobStepExecutor(ctx, items[0].JobID, items[0].Config); err != nil {
		return err
	}

	if len(items) > 1 {
		go runBatchRetryJobStepsV2(context.Background(), items)
	}
	return nil
}

func BatchRunJobStepsV2(ctx context.Context, eid int64, run BatchRunContextV2, items []BatchRunJobStepItemV2) (string, []int64, error) {
	if eid <= 0 {
		return "", nil, fmt.Errorf("%w: invalid eid", ErrInvalidBatchRunRequest)
	}
	if run.RelatedID <= 0 {
		return "", nil, fmt.Errorf("%w: invalid related id", ErrInvalidBatchRunRequest)
	}
	if len(items) == 0 {
		return "", nil, fmt.Errorf("%w: empty steps", ErrInvalidBatchRunRequest)
	}

	jobFactory := GetRagJobFactoryV2()
	if jobFactory == nil {
		return "", nil, fmt.Errorf("RAG Job Engine not initialized")
	}

	file, err := model.GetFileByID(eid, run.RelatedID)
	if err != nil {
		return "", nil, err
	}

	db := model.DB.WithContext(ctx)

	var strategy *model.RagRoutingStrategy
	var pipelineProfile *model.RagPipelineProfile
	if run.StrategyID > 0 {
		var s model.RagRoutingStrategy
		if err := db.Where("eid = ? AND id = ?", eid, run.StrategyID).First(&s).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return "", nil, fmt.Errorf("%w: strategy not found", ErrInvalidBatchRunRequest)
			}
			return "", nil, err
		}
		strategy = &s
	}

	if run.PipelineID > 0 {
		var profile model.RagPipelineProfile
		if err := db.Where("eid = ? AND id = ?", eid, run.PipelineID).First(&profile).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return "", nil, fmt.Errorf("%w: pipeline not found", ErrInvalidBatchRunRequest)
			}
			return "", nil, err
		}
		pipelineProfile = &profile
		if strategy != nil && strategy.PipelineID != pipelineProfile.ID {
			return "", nil, fmt.Errorf("%w: strategy and pipeline mismatch", ErrInvalidBatchRunRequest)
		}
	} else if strategy != nil {
		var profile model.RagPipelineProfile
		if err := db.Where("eid = ? AND id = ?", eid, strategy.PipelineID).First(&profile).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return "", nil, fmt.Errorf("%w: pipeline not found", ErrInvalidBatchRunRequest)
			}
			return "", nil, err
		}
		pipelineProfile = &profile
	} else {
		s, p, err := model.FindHighestPriorityRagRoutingStrategyAndPipelineByFile(db, file)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return "", nil, fmt.Errorf("%w: routing strategy not found", ErrInvalidBatchRunRequest)
			}
			return "", nil, err
		}
		strategy = s
		pipelineProfile = p
	}

	var profile v2model.RuntimeProfile
	if err := json.Unmarshal([]byte(pipelineProfile.ProfileJSON), &profile); err != nil {
		return "", nil, fmt.Errorf("%w: invalid pipeline profile json", ErrInvalidBatchRunRequest)
	}
	profile.ID = pipelineProfile.ID

	stepKeyIndex := make(map[string]int, len(profile.Steps))
	for i := range profile.Steps {
		if profile.Steps[i].StepKey != "" {
			stepKeyIndex[profile.Steps[i].StepKey] = i
		}
	}

	resolved := make([]struct {
		Index   int
		Item    BatchRunJobStepItemV2
		RunMode v2model.RunMode
	}, 0, len(items))
	prevIndex := -1
	seen := make(map[int]struct{}, len(items))
	for _, item := range items {
		idx := -1
		if item.StepIndex != nil {
			idx = *item.StepIndex
		} else if item.StepKey != "" {
			if v, ok := stepKeyIndex[item.StepKey]; ok {
				idx = v
			} else {
				return "", nil, fmt.Errorf("%w: step not found", ErrInvalidBatchRunRequest)
			}
		} else {
			return "", nil, fmt.Errorf("%w: step_key or step_index required", ErrInvalidBatchRunRequest)
		}
		if idx < 0 || idx >= len(profile.Steps) {
			return "", nil, fmt.Errorf("%w: invalid step index", ErrInvalidBatchRunRequest)
		}
		if item.StepKey != "" && profile.Steps[idx].StepKey != item.StepKey {
			return "", nil, fmt.Errorf("%w: step mismatch", ErrInvalidBatchRunRequest)
		}
		if _, ok := seen[idx]; ok {
			return "", nil, fmt.Errorf("%w: duplicated step", ErrInvalidBatchRunRequest)
		}
		seen[idx] = struct{}{}
		if prevIndex != -1 && idx <= prevIndex {
			return "", nil, fmt.Errorf("%w: step order must be increasing", ErrInvalidBatchRunRequest)
		}
		prevIndex = idx

		runMode, err := resolveBatchRunMode(profile.Steps[idx], item.RunMode)
		if err != nil {
			return "", nil, err
		}
		if runMode == v2model.RunModeSkip {
			return "", nil, fmt.Errorf("%w: cannot run skipped step", ErrInvalidBatchRunRequest)
		}
		resolved = append(resolved, struct {
			Index   int
			Item    BatchRunJobStepItemV2
			RunMode v2model.RunMode
		}{Index: idx, Item: item, RunMode: runMode})
	}

	for _, r := range resolved {
		if len(r.Item.Config) > 0 {
			profile.Steps[r.Index].Config = r.Item.Config
		}
		if r.Item.RunMode != "" {
			profile.Steps[r.Index].RunMode = r.RunMode
		}
	}

	runID := run.RunID
	if runID == "" {
		runID = uuid.New().String()
	}

	paramsMap := make(map[string]interface{})
	if len(run.StartParameters) > 0 {
		_ = json.Unmarshal(run.StartParameters, &paramsMap)
	}
	paramsMap["eid"] = eid
	paramsMap["file_id"] = run.RelatedID
	paramsMap["__single_step_execution"] = true
	if strategy != nil {
		if _, exists := paramsMap["cleaning_rule"]; !exists {
			paramsMap["cleaning_rule"] = map[string]interface{}{
				"id":   strategy.ID,
				"name": strategy.Name,
				"icon": strategy.Icon,
			}
		}
	}

	startParamsBytes, err := json.Marshal(paramsMap)
	if err != nil {
		return "", nil, err
	}

	encodedPipelineID, _ := hashids.Encode(pipelineProfile.ID)
	initInfo := model.FileCleaningRuleInfo{
		PipelineID:   encodedPipelineID,
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
	if strategy != nil {
		encodedStrategyID, _ := hashids.Encode(strategy.ID)
		initInfo.StrategyID = encodedStrategyID
		initInfo.StrategyName = strategy.Name
		initInfo.StrategyIcon = strategy.Icon
	}
	if initBytes, err := json.Marshal(initInfo); err == nil {
		_ = db.Model(&model.File{}).Where("id = ? AND eid = ?", run.RelatedID, eid).
			Updates(map[string]interface{}{"cleaning_rule_info": string(initBytes), "run_status": "pending"}).Error
	}
	_ = model.UpdateFileCleaningRuleInfoHelper(db, run.RelatedID, runID, "")

	createdJobIDs := make([]int64, 0, len(resolved))
	retryItems := make([]BatchRetryJobStepItemV2, 0, len(resolved))
	for _, r := range resolved {
		job, err := jobFactory.CreateJobFromProfileStep(ctx, eid, profile, r.Index, string(startParamsBytes), runID)
		if err != nil {
			return "", nil, err
		}
		createdJobIDs = append(createdJobIDs, job.JobID)
		if r.RunMode == v2model.RunModeManual {
			if err := db.Model(&model.RagJob{}).Where("job_id = ?", job.JobID).
				Update("status", model.RagJobStatusPaused).Error; err != nil {
				return "", nil, err
			}
			continue
		}
		retryItems = append(retryItems, BatchRetryJobStepItemV2{JobID: job.JobID})
	}

	if len(retryItems) > 0 {
		if err := BatchRetryJobStepsV2(ctx, retryItems); err != nil {
			return "", nil, err
		}
	}

	return runID, createdJobIDs, nil
}

func resolveBatchRunMode(step v2model.ProfileStep, runMode string) (v2model.RunMode, error) {
	if runMode != "" {
		switch v2model.RunMode(strings.ToLower(runMode)) {
		case v2model.RunModeAuto:
			return v2model.RunModeAuto, nil
		case v2model.RunModeManual:
			return v2model.RunModeManual, nil
		case v2model.RunModeSkip:
			return v2model.RunModeSkip, nil
		default:
			return "", fmt.Errorf("%w: invalid run_mode", ErrInvalidBatchRunRequest)
		}
	}

	effective := step.RunMode
	if effective == "" {
		if step.Enabled {
			effective = v2model.RunModeAuto
		} else {
			effective = v2model.RunModeManual
		}
	}
	return effective, nil
}

func runBatchRetryJobStepsV2(ctx context.Context, items []BatchRetryJobStepItemV2) {
	if len(items) < 2 {
		return
	}

	prevJobID := items[0].JobID
	for _, item := range items[1:] {
		status, err := waitForJobTerminalStatus(ctx, prevJobID, 30*time.Minute)
		if err != nil {
			logger.Errorf(ctx, "Batch retry waiting job %d failed: %v", prevJobID, err)
			return
		}
		if status != model.RagJobStatusSuccess {
			logger.Errorf(ctx, "Batch retry stopped: job %d status %s", prevJobID, status)
			return
		}
		if err := batchRetryJobStepExecutor(ctx, item.JobID, item.Config); err != nil {
			logger.Errorf(ctx, "Batch retry enqueue job %d failed: %v", item.JobID, err)
			return
		}
		prevJobID = item.JobID
	}
}

func waitForJobTerminalStatus(ctx context.Context, jobID int64, timeout time.Duration) (string, error) {
	waitCtx := ctx
	var cancel context.CancelFunc
	if _, ok := ctx.Deadline(); !ok && timeout > 0 {
		waitCtx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		var job model.RagJob
		if err := model.DB.WithContext(waitCtx).Select("status").First(&job, jobID).Error; err != nil {
			return "", err
		}
		switch job.Status {
		case model.RagJobStatusSuccess, model.RagJobStatusFailed, model.RagJobStatusCancelled:
			return job.Status, nil
		}

		select {
		case <-waitCtx.Done():
			return "", waitCtx.Err()
		case <-ticker.C:
		}
	}
}

func CancelRagJobV2(ctx context.Context, jobID int64) ([]model.RagJob, error) {
	var job model.RagJob
	if err := model.DB.WithContext(ctx).First(&job, jobID).Error; err != nil {
		return nil, err
	}

	targetJobs := []model.RagJob{job}
	if job.RunID != "" {
		if err := model.DB.WithContext(ctx).Where("run_id = ?", job.RunID).Find(&targetJobs).Error; err != nil {
			return nil, err
		}
	}

	for _, target := range targetJobs {
		if target.Status == model.RagJobStatusProcessing {
			return nil, ErrJobProcessing
		}
		if target.Status != model.RagJobStatusPending && target.Status != model.RagJobStatusCancelled {
			return nil, ErrJobNotCancelable
		}
	}

	pendingJobIDs := make([]int64, 0)
	for _, target := range targetJobs {
		if target.Status == model.RagJobStatusPending {
			pendingJobIDs = append(pendingJobIDs, target.JobID)
		}
	}

	if len(pendingJobIDs) > 0 {
		if err := model.DB.WithContext(ctx).Model(&model.RagJob{}).
			Where("job_id IN ?", pendingJobIDs).
			Update("status", model.RagJobStatusCancelled).Error; err != nil {
			return nil, err
		}
	}

	if common.RDB != nil && len(pendingJobIDs) > 0 {
		jobIDSet := make(map[int64]struct{}, len(pendingJobIDs))
		for _, id := range pendingJobIDs {
			jobIDSet[id] = struct{}{}
		}
		for _, target := range targetJobs {
			if _, ok := jobIDSet[target.JobID]; !ok {
				continue
			}
			queueName := fmt.Sprintf("rag:job:queue:%s", target.Type)
			processingQueue := fmt.Sprintf("rag:job:processing:%s", target.Type)
			queuePayloads, err := common.RDB.LRange(ctx, queueName, 0, -1).Result()
			if err == nil {
				for _, payload := range queuePayloads {
					var wrapper model.JobWrapper
					if err := json.Unmarshal([]byte(payload), &wrapper); err != nil {
						continue
					}
					if wrapper.JobID == target.JobID {
						common.RDB.LRem(ctx, queueName, 1, payload)
						break
					}
				}
			}
			processingPayloads, err := common.RDB.LRange(ctx, processingQueue, 0, -1).Result()
			if err == nil {
				for _, payload := range processingPayloads {
					var wrapper model.JobWrapper
					if err := json.Unmarshal([]byte(payload), &wrapper); err != nil {
						continue
					}
					if wrapper.JobID == target.JobID {
						common.RDB.LRem(ctx, processingQueue, 1, payload)
						break
					}
				}
			}
		}
	}

	fileIDSet := make(map[int64]struct{})
	for _, target := range targetJobs {
		fileID := model.ExtractFileIDFromJob(&target)
		if fileID > 0 {
			fileIDSet[fileID] = struct{}{}
		}
	}
	if job.RunID != "" {
		for fileID := range fileIDSet {
			if err := model.UpdateFileCleaningRuleInfoHelper(model.DB.WithContext(ctx), fileID, job.RunID, ""); err != nil {
				return nil, err
			}
		}
	}

	var updated []model.RagJob
	query := model.DB.WithContext(ctx)
	if job.RunID != "" {
		query = query.Where("run_id = ?", job.RunID)
	} else {
		query = query.Where("job_id = ?", job.JobID)
	}
	if err := query.Find(&updated).Error; err != nil {
		return nil, err
	}

	return updated, nil
}

func parseProfileStepIndexFromParameters(startParameters string) (map[string]interface{}, int, error) {
	var params map[string]interface{}
	if err := json.Unmarshal([]byte(startParameters), &params); err != nil {
		params = make(map[string]interface{})
	}
	currentIndex := -1
	if val, ok := params["__profile_step_index"]; ok {
		if idx, ok := val.(float64); ok {
			currentIndex = int(idx)
		}
	}
	return params, currentIndex, nil
}

func cleanupRunJobsForRetry(ctx context.Context, job model.RagJob, currentIndex int) error {
	if job.RunID == "" {
		return nil
	}

	var jobs []model.RagJob
	query := model.DB.WithContext(ctx).Where("run_id = ?", job.RunID)
	if job.PipelineID > 0 {
		query = query.Where("pipeline_id = ?", job.PipelineID)
	}
	if err := query.Find(&jobs).Error; err != nil {
		return err
	}

	var jobIDsToReset []int64
	for _, target := range jobs {
		if target.JobID == job.JobID {
			continue
		}
		index, ok := extractProfileStepIndex(target.StartParameters)
		if !ok {
			continue
		}
		if index < currentIndex {
			continue
		}
		if target.Status == model.RagJobStatusProcessing {
			return fmt.Errorf("job %d is currently processing", target.JobID)
		}
		jobIDsToReset = append(jobIDsToReset, target.JobID)
	}

	if len(jobIDsToReset) > 0 {
		if err := model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			// 保留后续步骤记录，但清理执行状态，避免 by-related 结果缺失并允许继续调度
			if err := tx.Model(&model.RagJob{}).
				Where("job_id IN ?", jobIDsToReset).
				Updates(map[string]interface{}{
					"status":         model.RagJobStatusPaused,
					"failure_reason": "",
				}).Error; err != nil {
				return err
			}
			if err := tx.Model(&model.RagJobStep{}).
				Where("job_id IN ?", jobIDsToReset).
				Updates(map[string]interface{}{
					"status":     model.RagJobStepStatusPending,
					"start_time": int64(0),
					"end_time":   int64(0),
					"results":    "",
					"parameters": "",
				}).Error; err != nil {
				return err
			}
			return nil
		}); err != nil {
			return err
		}
	}

	return nil
}

func GetLatestRunJobsWithStepsByRelatedID(ctx context.Context, eid int64, relatedID int64) (string, []model.RagJob, map[int64][]model.RagJobStep, error) {
	query := model.DB.WithContext(ctx).Model(&model.RagJob{})
	if eid > 0 {
		query = query.Where("eid = ?", eid)
	}

	var latestJob model.RagJob
	if err := query.Where("related_id = ?", relatedID).Order("created_time DESC").First(&latestJob).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil, map[int64][]model.RagJobStep{}, nil
		}
		return "", nil, nil, err
	}

	runID := latestJob.RunID
	jobQuery := model.DB.WithContext(ctx).Model(&model.RagJob{})
	if eid > 0 {
		jobQuery = jobQuery.Where("eid = ?", eid)
	}
	if runID != "" {
		jobQuery = jobQuery.Where("run_id = ?", runID)
	} else {
		jobQuery = jobQuery.Where("job_id = ?", latestJob.JobID)
	}
	jobQuery = jobQuery.Where("related_id = ?", relatedID).Order("created_time ASC")

	var jobs []model.RagJob
	if err := jobQuery.Find(&jobs).Error; err != nil {
		return "", nil, nil, err
	}

	if len(jobs) == 0 {
		return runID, jobs, map[int64][]model.RagJobStep{}, nil
	}

	jobIDs := make([]int64, 0, len(jobs))
	for _, job := range jobs {
		jobIDs = append(jobIDs, job.JobID)
	}

	var steps []model.RagJobStep
	if err := model.DB.WithContext(ctx).
		Where("job_id IN ?", jobIDs).
		Order("job_id ASC, step_order ASC").
		Find(&steps).Error; err != nil {
		return runID, jobs, nil, err
	}

	stepMap := make(map[int64][]model.RagJobStep, len(jobIDs))
	for _, step := range steps {
		stepMap[step.JobID] = append(stepMap[step.JobID], step)
	}

	return runID, jobs, stepMap, nil
}

func extractProfileStepIndex(startParameters string) (int, bool) {
	var params map[string]interface{}
	if err := json.Unmarshal([]byte(startParameters), &params); err != nil {
		return -1, false
	}
	val, ok := params["__profile_step_index"]
	if !ok {
		return -1, false
	}
	idx, ok := val.(float64)
	if !ok {
		return -1, false
	}
	return int(idx), true
}

func resetJobStepResults(ctx context.Context, jobID int64) error {
	return model.DB.WithContext(ctx).Model(&model.RagJobStep{}).
		Where("job_id = ?", jobID).
		Updates(map[string]interface{}{
			"status":     model.RagJobStepStatusPending,
			"start_time": int64(0),
			"end_time":   int64(0),
			"results":    "",
			"parameters": "",
		}).Error
}
