package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	recordingdebug "github.com/53AI/53AIHub/service/recording_debug"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
)

// insightFrameworkVariant 是这次对照实验里的一套思考框架。
type insightFrameworkVariant struct {
	Name                     string
	SystemPrompt             string
	AttentionRouterHash      string // Phase 5A：control 为空，treatment 非空。
	MinimalRouterHash        string // Phase 5B：control 为空，treatment 非空。
	GuardedMinimalRouterHash string // Phase 5C：control 为空，treatment 非空。
}

// insightFrameworkInputs 是一次「同一份输入、两套思考框架」对照实验的准备结果。
// 两个 variant 共享除 System Prompt 以外的全部输入，保证唯一变量是思考框架。
type insightFrameworkInputs struct {
	Perspective        model.InsightPerspective
	Variants           []insightFrameworkVariant
	UserPrompt         string
	ContextTail        string
	PrimaryMaterial    string
	TranscriptText     string
	HistoryStr         string
	GateMode           string
	// Phase 5A Attention Router 受控实验共享字段。
	BaseSystemPrompt   string
	TaxonomyVersion    string
	TaxonomyResultHash string
}

// InsightFrameworkExperimentComparison 是控制变量校验所需的稳定契约。
type InsightFrameworkExperimentComparison struct {
	EID                  int64  `json:"eid"`
	FileID               int64  `json:"file_id"`
	InsightGeneration    int64  `json:"insight_generation"`
	Perspective          string `json:"perspective"`
	Model                string `json:"model"`
	InputHash            string `json:"input_hash"`
	UserPromptHash       string `json:"user_prompt_hash"`
	ContextHash          string `json:"context_hash"`
	V1SystemPromptHash   string `json:"v1_system_prompt_hash"`
	V2SystemPromptHash   string `json:"v2_system_prompt_hash"`
	InputHashMatch       bool   `json:"input_hash_match"`
	UserPromptHashMatch  bool   `json:"user_prompt_hash_match"`
	ContextHashMatch     bool   `json:"context_hash_match"`
	ModelMatch           bool   `json:"model_match"`
	PerspectiveMatch     bool   `json:"perspective_match"`
	SystemPromptHashDiff bool   `json:"system_prompt_hash_diff"`
	Valid                bool   `json:"valid"`
	// VariantA / VariantB 记录本次对照的两个 variant 名称（V1/V2 字段分别是它们的结果）。
	VariantA string                                     `json:"variant_a"`
	VariantB string                                     `json:"variant_b"`
	V1       *model.RecordingInsightFrameworkExperiment `json:"v1"`
	V2       *model.RecordingInsightFrameworkExperiment `json:"v2"`
	// Phase 5A Attention Router 受控校验字段。
	BaseSystemPromptHash  string `json:"base_system_prompt_hash"`
	BaseContextHash       string `json:"base_context_hash"`
	AttentionRouterHash   string `json:"attention_router_hash"`
	TaxonomyVersion       string `json:"taxonomy_version"`
	TaxonomyResultHash    string `json:"taxonomy_result_hash"`
	BaseSystemPromptMatch bool   `json:"base_system_prompt_match"`
	BaseContextHashMatch  bool   `json:"base_context_hash_match"`
	TaxonomyResultMatch   bool   `json:"taxonomy_result_match"`
	// Phase 5B Minimal Router 受控校验字段。
	MinimalRouterHash     string `json:"minimal_router_hash"`
	MinimalRouterMatch    bool   `json:"minimal_router_match"`
	// Phase 5C Guarded Minimal Router 受控校验字段。
	GuardedMinimalRouterHash  string `json:"guarded_minimal_router_hash"`
	GuardedMinimalRouterMatch bool   `json:"guarded_minimal_router_match"`
}

// insightFrameworkInputHash 覆盖“本次准备出来的事实输入”，用于证明两个 variant 读到的是同一份材料。
func insightFrameworkInputHash(inputs insightFrameworkInputs, generation int64) string {
	parts := []string{
		string(inputs.Perspective),
		fmt.Sprintf("%d", generation),
		inputs.GateMode,
		inputs.PrimaryMaterial,
		inputs.TranscriptText,
		inputs.HistoryStr,
	}
	return secondBrainHash(strings.Join(parts, "\x00"))
}

// runInsightFrameworkExperiment 用一次准备的输入连续发起两次模型调用（V1 框架 / V2 框架），
// 并把结果写入评测专用表。它不触碰任何正式数据。
func runInsightFrameworkExperiment(ctx context.Context, eid, userID, fileID, generation int64, config *model.RecordingConfig, inputs insightFrameworkInputs) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("insight framework experiment panic: %v", r)
			logger.Errorf(context.Background(), "【框架对照实验】panic 已隔离 fileID=%d err=%v", fileID, err)
		}
	}()
	if config == nil || config.InferenceModelID == 0 || strings.TrimSpace(config.InferenceModelName) == "" {
		return fmt.Errorf("insight framework experiment requires a configured inference model")
	}
	if len(inputs.Variants) != 2 || strings.TrimSpace(inputs.UserPrompt) == "" {
		return fmt.Errorf("insight framework experiment requires exactly two variants and one user prompt")
	}
	for _, variant := range inputs.Variants {
		if strings.TrimSpace(variant.Name) == "" || strings.TrimSpace(variant.SystemPrompt) == "" {
			return fmt.Errorf("insight framework experiment variant must carry a name and a system prompt")
		}
	}
	if !isInsightGenerationCurrent(eid, fileID, generation) {
		return nil
	}

	inputHash := insightFrameworkInputHash(inputs, generation)
	userPromptHash := secondBrainHash(inputs.UserPrompt)
	contextHash := secondBrainHash(inputs.ContextTail)
	baseSystemPromptHash := secondBrainHash(inputs.BaseSystemPrompt)
	baseContextHash := contextHash
	for _, variant := range inputs.Variants {
		row := &model.RecordingInsightFrameworkExperiment{
			Eid: eid, OwnerID: userID, FileID: fileID, InsightGeneration: generation,
			Variant: variant.Name, Perspective: string(inputs.Perspective), ModelName: config.InferenceModelName,
			SystemPromptHash: secondBrainHash(variant.SystemPrompt),
			InputHash:        inputHash, UserPromptHash: userPromptHash, ContextHash: contextHash,
			BaseSystemPromptHash:     baseSystemPromptHash,
			BaseContextHash:          baseContextHash,
			AttentionRouterHash:      variant.AttentionRouterHash,
			MinimalRouterHash:        variant.MinimalRouterHash,
			GuardedMinimalRouterHash: variant.GuardedMinimalRouterHash,
			TaxonomyVersion:          inputs.TaxonomyVersion,
			TaxonomyResultHash:       inputs.TaxonomyResultHash,
		}
		// 对照实验需要保证每次运行都使用当前实验框架重新生成，不跳过已有 shadow 行。
		startedAt := time.Now()
		raw, callErr := callLLMWithRetry(
			recordingdebug.WithLLMStage(ctx, recordingdebug.LLMStage(ctx, "insight_framework_experiment_llm")),
			config,
			func() *relaymodel.GeneralOpenAIRequest {
				return &relaymodel.GeneralOpenAIRequest{
					Model:     config.InferenceModelName,
					MaxTokens: 0,
					Messages: []relaymodel.Message{
						{Role: "system", Content: variant.SystemPrompt},
						{Role: "user", Content: inputs.UserPrompt},
					},
				}
			},
		)
		row.DurationMs = time.Since(startedAt).Milliseconds()
		if callErr != nil {
			row.Status = secondBrainShadowStatusFailed
			row.ErrorMessage = truncateSecondBrainError(callErr)
			if upsertErr := model.UpsertRecordingInsightFrameworkExperiment(ctx, row); upsertErr != nil {
				logger.Warnf(ctx, "【框架对照实验】失败结果写入失败 fileID=%d variant=%s err=%v", fileID, variant.Name, upsertErr)
			}
			return callErr
		}
		row.Status = secondBrainShadowStatusShadow
		row.Content = model.LongText(strings.TrimSpace(raw))
		if upsertErr := model.UpsertRecordingInsightFrameworkExperiment(ctx, row); upsertErr != nil {
			return fmt.Errorf("persist insight framework experiment: %w", upsertErr)
		}
		logger.Infof(ctx, "【框架对照实验】生成成功 fileID=%d generation=%d variant=%s sys_hash=%s chars=%d elapsed_ms=%d",
			fileID, generation, variant.Name, row.SystemPromptHash[:12], len([]rune(row.Content)), row.DurationMs)
	}
	return nil
}

// LoadInsightFrameworkComparison 读取同一 file/generation 下的 V1 与 V2 两个 variant 并完成控制变量校验。
func LoadInsightFrameworkComparison(ctx context.Context, eid, fileID, generation int64) (*InsightFrameworkExperimentComparison, error) {
	return LoadInsightFrameworkVariantComparison(ctx, eid, fileID, generation, model.InsightFrameworkVariantV1, model.InsightFrameworkVariantV2)
}

// LoadInsightFrameworkVariantComparison 读取指定的两个 variant 并完成控制变量校验。
// 返回值里 V1/V2 字段代表“variantA / variantB”，V1Variant/V2Variant 记录它们各自的名称。
func LoadInsightFrameworkVariantComparison(ctx context.Context, eid, fileID, generation int64, variantA, variantB string) (*InsightFrameworkExperimentComparison, error) {
	v1, err := model.GetRecordingInsightFrameworkExperiment(ctx, eid, fileID, generation, variantA)
	if err != nil {
		return nil, err
	}
	v2, err := model.GetRecordingInsightFrameworkExperiment(ctx, eid, fileID, generation, variantB)
	if err != nil {
		return nil, err
	}
	comparison := &InsightFrameworkExperimentComparison{EID: eid, FileID: fileID, InsightGeneration: generation, V1: v1, V2: v2, VariantA: variantA, VariantB: variantB}
	if v1 == nil || v2 == nil {
		return comparison, nil
	}
	comparison.Perspective = v1.Perspective
	comparison.Model = v1.ModelName
	comparison.InputHash = v1.InputHash
	comparison.UserPromptHash = v1.UserPromptHash
	comparison.ContextHash = v1.ContextHash
	comparison.V1SystemPromptHash = v1.SystemPromptHash
	comparison.V2SystemPromptHash = v2.SystemPromptHash
	comparison.InputHashMatch = v1.InputHash == v2.InputHash
	comparison.UserPromptHashMatch = v1.UserPromptHash == v2.UserPromptHash
	comparison.ContextHashMatch = v1.ContextHash == v2.ContextHash
	comparison.ModelMatch = v1.ModelName == v2.ModelName
	comparison.PerspectiveMatch = v1.Perspective == v2.Perspective
	comparison.SystemPromptHashDiff = v1.SystemPromptHash != v2.SystemPromptHash
	// Phase 5A Attention Router 受控校验字段。
	comparison.BaseSystemPromptHash = v1.BaseSystemPromptHash
	comparison.BaseContextHash = v1.BaseContextHash
	comparison.AttentionRouterHash = v1.AttentionRouterHash
	comparison.TaxonomyVersion = v1.TaxonomyVersion
	comparison.TaxonomyResultHash = v1.TaxonomyResultHash
	comparison.BaseSystemPromptMatch = v1.BaseSystemPromptHash == v2.BaseSystemPromptHash
	comparison.BaseContextHashMatch = v1.BaseContextHash == v2.BaseContextHash
	comparison.TaxonomyResultMatch = v1.TaxonomyResultHash == v2.TaxonomyResultHash
	comparison.Valid = comparison.InputHashMatch && comparison.UserPromptHashMatch && comparison.ContextHashMatch &&
		comparison.ModelMatch && comparison.PerspectiveMatch && comparison.SystemPromptHashDiff &&
		v1.Status == secondBrainShadowStatusShadow && v2.Status == secondBrainShadowStatusShadow
	// Phase 5A / 5B / 5C 受控校验：base_system_prompt / base_context / taxonomy_result 必须一致，且路由变量只允许一个方向不同。
	comparison.MinimalRouterHash = v1.MinimalRouterHash
	comparison.MinimalRouterMatch = v1.MinimalRouterHash == v2.MinimalRouterHash
	comparison.GuardedMinimalRouterHash = v1.GuardedMinimalRouterHash
	comparison.GuardedMinimalRouterMatch = v1.GuardedMinimalRouterHash == v2.GuardedMinimalRouterHash
	if comparison.BaseSystemPromptHash != "" || comparison.BaseContextHash != "" || comparison.TaxonomyResultHash != "" {
		comparison.Valid = comparison.Valid && comparison.BaseSystemPromptMatch && comparison.BaseContextHashMatch && comparison.TaxonomyResultMatch
		attentionDiff := v1.AttentionRouterHash != v2.AttentionRouterHash
		minimalDiff := v1.MinimalRouterHash != v2.MinimalRouterHash
		guardedDiff := v1.GuardedMinimalRouterHash != v2.GuardedMinimalRouterHash
		// 只允许 attention / minimal / guarded 其中一侧不同，不能同时多侧不同，也不能同时相同。
		diffCount := 0
		if attentionDiff {
			diffCount++
		}
		if minimalDiff {
			diffCount++
		}
		if guardedDiff {
			diffCount++
		}
		comparison.Valid = comparison.Valid && diffCount == 1
	}
	return comparison, nil
}

// RunControlledInsightComparison 是开发者入口：同一份输入、V1 与 V2 两套思考框架各跑一次，只写评测表。
func RunControlledInsightComparison(ctx context.Context, eid, userID, fileID int64) (*InsightFrameworkExperimentComparison, error) {
	file, err := model.GetFileByID(eid, fileID)
	if err != nil || file == nil {
		return nil, fmt.Errorf("读取文件失败: %w", err)
	}
	if runErr := generateInsights(ctx, eid, fileID, userID, insightRunModeControlledComparison); runErr != nil {
		return nil, runErr
	}
	return LoadInsightFrameworkComparison(ctx, eid, fileID, file.InsightGeneration)
}

// RunSecondBrainV21Comparison 是 Phase 3B1 入口：冻结的 V2.0 与 V2.1（证据护栏）各跑一次，只写评测表。
func RunSecondBrainV21Comparison(ctx context.Context, eid, userID, fileID int64) (*InsightFrameworkExperimentComparison, error) {
	file, err := model.GetFileByID(eid, fileID)
	if err != nil || file == nil {
		return nil, fmt.Errorf("读取文件失败: %w", err)
	}
	if runErr := generateInsights(ctx, eid, fileID, userID, insightRunModeSecondBrainV21Comparison); runErr != nil {
		return nil, runErr
	}
	return LoadInsightFrameworkVariantComparison(ctx, eid, fileID, file.InsightGeneration, model.InsightFrameworkVariantV2Frozen, model.InsightFrameworkVariantV21)
}

// RunSecondBrainTaxonomyRouterComparison 是 Phase 5A 入口：
// CONTROL = V2.1 baseline；TREATMENT = V2.1 + Taxonomy Attention Router。只写评测表。
func RunSecondBrainTaxonomyRouterComparison(ctx context.Context, eid, userID, fileID int64) (*InsightFrameworkExperimentComparison, error) {
	file, err := model.GetFileByID(eid, fileID)
	if err != nil || file == nil {
		return nil, fmt.Errorf("读取文件失败: %w", err)
	}
	if runErr := generateInsights(ctx, eid, fileID, userID, insightRunModeTaxonomyAttentionRouterComparison); runErr != nil {
		return nil, runErr
	}
	return LoadInsightFrameworkVariantComparison(ctx, eid, fileID, file.InsightGeneration, model.InsightFrameworkVariantV21Control, model.InsightFrameworkVariantV21TaxonomyRouter)
}

// RunMinimalTaxonomyComparison 是 Phase 5B 入口：
// CONTROL = V2.1 baseline；TREATMENT = V2.1 + Minimal Taxonomy Context。只写评测表。
func RunMinimalTaxonomyComparison(ctx context.Context, eid, userID, fileID int64) (*InsightFrameworkExperimentComparison, error) {
	file, err := model.GetFileByID(eid, fileID)
	if err != nil || file == nil {
		return nil, fmt.Errorf("读取文件失败: %w", err)
	}
	if runErr := generateInsights(ctx, eid, fileID, userID, insightRunModeMinimalTaxonomyComparison); runErr != nil {
		return nil, runErr
	}
	return LoadInsightFrameworkVariantComparison(ctx, eid, fileID, file.InsightGeneration, model.InsightFrameworkVariantV21Control, model.InsightFrameworkVariantV21Minimal)
}

// RunGuardedMinimalTaxonomyComparison 是 Phase 5C 入口：
// CONTROL = V2.1 baseline；TREATMENT = V2.1 + Guarded Minimal Taxonomy Context。只写评测表。
func RunGuardedMinimalTaxonomyComparison(ctx context.Context, eid, userID, fileID int64) (*InsightFrameworkExperimentComparison, error) {
	file, err := model.GetFileByID(eid, fileID)
	if err != nil || file == nil {
		return nil, fmt.Errorf("读取文件失败: %w", err)
	}
	if runErr := generateInsights(ctx, eid, fileID, userID, insightRunModeGuardedMinimalTaxonomyComparison); runErr != nil {
		return nil, runErr
	}
	return LoadInsightFrameworkVariantComparison(ctx, eid, fileID, file.InsightGeneration, model.InsightFrameworkVariantV21Control, model.InsightFrameworkVariantV21GuardedMinimal)
}
