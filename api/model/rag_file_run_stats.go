package model

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	v2model "github.com/53AI/53AIHub/rag-pipeline-v2/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type RagFileRunStats struct {
	ID             int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Eid            int64  `json:"eid" gorm:"not null;index:idx_rag_file_run_stats_eid_library,priority:1"`
	LibraryID      int64  `json:"library_id" gorm:"not null;index:idx_rag_file_run_stats_eid_library,priority:2"`
	FileID         int64  `json:"file_id" gorm:"not null;index"`
	RunID          string `json:"run_id" gorm:"type:varchar(36);not null;uniqueIndex:uniq_rag_file_run_stats_run_id"`
	Status         string `json:"status" gorm:"type:varchar(20);not null;index"`
	Progress       int    `json:"progress" gorm:"not null;default:0"`
	SuccessCount   int    `json:"success_count" gorm:"not null;default:0"`
	FailureCount   int    `json:"failure_count" gorm:"not null;default:0"`
	TotalSteps     int    `json:"total_steps" gorm:"not null;default:0"`
	StartTime      int64  `json:"start_time" gorm:"not null;default:0;index"`
	EndTime        int64  `json:"end_time" gorm:"not null;default:0;index"`
	CompletionTime int64  `json:"completion_time" gorm:"not null;default:0"`
	BaseModel
}

func (RagFileRunStats) TableName() string {
	return "rag_file_run_stats"
}

type RagFileRunStatsSummary struct {
	CompletedCount         int64 `json:"completed_count"`
	QueuedCount            int64 `json:"queued_count"`
	ProcessingCount        int64 `json:"processing_count"`
	FailedInterruptedCount int64 `json:"failed_interrupted_count"`
	AvgCompletionTime      int64 `json:"avg_completion_time"`
}

func UpsertRagFileRunStats(db *gorm.DB, stats *RagFileRunStats) error {
	if stats == nil {
		return errors.New("stats is nil")
	}
	if stats.RunID == "" {
		return errors.New("run_id is empty")
	}
	if db == nil {
		db = DB
	}
	if db == nil {
		return errors.New("db is nil")
	}

	stats.UpdatedTime = time.Now().UTC().UnixMilli()

	valExpr := func(col string) clause.Expr {
		dialect := db.Dialector.Name()
		if dialect == "sqlite" || dialect == "postgres" {
			return gorm.Expr("excluded." + col)
		}
		return gorm.Expr("VALUES(" + col + ")")
	}

	updates := map[string]interface{}{
		"eid":             valExpr("eid"),
		"library_id":      valExpr("library_id"),
		"file_id":         valExpr("file_id"),
		"status":          valExpr("status"),
		"progress":        valExpr("progress"),
		"success_count":   valExpr("success_count"),
		"failure_count":   valExpr("failure_count"),
		"total_steps":     valExpr("total_steps"),
		"start_time":      valExpr("start_time"),
		"end_time":        valExpr("end_time"),
		"completion_time": valExpr("completion_time"),
		"updated_time":    valExpr("updated_time"),
	}

	return db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "run_id"}},
		DoUpdates: clause.Assignments(updates),
	}).Create(stats).Error
}

func GetRagFileRunStatsSummary(eid int64, libraryID *int64) (*RagFileRunStatsSummary, error) {
	if DB == nil {
		return nil, errors.New("db is nil")
	}

	query := DB.Model(&File{}).
		Where("eid = ?", eid).
		Where("is_deleted = ?", false).
		Where("type = ?", FILE_TYPE_FILE)

	if libraryID != nil && *libraryID > 0 {
		query = query.Where("library_id = ?", *libraryID)
	}

	type statusCount struct {
		Status string
		Count  int64
	}
	var counts []statusCount
	if err := query.Select("run_status as status, COUNT(*) as count").Group("run_status").Find(&counts).Error; err != nil {
		return nil, err
	}

	summary := &RagFileRunStatsSummary{}
	for _, c := range counts {
		switch c.Status {
		case "success":
			summary.CompletedCount += c.Count
		case "pending", "waiting", "not_started":
			summary.QueuedCount += c.Count
		case "processing", "running":
			summary.ProcessingCount += c.Count
		case "failed", "interrupted":
			summary.FailedInterruptedCount += c.Count
		}
	}

	avgQuery := DB.Table("rag_file_run_stats").
		Joins("INNER JOIN files ON files.id = rag_file_run_stats.file_id").
		Where("rag_file_run_stats.eid = ?", eid).
		Where("files.eid = ?", eid).
		Where("files.is_deleted = ?", false).
		Where("files.type = ?", FILE_TYPE_FILE).
		Where("rag_file_run_stats.status IN ?", []string{"success", "failed", "interrupted"}).
		Where("rag_file_run_stats.completion_time > 0")

	if libraryID != nil && *libraryID > 0 {
		avgQuery = avgQuery.Where("rag_file_run_stats.library_id = ?", *libraryID)
	}

	var avg float64
	if err := avgQuery.Select("COALESCE(AVG(rag_file_run_stats.completion_time), 0)").Scan(&avg).Error; err != nil {
		return nil, err
	}
	if avg > 0 {
		summary.AvgCompletionTime = int64(math.Round(avg))
	}

	return summary, nil
}

// UpdateFileCleaningRuleInfoHelper 更新文件中的 CleaningRuleInfo
// statusUpdate: 可选，如果不为空，则强制更新为该状态；否则根据统计结果计算
func UpdateFileCleaningRuleInfoHelper(db *gorm.DB, fileID int64, runID string, statusUpdate string) error {
	var file File
	if err := db.Select("cleaning_rule_info", "eid", "library_id", "id", "upload_file_id").First(&file, fileID).Error; err != nil {
		return err
	}

	var info FileCleaningRuleInfo
	if file.CleaningRuleInfo != "" {
		if err := json.Unmarshal([]byte(file.CleaningRuleInfo), &info); err != nil {
			// 如果解析失败，可能是旧数据或格式错误，重新初始化部分字段
			info = FileCleaningRuleInfo{RunID: runID}
		}
	} else {
		// 如果为空，初始化
		info = FileCleaningRuleInfo{RunID: runID}
	}

	// 如果 RunID 不匹配，说明可能是新一轮任务覆盖，或者并发问题
	// 这里假设调用者传入的 RunID 是权威的，如果不同则更新
	if info.RunID != runID && runID != "" {
		info.RunID = runID
		// 重置计数
		info.SuccessCount = 0
		info.FailureCount = 0
		info.Progress = 0
		info.TotalSteps = 0
		info.StartTime = 0 // 重置开始时间，等待后续逻辑或重新初始化
		info.EndTime = 0
		info.Status = ""
		info.CurrentJobType = ""
		// Status 由下面逻辑决定
	}

	prevStatus := strings.ToLower(strings.TrimSpace(info.Status))

	// 统计该 RunID 下的所有 Job 状态
	// 注意：这里需要查询 rag_jobs 表
	var jobs []RagJob
	// 需要根据 Eid 和 FileID 关联查询 Job，以提高效率和准确性
	// 由于 RagJob 中没有直接存储 FileID，而是通过 RelatedId 存储
	// 且 RunID 已经是唯一索引，所以直接通过 RunID 查询即可
	// 但为了确保准确性，我们验证一下 RelatedId
	if err := db.Select("status, created_time, related_id, type, pipeline_id, runtime_profile_json").Where("run_id = ?", info.RunID).Order("job_id ASC").Find(&jobs).Error; err != nil {
		return err
	}

	successCount := 0
	failureCount := 0
	pausedCount := 0
	pendingCount := 0
	processingCount := 0
	hasInterrupted := false
	var earliestStart int64 = 0
	pipelineID := int64(0)

	// 如果没有找到 Job，但 RunID 存在，可能是刚刚创建还没入库，或者全部在队列中
	// 这种情况下，保持现有状态或设为 pending

	for _, job := range jobs {
		// 简单的关联检查：如果 job.RelatedId > 0 且 != fileID，可能是异常数据，记录日志但不中断
		if job.RelatedId > 0 && job.RelatedId != fileID {
			logger.Warn(context.Background(), fmt.Sprintf("Job %d has RelatedId %d, expected %d (RunID: %s)", job.JobID, job.RelatedId, fileID, info.RunID))
		}

		if job.Status == RagJobStatusSuccess {
			successCount++
		} else if job.Status == RagJobStatusFailed {
			failureCount++
		} else if job.Status == RagJobStatusPaused {
			pausedCount++
		} else if job.Status == RagJobStatusPending {
			pendingCount++
		} else if job.Status == RagJobStatusProcessing {
			processingCount++
		} else if job.Status == RagJobStatusCancelled {
			hasInterrupted = true
		}
		if pipelineID == 0 && job.PipelineID > 0 {
			pipelineID = job.PipelineID
		}
		// 记录最早的创建时间作为开始时间
		jobStart := job.CreatedTime
		if earliestStart == 0 || jobStart < earliestStart {
			earliestStart = jobStart
		}
	}

	if info.StartTime == 0 && earliestStart > 0 {
		info.StartTime = earliestStart
	}
	totalJobs := len(jobs)

	// 如果 info.TotalSteps 为 0（可能初始化时未设置），尝试用当前 job 数量兜底，或者保持 0
	if info.TotalSteps == 0 && totalJobs > 0 {
		info.TotalSteps = totalJobs
	}

	if pipelineID == 0 && strings.TrimSpace(info.PipelineID) != "" {
		if decodedID, err := hashids.TryParseID(strings.TrimSpace(info.PipelineID)); err == nil && decodedID > 0 {
			pipelineID = decodedID
		}
	}

	info.SuccessCount = successCount
	info.FailureCount = failureCount

	// 计算进度
	if info.TotalSteps > 0 {
		// 简单的进度计算：完成的步骤（成功或失败）/ 总步骤
		// 或者根据业务需求，只计算成功的
		completed := successCount + failureCount
		info.Progress = int(math.Min(100, float64(completed)/float64(info.TotalSteps)*100))
	}

	var currentJob *RagJob
	currentIndex := -1
	for i := range jobs {
		job := &jobs[i]
		if job.Status != RagJobStatusSuccess {
			currentJob = job
			currentIndex = i
			break
		}
	}

	if currentJob != nil {
		info.StepKey = currentJob.Type
		info.StepName = getStepDisplayName(currentJob.Type)
		info.StepMode = resolveJobStepMode(currentJob)
	} else {
		info.StepKey = ""
		info.StepName = ""
		info.StepMode = ""
	}

	var nextJob *RagJob
	if currentIndex >= 0 {
		for i := currentIndex + 1; i < len(jobs); i++ {
			job := &jobs[i]
			if job.Status == RagJobStatusPending || job.Status == RagJobStatusProcessing || job.Status == RagJobStatusPaused {
				nextJob = job
				break
			}
		}
	}

	if nextJob != nil && nextJob.RuntimeProfile != "" {
		info.NextStepKey = nextJob.Type
		info.NextStepName = getStepDisplayName(nextJob.Type)
		info.NextStepMode = resolveJobStepMode(nextJob)
	} else {
		info.NextStepKey = ""
		info.NextStepName = ""
		info.NextStepMode = ""
	}

	// 决定最终状态
	// 优先级：传入的状态 > 失败 > 完成 > 进行中
	if statusUpdate != "" {
		info.Status = statusUpdate
	} else {
		if hasInterrupted || failureCount > 0 {
			info.Status = "failed"
		} else if successCount >= info.TotalSteps && info.TotalSteps > 0 {
			info.Status = "success"
			info.Progress = 100
		} else if pendingCount == 0 && processingCount == 0 && pausedCount > 0 {
			info.Status = "waiting"
		} else if processingCount > 0 {
			info.Status = "processing"
		} else if successCount == 0 && failureCount == 0 {
			info.Status = "pending"
		} else {
			info.Status = "processing"
		}
	}
	newStatus := strings.ToLower(strings.TrimSpace(info.Status))

	// 设置结束时间
	if (info.Status == "success" || info.Status == "failed") && info.EndTime == 0 {
		info.EndTime = time.Now().UnixMilli()
	}

	// 序列化并保存
	newInfoBytes, err := json.Marshal(info)
	if err != nil {
		return err
	}

	if err := db.Model(&File{}).Where("id = ?", fileID).Updates(map[string]interface{}{
		"cleaning_rule_info": string(newInfoBytes),
		"run_status":         info.Status,
	}).Error; err != nil {
		return err
	}

	if pipelineID > 0 && prevStatus != newStatus && prevStatus != "success" && prevStatus != "failed" {
		if newStatus == "success" || newStatus == "failed" {
			updates := map[string]interface{}{
				"last_run_time": time.Now().UnixMilli(),
			}
			if newStatus == "success" {
				updates["success_count"] = gorm.Expr("success_count + ?", 1)
			} else {
				updates["failure_count"] = gorm.Expr("failure_count + ?", 1)
			}
			if err := db.Model(&RagPipelineProfile{}).Where("id = ? AND eid = ?", pipelineID, file.Eid).Updates(updates).Error; err != nil {
				logger.Error(db.Statement.Context, fmt.Sprintf("Failed to update pipeline stats (PipelineID: %d, RunID: %s, Status: %s): %v", pipelineID, info.RunID, newStatus, err))
			}
		}
	}

	runStatsStatus := info.Status
	if hasInterrupted {
		runStatsStatus = "interrupted"
	}
	completionTime := int64(0)
	if info.StartTime > 0 && info.EndTime > 0 && info.EndTime >= info.StartTime {
		completionTime = (info.EndTime - info.StartTime) / 1000
	}
	stats := &RagFileRunStats{
		Eid:            file.Eid,
		LibraryID:      file.LibraryID,
		FileID:         file.ID,
		RunID:          info.RunID,
		Status:         runStatsStatus,
		Progress:       info.Progress,
		SuccessCount:   info.SuccessCount,
		FailureCount:   info.FailureCount,
		TotalSteps:     info.TotalSteps,
		StartTime:      info.StartTime,
		EndTime:        info.EndTime,
		CompletionTime: completionTime,
	}
	if err := UpsertRagFileRunStats(db, stats); err != nil {
		// 添加详细日志，方便诊断为什么没有新增数据
		logger.Error(db.Statement.Context, fmt.Sprintf("Failed to upsert rag_file_run_stats (FileID: %d, RunID: %s): %v", fileID, info.RunID, err))
		return err
	}

	return nil
}

// ExtractFileIDFromJob 从 Job 中提取 FileID
func ExtractFileIDFromJob(job *RagJob) int64 {
	// 尝试从 RelatedId 获取
	if job.RelatedId > 0 {
		return job.RelatedId
	}

	// 尝试从 StartParameters 解析
	var params map[string]interface{}
	if err := json.Unmarshal([]byte(job.StartParameters), &params); err == nil {
		if val, ok := params["file_id"]; ok {
			if fVal, ok := val.(float64); ok {
				return int64(fVal)
			}
		}
	}
	return 0
}

func getStepDisplayName(stepKey string) string {
	stepNames := map[string]string{
		"document_parsing":   "文档解析",
		"content_cleaning":   "内容清洗",
		"document_chunking":  "文档分块",
		"vector_indexing":    "向量化索引",
		"summary_generation": "摘要生成",
	}
	if name, ok := stepNames[stepKey]; ok {
		return name
	}
	return stepKey
}

func resolveJobStepMode(job *RagJob) string {
	if job == nil || strings.TrimSpace(job.RuntimeProfile) == "" {
		return ""
	}

	var profile v2model.RuntimeProfile
	if err := json.Unmarshal([]byte(job.RuntimeProfile), &profile); err != nil {
		return ""
	}
	for _, step := range profile.Steps {
		if step.StepKey != job.Type {
			continue
		}
		runMode := step.RunMode
		if runMode == "" {
			if step.Enabled {
				runMode = v2model.RunModeAuto
			} else {
				runMode = v2model.RunModeManual
			}
		}
		return string(runMode)
	}
	return ""
}
