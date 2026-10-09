package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	recordingdebug "github.com/53AI/53AIHub/service/recording_debug"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
)

const (
	recordingSecondBrainV2ShadowEnabledEnv = "RECORDING_SECOND_BRAIN_V2_SHADOW_ENABLED"
	secondBrainShadowPromptVersion         = "second-brain-v2-phase1"
	secondBrainShadowStatusShadow          = "shadow"
	secondBrainShadowStatusFailed          = "failed"
)

// recordingSecondBrainV2ShadowEnabled 是部署级灰度开关，默认关闭。
// 关闭时生产链路不调用 V2、不写 shadow；开发者安全模式（isDevRun=true）不受它约束。
func recordingSecondBrainV2ShadowEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(recordingSecondBrainV2ShadowEnabledEnv))) {
	case "1", "true", "on", "enabled", "yes":
		return true
	default:
		return false
	}
}

// shouldRunSecondBrainShadow 判定本次运行是否生成 V2 Shadow：
// 生产链路受部署开关约束；开发者安全模式（显式入口）始终运行。
func shouldRunSecondBrainShadow(isDevRun bool) bool {
	return isDevRun || recordingSecondBrainV2ShadowEnabled()
}

// RunSecondBrainShadowOnly 是开发者安全入口：读取该会议当前真实数据，
// 复用与生产链路完全相同的输入准备流程生成一次 V2 Shadow。
// 它不写 files.insight_summary / insight_context / insight_generation / cleaning_rule_info，
// 不生成决策页面（不跑 Prompt 5），不触发任何 Action；正式数据在调用前后保持一致。
func RunSecondBrainShadowOnly(ctx context.Context, eid, userID, fileID int64) error {
	return generateInsights(ctx, eid, fileID, userID, insightRunModeSecondBrainShadowOnly)
}

// secondBrainShadowInput 是 V2 Shadow 的完整输入：与 V1 使用同一份事实材料与 Context，
// 只把 System Prompt 换成第二大脑思考程序。
type secondBrainShadowInput struct {
	Perspective  model.InsightPerspective
	SystemPrompt string
	UserPrompt   string
}

// SecondBrainShadowComparison 是开发者对比 V1 / V2 的稳定返回契约。
type SecondBrainShadowComparison struct {
	EID               int64  `json:"eid"`
	FileID            int64  `json:"file_id"`
	InsightGeneration int64  `json:"insight_generation"`
	Perspective       string `json:"perspective"`
	V1Status          string `json:"v1_status"`
	V1Markdown        string `json:"v1_markdown"`
	V2Status          string `json:"v2_status"`
	V2Markdown        string `json:"v2_markdown"`
	V2Perspective     string `json:"v2_perspective,omitempty"`
	V2PromptHash      string `json:"v2_prompt_hash,omitempty"`
	V2Model           string `json:"v2_model,omitempty"`
	V2ErrorMessage    string `json:"v2_error_message,omitempty"`
	V2DurationMs      int64  `json:"v2_duration_ms,omitempty"`
}

// runSecondBrainShadow 在 Shadow 通道生成一次 V2 洞察 Markdown。
// 是否运行由调用方通过 shouldRunSecondBrainShadow 决定。
// 约束：不覆盖 files.insight_summary、不写 insight_page、不触发任何 Action；任何失败只记录在 shadow 表。
func runSecondBrainShadow(ctx context.Context, eid, userID, fileID, generation int64, config *model.RecordingConfig, in secondBrainShadowInput) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("second brain shadow panic: %v", r)
			logger.Errorf(context.Background(), "【第二大脑V2-Shadow】panic 已隔离 fileID=%d err=%v", fileID, err)
		}
	}()
	if config == nil || config.InferenceModelID == 0 || strings.TrimSpace(config.InferenceModelName) == "" {
		return fmt.Errorf("second brain shadow requires a configured inference model")
	}
	if strings.TrimSpace(in.SystemPrompt) == "" || strings.TrimSpace(in.UserPrompt) == "" {
		return fmt.Errorf("second brain shadow requires system and user prompts")
	}
	if !isInsightGenerationCurrent(eid, fileID, generation) {
		return nil
	}
	// 同一 generation 已成功产出时不重复消耗模型调用。
	if existing, getErr := model.GetRecordingSecondBrainShadow(ctx, eid, fileID, generation); getErr == nil && existing != nil && existing.Status == secondBrainShadowStatusShadow {
		return nil
	}

	startedAt := time.Now()
	buildRequest := func() *relaymodel.GeneralOpenAIRequest {
		return &relaymodel.GeneralOpenAIRequest{
			Model:     config.InferenceModelName,
			MaxTokens: 0,
			Messages: []relaymodel.Message{
				{Role: "system", Content: in.SystemPrompt},
				{Role: "user", Content: in.UserPrompt},
			},
		}
	}
	row := &model.RecordingSecondBrainShadow{
		Eid: eid, OwnerID: userID, FileID: fileID, InsightGeneration: generation,
		Perspective: string(in.Perspective), PromptVersion: secondBrainShadowPromptVersion,
		PromptHash: secondBrainPromptHash(in.SystemPrompt, in.UserPrompt),
		ModelName:  config.InferenceModelName,
	}
	raw, callErr := callLLMWithRetry(recordingdebug.WithLLMStage(ctx, recordingdebug.LLMStage(ctx, "second_brain_shadow_llm")), config, buildRequest)
	row.DurationMs = time.Since(startedAt).Milliseconds()
	if callErr != nil {
		row.Status = secondBrainShadowStatusFailed
		row.ErrorMessage = truncateSecondBrainError(callErr)
		if upsertErr := model.UpsertRecordingSecondBrainShadow(ctx, row); upsertErr != nil {
			logger.Warnf(ctx, "【第二大脑V2-Shadow】失败结果写入失败 fileID=%d err=%v", fileID, upsertErr)
		}
		return callErr
	}
	row.Status = secondBrainShadowStatusShadow
	row.Content = model.LongText(strings.TrimSpace(raw))
	if upsertErr := model.UpsertRecordingSecondBrainShadow(ctx, row); upsertErr != nil {
		return fmt.Errorf("persist second brain shadow: %w", upsertErr)
	}
	logger.Infof(ctx, "【第二大脑V2-Shadow】生成成功 fileID=%d generation=%d perspective=%s chars=%d elapsed_ms=%d",
		fileID, generation, row.Perspective, len([]rune(row.Content)), row.DurationMs)
	return nil
}

func secondBrainPromptHash(systemPrompt, userPrompt string) string {
	sum := sha256.Sum256([]byte(systemPrompt + "\x00" + userPrompt))
	return hex.EncodeToString(sum[:])
}

func truncateSecondBrainError(err error) string {
	if err == nil {
		return ""
	}
	message := []rune(strings.TrimSpace(err.Error()))
	if len(message) > 480 {
		return string(message[:480])
	}
	return string(message)
}

// CompareRecordingSecondBrainShadow 返回同一份会议材料下的 V1 正式洞察与 V2 shadow 结果。
// 供开发者对比工具使用；V2 尚未运行时返回空 V2 内容与状态。
func CompareRecordingSecondBrainShadow(ctx context.Context, eid, userID, fileID int64) (*SecondBrainShadowComparison, error) {
	file, err := GetViewableRecordingFile(ctx, eid, userID, fileID)
	if err != nil {
		return nil, err
	}
	comparison := &SecondBrainShadowComparison{
		EID: eid, FileID: fileID, InsightGeneration: file.InsightGeneration,
		Perspective: string(model.NormalizeInsightPerspective(file.InsightPerspective)),
		V1Markdown:  string(file.InsightSummary),
	}
	if strings.TrimSpace(file.CleaningRuleInfo) != "" {
		var info model.FileCleaningRuleInfo
		if json.Unmarshal([]byte(file.CleaningRuleInfo), &info) == nil {
			comparison.V1Status = info.InsightsStatus
		}
	}
	shadow, err := model.GetRecordingSecondBrainShadow(ctx, eid, fileID, file.InsightGeneration)
	if err != nil {
		return nil, err
	}
	if shadow != nil {
		comparison.V2Status = shadow.Status
		comparison.V2Markdown = string(shadow.Content)
		comparison.V2Perspective = shadow.Perspective
		comparison.V2PromptHash = shadow.PromptHash
		comparison.V2Model = shadow.ModelName
		comparison.V2ErrorMessage = shadow.ErrorMessage
		comparison.V2DurationMs = shadow.DurationMs
	}
	return comparison, nil
}

// SecondBrainFormalDataFingerprint 是正式数据的只读指纹，用于证明一次 Shadow 运行
// 没有改动正式洞察、生成版本、决策页面、阶段状态或 Action 链路。
type SecondBrainFormalDataFingerprint struct {
	InsightSummaryHash  string `json:"insight_summary_hash"`
	InsightContextHash  string `json:"insight_context_hash"`
	InsightGeneration   int64  `json:"insight_generation"`
	InsightPageHash     string `json:"insight_page_hash"`
	CleaningRuleHash    string `json:"cleaning_rule_hash"`
	ActionOpportunityCount int64 `json:"action_opportunity_count"`
	ActionPlanCount        int64 `json:"action_plan_count"`
	ActionRunCount         int64 `json:"action_run_count"`
}

func secondBrainHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

// CaptureSecondBrainFormalDataFingerprint 只读采集上述指纹；缺失记录用空串表示。
func CaptureSecondBrainFormalDataFingerprint(ctx context.Context, eid, fileID int64) (*SecondBrainFormalDataFingerprint, error) {
	file, err := model.GetFileByID(eid, fileID)
	if err != nil || file == nil {
		return nil, fmt.Errorf("读取文件失败: %w", err)
	}
	fingerprint := &SecondBrainFormalDataFingerprint{
		InsightSummaryHash: secondBrainHash(string(file.InsightSummary)),
		InsightContextHash: secondBrainHash(string(file.InsightContext)),
		InsightGeneration:  file.InsightGeneration,
		CleaningRuleHash:   secondBrainHash(file.CleaningRuleInfo),
	}
	page, err := model.GetRecordingFileInsightPageByFileID(fileID)
	if err == nil && page != nil {
		fingerprint.InsightPageHash = secondBrainHash(string(page.PageJSON))
	}
	counts := []struct {
		model  interface{}
		where  string
		args   []interface{}
		target *int64
	}{
		{model: &model.ActionOpportunityRecord{}, where: "source_insight_id = ? OR source_id = ?", args: []interface{}{fileID, fileID}, target: &fingerprint.ActionOpportunityCount},
		{model: &model.ActionPlanRecord{}, where: "opportunity_id IN (SELECT opportunity_id FROM action_opportunities WHERE source_insight_id = ? OR source_id = ?)", args: []interface{}{fileID, fileID}, target: &fingerprint.ActionPlanCount},
		{model: &model.ActionRunRecord{}, where: "action_id IN (SELECT action_id FROM actions WHERE source_file_id = ?)", args: []interface{}{fileID}, target: &fingerprint.ActionRunCount},
	}
	for _, item := range counts {
		var count int64
		if err := model.DB.WithContext(ctx).Model(item.model).Where(item.where, item.args...).Count(&count).Error; err != nil {
			// Action 子表可能尚未建表（旧部署）；此时按 0 处理，不阻塞指纹采集。
			continue
		}
		*item.target = count
	}
	return fingerprint, nil
}

// FormalDataUnchanged 报告两次指纹之间是否所有正式数据字段一致。
func (f *SecondBrainFormalDataFingerprint) FormalDataUnchanged(other *SecondBrainFormalDataFingerprint) bool {
	if f == nil || other == nil {
		return false
	}
	return f.InsightSummaryHash == other.InsightSummaryHash &&
		f.InsightContextHash == other.InsightContextHash &&
		f.InsightGeneration == other.InsightGeneration &&
		f.InsightPageHash == other.InsightPageHash &&
		f.CleaningRuleHash == other.CleaningRuleHash &&
		f.ActionOpportunityCount == other.ActionOpportunityCount &&
		f.ActionPlanCount == other.ActionPlanCount &&
		f.ActionRunCount == other.ActionRunCount
}
