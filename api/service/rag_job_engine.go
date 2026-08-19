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
	// 注册纪要生成回调，不依赖 Redis
	v2steps.GenerateMeetingMinutesFn = GenerateMeetingMinutes

	// 注册转写复用回调（同内容文件已有 completed 转写 → 拷贝跳过 ASR）
	v2steps.ReuseTranscriptFn = reuseTranscriptForFile

	// 注册洞察生成回调（在 document_chunking 步骤中实体抽取完成后触发）
	v2steps.GenerateInsightsFn = GenerateInsights

	// 注册纪要 JSON→Markdown 转换回调（在 document_chunking 步骤中文件摘要/实体抽取前使用）
	v2steps.BuildMinutesMarkdownFn = BuildMinutesMarkdown
	logger.SysLog("【诊断-内容转换】BuildMinutesMarkdownFn 已注册")

	// 注册录音管线 context provider，供异步 goroutine 派生可被服务停止优雅取消的子 context
	v2steps.PipelineCtxFn = func() context.Context { return recordingPipelineCtx }

	initOnce.Do(func() {
		if !common.IsRedisEnabled() {
			logger.SysLog("Redis not enabled, skipping RAG job engine initialization")
			return
		}

		// 初始化 V2 引擎
		ragJobFactoryV2 = v2factory.NewJobFactory(model.DB, common.RDB)
		ragJobEngineV2 = v2engines.NewRagJobEngineV2(common.RDB, model.DB, ragJobFactoryV2)

		ragJobEngineV2.SetPostFinalizeHook(func(ctx context.Context, job model.RagJob, currentIndex int, profile v2model.RuntimeProfile) error {
			// 独立 Wiki 向量化 Job 不属于 RAG Pipeline，不能在完成后再次触发 Wiki 生成。
			if job.PipelineID <= 0 || !shouldAutoTriggerWikiAfterStep(profile, currentIndex) {
				return nil
			}
			return NewWikiAutoTriggerService(model.DB).MaybeEnqueueWikiGeneration(ctx, WikiAutoTriggerInput{
				Eid:           job.Eid,
				FileID:        model.ExtractFileIDFromJob(&job),
				SourceRunID:   job.RunID,
				TriggerSource: "auto_after_pipeline",
			})
		})

		// 注册 V2 Handler
		ragJobEngineV2.RegisterHandler("document_parsing", v2steps.NewDocumentParsingHandler(model.DB))

		registerRagJobEngineV2Handlers(ragJobEngineV2)

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

func shouldAutoTriggerWikiAfterStep(profile v2model.RuntimeProfile, currentIndex int) bool {
	if currentIndex < 0 || currentIndex >= len(profile.Steps) {
		return false
	}

	for _, step := range profile.Steps {
		if step.StepKey == "wiki_page_generation" {
			return false
		}
	}

	for _, step := range profile.Steps[currentIndex+1:] {
		runMode := step.RunMode
		if runMode == "" {
			if step.Enabled {
				runMode = v2model.RunModeAuto
			} else {
				runMode = v2model.RunModeManual
			}
		}
		if runMode != v2model.RunModeSkip {
			return false
		}
	}
	return true
}

func registerRagJobEngineV2Handlers(engine *v2engines.RagJobEngineV2) {
	if engine == nil {
		return
	}

	// 注册 V2 Handler
	engine.RegisterHandler("document_parsing", v2steps.NewDocumentParsingHandler(model.DB))
	engine.RegisterHandler("content_cleaning", v2steps.NewContentCleaningHandler(model.DB))
	engine.RegisterHandler("summary_generation", v2steps.NewSummaryGenerationHandler(model.DB))
	engine.RegisterHandler("document_chunking", v2steps.NewDocumentChunkingHandler(model.DB))
	engine.RegisterHandler("vector_indexing", v2steps.NewVectorIndexingHandler(model.DB))
	engine.RegisterHandler("graph_generation", v2steps.NewGraphGenerationHandler(model.DB))
	engine.RegisterHandler("wiki_page_generation", v2steps.NewWikiPageGenerationHandler(NewWikiPageGenerationProcessor(model.DB)))
	engine.RegisterHandler(wikiPageVectorizationJobType, NewWikiPageVectorizationHandler(NewWikiPageVectorizationProcessor(model.DB)))

	// 注册 V2 Recovery Handler
	engine.RegisterRecoveryHandler("document_parsing", v2steps.RecoverDocumentParsing(model.DB))
	engine.RegisterRecoveryHandler("content_cleaning", v2steps.RecoverContentCleaning(model.DB))
	engine.RegisterRecoveryHandler("summary_generation", v2steps.RecoverSummaryGeneration(model.DB))
	engine.RegisterRecoveryHandler("document_chunking", v2steps.RecoverDocumentChunking(model.DB))
	engine.RegisterRecoveryHandler("vector_indexing", v2steps.RecoverVectorIndexing(model.DB))
	engine.RegisterRecoveryHandler("graph_generation", v2steps.RecoverGraphGeneration(model.DB))
	engine.RegisterRecoveryHandler("wiki_page_generation", v2steps.RecoverWikiPageGeneration(model.DB, NewWikiPageGenerationProcessor(model.DB)))
	engine.RegisterRecoveryHandler(wikiPageVectorizationJobType, RecoverWikiPageVectorization(model.DB, NewWikiPageVectorizationProcessor(model.DB)))
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

	// 记录该 job 是否由批量运行创建（single_step 标志随后会被删除，先记录再删）。
	// 批量运行创建的步骤由管理端显式选择，不受手动步骤断点约束；
	// 普通链上任务的主动重试必须尊重手动步骤边界，避免跳过内容清洗等手动节点。
	_, wasBatchSingleStep := params["__single_step_execution"]
	// 确保移除单步执行标志，让引擎能够触发后续步骤
	delete(params, "__single_step_execution")

	// 手动步骤断点：链上任务重试时，若该步骤之前存在未执行（paused）的手动步骤，
	// 拒绝重试，要求用户先手动执行该手动步骤。
	if !wasBatchSingleStep {
		blocked, err := hasPausedManualStepBefore(ctx, job.RunID, currentIndex, profile)
		if err != nil {
			return fmt.Errorf("检查前置手动步骤失败: %v", err)
		}
		if blocked {
			return fmt.Errorf("步骤 %s 之前存在未执行的手动步骤（如内容清洗），请先手动执行该步骤", step.StepKey)
		}
	}

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

	// 批量运行/重试同样尊重手动步骤断点：目标步骤之前存在未执行（paused）的
	// 手动步骤时，该 job 保持 paused 等待手动触发，不再自动入队，
	// 避免"内容清洗"未手动开始而语料拆分/向量化等下游步骤自动完成。
	blocked, err := isJobBlockedByPausedManualStep(ctx, items[0].JobID)
	if err != nil {
		return err
	}
	if blocked {
		// 置 paused 而非保持 pending：pending 会污染排队统计并让文件 run_status 误判为
		// processing；paused 表示等待手动触发，手动步骤执行后由 EnqueueNextJob 正常推进。
		if err := model.DB.WithContext(ctx).Model(&model.RagJob{}).
			Where("job_id = ?", items[0].JobID).
			Update("status", model.RagJobStatusPaused).Error; err != nil {
			return err
		}
		logger.Infof(ctx, "Batch retry stopped at job %d: 前置手动步骤未执行，置 paused 等待手动触发", items[0].JobID)
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
	// Batch 单步运行可由管理端直接发起，StartParameters 并不保证带有 user_id。
	// 下游的纪要、洞察和安心录记忆均按 owner_id 查询，因此在任务创建时补齐
	// 文件创建者，保证新任务和常规上传任务的归属一致。
	populateRagJobOwnerID(paramsMap, file.UserID)
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
			Updates(map[string]interface{}{
				"cleaning_rule_info": string(initBytes),
				"run_status":         "pending",
				"parsing_status":     "pending",
			}).Error
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
		// 手动步骤断点：该步骤之前存在未执行（paused）的手动步骤时，
		// 保持 paused 等待手动触发，不自动入队，避免"内容清洗"未手动开始
		// 而语料拆分/向量化等下游步骤自动完成（也不产生孤儿 pending 污染排队统计）。
		blocked, err := isJobBlockedByPausedManualStep(ctx, job.JobID)
		if err != nil {
			return "", nil, err
		}
		if blocked {
			if err := db.Model(&model.RagJob{}).Where("job_id = ?", job.JobID).
				Update("status", model.RagJobStatusPaused).Error; err != nil {
				return "", nil, err
			}
			logger.Infof(ctx, "BatchRun: job %d (step=%s) 前置手动步骤未执行，置 paused 等待手动触发", job.JobID, job.Type)
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

func populateRagJobOwnerID(params map[string]interface{}, fileOwnerID int64) {
	if fileOwnerID <= 0 {
		return
	}
	if _, exists := params["user_id"]; !exists {
		params["user_id"] = fileOwnerID
	}
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
		// 手动步骤断点：该步骤之前存在未执行（paused）的手动步骤时停止串行，
		// 该 job 置 paused 等待用户手动触发，避免跳过内容清洗等手动节点
		// （也避免残留 pending 孤儿污染排队统计/误判 run_status）。
		blocked, err := isJobBlockedByPausedManualStep(ctx, item.JobID)
		if err != nil {
			logger.Errorf(ctx, "Batch retry check manual step boundary failed: job %d, err %v", item.JobID, err)
			return
		}
		if blocked {
			if err := model.DB.WithContext(ctx).Model(&model.RagJob{}).
				Where("job_id = ?", item.JobID).
				Update("status", model.RagJobStatusPaused).Error; err != nil {
				logger.Errorf(ctx, "Batch retry pause job %d failed: %v", item.JobID, err)
				return
			}
			logger.Infof(ctx, "Batch retry stopped at job %d: 前置手动步骤未执行，置 paused 等待手动触发", item.JobID)
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

	runID := latestRunIDForJob(latestJob)
	jobQuery := model.DB.WithContext(ctx).Model(&model.RagJob{})
	if eid > 0 {
		jobQuery = jobQuery.Where("eid = ?", eid)
	}
	if runID != "" {
		if strings.TrimSpace(latestJob.RunID) == "" {
			// 兼容旧版自动触发的 Wiki Job：这些记录可能只有 source_run_id，
			// 需要把自身并入源流水线批次，避免接口只返回 Wiki 这一条记录。
			jobQuery = jobQuery.Where("run_id = ? OR job_id = ?", runID, latestJob.JobID)
		} else {
			jobQuery = jobQuery.Where("run_id = ?", runID)
		}
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

func latestRunIDForJob(job model.RagJob) string {
	if runID := strings.TrimSpace(job.RunID); runID != "" {
		return runID
	}

	var params map[string]interface{}
	if err := json.Unmarshal([]byte(job.StartParameters), &params); err != nil {
		return ""
	}
	if sourceRunID, ok := params["source_run_id"].(string); ok {
		return strings.TrimSpace(sourceRunID)
	}
	return ""
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

// hasPausedManualStepBefore 检查 run 中是否存在位于 stepIndex 之前、尚未执行（paused）的手动步骤。
// 存在时该步骤之后的所有下游步骤都不应被自动推进，必须等待用户手动触发该手动步骤，
// 防止"内容清洗"等手动节点未执行时语料拆分/向量化等下游步骤自动完成。
// 该函数只识别 profile 中 run_mode 为 manual 且 job 仍为 paused 的步骤；
// paused 的 auto 步骤（如 reindex 遗留）不构成手动断点。
func hasPausedManualStepBefore(ctx context.Context, runID string, stepIndex int, profile v2model.RuntimeProfile) (bool, error) {
	if runID == "" || stepIndex <= 0 {
		return false, nil
	}
	var jobs []model.RagJob
	if err := model.DB.WithContext(ctx).Select("start_parameters").
		Where("run_id = ? AND status = ?", runID, model.RagJobStatusPaused).
		Find(&jobs).Error; err != nil {
		return false, err
	}
	for _, j := range jobs {
		idx, ok := extractProfileStepIndex(j.StartParameters)
		if !ok || idx < 0 || idx >= stepIndex || idx >= len(profile.Steps) {
			continue
		}
		step := profile.Steps[idx]
		runMode := step.RunMode
		if runMode == "" {
			if step.Enabled {
				runMode = v2model.RunModeAuto
			} else {
				runMode = v2model.RunModeManual
			}
		}
		if runMode == v2model.RunModeManual {
			return true, nil
		}
	}
	return false, nil
}

// isJobBlockedByPausedManualStep 判断指定 job 是否被同 run 内未执行（paused）的手动步骤阻塞。
// profile/参数解析失败等异常场景返回 false，保持调用方原有行为（不额外阻塞）。
func isJobBlockedByPausedManualStep(ctx context.Context, jobID int64) (bool, error) {
	var job model.RagJob
	if err := model.DB.WithContext(ctx).Select("run_id", "start_parameters", "runtime_profile_json").
		First(&job, jobID).Error; err != nil {
		return false, err
	}
	if job.RunID == "" || job.RuntimeProfile == "" {
		return false, nil
	}
	var profile v2model.RuntimeProfile
	if err := json.Unmarshal([]byte(job.RuntimeProfile), &profile); err != nil {
		return false, nil
	}
	idx, ok := extractProfileStepIndex(job.StartParameters)
	if !ok {
		return false, nil
	}
	return hasPausedManualStepBefore(ctx, job.RunID, idx, profile)
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
