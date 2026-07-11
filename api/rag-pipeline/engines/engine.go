package engines

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/rag-pipeline/pipelines"
	"github.com/go-redis/redis/v8"
	"gorm.io/gorm"
)

// RagJobEngine 任务调度器主结构
type RagJobEngine struct {
	rdb                 redis.Cmdable
	db                  *gorm.DB
	queueName           string
	processingQueueName string // 正在处理的队列
	deadLetterQueueName string // 死信队列
	retryQueueName      string // 重试队列
	workers             int
	maxRetries          int
	jobProcessDelay     time.Duration // 任务处理间隔延迟，用于debug
	ctx                 context.Context
	cancel              context.CancelFunc
	wg                  sync.WaitGroup
}

// JobWrapper 用于在队列中传递的任务包装器
type JobWrapper struct {
	JobID      int64     `json:"job_id"`
	Eid        int64     `json:"eid"`
	Type       string    `json:"type"`
	EnqueuedAt time.Time `json:"enqueued_at"`
	Retries    int       `json:"retries"`
}

// NewRagJobEngine 创建引擎实例
func NewRagJobEngine(rdb redis.Cmdable, db *gorm.DB, queuePrefix string) *RagJobEngine {
	if queuePrefix == "" {
		queuePrefix = "rag:job"
	}

	ctx, cancel := context.WithCancel(context.Background())

	return &RagJobEngine{
		rdb:                 rdb,
		db:                  db,
		queueName:           fmt.Sprintf("%s:queue", queuePrefix),
		processingQueueName: fmt.Sprintf("%s:processing", queuePrefix),
		deadLetterQueueName: fmt.Sprintf("%s:deadletter", queuePrefix),
		retryQueueName:      fmt.Sprintf("%s:retry", queuePrefix),
		workers:             5, // 默认5个工作协程
		maxRetries:          3, // 默认最大重试次数
		jobProcessDelay:     0, // 默认无延迟
		ctx:                 ctx,
		cancel:              cancel,
	}
}

// SetWorkers 设置工作协程数量
func (e *RagJobEngine) SetWorkers(workers int) {
	e.workers = workers
}

// SetMaxRetries 设置最大重试次数
func (e *RagJobEngine) SetMaxRetries(maxRetries int) {
	e.maxRetries = maxRetries
}

// SetJobProcessDelay 设置任务处理间隔延迟，用于debug
func (e *RagJobEngine) SetJobProcessDelay(delay time.Duration) {
	e.jobProcessDelay = delay
	logger.SysLogf("Set job process delay to %v", delay)
}

// getQueueNameByType 根据jobtype获取队列名称
func (e *RagJobEngine) getQueueNameByType(jobType string) string {
	return fmt.Sprintf("%s:%s", e.queueName, jobType)
}

// getProcessingQueueNameByType 根据jobtype获取处理队列名称
func (e *RagJobEngine) getProcessingQueueNameByType(jobType string) string {
	return fmt.Sprintf("%s:%s", e.processingQueueName, jobType)
}

// getRetryQueueNameByType 根据jobtype获取重试队列名称
func (e *RagJobEngine) getRetryQueueNameByType(jobType string) string {
	return fmt.Sprintf("%s:%s", e.retryQueueName, jobType)
}

// getStackTrace 获取调用栈信息
func getStackTrace(skip int) string {
	buf := make([]byte, 1024)
	for {
		n := runtime.Stack(buf, false)
		if n < len(buf) {
			return string(buf[:n])
		}
		buf = make([]byte, 2*len(buf))
	}
}

// formatErrorWithStack 格式化错误信息，包含调用栈
func formatErrorWithStack(err error) string {
	if err == nil {
		return ""
	}

	// 获取调用栈
	stack := getStackTrace(3) // 跳过3层调用栈

	// 提取有用的调用栈信息
	lines := strings.Split(stack, "\n")
	var usefulLines []string
	for i, line := range lines {
		// 跳过前几行（通常是runtime和当前函数）
		if i < 4 {
			continue
		}
		// 只保留包含项目路径的行
		if strings.Contains(line, "53AI/") {
			usefulLines = append(usefulLines, line)
		}
		// 限制调用栈深度
		if len(usefulLines) >= 5 {
			break
		}
	}

	// 组合错误信息和调用栈
	result := err.Error()
	if len(usefulLines) > 0 {
		result += "\nCall Stack:\n" + strings.Join(usefulLines, "\n")
	}

	return result
}

// EnqueueJob 将RagJob推入队列（按jobtype分类推入）
func (e *RagJobEngine) EnqueueJob(ctx context.Context, job *model.RagJob) error {
	if !common.IsRedisEnabled() {
		return errors.New("redis is not enabled")
	}

	// 保存任务到数据库
	if err := e.db.Create(job).Error; err != nil {
		logger.Error(ctx, fmt.Sprintf("Failed to save job to database: %v", err))
		return err
	}

	// 创建任务包装器
	wrapper := &JobWrapper{
		JobID:      job.JobID,
		Eid:        job.Eid,
		Type:       job.Type,
		EnqueuedAt: time.Now(),
		Retries:    0,
	}

	// 序列化任务
	payload, err := json.Marshal(wrapper)
	if err != nil {
		logger.Error(ctx, fmt.Sprintf("Failed to marshal job: %v", err))
		return err
	}

	// 根据jobtype推入对应的队列
	typeQueueName := e.getQueueNameByType(job.Type)
	if err := e.rdb.LPush(ctx, typeQueueName, string(payload)).Err(); err != nil {
		logger.Error(ctx, fmt.Sprintf("Failed to enqueue job to queue %s: %v", typeQueueName, err))
		return err
	}

	logger.Info(ctx, fmt.Sprintf("Enqueued job %d of type %s for enterprise %d to queue %s", job.JobID, job.Type, job.Eid, typeQueueName))
	return nil
}

// StartWorkers 启动工作协程（按jobtype分类启动）
func (e *RagJobEngine) StartWorkers(parentCtx context.Context) error {
	if !common.IsRedisEnabled() {
		return errors.New("redis is not enabled")
	}

	logger.SysLogf("Starting %d workers per job type for RAG job engine", e.workers)

	// 支持的jobtype列表
	jobTypes := []string{
		"document_conversion",
		"auto_chunking",
		"reindex",
		"rechunk_and_reindex",
		"generate_questions_and_summary",
		"ai_generate_index",
		"generate_knowledge_map",
		"hello", // 测试类型
	}

	// 为每种jobtype启动指定数量的工作协程
	for _, jobType := range jobTypes {
		for i := 0; i < e.workers; i++ {
			e.wg.Add(1)
			workerID := fmt.Sprintf("%s_%d", jobType, i)
			go e.workerLoop(workerID, jobType)
		}
	}

	// 启动重试队列处理协程
	e.wg.Add(1)
	go e.retryLoop()

	// 启动死信队列监控协程
	e.wg.Add(1)
	go e.deadLetterLoop()

	// 监控父上下文取消
	go func() {
		select {
		case <-parentCtx.Done():
			e.Shutdown(parentCtx)
		case <-e.ctx.Done():
			// 内部取消
		}
	}()

	return nil
}

// workerLoop 工作协程循环（按指定jobtype处理）
func (e *RagJobEngine) workerLoop(workerID string, jobType string) {
	defer e.wg.Done()

	logger.SysLogf("Worker %s started for job type %s", workerID, jobType)

	// 获取该jobtype对应的队列名
	typeQueueName := e.getQueueNameByType(jobType)
	typeProcessingQueueName := e.getProcessingQueueNameByType(jobType)

	for {
		select {
		case <-e.ctx.Done():
			logger.SysLogf("Worker %s for job type %s stopping", workerID, jobType)
			return
		default:
			// 从该jobtype的队列中取出任务并移至该jobtype的处理队列
			result, err := e.rdb.BRPopLPush(e.ctx, typeQueueName, typeProcessingQueueName, 5*time.Second).Result()
			if err != nil {
				if err != redis.Nil {
					logger.Error(e.ctx, fmt.Sprintf("Worker %s failed to fetch job from queue %s: %v", workerID, typeQueueName, err))
					time.Sleep(1 * time.Second)
				}
				continue
			}

			// 处理任务
			e.processJob(workerID, result, jobType)

			// 如果设置了延迟，在处理完任务后等待
			if e.jobProcessDelay > 0 {
				logger.Info(e.ctx, fmt.Sprintf("Worker %s waiting %v before next job", workerID, e.jobProcessDelay))
				time.Sleep(e.jobProcessDelay)
			}
		}
	}
}

// processJob 处理单个任务
func (e *RagJobEngine) processJob(workerID string, payload string, jobType string) {
	// 反序列化任务
	var wrapper JobWrapper
	if err := json.Unmarshal([]byte(payload), &wrapper); err != nil {
		logger.Error(e.ctx, fmt.Sprintf("Worker %s failed to unmarshal job: %v", workerID, err))
		return
	}

	defer func() {
		if r := recover(); r != nil {
			errMsg := fmt.Sprintf("RAG任务执行发生panic: %v", r)
			logger.Errorf(e.ctx, "%s，job_id=%d，type=%s", errMsg, wrapper.JobID, wrapper.Type)
			logger.Errorf(e.ctx, "panic堆栈: %s", string(debug.Stack()))

			e.db.Model(&model.RagJob{}).Where("job_id = ?", wrapper.JobID).Updates(map[string]interface{}{
				"status":         model.RagJobStatusFailed,
				"failure_reason": errMsg,
			})

			e.ackJob(wrapper.JobID)
		}
	}()

	logger.Info(e.ctx, fmt.Sprintf("Worker %s processing job %d of type %s", workerID, wrapper.JobID, wrapper.Type))

	// 从数据库获取任务详情
	var job model.RagJob
	if err := e.db.First(&job, wrapper.JobID).Error; err != nil {
		logger.Error(e.ctx, fmt.Sprintf("Worker %s failed to get job %d from database: %v", workerID, wrapper.JobID, err))
		e.removeJobFromProcessingQueue(wrapper.JobID, jobType)
		return
	}

	// 获取RAG Job日志记录器
	ragLogger, err := logger.GetRAGJobLogger(job.Type)
	if err != nil {
		logger.Error(e.ctx, fmt.Sprintf("Failed to get RAG job logger for type %s: %v", job.Type, err))
		ragLogger = nil // 继续处理，不使用日志记录器
	}

	// 记录任务开始
	if ragLogger != nil {
		ragLogger.JobStart(wrapper.JobID, job.Eid, job.Type, job.StartParameters)
	}

	// 校验任务状态，如果不是pending状态，则跳过该任务
	if job.Status != model.RagJobStatusPending {
		logger.Info(e.ctx, fmt.Sprintf("Worker %s skipping job %d with status %s (not pending)", workerID, wrapper.JobID, job.Status))
		if ragLogger != nil {
			ragLogger.LogJobEvent(wrapper.JobID, "SKIP", fmt.Sprintf("Job status is %s, not pending", job.Status))
		}
		e.removeJobFromProcessingQueue(wrapper.JobID, jobType)
		return
	}

	jobStartTime := time.Now()

	// 更新任务状态为处理中
	if err := e.db.Model(&job).Updates(map[string]interface{}{
		"status": model.RagJobStatusProcessing,
	}).Error; err != nil {
		logger.Error(e.ctx, fmt.Sprintf("Worker %s failed to update job status: %v", workerID, err))
		if ragLogger != nil {
			ragLogger.Error(fmt.Sprintf("Failed to update job status: %v", err))
		}
	}

	// 获取任务流水线
	pipeline, err := pipelines.GetPipeline(job.Type)
	if err != nil {
		errMsg := fmt.Sprintf("No pipeline registered for job type: %s - %v", job.Type, err)
		logger.Error(e.ctx, errMsg)

		// 记录管道获取失败
		if ragLogger != nil {
			ragLogger.Errorf("Failed to get pipeline: %s", errMsg)
			ragLogger.JobEnd(wrapper.JobID, "failed", time.Since(jobStartTime), errMsg)
		}

		// 更新任务状态为失败
		e.db.Model(&job).Updates(map[string]interface{}{
			"status":         model.RagJobStatusFailed,
			"failure_reason": errMsg,
		})

		e.removeJobFromProcessingQueue(wrapper.JobID, jobType)
		return
	}

	// 执行流水线
	if err := e.executePipeline(&job, pipeline); err != nil {
		// 使用formatErrorWithStack获取包含调用栈的错误信息
		errorWithStack := formatErrorWithStack(err)
		logger.Error(e.ctx, fmt.Sprintf("Worker %s failed to execute pipeline for job %d: %s", workerID, wrapper.JobID, errorWithStack))

		// 记录执行失败
		if ragLogger != nil {
			ragLogger.LogError(wrapper.JobID, err.Error(), errorWithStack)
			ragLogger.JobEnd(wrapper.JobID, "failed", time.Since(jobStartTime), err.Error())
		}

		// 更新任务失败原因（只保存错误信息，不包含调用栈，避免数据库字段过长）
		e.db.Model(&job).Updates(map[string]interface{}{
			"failure_reason": err.Error(),
		})

		// 重试任务
		e.retryJob(&wrapper, err)
	} else {
		// 任务成功完成
		// 注意：pipeline.Execute方法已经更新了任务状态到数据库，所以这里不需要再次更新
		// 但是，我们需要确保从数据库获取最新的任务状态
		if err := e.db.First(&job, wrapper.JobID).Error; err != nil {
			logger.Error(e.ctx, fmt.Sprintf("Worker %s failed to refresh job %d from database: %v", workerID, wrapper.JobID, err))
			if ragLogger != nil {
				ragLogger.Errorf("Failed to refresh job from database: %v", err)
			}
		}

		// 记录任务成功完成
		if ragLogger != nil {
			ragLogger.JobEnd(wrapper.JobID, "success", time.Since(jobStartTime), "")
		}

		e.removeJobFromProcessingQueue(wrapper.JobID, jobType)
		logger.Info(e.ctx, fmt.Sprintf("Worker %s successfully completed job %d", workerID, wrapper.JobID))
	}
}

// executePipeline 执行任务流水线
func (e *RagJobEngine) executePipeline(job *model.RagJob, pipeline pipelines.Pipeline) error {
	// 使用pipeline.Execute方法执行整个流水线
	// 注意：这里pipeline.Execute会处理所有步骤，包括从当前步骤开始执行
	if err := pipeline.Execute(job); err != nil {
		// 使用fmt.Errorf包装错误，保留原始错误信息
		return fmt.Errorf("pipeline execution failed: %w", err)
	}

	return nil
}

// ackJob 确认任务完成
func (e *RagJobEngine) ackJob(jobID int64) {
	// 此方法现已过时，因为我们在processJob完成后直接从对应队列中移除
	// 但为了兼容性保留该方法，实际使用时会在processJob中处理
}

// removeJobFromProcessingQueue 从指定jobtype的处理队列中移除任务
func (e *RagJobEngine) removeJobFromProcessingQueue(jobID int64, jobType string) {
	ctx, cancel := context.WithTimeout(e.ctx, 5*time.Second)
	defer cancel()

	typeProcessingQueueName := e.getProcessingQueueNameByType(jobType)

	// 获取处理队列中的所有任务
	jobs, err := e.rdb.LRange(ctx, typeProcessingQueueName, 0, -1).Result()
	if err != nil {
		logger.Error(ctx, fmt.Sprintf("Failed to get processing queue %s: %v", typeProcessingQueueName, err))
		return
	}

	// 查找并移除任务
	for _, job := range jobs {
		var wrapper JobWrapper
		if err := json.Unmarshal([]byte(job), &wrapper); err != nil {
			continue
		}

		if wrapper.JobID == jobID {
			e.rdb.LRem(ctx, typeProcessingQueueName, 1, job)
			break
		}
	}
}

// retryJob 重试任务
func (e *RagJobEngine) retryJob(wrapper *JobWrapper, err error) {
	// 增加重试次数
	wrapper.Retries++

	// 检查是否超过最大重试次数
	if wrapper.Retries > e.maxRetries {
		logger.Error(e.ctx, fmt.Sprintf("Job %d exceeded max retries (%d), moving to dead letter queue", wrapper.JobID, e.maxRetries))

		// 移至死信队列
		e.moveToDeadLetter(wrapper, err)
		return
	}

	// 计算重试延迟（指数退避）
	delay := time.Duration(wrapper.Retries*wrapper.Retries) * time.Second
	if delay > 30*time.Minute {
		delay = 30 * time.Minute
	}

	// 更新任务状态为重试
	e.db.Model(&model.RagJob{JobID: wrapper.JobID}).Update("status", model.RagJobStatusPending)

	// 序列化任务
	payload, marshalErr := json.Marshal(wrapper)
	if marshalErr != nil {
		logger.Error(e.ctx, fmt.Sprintf("Failed to marshal job for retry: %v", marshalErr))
		e.removeJobFromProcessingQueue(wrapper.JobID, wrapper.Type)
		return
	}

	// 添加到该jobtype对应的重试队列，使用ZSET实现延迟重试
	ctx, cancel := context.WithTimeout(e.ctx, 5*time.Second)
	defer cancel()

	typeRetryQueueName := e.getRetryQueueNameByType(wrapper.Type)
	score := float64(time.Now().Add(delay).Unix())
	if zErr := e.rdb.ZAdd(ctx, typeRetryQueueName, &redis.Z{
		Score:  score,
		Member: string(payload),
	}).Err(); zErr != nil {
		logger.Error(e.ctx, fmt.Sprintf("Failed to add job to retry queue %s: %v", typeRetryQueueName, zErr))
		e.removeJobFromProcessingQueue(wrapper.JobID, wrapper.Type)
		return
	}

	// 从处理队列中移除
	e.removeJobFromProcessingQueue(wrapper.JobID, wrapper.Type)

	logger.Info(e.ctx, fmt.Sprintf("Job %d of type %s scheduled for retry %d in %v", wrapper.JobID, wrapper.Type, wrapper.Retries, delay))
}

// moveToDeadLetter 将任务移至死信队列
func (e *RagJobEngine) moveToDeadLetter(wrapper *JobWrapper, err error) {
	// 更新任务状态为失败
	e.db.Model(&model.RagJob{JobID: wrapper.JobID}).Updates(map[string]interface{}{
		"status":         model.RagJobStatusFailed,
		"failure_reason": err.Error(),
	})

	// 序列化任务
	payload, marshalErr := json.Marshal(wrapper)
	if marshalErr != nil {
		logger.Error(e.ctx, fmt.Sprintf("Failed to marshal job for dead letter: %v", marshalErr))
		e.removeJobFromProcessingQueue(wrapper.JobID, wrapper.Type)
		return
	}

	// 添加到死信队列
	ctx, cancel := context.WithTimeout(e.ctx, 5*time.Second)
	defer cancel()

	if zErr := e.rdb.LPush(ctx, e.deadLetterQueueName, string(payload)).Err(); zErr != nil {
		logger.Error(e.ctx, fmt.Sprintf("Failed to add job to dead letter queue: %v", zErr))
	}

	// 从处理队列中移除
	e.removeJobFromProcessingQueue(wrapper.JobID, wrapper.Type)

	logger.Error(e.ctx, fmt.Sprintf("Job %d of type %s moved to dead letter queue: %v", wrapper.JobID, wrapper.Type, err))
}

// retryLoop 重试队列处理循环
func (e *RagJobEngine) retryLoop() {
	defer e.wg.Done()

	ticker := time.NewTicker(30 * time.Second) // 每30秒检查一次重试队列
	defer ticker.Stop()

	logger.SysLog("Retry loop started")

	for {
		select {
		case <-e.ctx.Done():
			logger.SysLog("Retry loop stopping")
			return
		case <-ticker.C:
			e.processRetryQueue()
		}
	}
}

// processRetryQueue 处理重试队列
func (e *RagJobEngine) processRetryQueue() {
	ctx, cancel := context.WithTimeout(e.ctx, 10*time.Second)
	defer cancel()

	now := float64(time.Now().Unix())

	// 支持的jobtype列表
	jobTypes := []string{
		"document_conversion",
		"auto_chunking",
		"reindex",
		"rechunk_and_reindex",
		"generate_questions_and_summary",
		"ai_generate_index",
		"hello",
	}

	// 为每种jobtype处理对应的重试队列
	for _, jobType := range jobTypes {
		typeRetryQueueName := e.getRetryQueueNameByType(jobType)

		// 获取到期的重试任务
		jobs, err := e.rdb.ZRangeByScore(ctx, typeRetryQueueName, &redis.ZRangeBy{
			Min: "-inf",
			Max: strconv.FormatFloat(now, 'f', 0, 64),
		}).Result()

		if err != nil {
			logger.Error(ctx, fmt.Sprintf("Failed to get retry jobs from queue %s: %v", typeRetryQueueName, err))
			continue
		}

		if len(jobs) == 0 {
			continue
		}

		logger.Info(ctx, fmt.Sprintf("Processing %d retry jobs for job type %s", len(jobs), jobType))

		// 将到期的任务移回对应的主队列
		typeQueueName := e.getQueueNameByType(jobType)
		for _, jobJSON := range jobs {
			// 从对应jobtype的重试队列中移除
			e.rdb.ZRem(ctx, typeRetryQueueName, jobJSON)

			// 添加到对应jobtype的主队列
			if err := e.rdb.LPush(ctx, typeQueueName, jobJSON).Err(); err != nil {
				logger.Error(ctx, fmt.Sprintf("Failed to requeue retry job to queue %s: %v", typeQueueName, err))
			}
		}
	}
}

// deadLetterLoop 死信队列监控循环
func (e *RagJobEngine) deadLetterLoop() {
	defer e.wg.Done()

	ticker := time.NewTicker(5 * time.Minute) // 每5分钟检查一次死信队列
	defer ticker.Stop()

	logger.SysLog("Dead letter loop started")

	for {
		select {
		case <-e.ctx.Done():
			logger.SysLog("Dead letter loop stopping")
			return
		case <-ticker.C:
			e.monitorDeadLetterQueue()
		}
	}
}

// monitorDeadLetterQueue 监控死信队列
func (e *RagJobEngine) monitorDeadLetterQueue() {
	ctx, cancel := context.WithTimeout(e.ctx, 10*time.Second)
	defer cancel()

	// 获取死信队列长度
	length, err := e.rdb.LLen(ctx, e.deadLetterQueueName).Result()
	if err != nil {
		logger.Error(ctx, fmt.Sprintf("Failed to get dead letter queue length: %v", err))
		return
	}

	if length > 0 {
		logger.Warn(ctx, fmt.Sprintf("Dead letter queue has %d jobs", length))

		// 如果死信队列过长，记录警告
		if length > 100 {
			logger.Error(ctx, fmt.Sprintf("Dead letter queue is too long (%d jobs), please check", length))
		}
	}
}

// Shutdown 关闭引擎
func (e *RagJobEngine) Shutdown(ctx context.Context) error {
	logger.SysLog("Shutting down RAG job engine")

	// 取消上下文
	e.cancel()

	// 等待所有工作协程完成
	done := make(chan struct{})
	go func() {
		e.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		logger.SysLog("All workers stopped")
		return nil
	case <-ctx.Done():
		logger.SysLog("Shutdown timeout")
		return ctx.Err()
	}
}

// GetQueueStats 获取队列统计信息
func (e *RagJobEngine) GetQueueStats(ctx context.Context, eid int64) (map[string]int64, error) {
	if !common.IsRedisEnabled() {
		return nil, errors.New("redis is not enabled")
	}

	stats := make(map[string]int64)

	// 支持的jobtype列表
	jobTypes := []string{
		"document_conversion",
		"auto_chunking",
		"reindex",
		"rechunk_and_reindex",
		"generate_questions_and_summary",
		"ai_generate_index",
		"hello",
	}

	// 获取各jobtype对应队列的长度
	for _, jobType := range jobTypes {
		typeQueueName := e.getQueueNameByType(jobType)
		queueLength, err := e.rdb.LLen(ctx, typeQueueName).Result()
		if err == nil {
			stats[fmt.Sprintf("queue:%s", jobType)] = queueLength
		}

		typeProcessingQueueName := e.getProcessingQueueNameByType(jobType)
		processingLength, err := e.rdb.LLen(ctx, typeProcessingQueueName).Result()
		if err == nil {
			stats[fmt.Sprintf("processing:%s", jobType)] = processingLength
		}

		typeRetryQueueName := e.getRetryQueueNameByType(jobType)
		retryLength, err := e.rdb.ZCard(ctx, typeRetryQueueName).Result()
		if err == nil {
			stats[fmt.Sprintf("retry:%s", jobType)] = retryLength
		}
	}

	// 获取死信队列长度（统一的）
	deadLetterLength, err := e.rdb.LLen(ctx, e.deadLetterQueueName).Result()
	if err != nil {
		return nil, err
	}
	stats["dead_letter"] = deadLetterLength

	// 获取数据库中该企业的任务统计
	var pendingCount, processingCount, successCount, failedCount int64

	// 统计各状态的任务数量
	if err := e.db.Model(&model.RagJob{}).
		Where("eid = ? AND status = ?", eid, model.RagJobStatusPending).
		Count(&pendingCount).Error; err != nil {
		return nil, err
	}
	stats["pending"] = pendingCount

	if err := e.db.Model(&model.RagJob{}).
		Where("eid = ? AND status = ?", eid, model.RagJobStatusProcessing).
		Count(&processingCount).Error; err != nil {
		return nil, err
	}
	stats["processing_db"] = processingCount

	if err := e.db.Model(&model.RagJob{}).
		Where("eid = ? AND status = ?", eid, model.RagJobStatusSuccess).
		Count(&successCount).Error; err != nil {
		return nil, err
	}
	stats["success"] = successCount

	if err := e.db.Model(&model.RagJob{}).
		Where("eid = ? AND status = ?", eid, model.RagJobStatusFailed).
		Count(&failedCount).Error; err != nil {
		return nil, err
	}
	stats["failed"] = failedCount

	return stats, nil
}
