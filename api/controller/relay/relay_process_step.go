package relay

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
)

var messageProcessStepSaver = func(step *model.MessageProcessStep) error {
	return model.CreateMessageProcessStep(step)
}

func NewProcessSender(c *gin.Context, requestId string, chatRequest *ChatRequest, messageStatus *MessageStatsInfo) *ProcessSender {
	return &ProcessSender{
		c:             c,
		requestId:     requestId,
		chatRequest:   chatRequest,
		messageStatus: messageStatus,
	}
}

func normalizeProcessStep(step ProcessStep) ProcessStep {
	stepData := map[string]interface{}(nil)
	if step.Data != nil {
		stepData = hashIDsInStepData(step.Data)
	}
	timestamp := step.Timestamp
	if timestamp <= 0 {
		timestamp = time.Now().Unix()
	}
	return ProcessStep{
		StepCode:  step.StepCode,
		Name:      step.Name,
		Status:    step.Status,
		Message:   step.Message,
		Data:      stepData,
		Timestamp: timestamp,
	}
}

func saveProcessStepRecord(eid, messageID int64, requestID string, step ProcessStep) error {
	record := &model.MessageProcessStep{
		Eid:           eid,
		MessageID:     messageID,
		RequestID:     requestID,
		StepCode:      step.StepCode,
		Name:          step.Name,
		Status:        step.Status,
		Message:       step.Message,
		StepTimestamp: step.Timestamp,
	}
	if err := record.SetDataMap(step.Data); err != nil {
		return err
	}
	return messageProcessStepSaver(record)
}

func recordProcessStepForHistory(ctx context.Context, eid int64, messageStatus *MessageStatsInfo, requestID string, step ProcessStep) {
	if messageStatus == nil || eid <= 0 {
		return
	}
	normalized := normalizeProcessStep(step)
	if !shouldPersistProcessStepForHistory(normalized) {
		return
	}
	if messageStatus.MessageID <= 0 {
		messageStatus.BufferedSteps = append(messageStatus.BufferedSteps, normalized)
		return
	}
	if err := saveProcessStepRecord(eid, messageStatus.MessageID, requestID, normalized); err != nil {
		messageStatus.ProcessRecordError = err.Error()
		logger.Warnf(ctx, "【技能运行】过程记录落库失败: message_id=%d, step_code=%s, err=%v",
			messageStatus.MessageID, normalized.StepCode, err)
	}
}

func shouldPersistProcessStepForHistory(step ProcessStep) bool {
	status := strings.ToLower(strings.TrimSpace(step.Status))
	switch status {
	case STEP_STATUS_COMPLETED, "error", "failed":
		return true
	default:
		return false
	}
}

func bindMessageIDAndFlushProcessSteps(ctx context.Context, eid int64, messageStatus *MessageStatsInfo, messageID int64) {
	if messageStatus == nil || eid <= 0 || messageID <= 0 {
		return
	}

	messageStatus.MessageID = messageID
	if len(messageStatus.BufferedSteps) == 0 {
		return
	}

	buffered := append([]ProcessStep(nil), messageStatus.BufferedSteps...)
	messageStatus.BufferedSteps = nil

	for _, step := range buffered {
		if err := saveProcessStepRecord(eid, messageID, messageStatus.RequestId, step); err != nil {
			messageStatus.ProcessRecordError = err.Error()
			logger.Warnf(ctx, "【技能运行】过程记录缓冲刷新失败: message_id=%d, step_code=%s, err=%v",
				messageID, step.StepCode, err)
		}
	}
}

func (ps *ProcessSender) recordProcessStep(step ProcessStep) {
	if ps == nil || ps.messageStatus == nil || ps.c == nil {
		return
	}
	eid := config.GetEID(ps.c)
	recordProcessStepForHistory(ps.c.Request.Context(), eid, ps.messageStatus, ps.requestId, step)
}

// sendProcessStep 发送处理步骤的流式数据
func sendProcessStep(c *gin.Context, requestId string, step ProcessStep) error {
	if shouldSkipProcessStepInCompact(step) {
		return nil
	}
	hashedStep := normalizeProcessStep(step)

	if !isMessageIDFirstFrameSent(c) {
		enqueuePendingProcessStep(c, requestId, hashedStep)
		return nil
	}

	return sendProcessStepRaw(c, requestId, hashedStep)
}

func sendProcessStepRaw(c *gin.Context, requestId string, hashedStep ProcessStep) error {
	if streamDone, exists := c.Get("stream_response_done"); exists {
		if done, ok := streamDone.(bool); ok && done {
			return nil
		}
	}
	if hashedStep.StepCode != "llm_delta" {
		logger.SysLogf(
			"步骤 step=%s status=%s name=%s msg=%s",
			hashedStep.StepCode,
			hashedStep.Status,
			hashedStep.Name,
			hashedStep.Message,
		)
	}
	payload := buildProcessStepPayload(requestId, hashedStep)

	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	var reqCtx context.Context
	if c.Request != nil {
		reqCtx = c.Request.Context()
	} else {
		reqCtx = context.Background()
	}
	if hashedStep.StepCode == STEP_REF_ANALYSIS {
		logger.Debugf(reqCtx, "【引用分析】准备写入前的 payload: request_id=%s, payload=%s",
			requestId, string(b))
	}

	chunk := append([]byte("data: "), b...)
	chunk = append(chunk, []byte("\n\n")...)

	logger.Debugf(reqCtx, "【SSE发送】step=%s, request_id=%s, 完整包体=\n%s",
		hashedStep.StepCode, requestId, string(chunk))

	if _, err := c.Writer.Write(chunk); err != nil {
		return err
	}
	if flusher, ok := c.Writer.(http.Flusher); ok {
		flusher.Flush()
	}
	mirrorAgentRunTimelineEvent(c, requestId, model.AgentRunEventProcessStep, payload)
	return nil
}

func shouldSkipProcessStepInCompact(step ProcessStep) bool {
	// compact 模式只缩减 payload，不再丢弃任何步骤事件。
	// SSE 的目标是完整重放接口行为，step 是否展示应由前端决定。
	return false
}

func buildProcessStepPayload(requestId string, hashedStep ProcessStep) map[string]interface{} {
	if !config.IsSSECompactMode() {
		return map[string]interface{}{
			"id":           requestId,
			"object":       "process.step",
			"created":      hashedStep.Timestamp,
			"process_step": hashedStep,
		}
	}

	processStep := map[string]interface{}{
		"step_code": hashedStep.StepCode,
		"status":    hashedStep.Status,
		"message":   hashedStep.Message,
	}
	if len(hashedStep.Data) > 0 {
		processStep["data"] = hashedStep.Data
	}
	return map[string]interface{}{
		"object":       "process.step",
		"process_step": processStep,
	}
}

// hashIDsInStepData 对步骤数据中的ID字段进行hash化处理
func hashIDsInStepData(data map[string]interface{}) map[string]interface{} {
	hashedData := make(map[string]interface{})

	for key, value := range data {
		switch key {
		case "knowledge_base_ids":
			// 处理知识库ID数组
			if ids, ok := value.([]int64); ok {
				hashedData[key] = hashInt64Slice(ids)
			} else {
				hashedData[key] = value
			}
		case "sources":
			// 处理sources数组，其中每个source都包含ID字段
			if sources, ok := value.([]rag.SourceReference); ok {
				hashedData[key] = hashSourcesArray(sources)
			} else {
				hashedData[key] = value
			}
		case "unique_documents":
			// 处理去重文档数组
			if docs, ok := value.([]UniqueDocumentInfo); ok {
				hashedData[key] = hashUniqueDocumentsArray(docs)
			} else {
				hashedData[key] = value
			}
		default:
			// 其他字段保持不变
			hashedData[key] = value
		}
	}

	return hashedData
}

func (ps *ProcessSender) SendStartWebSearchStep() error {
	step1 := ProcessStep{
		StepCode:  WEB_SEARCH,
		Name:      "正在搜索网络",
		Status:    "processing",
		Message:   "正在搜索网络获取相关信息...",
		Timestamp: time.Now().Unix(),
	}
	if ps != nil && ps.chatRequest != nil && ps.chatRequest.EnableProcessSteps {
		ps.recordProcessStep(step1)
	}
	if !ps.CheckNeedSend() {
		return nil
	}
	if err := sendProcessStep(ps.c, ps.requestId, step1); err != nil {
		logger.SysErrorf("发送处理步骤1失败: %s", err.Error())
		return err
	}
	return nil
}

func (ps *ProcessSender) EndStartWebSearchStep(chunks []rag.SourceReference) error {
	step2Completed := ProcessStep{
		StepCode: DOC_SEARCH,
		Name:     "完成搜索网络",
		Status:   "completed",
		Message:  fmt.Sprintf("搜索到 %d 篇资料作为参考:", len(chunks)),
		Data: map[string]interface{}{
			"document_search": map[string]interface{}{
				"chunks": chunks,
			}},
		Timestamp: time.Now().Unix(),
	}
	if ps != nil && ps.chatRequest != nil && ps.chatRequest.EnableProcessSteps {
		ps.recordProcessStep(step2Completed)
	}
	if !ps.CheckNeedSend() {
		return nil
	}
	if err := sendProcessStep(ps.c, ps.requestId, step2Completed); err != nil {
		logger.SysErrorf("发送: %s", err.Error())
		return err
	}
	return nil
}

func (ps *ProcessSender) CheckNeedSend() bool {
	return ps != nil && ps.chatRequest != nil && ps.chatRequest.EnableProcessSteps && ps.chatRequest.Stream
}

func (ps *ProcessSender) SendOutOfRangeReply() error {
	step3 := ProcessStep{
		StepCode: DOC_SEARCH,
		Name:     "正在搜索文档",
		Status:   "completed",
		Message:  "未搜索到相关文档，使用超纲回复",
		Data: map[string]interface{}{
			"document_search": map[string]interface{}{
				"chunks": []interface{}{},
			},
		},
		Timestamp: time.Now().Unix(),
	}
	if ps != nil && ps.chatRequest != nil && ps.chatRequest.EnableProcessSteps {
		ps.recordProcessStep(step3)
	}
	if !ps.CheckNeedSend() {
		return nil
	}
	if err := sendProcessStep(ps.c, ps.requestId, step3); err != nil {
		logger.SysErrorf("发送处理步骤3失败: %s", err.Error())
		return err
	}
	return nil
}

func (ps *ProcessSender) SendStartStep(StepCode string, Message string, Data map[string]interface{}) error {
	step := ProcessStep{
		StepCode:  StepCode,
		Status:    STEP_STATUS_START,
		Message:   Message,
		Timestamp: time.Now().Unix(),
		Data:      Data,
	}
	if ps != nil && ps.chatRequest != nil && ps.chatRequest.EnableProcessSteps {
		ps.recordProcessStep(step)
	}
	if !ps.CheckNeedSend() {
		return nil
	}

	if err := sendProcessStep(ps.c, ps.requestId, step); err != nil {
		logger.SysErrorf("发送处理步骤失败: %s", err.Error())
		return err
	}
	return nil
}

func (ps *ProcessSender) SendEndStep(StepCode string, Message string, Data map[string]interface{}) error {
	// ⭐ 在发送前处理 data，截取 content
	processedData := ps.truncateSourcesContent(Data)

	step := ProcessStep{
		StepCode:  StepCode,
		Status:    STEP_STATUS_COMPLETED,
		Message:   Message,
		Timestamp: time.Now().Unix(),
		Data:      processedData, // 使用处理后的数据
	}
	if ps != nil && ps.chatRequest != nil && ps.chatRequest.EnableProcessSteps {
		ps.recordProcessStep(step)
	}
	if !ps.CheckNeedSend() {
		return nil
	}
	if err := sendProcessStep(ps.c, ps.requestId, step); err != nil {
		logger.SysErrorf("发送处理步骤失败: %s", err.Error())
		return err
	}
	return nil
}

// truncateSourcesContent 截取 data 中 sources 的 content
func (ps *ProcessSender) truncateSourcesContent(data map[string]interface{}) map[string]interface{} {
	if data == nil {
		return data
	}

	// 复制一份 data，避免修改原始数据
	result := make(map[string]interface{})
	for k, v := range data {
		if k == "sources" {
			// 处理 sources 数组
			if sources, ok := v.([]rag.SourceReference); ok {
				truncatedSources := make([]rag.SourceReference, len(sources))
				for i, source := range sources {
					truncatedSources[i] = source
					// 图谱聚合 source 没有原始来源文档，必须保留完整内容进入流。
					if shouldPreserveSourceContent(source) {
						continue
					}
					truncatedSources[i].Content = truncateContent(source.Content, 30)
				}
				result[k] = truncatedSources
			} else {
				result[k] = v
			}
		} else {
			result[k] = v
		}
	}
	return result
}

func shouldPreserveSourceContent(source rag.SourceReference) bool {
	return source.ChunkType == rag.GraphAggregateChunkType ||
		source.ReferenceID == rag.GraphAggregateReferenceID ||
		source.SourceKey == "[Source:G-1]"
}
