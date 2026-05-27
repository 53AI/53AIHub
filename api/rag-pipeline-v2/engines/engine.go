package engines

import (
	"context"
	"encoding/json"
	"fmt"
	"runtime/debug"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	v2factory "github.com/53AI/53AIHub/rag-pipeline-v2/factory"
	v2model "github.com/53AI/53AIHub/rag-pipeline-v2/model"
	"github.com/go-redis/redis/v8"
	"gorm.io/gorm"
)

// StepHandler 定义每个步骤的处理函数
type StepHandler func(ctx context.Context, job *model.RagJob, config json.RawMessage) error

// RagJobEngineV2 V2版本任务引擎
type RagJobEngineV2 struct {
	rdb                 redis.Cmdable
	db                  *gorm.DB
	factory             *v2factory.JobFactory
	queuePrefix         string
	workers             int
	handlers            map[string]StepHandler
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
		ctx:                 ctx,
		cancel:              cancel,
		processingQueueName: "rag:job:processing",
	}
}

// RegisterHandler 注册步骤处理函数
func (e *RagJobEngineV2) RegisterHandler(stepKey string, handler StepHandler) {
	e.handlers[stepKey] = handler
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
		e.db.Model(&existingStep).Updates(map[string]interface{}{
			"status":     model.RagJobStepStatusProcessing,
			"start_time": time.Now().UnixMilli(),
		})
	}

	// 执行 Handler
	handler, exists := e.handlers[stepKey]
	if !exists {
		e.handleFailure(wrapper, fmt.Sprintf("No handler for step_key: %s", stepKey))
		e.rdb.LRem(e.ctx, processingQueue, 1, payload)
		return
	}

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

	// 更新状态成功
	e.db.Model(&job).Update("status", model.RagJobStatusSuccess)

	// 更新 Step 状态为 Success
	var successStep model.RagJobStep
	if err := e.db.Where("job_id = ?", job.JobID).First(&successStep).Error; err == nil {
		if err := successStep.CompleteSuccessfully(nil); err == nil {
			e.db.Save(&successStep)
		} else {
			logger.Error(e.ctx, fmt.Sprintf("Failed to update step status to success: %v", err))
		}
	}

	// 成功时也更新 File Cleaning Rule Info
	fileID := model.ExtractFileIDFromJob(&job)
	if fileID > 0 {
		if updateErr := model.UpdateFileCleaningRuleInfoHelper(e.db, fileID, job.RunID, ""); updateErr != nil {
			logger.Error(e.ctx, fmt.Sprintf("Failed to update cleaning_rule_info for job %d (success): %v", job.JobID, updateErr))
		}
	}

	// 如果是最后一步，更新流水线统计信息
	if currentIndex == len(profile.Steps)-1 {
		if job.PipelineID > 0 {
			if err := e.db.Model(&model.RagPipelineProfile{}).Where("id = ?", job.PipelineID).Updates(map[string]interface{}{
				"success_count": gorm.Expr("success_count + ?", 1),
				"last_run_time": time.Now().UnixMilli(),
			}).Error; err != nil {
				logger.Error(e.ctx, fmt.Sprintf("Failed to update pipeline stats for job %d: %v", job.JobID, err))
			}
		}
	}

	// 触发下一步（方案A：从预创建的 Job 队列中触发）
	// 检查是否为单步执行模式
	isSingleStep := false
	if val, ok := params["__single_step_execution"]; ok {
		if b, ok := val.(bool); ok && b {
			isSingleStep = true
		}
	}

	if !stepConfig.ParallelGroup && !isSingleStep {
		if err := e.factory.EnqueueNextJob(e.ctx, job.RunID, currentIndex); err != nil {
			logger.Error(e.ctx, fmt.Sprintf("Failed to trigger next step for job %d: %v", job.JobID, err))
			if fileID > 0 {
				if updateErr := model.UpdateFileCleaningRuleInfoHelper(e.db, fileID, job.RunID, "failed"); updateErr != nil {
					logger.Error(e.ctx, fmt.Sprintf("Failed to update cleaning_rule_info for job %d: %v", job.JobID, updateErr))
				}
			}
		} else if fileID > 0 {
			if updateErr := model.UpdateFileCleaningRuleInfoHelper(e.db, fileID, job.RunID, ""); updateErr != nil {
				logger.Error(e.ctx, fmt.Sprintf("Failed to update cleaning_rule_info after triggering next step for job %d: %v", job.JobID, updateErr))
			}
		}
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
	}
}
