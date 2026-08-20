package steps

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"gorm.io/gorm"
)

// RecoverContentCleaning content_cleaning 步骤的恢复 handler。
// 断点检查规则：
//  1. 当前 RunID 的 content_cleaning Job 有成功 step 且 results 含清洗标记 -> 跳过。
//  2. 无成功 step，但 job 创建时间之后存在新 FileBody 且其内容 hash 与解析源不同
//     （body 已提交但 metadata 未写）-> 跳过。
//  3. 否则从解析源 body 重做（调用真实 handler）。
//
// 重试不得盲读最新 body，避免重复清洗；重做由 handler 内部通过 RunID 定位解析源 body。
func RecoverContentCleaning(db *gorm.DB) func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
	return func(ctx context.Context, job *model.RagJob, config json.RawMessage) error {
		eid, fileID := extractEidAndFileID(job)
		if eid <= 0 || fileID <= 0 {
			logger.Warnf(ctx, "【流水线恢复】content_cleaning: 参数缺失，重做 (eid=%d, file_id=%d)", eid, fileID)
			return NewContentCleaningHandler(db)(ctx, job, config)
		}

		// 规则1：当前 job 有成功 step 且含清洗标记
		if contentCleaningStepSucceeded(db, job) {
			logger.Infof(ctx, "【流水线恢复】content_cleaning: step 已成功，跳过 (file_id=%d)", fileID)
			return nil
		}

		// 规则2：job 创建时间之后存在内容不同的新 FileBody（body 已提交但 metadata 未写）
		exists, err := contentCleaningOutputBodyExists(db, eid, fileID, job)
		if err != nil {
			logger.Warnf(ctx, "【流水线恢复】content_cleaning: 检查输出 body 失败，重做 (file_id=%d, err=%v)", fileID, err)
			return NewContentCleaningHandler(db)(ctx, job, config)
		}
		if exists {
			logger.Infof(ctx, "【流水线恢复】content_cleaning: 已有输出 FileBody，跳过 (file_id=%d)", fileID)
			return nil
		}

		// 规则3：重做
		logger.Infof(ctx, "【流水线恢复】content_cleaning: 无完整输出，重做 (file_id=%d)", fileID)
		return NewContentCleaningHandler(db)(ctx, job, config)
	}
}

// contentCleaningStepSucceeded 判断当前 job 是否有成功的清洗 step 且 results 含清洗标记。
// 按 id DESC 取最新的一条 step，避免多 step 时取值不确定。
func contentCleaningStepSucceeded(db *gorm.DB, job *model.RagJob) bool {
	if job == nil || job.JobID == 0 {
		return false
	}
	var step model.RagJobStep
	if err := db.Where("job_id = ?", job.JobID).Order("id DESC").First(&step).Error; err != nil {
		return false
	}
	if step.Status != model.RagJobStepStatusSuccess {
		return false
	}
	// results 含清洗标记（cleaned_content_length 或 total_tokens）
	var results map[string]interface{}
	if err := json.Unmarshal([]byte(step.Results), &results); err != nil {
		return false
	}
	if _, ok := results["cleaned_content_length"]; ok {
		return true
	}
	if _, ok := results["total_tokens"]; ok {
		return true
	}
	return false
}

// contentCleaningOutputBodyExists 判断 job 创建时间之后是否存在内容不同的新 FileBody。
// 用于 body 已提交但 metadata 未写入的情况；结合 job 创建时间边界和内容 hash 判定，
// 避免把重复解析的相同内容误判为清洗输出。
func contentCleaningOutputBodyExists(db *gorm.DB, eid, fileID int64, job *model.RagJob) (bool, error) {
	if job == nil {
		return false, nil
	}
	boundary := job.CreatedTime
	if boundary == 0 {
		return false, nil
	}

	// 统计文件下 FileBody 总数，至少 2 条（解析源 + 清洗输出）才可能已完成
	var count int64
	if err := db.Model(&model.FileBody{}).Where("eid = ? AND file_id = ?", eid, fileID).Count(&count).Error; err != nil {
		return false, err
	}
	if count < 2 {
		return false, nil
	}

	// 取 job 创建时间之前最旧的 FileBody 作为解析源，计算其内容 hash
	var sourceBody model.FileBody
	if err := db.Where("eid = ? AND file_id = ? AND created_time <= ?", eid, fileID, boundary).
		Order("id ASC").First(&sourceBody).Error; err != nil {
		return false, err
	}
	sourceContent, err := sourceBody.GetContent()
	if err != nil {
		return false, err
	}
	sourceHash := sha256Hex(sourceContent)

	// 查 job 创建时间之后的新 body，任一内容 hash 与源不同则视为清洗输出
	var afterBodies []model.FileBody
	if err := db.Where("eid = ? AND file_id = ? AND created_time > ?", eid, fileID, boundary).
		Order("id ASC").Find(&afterBodies).Error; err != nil {
		return false, err
	}
	for i := range afterBodies {
		content, err := afterBodies[i].GetContent()
		if err != nil {
			continue
		}
		if sha256Hex(content) != sourceHash {
			return true, nil
		}
	}
	return false, nil
}

// sha256Hex 计算文本的 sha256 十六进制摘要，用于内容 hash 判定。
func sha256Hex(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}
