package model

import (
	"encoding/json"
	"fmt"
	"time"
)

// RagJobStep RAG任务步骤结构体
type RagJobStep struct {
	ID         int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	JobID      int64  `json:"job_id" gorm:"not null;index" comment:"任务ID"`
	Eid        int64  `json:"eid" gorm:"not null;index" comment:"企业ID"`
	StepOrder  int    `json:"step_order" gorm:"not null" comment:"步骤序号"`
	Parameters string `json:"parameters" gorm:"type:text" comment:"步骤参数(JSON字符串)"`
	Results    string `json:"results" gorm:"type:text" comment:"步骤结果(JSON字符串)"`
	Status     string `json:"status" gorm:"size:20;not null;default:'pending'" comment:"步骤状态"`
	StartTime  int64  `json:"start_time" gorm:"comment:开始时间(毫秒时间戳)"`
	EndTime    int64  `json:"end_time" gorm:"comment:结束时间(毫秒时间戳)"`
	BaseModel
}

const (
	RagJobStepStatusPending    = "pending"    // 未开始
	RagJobStepStatusProcessing = "processing" // 处理中
	RagJobStepStatusSuccess    = "success"    // 成功
	RagJobStepStatusFailed     = "failed"     // 失败
)

// TableName 设置表名
func (RagJobStep) TableName() string {
	return "rag_job_steps"
}

// StartProcessing 开始处理步骤，从 PENDING 转为 PROCESSING
func (r *RagJobStep) StartProcessing(parameters any) error {
	// 检查当前状态是否为 PENDING
	if r.Status != RagJobStepStatusPending {
		return fmt.Errorf("invalid status transition from %s to %s", r.Status, RagJobStepStatusProcessing)
	}

	// 将参数转换为 JSON 字符串
	if parameters != nil {
		paramBytes, err := json.Marshal(parameters)
		if err != nil {
			return fmt.Errorf("failed to marshal parameters: %w", err)
		}
		r.Parameters = string(paramBytes)
	}

	// 更新状态和开始时间
	r.Status = RagJobStepStatusProcessing
	r.StartTime = time.Now().UnixMilli()

	return nil
}

// CompleteSuccessfully 成功完成步骤，从 PROCESSING 转为 SUCCESS
func (r *RagJobStep) CompleteSuccessfully(results any) error {
	// 检查当前状态是否为 PROCESSING
	if r.Status != RagJobStepStatusProcessing {
		return fmt.Errorf("invalid status transition from %s to %s", r.Status, RagJobStepStatusSuccess)
	}

	// 将结果转换为 JSON 字符串
	if results != nil {
		resultBytes, err := json.Marshal(results)
		if err != nil {
			return fmt.Errorf("failed to marshal results: %w", err)
		}
		r.Results = string(resultBytes)
	}

	// 更新状态和结束时间
	r.Status = RagJobStepStatusSuccess
	r.EndTime = time.Now().UnixMilli()

	return nil
}

// CompleteWithError 失败完成步骤，从 PROCESSING 转为 FAILED
func (r *RagJobStep) CompleteWithError(results any) error {
	// 检查当前状态是否为 PROCESSING
	if r.Status != RagJobStepStatusProcessing {
		return fmt.Errorf("invalid status transition from %s to %s", r.Status, RagJobStepStatusFailed)
	}

	// 将结果转换为 JSON 字符串
	if results != nil {
		resultBytes, err := json.Marshal(results)
		if err != nil {
			return fmt.Errorf("failed to marshal results: %w", err)
		}
		r.Results = string(resultBytes)
	}

	// 更新状态和结束时间
	r.Status = RagJobStepStatusFailed
	r.EndTime = time.Now().UnixMilli()

	return nil
}
