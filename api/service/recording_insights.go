package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/keystone"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	recordingdebug "github.com/53AI/53AIHub/service/recording_debug"
	relaymodel "github.com/songquanpeng/one-api/relay/model"
)

// historyMeeting 历史会议数据，用于 Prompt 4 的 historical_context。
// 只包含历史纪要或结构化会议记忆，不包含历史洞察，避免上轮输出自我强化。
type historyMeeting struct {
	FileID       int64
	Title        string
	Minutes      string
	Memories     []meetingMemoryContext
	RecallSource uint8
}

const (
	historyRecallEntityOverlap uint8 = 1 << iota
	historyRecallClaim
	historyRecallEntityFact
)

// 输出：写入 file.insight_summary
func GenerateInsights(ctx context.Context, eid, fileID, userID int64) {
	file, err := model.GetFileByID(eid, fileID)
	if err != nil || file == nil {
		logger.Errorf(ctx, "【洞察】读取文件信息失败 fileID=%d err=%v", fileID, err)
		setInsightsStatus(fileID, "failed")
		return
	}
	traceCtx, trace, _ := recordingdebug.EnsureTrace(ctx, eid, fileID, file.InsightGeneration, file.Path)
	ctx = traceCtx
	insightStartedAt := time.Now()
	recordingdebug.RecordStage(ctx, "insights", "决策洞察生成", "processing", insightStartedAt, map[string]interface{}{
		"generation": file.InsightGeneration,
	}, nil)
	if !file.IsRecordingOriginType() {
		logger.Infof(ctx, "【洞察】跳过非录音来源 fileID=%d originType=%s", fileID, file.OriginType)
		setInsightOutcomeIfCurrent(eid, fileID, file.InsightGeneration, insightGateResult{
			Mode:       insightModeNoInsight,
			ReasonCode: "non_recording_source",
			Message:    "非安心录文件不生成会议洞察。",
		})
		recordingdebug.RecordStage(ctx, "insights", "决策洞察生成", "skipped", insightStartedAt, map[string]interface{}{"reason": "non_recording_source"}, nil)
		trace.Finish("success", nil)
		return
	}

	config, err := model.ValidateOrCreateRecordingConfig(eid)
	if err != nil || config.InferenceModelID == 0 || config.InferenceModelName == "" {
		logger.Infof(ctx, "【洞察】推理模型未配置，跳过 fileID=%d", fileID)
		setInsightOutcomeIfCurrent(eid, fileID, file.InsightGeneration, insightGateResult{
			Mode:       insightModeNoInsight,
			ReasonCode: "model_not_configured",
			Message:    "当前未配置推理模型，暂不生成洞察。",
		})
		recordingdebug.RecordStage(ctx, "insights", "决策洞察生成", "skipped", insightStartedAt, map[string]interface{}{"reason": "model_not_configured"}, nil)
		trace.Finish("success", nil)
		return
	}

	if file.UserID > 0 && userID != file.UserID {
		logger.Warnf(ctx, "【洞察】使用文件创建者作为记忆归属 fileID=%d requested_user_id=%d file_user_id=%d", fileID, userID, file.UserID)
		userID = file.UserID
	}
	generation := file.InsightGeneration
	if !isInsightGenerationCurrent(eid, fileID, generation) {
		recordingdebug.RecordStage(ctx, "insights", "决策洞察生成", "skipped", insightStartedAt, map[string]interface{}{"reason": "stale_generation", "generation": generation}, nil)
		trace.Finish("skipped", nil)
		return
	}

	// 质量门控必须早于个人、企业、补充和历史背景加载，避免背景把
	// 空录音“补写”为一篇看似完整的洞察。
	gateMaterial, gateErr := loadMeetingMinutesText(ctx, eid, fileID)
	if gateErr != nil || strings.TrimSpace(gateMaterial) == "" {
		gateMaterial, _ = loadTranscriptText(ctx, eid, fileID)
	}
	gateResult := evaluateInsightGate(gateMaterial)
	recordingdebug.RecordStage(ctx, "insight_gate", "洞察质量门控", map[bool]string{true: "success", false: "skipped"}[gateResult.Allowed], insightStartedAt, map[string]interface{}{
		"allowed":        gateResult.Allowed,
		"mode":           gateResult.Mode,
		"reason_code":    gateResult.ReasonCode,
		"confidence":     gateResult.Confidence,
		"material_chars": len([]rune(gateMaterial)),
	}, nil)
	if !gateResult.Allowed {
		if setInsightOutcomeIfCurrent(eid, fileID, generation, gateResult) {
			logger.Infof(ctx, "【洞察-质量门控】跳过 fileID=%d mode=%s reason=%s", fileID, gateResult.Mode, gateResult.ReasonCode)
		}
		recordingdebug.RecordStage(ctx, "insights", "决策洞察生成", "skipped", insightStartedAt, map[string]interface{}{"reason": gateResult.ReasonCode, "mode": gateResult.Mode}, nil)
		trace.Finish("success", nil)
		return
	}
	currentContext, contextErr := buildCurrentMeetingContext(ctx, eid, fileID, generation)
	if contextErr != nil {
		// Keep the generation usable for legacy minutes, but make the degraded
		// context explicit instead of silently pretending the snapshot exists.
		logger.Warnf(ctx, "【洞察-当前会议快照】构建失败，降级为兼容召回 fileID=%d err=%v", fileID, contextErr)
	} else if verifyErr := currentContext.VerifyCurrentMinutes(eid, fileID); verifyErr != nil {
		logger.Warnf(ctx, "【洞察-当前会议快照】检测到纪要版本变化，放弃旧快照 fileID=%d err=%v", fileID, verifyErr)
		currentContext = nil
	}

	readiness, memoryErr := ensureRecordingMemoryReady(ctx, eid, fileID, userID)
	if memoryErr != nil {
		logger.Warnf(ctx, "【洞察-记忆就绪】失败，继续使用可用降级上下文 fileID=%d err=%v", fileID, memoryErr)
	}
	memCfg := config.MemoryExtraction
	if memCfg == nil {
		memCfg = &model.MemoryExtractionConfig{Enabled: true, Types: []string{model.EntityTypePerson, model.EntityTypeMatter, model.EntityTypeCommitment}}
	}
	decisionContext, decisionContextErr := BuildRecordingDecisionContext(ctx, eid, userID, fileID, generation, memCfg, currentContext)
	var cognitionContext *RecordingCognitionContextPackage
	var historyRows []historyMeeting
	if decisionContextErr != nil {
		logger.Warnf(ctx, "【洞察-决策上下文】构建失败，继续使用兼容上下文 fileID=%d err=%v", fileID, decisionContextErr)
	} else {
		currentContext = decisionContext.Current
		cognitionContext = decisionContext.Cognitions
		historyRows = decisionContext.History
		// Memory V2 只做异步 shadow 对照，不参与当前洞察 Prompt，不阻塞主链路。
		if recordingMemoryV2ShadowEnabled() {
			go func(snapshot *CurrentMeetingContext) {
				shadowCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				defer cancel()
				if _, shadowErr := RunRecordingMemoryV2ShadowEvaluation(shadowCtx, eid, userID, fileID, generation, memCfg, snapshot); shadowErr != nil {
					logger.Warnf(context.Background(), "【Memory V2 shadow】评估失败，保留当前结构化记忆主链路 fileID=%d err=%v", fileID, shadowErr)
				}
			}(currentContext)
		} else {
			logger.Infof(ctx, "【Memory V2 shadow】灰度开关关闭，跳过新评估 fileID=%d", fileID)
		}
	}
	contextStatus := "success"
	if memoryErr != nil || decisionContextErr != nil {
		contextStatus = "degraded"
	}
	recordingdebug.RecordStage(ctx, "insight_context", "当前会议与决策上下文", contextStatus, insightStartedAt, map[string]interface{}{
		"current_context":        currentContext != nil,
		"memory_ready":           memoryErr == nil,
		"memory_readiness":       readiness,
		"memory_error":           errorString(memoryErr),
		"decision_context_ready": decisionContextErr == nil,
		"decision_context_error": errorString(decisionContextErr),
		"history_count":          len(historyRows),
	}, nil)
	requestedPerspective := model.NormalizeInsightPerspective(file.InsightPerspective)
	perspective := requestedPerspective
	profile := insightPromptProfileFor(perspective)

	personal := loadInsightPersonalContext(ctx, eid, userID, fileID)

	// 查询企业信息
	enterprise, _ := model.GetEnterpriseByID(eid)

	setInsightsStatusIfCurrent(eid, fileID, generation, "processing")
	if markErr := markInsightPageFormatIfCurrent(ctx, eid, fileID, generation, insightPageHTMLFormat); markErr != nil {
		if errors.Is(markErr, ErrInsightGenerationStale) {
			logger.Infof(ctx, "【洞察】检测到更新的生成版本，跳过旧任务 fileID=%d generation=%d", fileID, generation)
			recordingdebug.RecordStage(ctx, "insights", "决策洞察生成", "skipped", insightStartedAt, map[string]interface{}{"reason": "stale_generation"}, nil)
			trace.Finish("skipped", nil)
			return
		}
		logger.Errorf(ctx, "【洞察】保存页面格式标记失败 fileID=%d generation=%d err=%v", fileID, generation, markErr)
		setInsightsStatusIfCurrent(eid, fileID, generation, "failed")
		recordingdebug.RecordStage(ctx, "insights", "决策洞察生成", "failed", insightStartedAt, map[string]interface{}{"reason": "page_format_marker"}, markErr)
		trace.Finish("failed", markErr)
		return
	}
	// 上报 Keystone 阶段开始
	if client := keystone.GlobalClient; client != nil {
		client.ReportTaskStageStarted(keystone.TaskEvent{
			ExternalTaskID: fmt.Sprintf("recording-%d", fileID),
			TaskType:       "RECORDING_PIPELINE",
			StageKey:       "insights",
			ServiceKey:     "recording-pipeline",
		})
	}
	startTime := time.Now()

	// 1. 所有内置视角都以本次录音生成的纪要为主要材料；原始转写在后面作为证据补充。
	primaryMaterial, err := loadInsightPrimaryMaterial(ctx, eid, fileID, profile)
	if err != nil {
		recordingdebug.RecordStage(ctx, "insight_material", "读取洞察主要材料", "failed", insightStartedAt, map[string]interface{}{"perspective": perspective}, err)
		logger.Errorf(ctx, "【洞察】读取主要材料失败 fileID=%d perspective=%s err=%v", fileID, perspective, err)
		setInsightsStatusIfCurrent(eid, fileID, generation, "failed")
		trace.Finish("failed", err)
		return
	}
	recordingdebug.RecordStage(ctx, "insight_material", "读取洞察主要材料", "success", insightStartedAt, map[string]interface{}{
		"perspective":       perspective,
		"requested":         requestedPerspective,
		"primary_chars":     len([]rune(primaryMaterial)),
		"source_is_primary": profile.SourceIsPrimaryText,
	}, nil)

	var perspectiveResolution *insightPerspectiveResolution
	// 视角未设置时，只有企业显式开启多视角才调用一次分类器；分类失败安全回退为管理例会。
	if requestedPerspective == model.InsightPerspectiveAuto {
		resolved := resolveInsightPerspective(ctx, config, insightSourceTitle(file.Path), primaryMaterial)
		perspectiveResolution = &resolved
		perspective = resolved.Perspective
		profile = insightPromptProfileFor(perspective)
		logger.Infof(ctx, "【洞察】自动场景解析完成 fileID=%d perspective=%s enabled=%v", fileID, perspective, config.MultiPerspectiveEnabled)
	}
	if perspectiveResolution != nil {
		recordingdebug.RecordStage(ctx, "insight_perspective", "自动判断洞察视角", "success", insightStartedAt, map[string]interface{}{
			"requested":    requestedPerspective,
			"resolved":     perspectiveResolution.Perspective,
			"confidence":   perspectiveResolution.Confidence,
			"reason_codes": perspectiveResolution.ReasonCodes,
			"evidence":     perspectiveResolution.Evidence,
			"abstained":    perspectiveResolution.Abstained,
		}, nil)
	}

	// 构建视角化增强 Prompt。最终洞察请求仍会注入个人信息、公司信息和历史记忆。
	enrichedPrompt := buildEnrichedPrompt(enterprise, personal.User, personal.Position, personal.Style, personal.CustomMemory, buildInsightSystemPrompt(perspective))
	if cognitionContext == nil {
		var cognitionErr error
		cognitionContext, cognitionErr = LoadApplicableRecordingCognition(ctx, eid, userID, currentContext)
		if cognitionErr != nil {
			logger.Warnf(ctx, "【洞察-老板认知】加载适用认知失败，继续使用无认知上下文: fileID=%d err=%v", fileID, cognitionErr)
		}
	}
	if recordingDecisionRuntimeContextEnabled() && decisionContext != nil {
		if audit, auditErr := BuildRecordingDecisionContextAuditPackage(eid, userID, fileID, decisionContext); auditErr == nil {
			query := recordingEnterpriseKnowledgeQuery(currentContext)
			libraryIDs, scopeErr := recordingEnterpriseKnowledgeLibraryIDsFromEnv()
			if reason := enterpriseKnowledgeDegradationReason(recordingEnterpriseKnowledgeEnabled(), libraryIDs, scopeErr, query); reason != "" {
				audit.OmittedReasons = appendUniqueStrings(audit.OmittedReasons, reason)
				if scopeErr != nil {
					logger.Warnf(ctx, "【洞察-企业知识】scope配置无效，跳过检索 fileID=%d err=%v", fileID, scopeErr)
				}
			} else {
				candidates, omitted, searchErr := SearchRecordingEnterpriseKnowledge(ctx, RecordingEnterpriseKnowledgeSearchRequest{EID: eid, UserID: userID, Query: query, LibraryIDs: libraryIDs, TopK: 5})
				audit.OmittedReasons = appendUniqueStrings(audit.OmittedReasons, omitted...)
				if searchErr == nil {
					if appendErr := AppendEnterpriseKnowledgeCandidates(audit, candidates); appendErr != nil {
						audit.OmittedReasons = appendUniqueStrings(audit.OmittedReasons, "enterprise_knowledge_adapt_failed")
						logger.Warnf(ctx, "【洞察-企业知识】结果适配失败 fileID=%d err=%v", fileID, appendErr)
					}
				} else {
					audit.OmittedReasons = appendUniqueStrings(audit.OmittedReasons, "enterprise_knowledge_search_failed")
				}
			}
			if runtime, runtimeErr := CompileRecordingDecisionRuntimeContext(audit); runtimeErr == nil {
				enrichedPrompt += "\n\n" + FormatRecordingDecisionRuntimeContext(runtime)
				logger.Infof(ctx, "【洞察-决策Runtime】已启用四源运行时上下文 fileID=%d items=%d", fileID, len(audit.Items))
			} else {
				decisionContext.Public.OmittedReasons = appendUniqueStrings(decisionContext.Public.OmittedReasons, "decision_runtime_compile_failed")
				logger.Warnf(ctx, "【洞察-决策Runtime】编译失败，回退兼容认知上下文 fileID=%d err=%v", fileID, runtimeErr)
			}
		} else {
			logger.Warnf(ctx, "【洞察-决策Runtime】审计包构建失败，回退兼容认知上下文 fileID=%d err=%v", fileID, auditErr)
		}
	} else if cognitionPrompt := FormatRecordingCognitionContext(cognitionContext); cognitionPrompt != "" {
		enrichedPrompt += "\n\n" + cognitionPrompt
	}
	// 用户在协同研讨中确认的背景作为本次生成的高优先级补充上下文注入，
	// 不修改全局用户/企业资料，避免一次文件级修订意外影响其它录音。
	// 个人/企业信息已由 buildEnrichedPrompt 实时注入，快照只携带用户补充说明。
	if saved, ok := loadSavedInsightBackground(file.InsightContext); ok {
		enrichedPrompt += "\n\n" + formatInsightBackgroundPrompt(saved, mustLoadMinutesText(eid, fileID))
	}
	if outputInstruction := insightGateOutputInstruction(gateResult.Mode); outputInstruction != "" {
		enrichedPrompt += "\n\n" + outputInstruction
	}

	// 2. Context Builder 失败时回退到历史数据查询。
	if decisionContext == nil {
		historyRows = loadRelatedInsightHistoryWithContext(ctx, eid, fileID, userID, memCfg, currentContext)
	}

	// 3. 计算转写预算并压缩转写
	// 3.1 计算非转写输入 token 占用
	ctxBudget := getRecordingContextBudget(ctx, config)
	promptHistoryRows := historyRows
	if recordingDecisionRuntimeContextEnabled() && decisionContext != nil {
		// Runtime Context is the sole business-memory envelope in the gray path;
		// do not inject the legacy historical_context copy a second time.
		promptHistoryRows = nil
		logger.Infof(ctx, "【洞察-决策Runtime】跳过重复 historical_context fileID=%d", fileID)
	}
	historyStr := buildHistoricalContext(promptHistoryRows)
	recordingdebug.RecordStage(ctx, "insight_history", "加载历史关联会议", "success", insightStartedAt, map[string]interface{}{
		"meeting_count":        len(historyRows),
		"prompt_row_count":     len(promptHistoryRows),
		"history_chars":        len([]rune(historyStr)),
		"runtime_context_used": recordingDecisionRuntimeContextEnabled() && decisionContext != nil,
	}, nil)
	systemPromptTokens := estimateTokens(enrichedPrompt)
	primaryTokens := estimateTokens(primaryMaterial)
	historyTokens := estimateTokens(historyStr)
	outputReserve := 4096
	safetyMargin := 500

	fixedInputTokens := systemPromptTokens + historyTokens
	if !profile.SourceIsPrimaryText {
		fixedInputTokens += primaryTokens
	}
	availableInputBudget := ctxBudget - fixedInputTokens - outputReserve - safetyMargin
	if availableInputBudget < 1000 {
		logger.Errorf(ctx, "【洞察】视角输入预算不足: budget=%d perspective=%s", availableInputBudget, perspective)
		setInsightsStatusIfCurrent(eid, fileID, generation, "failed")
		recordingdebug.RecordStage(ctx, "insight_budget", "计算洞察输入预算", "failed", insightStartedAt, map[string]interface{}{
			"context_budget":         ctxBudget,
			"available_input_budget": availableInputBudget,
			"fixed_input_tokens":     fixedInputTokens,
		}, nil)
		trace.Finish("failed", fmt.Errorf("洞察输入预算不足: %d", availableInputBudget))
		return
	}
	recordingdebug.RecordStage(ctx, "insight_budget", "计算洞察输入预算", "success", insightStartedAt, map[string]interface{}{
		"context_budget":         ctxBudget,
		"available_input_budget": availableInputBudget,
		"fixed_input_tokens":     fixedInputTokens,
		"output_reserve":         outputReserve,
	}, nil)

	// 3.2 通过统一压缩方案获取精炼的转写或主要正文。
	rawMaterial := ""
	if profile.SourceIsPrimaryText {
		rawMaterial = primaryMaterial
	}
	prepared, err := getOrCompressTranscript(ctx, TranscriptPrepareRequest{
		EID:                eid,
		FileID:             fileID,
		Consumer:           "insights",
		ContextLength:      ctxBudget,
		FixedInputTokens:   fixedInputTokens,
		MaxOutputTokens:    outputReserve,
		SafetyMargin:       safetyMargin,
		Mode:               "strict",
		RawText:            rawMaterial,
		InferenceModelID:   config.InferenceModelID,
		InferenceModelName: config.InferenceModelName,
	})
	if err != nil {
		recordingdebug.RecordStage(ctx, "insight_compress", "洞察输入压缩", "failed", insightStartedAt, map[string]interface{}{}, err)
		logger.Errorf(ctx, "【洞察】转写压缩失败 fileID=%d err=%v", fileID, err)
		setInsightsStatusIfCurrent(eid, fileID, generation, "failed")
		trace.Finish("failed", err)
		return
	}
	recordingdebug.RecordStage(ctx, "insight_compress", "洞察输入压缩", "success", insightStartedAt, map[string]interface{}{
		"input_kind":         prepared.InputKind,
		"source_tokens":      prepared.SourceTokens,
		"result_tokens":      prepared.ResultTokens,
		"cache_hit":          prepared.CacheHit,
		"compression_rounds": prepared.CompressionRounds,
		"degraded":           prepared.Degraded,
	}, nil)
	logger.Infof(ctx, "【洞察】转写压缩完成 fileID=%d inputKind=%s sourceTokens=%d resultTokens=%d cacheHit=%v degraded=%v",
		fileID, prepared.InputKind, prepared.SourceTokens, prepared.ResultTokens, prepared.CacheHit, prepared.Degraded)
	transcriptText := prepared.Text
	if profile.SourceIsPrimaryText {
		primaryMaterial = prepared.Text
		transcriptText = ""
	}

	// 4. 调用视角化 Prompt 生成洞察
	result, err := callInsightsLLMForPerspective(ctx, config, fileID, perspective, insightSourceTitle(file.Path), transcriptText, primaryMaterial, promptHistoryRows, enrichedPrompt)
	if err != nil {
		if !isInsightGenerationCurrent(eid, fileID, generation) {
			recordingdebug.RecordStage(ctx, "insights", "决策洞察生成", "skipped", insightStartedAt, map[string]interface{}{"reason": "stale_generation"}, nil)
			trace.Finish("skipped", nil)
			return
		}
		recordingdebug.RecordStage(ctx, "insights_llm", "Prompt 4 生成决策洞察", "failed", insightStartedAt, map[string]interface{}{"perspective": perspective}, err)
		logger.Errorf(ctx, "【洞察】生成失败 fileID=%d err=%v", fileID, err)
		// 提取 LLM 错误类型
		errorType := model.ErrorTypeModelUnavailable
		var llmErr *model.LLMError
		if errors.As(err, &llmErr) {
			errorType = llmErr.ErrorType
		}
		if client := keystone.GlobalClient; client != nil {
			client.ReportTaskStageCompleted(keystone.TaskEvent{
				ExternalTaskID: fmt.Sprintf("recording-%d", fileID),
				TaskType:       "RECORDING_PIPELINE",
				StageKey:       "insights",
				StageStatus:    keystone.TaskStatusFailed,
				FailureCode:    "INSIGHTS_FAILED",
				ServiceKey:     "recording-pipeline",
				FinishedAt:     time.Now().UTC(),
			})
		}
		model.SetInsightsStatus(fileID, "failed", err.Error(), errorType)
		trace.Finish("failed", err)
		return
	}
	recordingdebug.RecordStage(ctx, "insights_llm", "Prompt 4 生成决策洞察", "success", insightStartedAt, map[string]interface{}{
		"perspective":  perspective,
		"result_chars": len([]rune(result)),
	}, nil)

	// 5. 写入 file.insight_summary。将生成版本放进 UPDATE 条件，
	// 即使用户在检查后立即确认新背景，旧结果也无法覆盖新一代洞察。
	resolution := insightPerspectiveResolution{Perspective: perspective}
	if perspectiveResolution != nil {
		resolution = *perspectiveResolution
	}
	insightContext, contextErr := withResolvedInsightPerspective(file.InsightContext, resolution)
	if contextErr != nil {
		logger.Warnf(ctx, "【洞察】保存实际场景失败 fileID=%d perspective=%s err=%v", fileID, perspective, contextErr)
	}
	updates := map[string]interface{}{"insight_summary": result}
	if contextErr == nil {
		updates["insight_context"] = insightContext
	}
	updateResult := model.DB.WithContext(ctx).Model(&model.File{}).
		Where("id = ? AND eid = ? AND insight_generation = ?", fileID, eid, generation).
		Updates(updates)
	if updateResult.Error != nil {
		recordingdebug.RecordStage(ctx, "insights_persist", "保存决策洞察", "failed", insightStartedAt, map[string]interface{}{"generation": generation}, updateResult.Error)
		logger.Errorf(ctx, "【洞察】保存失败 fileID=%d err=%v", fileID, updateResult.Error)
		setInsightsStatusIfCurrent(eid, fileID, generation, "failed")
		trace.Finish("failed", updateResult.Error)
		return
	}
	if updateResult.RowsAffected != 1 {
		logger.Infof(ctx, "【洞察】检测到更新的生成版本，丢弃旧结果 fileID=%d generation=%d", fileID, generation)
		recordingdebug.RecordStage(ctx, "insights", "决策洞察生成", "skipped", insightStartedAt, map[string]interface{}{"reason": "stale_generation"}, nil)
		trace.Finish("skipped", nil)
		return
	}
	recordingdebug.RecordStage(ctx, "insights_persist", "保存决策洞察", "success", insightStartedAt, map[string]interface{}{
		"generation":   generation,
		"result_chars": len([]rune(result)),
	}, nil)

	elapsed := time.Since(startTime)
	logger.Infof(ctx, "【洞察】生成成功 fileID=%d elapsed=%v history=%d", fileID, elapsed, len(historyRows))
	// 上报 Keystone 阶段成功
	if client := keystone.GlobalClient; client != nil {
		client.ReportTaskStageCompleted(keystone.TaskEvent{
			ExternalTaskID: fmt.Sprintf("recording-%d", fileID),
			TaskType:       "RECORDING_PIPELINE",
			StageKey:       "insights",
			StageStatus:    keystone.TaskStatusSucceeded,
			ServiceKey:     "recording-pipeline",
			FinishedAt:     time.Now().UTC(),
		})
	}
	setInsightsStatusIfCurrent(eid, fileID, generation, "completed")

	// 6. 调用 Prompt 5 生成决策页面编排（跟随当前 Worker 执行槽位，避免脱离限流）
	pageCtx, pageCancel := context.WithTimeout(recordingPipelineCtx, 5*time.Minute)
	defer pageCancel()
	generateInsightPageForGeneration(recordingdebug.WithTrace(pageCtx, trace), eid, fileID, config, result, historyRows, generation)
	trace.Finish("success", nil)
}

// generateInsightPage 调用 Prompt 5 将洞察结果编排为动态决策页面。
func generateInsightPage(ctx context.Context, eid, fileID int64, config *model.RecordingConfig, insightMarkdown string) {
	generation := int64(0)
	if file, err := model.GetFileByIDOlny(fileID); err == nil && file != nil {
		generation = file.InsightGeneration
	}
	generateInsightPageForGeneration(ctx, eid, fileID, config, insightMarkdown, nil, generation)
}

func generateInsightPageForGeneration(ctx context.Context, eid, fileID int64, config *model.RecordingConfig, insightMarkdown string, historyRows []historyMeeting, generation int64) {
	pageStartedAt := time.Now()
	recordingdebug.RecordStage(ctx, "insight_page", "决策页面编排", "processing", pageStartedAt, map[string]interface{}{"generation": generation}, nil)
	if !isInsightGenerationCurrent(eid, fileID, generation) {
		logger.Infof(ctx, "【页面】检测到更新的生成版本，跳过旧页面 fileID=%d generation=%d", fileID, generation)
		recordingdebug.RecordStage(ctx, "insight_page", "决策页面编排", "skipped", pageStartedAt, map[string]interface{}{"reason": "stale_generation"}, nil)
		return
	}
	if isInsightGenerationCurrent(eid, fileID, generation) {
		setInsightPageStatus(fileID, "processing")
		// 上报 Keystone 阶段开始
		if client := keystone.GlobalClient; client != nil {
			client.ReportTaskStageStarted(keystone.TaskEvent{
				ExternalTaskID: fmt.Sprintf("recording-%d", fileID),
				TaskType:       "RECORDING_PIPELINE",
				StageKey:       "insight_page",
				ServiceKey:     "recording-pipeline",
			})
		}
	} else {
		recordingdebug.RecordStage(ctx, "insight_page", "决策页面编排", "skipped", pageStartedAt, map[string]interface{}{"reason": "stale_generation"}, nil)
		return
	}

	pageHTML, err := callPageLayoutLLM(ctx, config, fileID, insightMarkdown, buildInsightCitationContext(historyRows))
	if err != nil {
		if !isInsightGenerationCurrent(eid, fileID, generation) {
			return
		}
		recordingdebug.RecordStage(ctx, "insight_page_llm", "Prompt 5 编排决策页面", "failed", pageStartedAt, map[string]interface{}{}, err)
		logger.Warnf(ctx, "【页面】编排失败: fileID=%d err=%v", fileID, err)
		if client := keystone.GlobalClient; client != nil {
			client.ReportTaskStageCompleted(keystone.TaskEvent{
				ExternalTaskID: fmt.Sprintf("recording-%d", fileID),
				TaskType:       "RECORDING_PIPELINE",
				StageKey:       "insight_page",
				StageStatus:    keystone.TaskStatusFailed,
				FailureCode:    "INSIGHT_PAGE_FAILED",
				ServiceKey:     "recording-pipeline",
				FinishedAt:     time.Now().UTC(),
			})
		}
		setInsightPageStatus(fileID, "failed")
		return
	}
	recordingdebug.RecordStage(ctx, "insight_page_llm", "Prompt 5 编排决策页面", "success", pageStartedAt, map[string]interface{}{"html_chars": len([]rune(pageHTML))}, nil)

	if !isInsightGenerationCurrent(eid, fileID, generation) {
		logger.Infof(ctx, "【页面】检测到更新的生成版本，跳过旧页面 fileID=%d generation=%d", fileID, generation)
		recordingdebug.RecordStage(ctx, "insight_page", "决策页面编排", "skipped", pageStartedAt, map[string]interface{}{"reason": "stale_generation"}, nil)
		return
	}
	pageJSON, err := encodeInsightHTMLPage(pageHTML, insightMarkdown)
	if err != nil {
		if isInsightGenerationCurrent(eid, fileID, generation) {
			logger.Warnf(ctx, "【页面】HTML 校验失败: fileID=%d err=%v", fileID, err)
			setInsightPageStatus(fileID, "failed")
		}
		recordingdebug.RecordStage(ctx, "insight_page_persist", "校验决策页面", "failed", pageStartedAt, map[string]interface{}{}, err)
		return
	}
	if err := upsertInsightPageIfCurrent(eid, fileID, generation, pageJSON); err != nil {
		if errors.Is(err, ErrInsightGenerationStale) {
			logger.Infof(ctx, "【页面】检测到更新的生成版本，跳过旧页面 fileID=%d generation=%d", fileID, generation)
			return
		}
		logger.Errorf(ctx, "【页面】保存失败 fileID=%d err=%v", fileID, err)
		if isInsightGenerationCurrent(eid, fileID, generation) {
			setInsightPageStatus(fileID, "failed")
		}
		recordingdebug.RecordStage(ctx, "insight_page_persist", "保存决策页面", "failed", pageStartedAt, map[string]interface{}{}, err)
		return
	}
	recordingdebug.RecordStage(ctx, "insight_page_persist", "保存决策页面", "success", pageStartedAt, map[string]interface{}{"page_chars": len([]rune(pageJSON))}, nil)

	logger.Infof(ctx, "【页面】编排成功 fileID=%d", fileID)
	// 上报 Keystone 阶段成功
	if client := keystone.GlobalClient; client != nil {
		client.ReportTaskStageCompleted(keystone.TaskEvent{
			ExternalTaskID: fmt.Sprintf("recording-%d", fileID),
			TaskType:       "RECORDING_PIPELINE",
			StageKey:       "insight_page",
			StageStatus:    keystone.TaskStatusSucceeded,
			ServiceKey:     "recording-pipeline",
			FinishedAt:     time.Now().UTC(),
		})
	}
	if isInsightGenerationCurrent(eid, fileID, generation) {
		setInsightPageStatus(fileID, "completed")
	}
	recordingdebug.RecordStage(ctx, "insight_page", "决策页面编排", "success", pageStartedAt, map[string]interface{}{
		"elapsed_ms": time.Since(pageStartedAt).Milliseconds(),
	}, nil)
}

// loadMeetingMinutesText 读取纪要并渲染为 Markdown（双模式：已反转读 FileBody，未反转读 Summary(0)）。
func loadMeetingMinutesText(ctx context.Context, eid, fileID int64) (string, error) {
	return loadMinutesText(eid, fileID)
}

func loadInsightPrimaryMaterial(ctx context.Context, eid, fileID int64, profile insightPromptProfile) (string, error) {
	if profile.SourceIsPrimaryText {
		fileBody, err := model.GetLastFileBodyByFileID(eid, fileID)
		if err == nil && fileBody != nil {
			content, contentErr := fileBody.GetContent()
			if contentErr == nil && strings.TrimSpace(content) != "" {
				return content, nil
			}
		}
	}
	return loadMeetingMinutesText(ctx, eid, fileID)
}

func insightSourceTitle(filePath string) string {
	title := strings.TrimSpace(path.Base(strings.TrimSpace(filePath)))
	for strings.Contains(title, ".") {
		ext := path.Ext(title)
		if ext == "" {
			break
		}
		title = strings.TrimSuffix(title, ext)
		if ext != ".md" && ext != ".markdown" {
			break
		}
	}
	return strings.TrimSpace(title)
}

// callInsightsLLM 调用 Prompt 4 生成洞察（带重试）。
func callInsightsLLM(ctx context.Context, config *model.RecordingConfig, fileID int64, transcriptText, summaryMarkdown string, historyRows []historyMeeting, enrichedPrompt string) (string, error) {
	return callInsightsLLMForPerspective(ctx, config, fileID, model.DefaultInsightPerspective, "", transcriptText, summaryMarkdown, historyRows, enrichedPrompt)
}

func callInsightsLLMForPerspective(ctx context.Context, config *model.RecordingConfig, fileID int64, perspective model.InsightPerspective, sourceTitle, transcriptText, primaryMaterial string, historyRows []historyMeeting, enrichedPrompt string) (string, error) {
	historicalContext := buildHistoricalContext(historyRows)

	buildRequest := func() *relaymodel.GeneralOpenAIRequest {
		userPrompt := buildInsightUserPrompt(perspective, sourceTitle, historicalContext, primaryMaterial, transcriptText)

		return &relaymodel.GeneralOpenAIRequest{
			Model:     config.InferenceModelName,
			MaxTokens: 0,
			Messages: []relaymodel.Message{
				{Role: "system", Content: enrichedPrompt},
				{Role: "user", Content: userPrompt},
			},
		}
	}

	return callLLMWithRetry(recordingdebug.WithLLMStage(ctx, recordingdebug.LLMStage(ctx, "insights_llm")), config, buildRequest)
}

// buildInsightsUserPrompt 构建 Prompt 4 的五段输入中的历史相关信息、纪要和转写部分。
// 个人信息和公司信息由 system prompt 中的独立标签注入。
func buildInsightsUserPrompt(historicalContext, summaryMarkdown, transcriptText string) string {
	return buildInsightUserPrompt(model.DefaultInsightPerspective, "", historicalContext, summaryMarkdown, transcriptText)
}

func buildInsightUserPrompt(perspective model.InsightPerspective, sourceTitle, historicalContext, primaryMaterial, transcriptText string) string {
	profile := insightPromptProfileFor(perspective)
	titleBlock := ""
	if strings.TrimSpace(sourceTitle) != "" {
		titleBlock = fmt.Sprintf("\n<source_title>\n%s\n</source_title>\n", sourceTitle)
	}

	return fmt.Sprintf(`请根据下面的%s生成决策洞察。使用 Markdown 输出，先保证视角匹配、事实依据、风险与行动内容的质量；不要输出 JSON 或页面结构。
%s
<related_history>
%s
</related_history>

<%s>
%s
</%s>

<transcription>
%s
</transcription>`, profile.SourceName, titleBlock, historicalContext, profile.SourceTag, primaryMaterial, profile.SourceTag, transcriptText)
}

// buildHistoricalContext 构建 historical_context JSON，只包含历史纪要，不包含历史洞察。
func buildHistoricalContext(rows []historyMeeting) string {
	if len(rows) == 0 {
		return `{"related_meetings":[]}`
	}

	var meetings []string
	var memories []string
	refIndex := 0
	for _, r := range rows {
		// 已有结构化记忆时只发送压缩后的 Claim；没有编译结果时才发送整篇纪要 fallback，
		// 避免同一会议的旧纪要与记忆重复占用上下文。
		if len(r.Memories) == 0 && strings.TrimSpace(r.Minutes) != "" {
			escapedMinutes, _ := json.Marshal(r.Minutes)
			meeting := fmt.Sprintf(`{"file_id":%d,"title":%s,"minutes":%s}`,
				r.FileID, jsonMarshal(r.Title), string(escapedMinutes))
			meetings = append(meetings, meeting)
		}
		for _, memory := range r.Memories {
			refIndex++
			memories = append(memories, fmt.Sprintf(
				`{"memory_ref":"M-%d","type":%s,"content":%s,"recall_reason":%s,"assertion_state":%s,"lifecycle_state":%s,"review_state":%s,"source_file":%s,"confidence":%.4f,"evidence_available":%t,"source_level":"L3","allowed_usage":"evidence","source_segment_ids":%s,"recall_path":%s,"structured_links":%s}`,
				refIndex,
				jsonMarshal(memory.Kind),
				jsonMarshal(memory.Content),
				jsonMarshal(memory.RecallReason),
				jsonMarshal(memory.AssertionState),
				jsonMarshal(memory.LifecycleState),
				jsonMarshal(memory.ReviewState),
				jsonMarshal(memory.SourceFile),
				memory.SourceConfidence,
				memory.EvidenceAvailable,
				jsonMarshal(memory.SourceSegmentIDs),
				jsonMarshal(memory.RecallPath),
				jsonOrEmptyObject(memory.StructuredLinks),
			))
		}
	}

	if len(memories) == 0 {
		return fmt.Sprintf(`{"related_meetings":[%s]}`,
			strings.Join(meetings, ","))
	}
	return fmt.Sprintf(`{"related_memories":[%s],"related_meetings":[%s]}`,
		strings.Join(memories, ","), strings.Join(meetings, ","))
}

// jsonOrEmptyObject returns a validated JSON object for fields that are
// embedded into the historical context object. Invalid or non-object values
// are deliberately downgraded to an empty object instead of breaking the
// whole prompt payload.
func jsonOrEmptyObject(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || !json.Valid([]byte(raw)) || !strings.HasPrefix(raw, "{") {
		return "{}"
	}
	return raw
}

// buildEnrichedPrompt 构建带用户上下文和公司信息的增强 Prompt。
// 空字段不输出，整块为空时整块不输出。
func buildEnrichedPrompt(enterprise *model.Enterprise, user *model.User, position, style, customMemory, basePrompt string) string {
	var sb strings.Builder

	// 个人信息块
	var personalFields []string
	if user != nil && user.Nickname != "" {
		personalFields = append(personalFields, fmt.Sprintf(`    "nickname": "%s"`, escapeJSON(user.Nickname)))
	}
	if user != nil && len(user.Departments) > 0 && user.Departments[0].Name != "" {
		personalFields = append(personalFields, fmt.Sprintf(`    "department": "%s"`, escapeJSON(user.Departments[0].Name)))
	}
	if position != "" {
		personalFields = append(personalFields, fmt.Sprintf(`    "position": "%s"`, escapeJSON(position)))
	}
	if style != "" {
		personalFields = append(personalFields, fmt.Sprintf(`    "preferred_style": "%s"`, escapeJSON(style)))
	}
	if customMemory != "" {
		personalFields = append(personalFields, fmt.Sprintf(`    "custom_memory": "%s"`, escapeJSON(strings.TrimSpace(customMemory))))
	}

	// 公司信息块
	var companyFields []string
	if enterprise != nil && enterprise.FullName != "" {
		companyFields = append(companyFields, fmt.Sprintf(`    "name": "%s"`, escapeJSON(enterprise.FullName)))
	}
	if enterprise != nil && enterprise.DisplayName != "" {
		companyFields = append(companyFields, fmt.Sprintf(`    "short_name": "%s"`, escapeJSON(enterprise.DisplayName)))
	}
	if enterprise != nil && enterprise.Industry != "" {
		companyFields = append(companyFields, fmt.Sprintf(`    "industry": "%s"`, escapeJSON(enterprise.Industry)))
	}
	if enterprise != nil && enterprise.Description != "" {
		companyFields = append(companyFields, fmt.Sprintf(`    "description": "%s"`, escapeJSON(enterprise.Description)))
	}
	if enterprise != nil && enterprise.Keywords != "" {
		companyFields = append(companyFields, fmt.Sprintf(`    "keywords": "%s"`, escapeJSON(enterprise.Keywords)))
	}
	if enterprise != nil && enterprise.Type != "" {
		companyFields = append(companyFields, fmt.Sprintf(`    "type": "%s"`, escapeJSON(enterprise.Type)))
	}
	if enterprise != nil && enterprise.Slogan != "" {
		companyFields = append(companyFields, fmt.Sprintf(`    "slogan": "%s"`, escapeJSON(enterprise.Slogan)))
	}

	// 如果两个块都为空，不输出个人或公司上下文
	if len(personalFields) == 0 && len(companyFields) == 0 {
		return basePrompt
	}

	if len(personalFields) > 0 {
		sb.WriteString("<personal_info>\n{\n")
		for i, f := range personalFields {
			sb.WriteString(f)
			if i < len(personalFields)-1 {
				sb.WriteString(",")
			}
			sb.WriteString("\n")
		}
		sb.WriteString("}\n</personal_info>\n\n")
	}

	if len(companyFields) > 0 {
		sb.WriteString("<company_info>\n{\n")
		for i, f := range companyFields {
			sb.WriteString(f)
			if i < len(companyFields)-1 {
				sb.WriteString(",")
			}
			sb.WriteString("\n")
		}
		sb.WriteString("}\n</company_info>\n\n")
	}

	sb.WriteString(basePrompt)
	return sb.String()
}

func formatMemoryFacts(items []model.MemoryItem) string {
	facts := make([]string, 0, len(items))
	for _, item := range items {
		if fact := strings.TrimSpace(item.Fact); fact != "" {
			facts = append(facts, fact)
		}
	}
	return strings.Join(facts, "\n")
}

// escapeJSON 转义 JSON 字符串中的特殊字符
func escapeJSON(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "\"", "\\\"")
	s = strings.ReplaceAll(s, "\n", "\\n")
	s = strings.ReplaceAll(s, "\r", "\\r")
	s = strings.ReplaceAll(s, "\t", "\\t")
	return s
}

func jsonMarshal(v interface{}) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// callPageLayoutLLM 调用 Prompt 5 将洞察结果转换为完整 HTML 页面（带重试）。
func callPageLayoutLLM(ctx context.Context, config *model.RecordingConfig, fileID int64, insightMarkdown, citationContext string) (string, error) {
	buildRequest := func(formatRetry bool) *relaymodel.GeneralOpenAIRequest {
		formatInstruction := "严格按照系统要求输出。"
		if formatRetry {
			formatInstruction = "上一次响应未通过 HTML 格式校验。请重新输出同一份内容，只返回从 <!doctype html> 到 </html> 的 HTML 文档本身，不得包含代码围栏、前后解释、JSON 或任何其他文字。"
		}
		userPrompt := fmt.Sprintf(`请将以下《决策洞察》转换为完整的独立 HTML 页面。只做忠实编排，不得改变任何判断、事实、行动或表述。

<decision_analysis>
%s
</decision_analysis>

<memory_citations>
%s
</memory_citations>

页面偏好：

<render_preferences>
{
  "language": "zh-CN",
  "mobile_long_image": true
}
</render_preferences>

%s`, insightMarkdown, citationContext, formatInstruction)

		return &relaymodel.GeneralOpenAIRequest{
			Model:     config.InferenceModelName,
			MaxTokens: 0,
			Messages: []relaymodel.Message{
				{Role: "system", Content: prompt5SystemPrompt},
				{Role: "user", Content: userPrompt},
			},
		}
	}

	llmCtx := recordingdebug.WithLLMStage(ctx, recordingdebug.LLMStage(ctx, "insight_page_llm"))
	var formatErr error
	for attempt := 0; attempt < 2; attempt++ {
		rawHTML, err := callLLMWithRetry(llmCtx, config, func() *relaymodel.GeneralOpenAIRequest {
			return buildRequest(attempt > 0)
		})
		if err != nil {
			return "", err
		}
		html, err := normalizeInsightHTML(rawHTML)
		if err == nil {
			return html, nil
		}
		formatErr = err
		if attempt == 0 {
			logger.Warnf(ctx, "【页面】Prompt 5 输出格式校验失败，准备格式重试 fileID=%d err=%v", fileID, err)
		}
	}
	return "", fmt.Errorf("Prompt 5 输出 HTML 校验失败: %w", formatErr)
}

func buildInsightCitationContext(rows []historyMeeting) string {
	if len(rows) == 0 {
		return `{"items":[]}`
	}
	items := make([]string, 0)
	refIndex := 0
	for _, row := range rows {
		for _, memory := range row.Memories {
			refIndex++
			items = append(items, fmt.Sprintf(`{"ref":"M-%d","type":%s,"content":%s,"source_file":%s,"confidence":%.4f,"evidence_available":%t}`,
				refIndex, jsonMarshal(memory.Kind), jsonMarshal(memory.Content), jsonMarshal(memory.SourceFile), memory.SourceConfidence, memory.EvidenceAvailable))
		}
	}
	return fmt.Sprintf(`{"items":[%s]}`, strings.Join(items, ","))
}
