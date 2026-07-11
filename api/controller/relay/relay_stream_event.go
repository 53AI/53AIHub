package relay

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
	relay_meta "github.com/songquanpeng/one-api/relay/meta"
	relay_model "github.com/songquanpeng/one-api/relay/model"
	"gorm.io/gorm"
)

const (
	ctxKeyMessageIDFirstFrameSent = "relay_message_id_first_frame_sent"
	ctxKeyPendingProcessSteps     = "relay_pending_process_steps"
	ctxKeyPendingProcessStepEnds  = "relay_pending_process_step_ends"
)

type pendingProcessStep struct {
	RequestID string
	Step      ProcessStep
}

type pendingProcessStepEnd struct {
	RequestID string
	CreatedAt int64
}

func ensureRequestID(c *gin.Context, preferred string) string {
	if c == nil {
		return preferred
	}
	if c.Request == nil {
		c.Request = &http.Request{}
	}

	baseCtx := context.Background()
	if c.Request.Context() != nil {
		baseCtx = c.Request.Context()
	}

	requestID := preferred
	if requestID == "" {
		requestID = helper.GetRequestID(baseCtx)
	}
	if requestID == "" {
		requestID = fmt.Sprintf("req-%d", time.Now().UnixNano())
	}
	ctx := context.WithValue(baseCtx, helper.RequestIdKey, requestID)
	c.Request = c.Request.WithContext(ctx)
	return requestID
}

func detachExecutionContext(requestCtx context.Context) context.Context {
	execCtx := context.Background()
	if requestCtx == nil {
		return execCtx
	}
	if requestID := helper.GetRequestID(requestCtx); requestID != "" {
		execCtx = context.WithValue(execCtx, helper.RequestIdKey, requestID)
	}
	return execCtx
}

func prepareDetachedExecutionContext(c *gin.Context, preferredRequestID string) (context.Context, context.Context, string) {
	requestCtx := context.Background()
	if c != nil && c.Request != nil {
		requestCtx = c.Request.Context()
	}

	requestID := strings.TrimSpace(preferredRequestID)
	if requestID == "" {
		requestID = helper.GetRequestID(requestCtx)
	}
	if requestID == "" {
		requestID = fmt.Sprintf("req-%d", time.Now().UnixNano())
	}

	execCtx := context.WithValue(context.Background(), helper.RequestIdKey, requestID)
	if c != nil && c.Request != nil {
		c.Request = c.Request.WithContext(execCtx)
	}
	return requestCtx, execCtx, requestID
}

func startAgentRunCancelWatcher(baseCtx context.Context, eid int64, requestID string, pollInterval time.Duration) (context.Context, context.CancelFunc) {
	if baseCtx == nil {
		baseCtx = context.Background()
	}
	watchCtx, cancel := context.WithCancel(baseCtx)

	requestID = strings.TrimSpace(requestID)
	if eid <= 0 || requestID == "" {
		return watchCtx, cancel
	}
	if pollInterval <= 0 {
		pollInterval = time.Second
	}

	runSvc := service.NewAgentRunService()
	go func() {
		ticker := time.NewTicker(pollInterval)
		defer ticker.Stop()

		for {
			select {
			case <-watchCtx.Done():
				return
			case <-ticker.C:
			}

			run, err := runSvc.GetRunByRequestID(watchCtx, eid, requestID)
			if err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					continue
				}
				if !errors.Is(err, context.Canceled) {
					logger.Warnf(watchCtx, "【技能运行】轮询取消状态失败: eid=%d, request_id=%s, err=%v", eid, requestID, err)
				}
				continue
			}

			if run.Status == model.AgentRunStatusCancelling || run.Status == model.AgentRunStatusCancelled {
				cancel()
				return
			}
		}
	}()

	return watchCtx, cancel
}

func isMessageIDFirstFrameSent(c *gin.Context) bool {
	if c == nil {
		return false
	}
	if sent, exists := c.Get(ctxKeyMessageIDFirstFrameSent); exists {
		if val, ok := sent.(bool); ok {
			return val
		}
	}
	return false
}

func markMessageIDFirstFrameSent(c *gin.Context) {
	if c == nil {
		return
	}
	c.Set(ctxKeyMessageIDFirstFrameSent, true)
}

func getPendingProcessSteps(c *gin.Context) []pendingProcessStep {
	if c == nil {
		return nil
	}
	if pending, exists := c.Get(ctxKeyPendingProcessSteps); exists {
		if steps, ok := pending.([]pendingProcessStep); ok {
			return steps
		}
	}
	return nil
}

func enqueuePendingProcessStep(c *gin.Context, requestID string, step ProcessStep) {
	if c == nil {
		return
	}
	steps := getPendingProcessSteps(c)
	steps = append(steps, pendingProcessStep{
		RequestID: requestID,
		Step:      step,
	})
	c.Set(ctxKeyPendingProcessSteps, steps)
}

func flushPendingProcessSteps(c *gin.Context) error {
	if c == nil {
		return nil
	}
	steps := getPendingProcessSteps(c)
	if len(steps) == 0 {
		return nil
	}
	// Clear first to avoid duplicated flush on partial retries.
	c.Set(ctxKeyPendingProcessSteps, []pendingProcessStep{})

	for _, item := range steps {
		if err := sendProcessStepRaw(c, item.RequestID, item.Step); err != nil {
			return err
		}
	}
	return nil
}

func getPendingProcessStepEnds(c *gin.Context) []pendingProcessStepEnd {
	if c == nil {
		return nil
	}
	if pending, exists := c.Get(ctxKeyPendingProcessStepEnds); exists {
		if items, ok := pending.([]pendingProcessStepEnd); ok {
			return items
		}
	}
	return nil
}

func enqueuePendingProcessStepEnd(c *gin.Context, requestID string, createdAt int64) {
	if c == nil {
		return
	}
	items := getPendingProcessStepEnds(c)
	items = append(items, pendingProcessStepEnd{
		RequestID: requestID,
		CreatedAt: createdAt,
	})
	c.Set(ctxKeyPendingProcessStepEnds, items)
}

func flushPendingProcessStepEnds(c *gin.Context) error {
	if c == nil {
		return nil
	}
	items := getPendingProcessStepEnds(c)
	if len(items) == 0 {
		return nil
	}
	c.Set(ctxKeyPendingProcessStepEnds, []pendingProcessStepEnd{})
	for _, item := range items {
		if err := sendProcessStepEndRaw(c, item.RequestID, item.CreatedAt); err != nil {
			return err
		}
	}
	return nil
}

func sendMessageIDFirstFrame(c *gin.Context, requestId, modelName string, messageID int64) error {
	if c == nil {
		return fmt.Errorf("nil context")
	}
	if messageID <= 0 {
		return fmt.Errorf("invalid message_id: %d", messageID)
	}
	if isMessageIDFirstFrameSent(c) {
		return nil
	}
	if err := sendSaveMessageEvent(c, requestId, modelName, messageID); err != nil {
		return err
	}
	markMessageIDFirstFrameSent(c)
	if err := flushPendingProcessSteps(c); err != nil {
		return err
	}
	return flushPendingProcessStepEnds(c)
}

func getPreparedMasterMessageID(c *gin.Context, messageStatus *MessageStatsInfo) int64 {
	if messageStatus != nil && messageStatus.MessageID > 0 {
		return messageStatus.MessageID
	}
	if c == nil {
		return 0
	}
	if existingMsgID, exists := c.Get("agent_master_message_id"); exists {
		if id, ok := existingMsgID.(int64); ok && id > 0 {
			return id
		}
	}
	return 0
}

func ensureStreamingMasterMessageBeforeRAG(
	c *gin.Context,
	chatRequest *ChatRequest,
	agent *model.Agent,
	userID int64,
	conversationID int64,
	textRequest *relay_model.GeneralOpenAIRequest,
	meta *relay_meta.Meta,
	requestId string,
	messageStatus *MessageStatsInfo,
) (int64, error) {
	if c == nil || chatRequest == nil || agent == nil || textRequest == nil || messageStatus == nil {
		return 0, fmt.Errorf("stream master message prerequisites are not ready")
	}
	if !chatRequest.Stream {
		return 0, nil
	}

	existingMsgID := getPreparedMasterMessageID(c, messageStatus)
	if existingMsgID > 0 {
		return existingMsgID, nil
	}

	if userID <= 0 {
		return 0, fmt.Errorf("invalid user_id: %d", userID)
	}
	if conversationID <= 0 {
		return 0, fmt.Errorf("invalid conversation_id: %d", conversationID)
	}
	if meta == nil {
		return 0, fmt.Errorf("stream meta is nil")
	}

	messageID, err := CreateInitialMessage(c, agent, userID, conversationID, textRequest, meta, requestId, messageStatus)
	if err != nil {
		return 0, err
	}

	c.Set("agent_master_message_id", messageID)
	bindMessageIDAndFlushProcessSteps(c.Request.Context(), agent.Eid, messageStatus, messageID)

	if err := sendMessageIDFirstFrame(c, requestId, textRequest.Model, messageID); err != nil {
		return messageID, err
	}

	return messageID, nil
}
