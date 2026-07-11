package engines

import (
	"context"
	"encoding/json"
	"fmt"
	"runtime/debug"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/env"
	"github.com/53AI/53AIHub/model"
	v2factory "github.com/53AI/53AIHub/rag-pipeline-v2/factory"
	v2model "github.com/53AI/53AIHub/rag-pipeline-v2/model"
	"github.com/go-redis/redis/v8"
	"gorm.io/gorm"
)

// Heartbeat constants
const (
	heartbeatKeyPrefix  = "rag:job:heartbeat"
	heartbeatInterval   = 30 * time.Second
	heartbeatKeyTTL     = 90 * time.Second
	staleJobCutoff      = 24 * time.Hour
)

// StepHandler 定义每个步骤的处理函数
type StepHandler func(ctx context.Context, job *model.RagJob, config json.RawMessage) error

// RecoveryConfig 断点恢复配置
type RecoveryConfig struct {
	GracePeriod time.Duration // 恢复窗口，默认 5min
	JobTimeout  time.Duration // 单 job 恢复超时，默认 10min
	Enabled     bool          // 是否启用恢复，默认 true
}

// LoadRecoveryConfigFromEnv 从环境变量加载恢复配置
func LoadRecoveryConfigFromEnv() RecoveryConfig {
	return RecoveryConfig{
		Enabled:     env.Bool("RAG_RECOVERY_ENABLED", true),
		GracePeriod: time.Duration(env.Int("RAG_RECOVERY_GRACE_PERIOD_SECONDS", 300)) * time.Second,
		JobTimeout:  time.Duration(env.Int("RAG_RECOVERY_JOB_TIMEOUT_SECONDS", 600)) * time.Second,
	}
}

// RagJobEngineV2 V2版本任务引擎
type RagJobEngineV2 struct {
	rdb                 redis.Cmdable
	db                  *gorm.DB
	factory             *v2factory.JobFactory
	queuePrefix         string
	workers             int
	handlers            map[string]StepHandler
	recoveryHandlers    map[string]StepHandler // recovery handler 注册表
	recoveryConfig      RecoveryConfig         // 恢复配置
	ctx                 context.Context
	cancel              context.CancelFunc
	wg                  sync.WaitGroup
	processingQueueName string // 统一前缀，实际使用时拼接 step_key
}

// JobWrapper 队列消息包装
type JobWrapper struct {
	JobID      int64     `json:"job_id"`
	Eid        int64     `json:"eid"`
	Type       string    `json:"type"`
	EnqueuedAt time.Time `json:"enqueued_at"`
	Retries    int       `json:"retries"`
}

func NewRagJobEngineV2(rdb redis.Cmdable, db *gorm.DB, factory *v2factory.JobFactory) *RagJobEngineV2 {
	ctx, cancel := context.WithCancel(context.Background())
	return &RagJobEngineV2{
		rdb:                 rdb,
		db:                  db,
		factory:             factory,
		queuePrefix:         "rag:job",
		workers:             5,
		handlers:            make(map[string]StepHandler),
		recoveryHandlers:    make(map[string]StepHandler),
		recoveryConfig:      LoadRecoveryConfigFromEnv(),
		ctx:                 ctx,
		cancel:              cancel,
		processingQueueName: "rag:job:processing",
	}
}

// RegisterHandler 注册步骤处理函数
func (e *RagJobEngineV2) RegisterHandler(stepKey string, handler StepHandler) {
	e.handlers[stepKey] = handler
}

// RegisterRecoveryHandler 注册恢复处理函数
func (e *RagJobEngineV2) RegisterRecoveryHandler(stepKey string, handler StepHandler) {
	e.recoveryHandlers[stepKey] = handler
}

// StartWorkers 启动所有注册步骤的 Worker
func (e *RagJobEngineV2) StartWorkers() {
	if !common.IsRedisEnabled() {
		logger.SysLog("Redis not enabled, RagJobEngineV2 workers not started")
		return
	}

	for stepKey := range e.handlers {
		for i := 0; i < e.workers; i++ {
			e.wg.Add(1)
			workerID := fmt.Sprintf("v2_%s_%d", stepKey, i)
			go e.workerLoop(workerID, stepKey)
		}
	}

	// 这里可以添加重试和死信队列的处理逻辑（略，复用 V1 或独立实现）
}

func (e *RagJobEngineV2) Stop() {
	e.cancel()
	e.wg.Wait()
}

func (e *RagJobEngineV2) workerLoop(workerID, stepKey string) {
	defer e.wg.Done()

	queueName := fmt.Sprintf("%s:queue:%s", e.queuePrefix, stepKey)
	processingQueue := fmt.Sprintf("%s:%s", e.processingQueueName, stepKey)

	logger.SysLogf("V2 Worker %s started listening on %s", workerID, queueName)

	for {
		select {
		case <-e.ctx.Done():
			return
		default:
			// RPOPLPUSH 可靠队列模式
			result, err := e.rdb.BRPopLPush(e.ctx, queueName, processingQueue, 5*time.Second).Result()
			if err != nil {
				if err != redis.Nil {
					logger.Error(e.ctx, fmt.Sprintf("Worker %s redis error: %v", workerID, err))
					time.Sleep(time.Second)
				}
				continue
			}

			e.processJob(workerID, result, stepKey, processingQueue)
		}
	}
}

func (e *RagJobEngineV2) processJob(workerID, payload, stepKey, processingQueue string) {
	var wrapper JobWrapper
	if err := json.Unmarshal([]byte(payload), &wrapper); err != nil {
		logger.Error(e.ctx, fmt.Sprintf("Unmarshal job failed: %v", err))
		// 无法解析，移除坏消息
		e.rdb.LRem(e.ctx, processingQueue, 1, payload)
		return
	}

	// 异常捕获
	defer func() {
		if r := recover(); r != nil {
			stack := string(debug.Stack())
			errMsg := fmt.Sprintf("Panic in job %d: %v\n%s", wrapper.JobID, r, stack)
			logger.Error(e.ctx, errMsg)
			e.handleFailure(wrapper, errMsg)
			e.rdb.LRem(e.ctx, processingQueue, 1, payload)
		}
	}()

	// 加载 Job
	var job model.RagJob
	if err := e.db.First(&job, wrapper.JobID).Error; err != nil {
		logger.Error(e.ctx, fmt.Sprintf("Load job %d failed: %v", wrapper.JobID, err))
		e.rdb.LRem(e.ctx, processingQueue, 1, payload)
		return
	}

	if job.Status != model.RagJobStatusPending {
		logger.Info(e.ctx, fmt.Sprintf("V2 worker %s skipping job %d with status %s", workerID, wrapper.JobID, job.Status))
		e.rdb.LRem(e.ctx, processingQueue, 1, payload)
		return
	}

	// 更新状态为处理中
	e.db.Model(&job).Update("status", model.RagJobStatusProcessing)

	// 写入 Redis 心跳：标记 job 正在运行
	e.rdb.Set(e.ctx, fmt.Sprintf("%s:%d", heartbeatKeyPrefix, job.JobID),
		time.Now().UnixMilli(), heartbeatKeyTTL)

	// 同步更新 File 的 run_status 为 processing
	// 显式传 processing 绕过 RunID 共享场景下旧 job 的干扰计算
	if fileID := model.ExtractFileIDFromJob(&job); fileID > 0 && job.RunID != "" {
		if err := model.UpdateFileCleaningRuleInfoHelper(e.db, fileID, job.RunID, "processing"); err != nil {
			logger.Warn(e.ctx, fmt.Sprintf("processJob: failed to update cleaning_rule_info for job %d: %v", wrapper.JobID, err))
		}
	}

	// 解析 Profile 获取当前步骤配置
	var profile v2model.RuntimeProfile
	if err := json.Unmarshal([]byte(job.RuntimeProfile), &profile); err != nil {
		e.handleFailure(wrapper, fmt.Sprintf("Parse profile failed: %v", err))
		e.rdb.LRem(e.ctx, processingQueue, 1, payload)
		return
	}

	// 解析参数获取当前步骤索引
	var params map[string]interface{}
	// 如果 StartParameters 为空或非 JSON，params 为空 map
	json.Unmarshal([]byte(job.StartParameters), &params)

	// 查找当前步骤索引
	// 优先使用 __profile_step_index
	// 如果没有，尝试通过 step_key 匹配（不推荐，可能有重复）
	var currentIndex int = -1
	if val, ok := params["__profile_step_index"]; ok {
		if idx, ok := val.(float64); ok {
			currentIndex = int(idx)
		}
	}

	if currentIndex == -1 || currentIndex >= len(profile.Steps) {
		e.handleFailure(wrapper, fmt.Sprintf("Invalid step index: %d", currentIndex))
		e.rdb.LRem(e.ctx, processingQueue, 1, payload)
		return
	}

	stepConfig := profile.Steps[currentIndex]

	// 记录步骤开始执行
	jobStep := model.RagJobStep{
		JobID:      job.JobID,
		Eid:        job.Eid,
		StepOrder:  currentIndex,
		Status:     model.RagJobStepStatusProcessing,
		StartTime:  time.Now().UnixMilli(),
		Parameters: job.StartParameters, // 记录启动参数
	}

	// 尝试查找或创建 RagJobStep
	var existingStep model.RagJobStep
	if err := e.db.Where("job_id = ?", job.JobID).First(&existingStep).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			if err := e.db.Create(&jobStep).Error; err != nil {
				logger.Error(e.ctx, fmt.Sprintf("Failed to create RagJobStep: %v", err))
			}
		} else {
			logger.Error(e.ctx, fmt.Sprintf("Failed to query RagJobStep: %v", err))
		}
	} else {
		// 已存在，更新状态
		if err := e.db.Model(&existingStep).Updates(map[string]interface{}{
			"status":     model.RagJobStepStatusProcessing,
			"start_time": time.Now().UnixMilli(),
		}).Error; err != nil {
			logger.Error(e.ctx, fmt.Sprintf("Failed to update RagJobStep status: %v", err))
		}
	}

	// 执行 Handler
	handler, exists := e.handlers[stepKey]
	if !exists {
		e.handleFailure(wrapper, fmt.Sprintf("No handler for step_key: %s", stepKey))
		e.rdb.LRem(e.ctx, processingQueue, 1, payload)
		return
	}

	// 启动心跳 goroutine：handler 执行期间定期刷新 Redis 心跳
	heartbeatStop := e.startHeartbeat(e.ctx, job.JobID)
	defer heartbeatStop()

	start := time.Now()
	if err := handler(e.ctx, &job, stepConfig.Config); err != nil {
		// 更新 Step 状态为 Failed
		var failedStep model.RagJobStep
		if errStep := e.db.Where("job_id = ?", job.JobID).First(&failedStep).Error; errStep == nil {
			failedStep.CompleteWithError(map[string]string{"error": err.Error()})
			e.db.Save(&failedStep)
		}

		e.handleFailure(wrapper, err.Error())
		// 这里可以添加重试逻辑（推入重试队列），暂时简化为直接移除
		e.rdb.LRem(e.ctx, processingQueue, 1, payload)
		return
	}

	logger.Info(e.ctx, fmt.Sprintf("Job %d (step: %s) completed in %v", job.JobID, stepKey, time.Since(start)))

	if err := e.finalizeJob(e.ctx, job, currentIndex, profile); err != nil {
		e.handleFailure(wrapper, "finalize failed: "+err.Error())
		e.rdb.LRem(e.ctx, processingQueue, 1, payload)
		return
	}

	// Ack (移除处理中消息)
	e.rdb.LRem(e.ctx, processingQueue, 1, payload)
}

func (e *RagJobEngineV2) handleFailure(wrapper JobWrapper, reason string) {
	// 更新任务状态
	e.db.Model(&model.RagJob{}).Where("job_id = ?", wrapper.JobID).Updates(map[string]interface{}{
		"status":         model.RagJobStatusFailed,
		"failure_reason": reason,
	})

	// 获取任务信息以更新 Pipeline 统计
	var job model.RagJob
	if err := e.db.Select("pipeline_id, run_id, related_id, start_parameters").First(&job, wrapper.JobID).Error; err == nil {
		fileID := model.ExtractFileIDFromJob(&job)
		if fileID > 0 {
			if updateErr := model.UpdateFileCleaningRuleInfoHelper(e.db, fileID, job.RunID, "failed"); updateErr != nil {
				logger.Error(e.ctx, fmt.Sprintf("Failed to update cleaning_rule_info for job %d: %v", wrapper.JobID, updateErr))
			}
		}
		if job.PipelineID > 0 {
			if err := e.db.Model(&model.RagPipelineProfile{}).Where("id = ?", job.PipelineID).Updates(map[string]interface{}{
				"failure_count": gorm.Expr("failure_count + ?", 1),
				"last_run_time": time.Now().UnixMilli(),
			}).Error; err != nil {
				logger.Error(e.ctx, fmt.Sprintf("Failed to update pipeline failure stats for job %d: %v", wrapper.JobID, err))
			}
		}

		// 清理 Redis 心跳
		e.rdb.Del(e.ctx, fmt.Sprintf("%s:%d", heartbeatKeyPrefix, job.JobID))

		// 注意：不在此处推进流水线——下游步骤依赖上游输出，上游 failed 意味着
		// 下游数据不完整。Cleaner 场景（24h 无心跳）由 cleanupStaleProcessingJobs
		// 单独取消下游 paused job；正常 handler 出错返回时，流水线保持 paused 状态，
		// 由用户或恢复机制决定后续处理。
	}
}

// startHeartbeat 启动心跳 goroutine，定期向 Redis 写入心跳标记
// 返回 stop 函数，调用后停止心跳
func (e *RagJobEngineV2) startHeartbeat(ctx context.Context, jobID int64) func() {
	ctx, cancel := context.WithCancel(ctx)
	go func() {
		ticker := time.NewTicker(heartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				e.rdb.Set(ctx, fmt.Sprintf("%s:%d", heartbeatKeyPrefix, jobID),
					time.Now().UnixMilli(), heartbeatKeyTTL)
			}
		}
	}()
	return cancel
}

// StartStaleJobCleaner 启动定时清理死 job 的任务
// 定期扫描 processing 状态但无心跳的 job，标记为失败并推进流水线
func (e *RagJobEngineV2) StartStaleJobCleaner(ctx context.Context, interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		// 启动时先跑一次
		e.cleanupStaleProcessingJobs(ctx)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				e.cleanupStaleProcessingJobs(ctx)
			}
		}
	}()
}

// cleanupStaleProcessingJobs 清理超过 24h 无心跳的 processing job
func (e *RagJobEngineV2) cleanupStaleProcessingJobs(ctx context.Context) {
	cutoff := time.Now().Add(-staleJobCutoff).UnixMilli()

	var staleJobs []model.RagJob
	if err := e.db.Where("status = ? AND updated_time < ?",
		model.RagJobStatusProcessing,
		cutoff,
	).Limit(500).Find(&staleJobs).Error; err != nil {
		logger.Errorf(ctx, "【StaleJobCleaner】查询死 job 失败: %v", err)
		return
	}

	if len(staleJobs) == 0 {
		return
	}

	var markedCount int
	for _, job := range staleJobs {
		// 检查 Redis 心跳是否存在
		exists, err := e.rdb.Exists(ctx, fmt.Sprintf("%s:%d", heartbeatKeyPrefix, job.JobID)).Result()
		if err != nil {
			logger.Warnf(ctx, "【StaleJobCleaner】检查心跳失败 job %d: %v", job.JobID, err)
			continue
		}
		if exists > 0 {
			continue // 有心跳，还活着
		}

		logger.Warnf(ctx, "【StaleJobCleaner】发现死 job %d (type=%s, run=%s, updated=%d)，标记为失败",
			job.JobID, job.Type, job.RunID, job.UpdatedTime)
		e.handleFailure(JobWrapper{
			JobID: job.JobID,
			Eid:   job.Eid,
			Type:  job.Type,
		}, "超时未完成: 超过24小时无心跳")

		// 终止同 run 中剩余的 paused 步骤：上游已死，下游的数据依赖不成立
		if job.RunID != "" {
			var remaining []model.RagJob
			e.db.Where("run_id = ? AND status = ?", job.RunID, model.RagJobStatusPaused).Find(&remaining)
			for _, rj := range remaining {
				e.db.Model(&rj).Updates(map[string]interface{}{
					"status":         model.RagJobStatusCancelled,
					"failure_reason": "上游步骤超时失败，流水线终止",
				})
				logger.Warnf(ctx, "【StaleJobCleaner】已取消下游 job %d (type=%s)", rj.JobID, rj.Type)
			}
		}

		markedCount++
	}

	if markedCount > 0 {
		logger.Infof(ctx, "【StaleJobCleaner】清理完成: 标记 %d 个死 job 为失败", markedCount)
	}
}

// finalizeJob 共享最终化逻辑，processJob 和 recoverOneJob 共用
// 事务保护：步骤 1-4（DB 操作）在同一个事务中执行，步骤 5（Redis 操作）在事务外执行
// 幂等保护：通过检查 RagJobStep 的当前状态判断是否为首次完成，避免 success_count 重复累加
func (e *RagJobEngineV2) finalizeJob(ctx context.Context, job model.RagJob, currentIndex int, profile v2model.RuntimeProfile) error {
	fileID := model.ExtractFileIDFromJob(&job)
	isLastStep := currentIndex == len(profile.Steps)-1

	// 步骤 1-4 在事务中执行
	err := e.db.Transaction(func(tx *gorm.DB) error {
		// 1. 更新 Job 状态为 success（幂等：Update 不关心当前值）
		if err := tx.Model(&model.RagJob{}).Where("job_id = ?", job.JobID).Update("status", model.RagJobStatusSuccess).Error; err != nil {
			return err
		}

		// 2. 更新 RagJobStep 状态为 success（幂等：检查是否已是 success）
		var stepJustUpdated bool
		var jobStep model.RagJobStep
		if err := tx.Where("job_id = ?", job.JobID).First(&jobStep).Error; err == nil {
			if jobStep.Status != model.RagJobStepStatusSuccess {
				if err := jobStep.CompleteSuccessfully(nil); err == nil {
					tx.Save(&jobStep)
					stepJustUpdated = true
				}
			}
		}

		// 3. 更新 File Cleaning Rule Info
		if fileID > 0 {
			model.UpdateFileCleaningRuleInfoHelper(tx, fileID, job.RunID, "")
		}

		// 4. 如果是最后一步，更新 pipeline 统计信息（幂等：仅 step 刚从非 success 变为 success 时累加）
		if isLastStep && job.PipelineID > 0 && stepJustUpdated {
			if err := tx.Model(&model.RagPipelineProfile{}).Where("id = ?", job.PipelineID).Updates(map[string]interface{}{
				"success_count": gorm.Expr("success_count + ?", 1),
				"last_run_time": time.Now().UnixMilli(),
			}).Error; err != nil {
				return err
			}
		}

		return nil
	})

	if err != nil {
		logger.Errorf(ctx, "finalizeJob 事务失败: job=%d, err=%v", job.JobID, err)
		return fmt.Errorf("finalizeJob transaction failed: %w", err)
	}

	// 步骤 5: 触发下一步（Redis 操作，在事务外执行）
	params, _, _ := parseProfileStepIndexFromParameters(job.StartParameters)
	isSingleStep := false
	if val, ok := params["__single_step_execution"]; ok {
		if b, ok := val.(bool); ok && b {
			isSingleStep = true
		}
	}
	if !profile.Steps[currentIndex].ParallelGroup && !isSingleStep {
		if err := e.factory.EnqueueNextJob(ctx, job.RunID, currentIndex); err != nil {
			logger.Errorf(ctx, "【重要】触发下一步失败，pipeline 可能断裂: job=%d, run_id=%s, err=%v", job.JobID, job.RunID, err)
		}
	}
	return nil
}

// RecoverStuckJobs 启动恢复扫描，阻塞式完成后再 StartWorkers
func (e *RagJobEngineV2) RecoverStuckJobs(ctx context.Context) {
	if !e.recoveryConfig.Enabled {
		logger.SysLog("【流水线恢复】Recovery 已禁用，跳过")
		return
	}

	engineStartTime := time.Now().UnixMilli()
	gracePeriod := int64(e.recoveryConfig.GracePeriod.Milliseconds())

	logger.Infof(ctx, "【流水线恢复】开始恢复扫描: engineStartTime=%d, gracePeriod=%dms", engineStartTime, gracePeriod)

	var wg sync.WaitGroup
	var attemptedCount int64
	var successCount atomic.Int64
	sem := make(chan struct{}, 20)

	// ===== Phase 1: 恢复窗口内中断的 processing job =====
	var stuckJobs []model.RagJob
	if err := e.db.Where("status = ? AND updated_time > ? AND updated_time < ?",
		model.RagJobStatusProcessing,
		engineStartTime-gracePeriod,
		engineStartTime,
	).Limit(200).Find(&stuckJobs).Error; err != nil {
		logger.Errorf(ctx, "【流水线恢复】Phase 1 查询 stuck jobs 失败: %v", err)
	}

	if len(stuckJobs) > 0 {
		grouped := groupJobsByRunID(stuckJobs)

		for _, jobs := range grouped {
			sortJobsByStepIndex(jobs)
			for _, job := range jobs {
				sem <- struct{}{}
				wg.Add(1)
				go func(j model.RagJob) {
					defer wg.Done()
					defer func() { <-sem }()
					if e.recoverOneJob(ctx, j) {
						successCount.Add(1)
					}
					e.cleanupProcessingQueue(ctx, j)
				}(job)
				attemptedCount++
			}
		}
	}

	// Phase 1 全部完成后，再执行 Phase 2
	wg.Wait()

	// ===== Phase 2: 修复断裂流水线 =====
	var repairedCount int64
	var brokenRunIDs []string
	if err := e.db.Model(&model.RagJob{}).
		Where("status = ? AND updated_time > ? AND updated_time < ?",
			model.RagJobStatusSuccess,
			engineStartTime-gracePeriod,
			engineStartTime,
		).
		Where("EXISTS (?)",
			e.db.Table("rag_jobs r2").Select("1").Where("r2.run_id = rag_jobs.run_id AND r2.status = ?", model.RagJobStatusPaused),
		).
		Where("NOT EXISTS (?)",
			e.db.Table("rag_jobs r3").Select("1").Where("r3.run_id = rag_jobs.run_id AND r3.status IN ?", []string{model.RagJobStatusProcessing, model.RagJobStatusPending}),
		).
		Distinct("run_id").
		Pluck("run_id", &brokenRunIDs).Error; err != nil {
		logger.Errorf(ctx, "【流水线恢复】Phase 2 查询断裂流水线失败: %v", err)
	}

	for _, runID := range brokenRunIDs {
		e.repairBrokenPipeline(ctx, runID)
		repairedCount++
	}

	logger.Infof(ctx, "【流水线恢复】恢复完成: 尝试恢复=%d, 成功恢复=%d, 修复流水线=%d",
		attemptedCount, successCount.Load(), repairedCount)
}

// recoverOneJob 恢复单个 job
func (e *RagJobEngineV2) recoverOneJob(ctx context.Context, job model.RagJob) bool {
	ctx, cancel := context.WithTimeout(ctx, e.recoveryConfig.JobTimeout)
	defer cancel()

	stepKey := job.Type
	makeWrapper := func() JobWrapper {
		return JobWrapper{JobID: job.JobID, Eid: job.Eid, Type: stepKey, EnqueuedAt: time.Now()}
	}

	defer func() {
		if r := recover(); r != nil {
			stack := string(debug.Stack())
			errMsg := fmt.Sprintf("panic in recovery job %d: %v\n%s", job.JobID, r, stack)
			logger.Errorf(ctx, "【流水线恢复】%s", errMsg)
			e.handleFailure(makeWrapper(), errMsg)
		}
	}()

	handler, exists := e.recoveryHandlers[stepKey]
	if !exists {
		handler = e.handlers[stepKey]
	}
	if handler == nil {
		logger.Errorf(ctx, "【流水线恢复】job %d 无可用 handler (step=%s)", job.JobID, stepKey)
		e.handleFailure(makeWrapper(), "no handler for recovery")
		return false
	}

	var profile v2model.RuntimeProfile
	if err := json.Unmarshal([]byte(job.RuntimeProfile), &profile); err != nil {
		e.handleFailure(makeWrapper(), "invalid profile: "+err.Error())
		return false
	}
	_, currentIndex, parseErr := parseProfileStepIndexFromParameters(job.StartParameters)
	if parseErr != nil {
		e.handleFailure(makeWrapper(), "parse step index failed: "+parseErr.Error())
		return false
	}
	if currentIndex < 0 || currentIndex >= len(profile.Steps) {
		e.handleFailure(makeWrapper(), fmt.Sprintf("invalid step index: %d (steps=%d)", currentIndex, len(profile.Steps)))
		return false
	}

	logger.Infof(ctx, "【流水线恢复】开始恢复 job %d (step=%s, run_id=%s, 中断于 %dms 前)",
		job.JobID, stepKey, job.RunID, time.Now().UnixMilli()-job.UpdatedTime)

	// 写初始心跳 + 启动心跳 goroutine
	e.rdb.Set(ctx, fmt.Sprintf("%s:%d", heartbeatKeyPrefix, job.JobID),
		time.Now().UnixMilli(), heartbeatKeyTTL)
	heartbeatStop := e.startHeartbeat(ctx, job.JobID)
	defer heartbeatStop()

	if err := handler(ctx, &job, profile.Steps[currentIndex].Config); err != nil {
		logger.Errorf(ctx, "【流水线恢复】job %d 恢复失败: %v", job.JobID, err)
		e.handleFailure(makeWrapper(), "recovery_failed: "+err.Error())
		return false
	}

	if err := e.finalizeJob(ctx, job, currentIndex, profile); err != nil {
		logger.Errorf(ctx, "【流水线恢复】job %d finalizeJob 失败: %v", job.JobID, err)
		return false
	}
	logger.Infof(ctx, "【流水线恢复】job %d 恢复成功", job.JobID)
	return true
}

// repairBrokenPipeline 修复断裂流水线（当前 job 已 success 但 EnqueueNextJob 未执行）
func (e *RagJobEngineV2) repairBrokenPipeline(ctx context.Context, runID string) {
	var successJobs []model.RagJob
	if err := e.db.Where("run_id = ? AND status = ?", runID, model.RagJobStatusSuccess).
		Find(&successJobs).Error; err != nil || len(successJobs) == 0 {
		return
	}

	var maxIndex int = -1
	for _, j := range successJobs {
		_, idx, _ := parseProfileStepIndexFromParameters(j.StartParameters)
		if idx > maxIndex {
			maxIndex = idx
		}
	}

	if maxIndex < 0 {
		logger.Warnf(ctx, "【流水线恢复】repairBrokenPipeline: 有 success job 但无法解析 step index，跳过修复 (run_id=%s, job_count=%d)", runID, len(successJobs))
		return
	}

	logger.Infof(ctx, "【流水线恢复】修复断裂流水线: run_id=%s, last_success_step=%d", runID, maxIndex)

	if err := e.factory.EnqueueNextJob(ctx, runID, maxIndex); err != nil {
		logger.Errorf(ctx, "【流水线恢复】修复断裂流水线失败: run_id=%s, err=%v", runID, err)
	}
}

// Lua 脚本：在 queue 中查找包含指定 jobID 的消息并删除（原子操作）
var cleanupQueueScript = redis.NewScript(`
local queue = KEYS[1]
local job_id = ARGV[1]
local payloads = redis.call('LRANGE', queue, 0, -1)
local pattern = '"job_id":' .. job_id .. '[^0-9]'
for i, v in ipairs(payloads) do
    if string.find(v, pattern) then
        redis.call('LREM', queue, 1, v)
        return 1
    end
end
return 0
`)

// cleanupProcessingQueue 清理 Redis 中残留的 processing queue 消息
func (e *RagJobEngineV2) cleanupProcessingQueue(ctx context.Context, job model.RagJob) {
	queueName := fmt.Sprintf("%s:%s", e.processingQueueName, job.Type)
	jobIDStr := fmt.Sprintf("%d", job.JobID)
	_, err := cleanupQueueScript.Run(ctx, e.rdb, []string{queueName}, jobIDStr).Result()
	if err != nil && err != redis.Nil {
		logger.Warnf(ctx, "【流水线恢复】清理 processing queue 失败: job=%d, queue=%s, err=%v", job.JobID, queueName, err)
	}
}

// groupJobsByRunID 按 run_id 分组
func groupJobsByRunID(jobs []model.RagJob) map[string][]model.RagJob {
	grouped := make(map[string][]model.RagJob)
	for _, job := range jobs {
		grouped[job.RunID] = append(grouped[job.RunID], job)
	}
	return grouped
}

// sortJobsByStepIndex 按 step_index 升序排列
func sortJobsByStepIndex(jobs []model.RagJob) {
	sort.Slice(jobs, func(i, j int) bool {
		_, idxI, _ := parseProfileStepIndexFromParameters(jobs[i].StartParameters)
		_, idxJ, _ := parseProfileStepIndexFromParameters(jobs[j].StartParameters)
		return idxI < idxJ
	})
}

// parseProfileStepIndexFromParameters 解析 StartParameters 获取 params 和 step index
// 注意：此函数是 service 包同名函数的复制版本（因包间循环依赖无法共享），两处需同步维护
func parseProfileStepIndexFromParameters(startParameters string) (map[string]interface{}, int, error) {
	var params map[string]interface{}
	if err := json.Unmarshal([]byte(startParameters), &params); err != nil {
		return make(map[string]interface{}), -1, fmt.Errorf("unmarshal start_parameters failed: %w", err)
	}
	currentIndex := -1
	if val, ok := params["__profile_step_index"]; ok {
		if idx, ok := val.(float64); ok {
			currentIndex = int(idx)
		}
	}
	return params, currentIndex, nil
}
