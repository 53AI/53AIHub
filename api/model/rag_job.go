package model

import (
	"context"
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"gorm.io/gorm"
)

// RagJob RAG任务模型
type RagJob struct {
	JobID            int64  `gorm:"column:job_id;primaryKey;autoIncrement" json:"job_id"`
	Eid              int64  `gorm:"column:eid;not null;index:idx_rag_jobs_eid" json:"eid"`
	Type             string `gorm:"column:type;not null" json:"type"`
	Status           string `gorm:"column:status;not null" json:"status"`
	CurrentStepOrder int    `gorm:"column:current_step_order;not null;default:0" json:"current_step_order"`
	FailureReason    string `gorm:"column:failure_reason" json:"failure_reason"`
	StartParameters  string `gorm:"column:start_parameters" json:"start_parameters"`
	Metadata         string `gorm:"column:metadata" json:"metadata"`
	RuntimeProfile   string `gorm:"column:runtime_profile_json;type:text" json:"runtime_profile_json"`
	RunID            string `gorm:"column:run_id;type:varchar(36);index:idx_rag_jobs_run_id" json:"run_id"` // 一次完整管线运行的唯一标识
	RelatedId        int64  `gorm:"column:related_id;index:idx_rag_jobs_related_id" json:"related_id"`
	PipelineID       int64  `gorm:"column:pipeline_id;index:idx_rag_jobs_pipeline_id" json:"pipeline_id"` // 关联的流水线ID
	Progress         int    `gorm:"column:progress;default:0" json:"progress"`                            // 任务进度
	CompletionTime   int64  `gorm:"column:completion_time" json:"completion_time"`                        // 完成耗时
	BaseModel
}

// RagCleaningRule 清洗规则详情结构
type RagCleaningRule struct {
	ID   string `json:"id"`             // 清洗规则ID
	Name string `json:"name"`           // 清洗规则名称
	Icon string `json:"icon,omitempty"` // 清洗规则图标
}

// RagJobMetadata 元数据主结构体，所有任务类型共用
type RagJobMetadata struct {
	FileInfo     *RagJobFileInfo  `json:"file_info,omitempty"`
	TokenCount   int64            `json:"token_count,omitempty"`   // 总Token数
	CleaningRule *RagCleaningRule `json:"cleaning_rule,omitempty"` // 命中的清洗规则详情
}

// RagJobFileInfo 文件信息结构体（来源于 model/file）
type RagJobFileInfo struct {
	ID   string `json:"id"`   // 文件ID (来自File.ID)
	Name string `json:"name"` // 文件名称 (来自File.Name)
	Type string `json:"type"` // 文件类型 (来自File.Type)
	Size int64  `json:"size"` // 文件大小 (来自File.UploadFile.Size)
}

// TableName 设置表名
func (RagJob) TableName() string {
	return "rag_jobs"
}

// 任务状态常量
const (
	RagJobStatusPending    = "pending"
	RagJobStatusProcessing = "processing"
	RagJobStatusPaused     = "paused"
	RagJobStatusSuccess    = "success"
	RagJobStatusFailed     = "failed"
	RagJobStatusCancelled  = "cancelled"
)

// CleanupRelatedJobs 清理相关任务
// 参数: RelatedId 和 Eid，先查询这些 JobID
// 步骤1: 查询符合条件的JobID
// 步骤2: 删除关联的RagJobStep, 查询条件是 JobID
// 步骤3: 删除这些 RagJob
func CleanupRelatedJobs(ctx context.Context, db *gorm.DB, eid int64, relatedId int64) error {
	// 步骤1: 查询符合条件的JobID
	var jobIDs []int64
	if err := db.WithContext(ctx).
		Model(&RagJob{}).
		Where("eid = ? AND related_id = ?", eid, relatedId).
		Pluck("job_id", &jobIDs).Error; err != nil {
		return fmt.Errorf("查询JobID失败: %v", err)
	}

	// 如果没有找到相关任务，直接返回
	if len(jobIDs) == 0 {
		return nil
	}

	// 步骤2: 删除关联的RagJobStep, 查询条件是 JobID
	if err := db.WithContext(ctx).
		Where("job_id IN ?", jobIDs).
		Delete(&RagJobStep{}).Error; err != nil {
		return fmt.Errorf("删除RagJobStep失败: %v", err)
	}

	// 步骤3: 删除这些 RagJob
	if err := db.WithContext(ctx).
		Where("job_id IN ?", jobIDs).
		Delete(&RagJob{}).Error; err != nil {
		return fmt.Errorf("删除RagJob失败: %v", err)
	}

	return nil
}

// UpdateJobStatusToFailed 将Job状态更新为失败，并根据job类型更新相关文件状态
func (job *RagJob) UpdateJobStatusToFailed(db *gorm.DB, reason string) error {
	// 更新job状态
	job.Status = RagJobStatusFailed
	job.FailureReason = reason

	if err := db.Model(job).Updates(map[string]interface{}{
		"status":         job.Status,
		"failure_reason": job.FailureReason,
	}).Error; err != nil {
		return fmt.Errorf("更新job状态失败: %v", err)
	}

	// 更新相关的未完成步骤状态为失败
	unfinishedStatuses := []string{RagJobStepStatusPending, RagJobStepStatusProcessing}
	if err := db.Model(&RagJobStep{}).
		Where("job_id = ? AND status IN ?", job.JobID, unfinishedStatuses).
		Updates(map[string]interface{}{
			"status":   RagJobStepStatusFailed,
			"end_time": time.Now().UnixMilli(),
		}).Error; err != nil {
		logger.SysErrorf("警告: 更新相关步骤状态为失败失败: %v", err)
	}

	// 根据job类型更新文件状态
	switch job.Type {
	case "document_conversion":
		// 文档转换任务失败，更新文件转换状态
		if err := UpdateFileConversionStatus(job.RelatedId, FileConversionStatusFail); err != nil {
			logger.SysErrorf("警告: 更新文件转换状态为failed失败: %v", err)
		}
	case "ai_generate_index":
		// AI生成索引任务失败，更新AI生成chunk状态
		if err := UpdateFileAIGenerateChunkStatus(job.RelatedId, AIGenerateChunkStatusFail); err != nil {
			logger.SysErrorf("警告: 更新文件AI生成chunk状态为failed失败: %v", err)
		}
	case "reindex", "rechunk_and_reindex", "auto_chunking":
		// 索引和分块相关任务失败，更新文件解析状态
		if err := UpdateFileParsingStatus(job.RelatedId, FileParsingStatusFail); err != nil {
			logger.SysErrorf("警告: 更新文件解析状态为failed失败: %v", err)
		}
	case "generate_questions_and_summary":
		// 生成问题和摘要任务失败，不修改解析状态，由步骤内部更新 ai_generate_sq_status
	case "hello":
		// 测试任务，不需要更新文件状态
	default:
		logger.SysErrorf("未知的job类型: %s", job.Type)
	}

	return nil
}
