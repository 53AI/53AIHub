package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

type PipelineStepAction string

const (
	PipelineStepSkipped    PipelineStepAction = "skipped"
	PipelineStepProcessing PipelineStepAction = "processing"
)

type PipelineResult struct {
	FileID         int64              `json:"file_id"`
	MeetingMinutes PipelineStepAction `json:"meeting_minutes"`
	Insights       PipelineStepAction `json:"insights"`
	InsightPage    PipelineStepAction `json:"insight_page"`
}

func getStageStatuses(fileID int64) (minutes, insights, page string) {
	file, err := model.GetFileByIDOlny(fileID)
	if err != nil || file.CleaningRuleInfo == "" {
		return "", "", ""
	}
	var info model.FileCleaningRuleInfo
	json.Unmarshal([]byte(file.CleaningRuleInfo), &info)
	return info.MeetingMinutesStatus, info.InsightsStatus, info.InsightPageStatus
}

func RunRecordingPipeline(ctx context.Context, eid, fileID, userID int64) (*PipelineResult, error) {
	// 权限放开：继续生成管线供其他知识库（团队/共享库）使用，只要求库查看权限，
	// 不再要求文件创建者是当前用户；非创建者触发时生成函数内部以文件创建者为记忆归属。
	if _, err := GetViewableRecordingFile(ctx, eid, userID, fileID); err != nil {
		return nil, fmt.Errorf("文件不存在: %w", err)
	}

	minutesStatus, insightsStatus, pageStatus := getStageStatuses(fileID)

	needMinutes := minutesStatus == "pending" || minutesStatus == "failed" || minutesStatus == ""
	needInsights := insightsStatus == "pending" || insightsStatus == "failed" || insightsStatus == ""
	needPage := pageStatus == "pending" || pageStatus == "failed" || pageStatus == ""

	result := &PipelineResult{FileID: fileID}

	if !needMinutes && !needInsights && !needPage {
		result.MeetingMinutes = PipelineStepSkipped
		result.Insights = PipelineStepSkipped
		result.InsightPage = PipelineStepSkipped
		return result, nil
	}

	if needMinutes {
		result.MeetingMinutes = PipelineStepProcessing
	} else {
		result.MeetingMinutes = PipelineStepSkipped
	}

	if needInsights {
		result.Insights = PipelineStepProcessing
	} else {
		result.Insights = PipelineStepSkipped
	}

	if needPage {
		result.InsightPage = PipelineStepProcessing
	} else {
		result.InsightPage = PipelineStepSkipped
	}

	go func() {
		pipelineCtx, cancel := context.WithTimeout(recordingPipelineCtx, 30*time.Minute)
		defer cancel()

		if needMinutes {
			logger.Infof(pipelineCtx, "【管线】开始生成纪要 fileID=%d", fileID)
			if err := GenerateMeetingMinutes(pipelineCtx, eid, fileID, userID); err != nil {
				logger.Errorf(pipelineCtx, "【管线】纪要生成失败 fileID=%d err=%v", fileID, err)
				return
			}
			mStatus, _, _ := getStageStatuses(fileID)
			if mStatus != "completed" {
				logger.Infof(pipelineCtx, "【管线】纪要状态为 %s，不继续 fileID=%d", mStatus, fileID)
				return
			}
		}

		if needInsights {
			logger.Infof(pipelineCtx, "【管线】开始生成洞察 fileID=%d", fileID)
			GenerateInsights(pipelineCtx, eid, fileID, userID)
			iStatus, _, _ := getStageStatuses(fileID)
			if iStatus != "completed" {
				logger.Errorf(pipelineCtx, "【管线】洞察生成失败 fileID=%d", fileID)
				return
			}
		} else if needPage {
			logger.Infof(pipelineCtx, "【管线】补跑洞察页面 fileID=%d", fileID)
			config, err := model.ValidateOrCreateRecordingConfig(eid)
			if err != nil || config.InferenceModelID == 0 || config.InferenceModelName == "" {
				logger.Infof(pipelineCtx, "【管线】推理模型未配置，跳过页面 fileID=%d", fileID)
				return
			}
			f, err := model.GetFileByIDOlny(fileID)
			if err != nil || f.InsightSummary == "" {
				logger.Errorf(pipelineCtx, "【管线】洞察内容为空，无法生成页面 fileID=%d", fileID)
				return
			}
			pageCtx, pageCancel := context.WithTimeout(recordingPipelineCtx, 5*time.Minute)
			defer pageCancel()
			generateInsightPage(pageCtx, eid, fileID, config, string(f.InsightSummary))
		}
	}()

	return result, nil
}
