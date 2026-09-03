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
	if !file.IsRecordingOriginType() {
		logger.Infof(ctx, "【洞察】跳过非录音来源 fileID=%d originType=%s", fileID, file.OriginType)
		setInsightOutcomeIfCurrent(eid, fileID, file.InsightGeneration, insightGateResult{
			Mode:       insightModeNoInsight,
			ReasonCode: "non_recording_source",
			Message:    "非安心录文件不生成会议洞察。",
		})
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
		return
	}

	if file.UserID > 0 && userID != file.UserID {
		logger.Warnf(ctx, "【洞察】使用文件创建者作为记忆归属 fileID=%d requested_user_id=%d file_user_id=%d", fileID, userID, file.UserID)
		userID = file.UserID
	}
	generation := file.InsightGeneration
	if !isInsightGenerationCurrent(eid, fileID, generation) {
		return
	}

	// 质量门控必须早于个人、企业、补充和历史背景加载，避免背景把
	// 空录音“补写”为一篇看似完整的洞察。
	gateMaterial, gateErr := loadMeetingMinutesText(ctx, eid, fileID)
	if gateErr != nil || strings.TrimSpace(gateMaterial) == "" {
		gateMaterial, _ = loadTranscriptText(ctx, eid, fileID)
	}
	gateResult := evaluateInsightGate(gateMaterial)
	if !gateResult.Allowed {
		if setInsightOutcomeIfCurrent(eid, fileID, generation, gateResult) {
			logger.Infof(ctx, "【洞察-质量门控】跳过 fileID=%d mode=%s reason=%s", fileID, gateResult.Mode, gateResult.ReasonCode)
		}
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

	if _, memoryErr := ensureRecordingMemoryReady(ctx, eid, fileID, userID); memoryErr != nil {
		logger.Warnf(ctx, "【洞察-记忆就绪】失败，继续使用可用降级上下文 fileID=%d err=%v", fileID, memoryErr)
	}
	requestedPerspective := model.NormalizeInsightPerspective(file.InsightPerspective)
	perspective := requestedPerspective
	profile := insightPromptProfileFor(perspective)

	// 查询用户信息
	user, _ := model.GetUserByIDAndEid(eid, userID)
	if user != nil {
		if departmentErr := user.LoadDepartments(0); departmentErr != nil {
			logger.Warnf(ctx, "【洞察-个人背景】加载部门失败 fileID=%d userID=%d err=%v", fileID, userID, departmentErr)
		}
	}

	// 查询用户记忆（职位、风格、智能记忆、自定义记忆）
	position := ""
	style := ""
	smartMemory := ""
	customMemory := ""
	if userMemory, _ := model.GetUserMemory(eid, userID); userMemory != nil {
		position = userMemory.Position
		style = userMemory.Style
		if items, err := userMemory.GetSmartMemoryItems(); err == nil {
			smartMemory = formatMemoryFacts(items)
		}
		if items, err := userMemory.GetCustomMemoryItems(); err == nil {
			customMemory = formatMemoryFacts(items)
		}
	}

	// 查询企业信息
	enterprise, _ := model.GetEnterpriseByID(eid)

	setInsightsStatusIfCurrent(eid, fileID, generation, "processing")
	if markErr := markInsightPageFormatIfCurrent(ctx, eid, fileID, generation, insightPageHTMLFormat); markErr != nil {
		if errors.Is(markErr, ErrInsightGenerationStale) {
			logger.Infof(ctx, "【洞察】检测到更新的生成版本，跳过旧任务 fileID=%d generation=%d", fileID, generation)
			return
		}
		logger.Errorf(ctx, "【洞察】保存页面格式标记失败 fileID=%d generation=%d err=%v", fileID, generation, markErr)
		setInsightsStatusIfCurrent(eid, fileID, generation, "failed")
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
		logger.Errorf(ctx, "【洞察】读取主要材料失败 fileID=%d perspective=%s err=%v", fileID, perspective, err)
		setInsightsStatusIfCurrent(eid, fileID, generation, "failed")
		return
	}

	// 视角未设置时，只有企业显式开启多视角才调用一次分类器；分类失败安全回退为内部会议。
	if requestedPerspective == model.InsightPerspectiveAuto {
		perspective = resolveInsightPerspective(ctx, config, insightSourceTitle(file.Path), primaryMaterial)
		profile = insightPromptProfileFor(perspective)
		logger.Infof(ctx, "【洞察】自动场景解析完成 fileID=%d perspective=%s enabled=%v", fileID, perspective, config.MultiPerspectiveEnabled)
	}

	// 构建视角化增强 Prompt。最终洞察请求仍会注入个人信息、公司信息和历史记忆。
	enrichedPrompt := buildEnrichedPrompt(enterprise, user, position, style, smartMemory, customMemory, buildInsightSystemPrompt(perspective))
	// 用户在协同研讨中确认的背景作为本次生成的高优先级补充上下文注入，
	// 不修改全局用户/企业资料，避免一次文件级修订意外影响其它录音。
	// 个人/企业信息已由 buildEnrichedPrompt 实时注入，快照只携带用户补充说明。
	if saved, ok := loadSavedInsightBackground(file.InsightContext); ok {
		enrichedPrompt += "\n\n" + formatInsightBackgroundPrompt(saved, mustLoadMinutesText(eid, fileID))
	}
	if outputInstruction := insightGateOutputInstruction(gateResult.Mode); outputInstruction != "" {
		enrichedPrompt += "\n\n" + outputInstruction
	}

	// 2. 查询历史数据（实体重叠匹配，受记忆开关控制）
	memCfg := config.MemoryExtraction
	if memCfg == nil {
		memCfg = &model.MemoryExtractionConfig{Enabled: true, Types: []string{model.EntityTypePerson, model.EntityTypeMatter, model.EntityTypeCommitment}}
	}
	historyRows := loadRelatedInsightHistoryWithContext(ctx, eid, fileID, userID, memCfg, currentContext)

	// 3. 计算转写预算并压缩转写
	// 3.1 计算非转写输入 token 占用
	ctxBudget := getRecordingContextBudget(ctx, config)
	historyStr := buildHistoricalContext(historyRows)
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
		return
	}

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
		logger.Errorf(ctx, "【洞察】转写压缩失败 fileID=%d err=%v", fileID, err)
		setInsightsStatusIfCurrent(eid, fileID, generation, "failed")
		return
	}
	logger.Infof(ctx, "【洞察】转写压缩完成 fileID=%d inputKind=%s sourceTokens=%d resultTokens=%d cacheHit=%v degraded=%v",
		fileID, prepared.InputKind, prepared.SourceTokens, prepared.ResultTokens, prepared.CacheHit, prepared.Degraded)
	transcriptText := prepared.Text
	if profile.SourceIsPrimaryText {
		primaryMaterial = prepared.Text
		transcriptText = ""
	}

	// 4. 调用视角化 Prompt 生成洞察
	result, err := callInsightsLLMForPerspective(ctx, config, fileID, perspective, insightSourceTitle(file.Path), transcriptText, primaryMaterial, historyRows, enrichedPrompt)
	if err != nil {
		if !isInsightGenerationCurrent(eid, fileID, generation) {
			return
		}
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
		return
	}

	// 5. 写入 file.insight_summary。将生成版本放进 UPDATE 条件，
	// 即使用户在检查后立即确认新背景，旧结果也无法覆盖新一代洞察。
	insightContext, contextErr := withResolvedInsightPerspective(file.InsightContext, perspective)
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
		logger.Errorf(ctx, "【洞察】保存失败 fileID=%d err=%v", fileID, updateResult.Error)
		setInsightsStatusIfCurrent(eid, fileID, generation, "failed")
		return
	}
	if updateResult.RowsAffected != 1 {
		logger.Infof(ctx, "【洞察】检测到更新的生成版本，丢弃旧结果 fileID=%d generation=%d", fileID, generation)
		return
	}

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

	// 6. 调用 Prompt 5 生成决策页面编排
	go func() {
		pageCtx, pageCancel := context.WithTimeout(recordingPipelineCtx, 5*time.Minute)
		defer pageCancel()
		generateInsightPageForGeneration(pageCtx, eid, fileID, config, result, generation)
	}()
}

// generateInsightPage 调用 Prompt 5 将洞察结果编排为动态决策页面。
func generateInsightPage(ctx context.Context, eid, fileID int64, config *model.RecordingConfig, insightMarkdown string) {
	generation := int64(0)
	if file, err := model.GetFileByIDOlny(fileID); err == nil && file != nil {
		generation = file.InsightGeneration
	}
	generateInsightPageForGeneration(ctx, eid, fileID, config, insightMarkdown, generation)
}

func generateInsightPageForGeneration(ctx context.Context, eid, fileID int64, config *model.RecordingConfig, insightMarkdown string, generation int64) {
	if !isInsightGenerationCurrent(eid, fileID, generation) {
		logger.Infof(ctx, "【页面】检测到更新的生成版本，跳过旧页面 fileID=%d generation=%d", fileID, generation)
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
		return
	}

	pageHTML, err := callPageLayoutLLM(ctx, config, fileID, insightMarkdown)
	if err != nil {
		if !isInsightGenerationCurrent(eid, fileID, generation) {
			return
		}
		logger.Warnf(ctx, "【页面】编排失败，降级使用原始洞察: fileID=%d err=%v", fileID, err)
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

	if !isInsightGenerationCurrent(eid, fileID, generation) {
		logger.Infof(ctx, "【页面】检测到更新的生成版本，跳过旧页面 fileID=%d generation=%d", fileID, generation)
		return
	}
	pageJSON, err := encodeInsightHTMLPage(pageHTML, insightMarkdown)
	if err != nil {
		if isInsightGenerationCurrent(eid, fileID, generation) {
			logger.Warnf(ctx, "【页面】HTML 校验失败，降级使用原始洞察: fileID=%d err=%v", fileID, err)
			setInsightPageStatus(fileID, "failed")
		}
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
		return
	}

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

	return callLLMWithRetry(ctx, config, buildRequest)
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
			memories = append(memories, fmt.Sprintf(
				`{"memory_id":%d,"type":%s,"content":%s,"assertion_state":%s,"lifecycle_state":%s,"review_state":%s,"source_file_id":%d,"source_file":%s,"confidence":%.4f,"evidence_available":%t,"source_level":"L3","allowed_usage":"evidence","source_segment_ids":%s,"evidence_refs":{"source_file_id":%d,"source_segment_ids":%s},"recall_path":%s,"structured_links":%s}`,
				memory.MemoryID,
				jsonMarshal(memory.Kind),
				jsonMarshal(memory.Content),
				jsonMarshal(memory.AssertionState),
				jsonMarshal(memory.LifecycleState),
				jsonMarshal(memory.ReviewState),
				memory.SourceFileID,
				jsonMarshal(memory.SourceFile),
				memory.SourceConfidence,
				memory.EvidenceAvailable,
				jsonMarshal(memory.SourceSegmentIDs),
				memory.SourceFileID,
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
func buildEnrichedPrompt(enterprise *model.Enterprise, user *model.User, position, style, smartMemory, customMemory, basePrompt string) string {
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
	if smartMemory != "" {
		personalFields = append(personalFields, fmt.Sprintf(`    "smart_memory": "%s"`, escapeJSON(strings.TrimSpace(smartMemory))))
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
func callPageLayoutLLM(ctx context.Context, config *model.RecordingConfig, fileID int64, insightMarkdown string) (string, error) {
	buildRequest := func() *relaymodel.GeneralOpenAIRequest {
		userPrompt := fmt.Sprintf(`请将以下《决策洞察》转换为完整的独立 HTML 页面。只做忠实编排，不得改变任何判断、事实、行动或表述。

<decision_analysis>
%s
</decision_analysis>

页面偏好：

<render_preferences>
{
  "language": "zh-CN",
  "mobile_long_image": true
}
</render_preferences>

严格按照系统要求输出。`, insightMarkdown)

		return &relaymodel.GeneralOpenAIRequest{
			Model:     config.InferenceModelName,
			MaxTokens: 0,
			Messages: []relaymodel.Message{
				{Role: "system", Content: prompt5SystemPrompt},
				{Role: "user", Content: userPrompt},
			},
		}
	}

	return callLLMWithRetry(ctx, config, buildRequest)
}
