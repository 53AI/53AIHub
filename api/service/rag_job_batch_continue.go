package service

import (
	"context"
	"fmt"
	"sort"

	"github.com/53AI/53AIHub/model"
)

// BatchContinueResultV2 是批量断点清洗中单个文档的处理结果。
type BatchContinueResultV2 struct {
	RelatedID int64  `json:"related_id"`
	RunID     string `json:"run_id,omitempty"`
	Status    string `json:"status"` // restarted（已完成，从头重跑）| continued（从断点续跑）| skipped（无需/暂不可处理）| error
	StepKey   string `json:"step_key,omitempty"`
	JobID     int64  `json:"job_id,omitempty"`
	Error     string `json:"error,omitempty"`
}

type indexedRagJobV2 struct {
	index int
	job   model.RagJob
}

// SelectBatchContinueTargetV2 为一次 run 选出续跑起点：
//   - 取步骤序号最小且状态非 success 的 job（失败 / 等待手动执行的 paused / 已取消）；
//   - 若全部步骤均 success，则取第一步（整条 run 从头重跑）。
//
// 独立管线 job（图谱/wiki）与无法解析步骤序号的 job 会被忽略。
// 返回值 restart 为 true 表示“从头重跑”，否则为“断点续跑”。
func SelectBatchContinueTargetV2(jobs []model.RagJob) (target model.RagJob, restart bool, ok bool) {
	indexed := make([]indexedRagJobV2, 0, len(jobs))
	for _, job := range jobs {
		if model.IsStandalonePipelineJobType(job.Type) {
			continue
		}
		idx, found := extractProfileStepIndex(job.StartParameters)
		if !found || idx < 0 {
			continue
		}
		indexed = append(indexed, indexedRagJobV2{index: idx, job: job})
	}
	if len(indexed) == 0 {
		return model.RagJob{}, false, false
	}
	sort.SliceStable(indexed, func(i, j int) bool { return indexed[i].index < indexed[j].index })

	for _, item := range indexed {
		if item.job.Status != model.RagJobStatusSuccess {
			return item.job, false, true
		}
	}
	return indexed[0].job, true, true
}

// ContinueRelatedRunV2 按文档实际状态决定续跑起点，并复用现有单步重试能力入队。
// 不修改管线核心：只是选取一个 job 后调用 RetryJobStepV2WithOptions(Continue=true)。
func ContinueRelatedRunV2(ctx context.Context, eid, relatedID int64) (BatchContinueResultV2, error) {
	result := BatchContinueResultV2{RelatedID: relatedID}
	if eid <= 0 || relatedID <= 0 {
		result.Status = "error"
		result.Error = "invalid related id"
		return result, fmt.Errorf("invalid related id")
	}

	runID, jobs, _, err := GetLatestRunJobsWithStepsByRelatedID(ctx, eid, relatedID)
	if err != nil {
		result.Status = "error"
		result.Error = err.Error()
		return result, err
	}
	result.RunID = runID
	if len(jobs) == 0 {
		result.Status = "skipped"
		result.Error = "no rag jobs"
		return result, nil
	}

	// 正在处理中的文档不介入，避免与运行中的步骤竞争。
	for _, job := range jobs {
		if model.IsStandalonePipelineJobType(job.Type) {
			continue
		}
		if job.Status == model.RagJobStatusProcessing {
			result.Status = "skipped"
			result.Error = "run in progress"
			return result, nil
		}
	}

	target, restart, ok := SelectBatchContinueTargetV2(jobs)
	if !ok {
		result.Status = "skipped"
		result.Error = "no executable step"
		return result, nil
	}
	result.JobID = target.JobID
	result.StepKey = target.Type

	if err := RetryJobStepV2WithOptions(ctx, target.JobID, nil, RetryJobStepOptionsV2{Continue: true}); err != nil {
		result.Status = "error"
		result.Error = err.Error()
		return result, err
	}

	if restart {
		result.Status = "restarted"
	} else {
		result.Status = "continued"
	}
	return result, nil
}
