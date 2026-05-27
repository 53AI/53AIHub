package model

import "encoding/json"

// RunMode 定义步骤运行模式
type RunMode string

const (
	RunModeAuto   RunMode = "auto"   // 自动运行
	RunModeManual RunMode = "manual" // 手动运行（跳过）
	RunModeSkip   RunMode = "skip"   // 跳过（标记成功）
)

// RuntimeProfile 定义任务执行时的管线配置快照
type RuntimeProfile struct {
	ID    int64         `json:"id,omitempty"` // 流水线ID
	Steps []ProfileStep `json:"steps"`
}

func (p RuntimeProfile) RequiredStepsCount() int {
	total := 0
	for _, step := range p.Steps {
		runMode := step.RunMode
		if runMode == "" {
			if step.Enabled {
				runMode = RunModeAuto
			} else {
				runMode = RunModeManual
			}
		}
		if runMode == RunModeSkip {
			continue
		}
		total++
	}
	return total
}

// ProfileStep 定义管线中的单个步骤配置
type ProfileStep struct {
	Enabled       bool            `json:"enabled"` // Deprecated: use RunMode instead
	RunMode       RunMode         `json:"run_mode"`
	StepKey       string          `json:"step_key"`
	Config        json.RawMessage `json:"config,omitempty"`
	ParallelGroup bool            `json:"parallel_group,omitempty"` // 是否与下一个任务并行执行
}
