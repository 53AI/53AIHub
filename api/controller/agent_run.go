package controller

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

type AgentRunEventsQuery struct {
	AfterSeq int64 `form:"after_seq"`
	Limit    int   `form:"limit"`
}

type AgentRunListQuery struct {
	Offset int `form:"offset"`
	Limit  int `form:"limit"`
}

type AgentRunListResponse struct {
	Count int64             `json:"count"`
	Runs  []*model.AgentRun `json:"runs"`
}

type AgentRunReplayQuery struct {
	AfterSeq int64 `form:"after_seq"`
	Limit    int   `form:"limit"`
}

type AgentRunEventView struct {
	*model.AgentRunEvent
	Payload map[string]interface{} `json:"payload,omitempty"`
}

type AgentRunReplayResponse struct {
	Run    *model.AgentRun      `json:"run"`
	Events []*AgentRunEventView `json:"events"`
}

var agentRunService = service.NewAgentRunService()

// @Summary 获取 Run 详情
// @Description 获取当前用户可访问的 run 详情
// @Tags AgentRun
// @Produce json
// @Security BearerAuth
// @Param run_id path string true "Run ID"
// @Success 200 {object} model.CommonResponse{data=model.AgentRun}
// @Failure 404 {object} model.CommonResponse
// @Router /api/agent-runs/{run_id} [get]
func GetAgentRun(c *gin.Context) {
	runID := c.Param("run_id")
	run, err := agentRunService.GetRunForUser(c.Request.Context(), config.GetEID(c), config.GetUserId(c), config.GetUserRole(c), runID)
	if err != nil {
		writeAgentRunError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(run))
}

// @Summary 获取会话最近一次 Run
// @Description 获取当前用户在指定会话下最近一次 run
// @Tags AgentRun
// @Produce json
// @Security BearerAuth
// @Param conversation_id path int true "Conversation ID"
// @Success 200 {object} model.CommonResponse{data=model.AgentRun}
// @Failure 400 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Router /api/conversations/{conversation_id}/latest-run [get]
func GetLatestConversationRun(c *gin.Context) {
	conversationID, err := strconv.ParseInt(c.Param("conversation_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	if conversationID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("conversation_id must be greater than 0"))
		return
	}

	run, err := agentRunService.GetLatestRunForConversation(c.Request.Context(), config.GetEID(c), config.GetUserId(c), config.GetUserRole(c), conversationID)
	if err != nil {
		writeAgentRunError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(run))
}

// @Summary 获取会话 Run 历史
// @Description 获取当前用户在指定会话下的 run 历史列表，按创建时间倒序排列
// @Tags AgentRun
// @Produce json
// @Security BearerAuth
// @Param conversation_id path int true "Conversation ID"
// @Param offset query int false "偏移量" default(0)
// @Param limit query int false "每页数量" default(20)
// @Success 200 {object} model.CommonResponse{data=AgentRunListResponse}
// @Failure 400 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Router /api/conversations/{conversation_id}/agent-runs [get]
func GetConversationAgentRuns(c *gin.Context) {
	conversationID, err := strconv.ParseInt(c.Param("conversation_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}
	if conversationID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("conversation_id must be greater than 0"))
		return
	}

	var query AgentRunListQuery
	if err := c.ShouldBindQuery(&query); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	count, runs, err := agentRunService.ListRunsForConversation(c.Request.Context(), config.GetEID(c), config.GetUserId(c), config.GetUserRole(c), conversationID, query.Offset, query.Limit)
	if err != nil {
		writeAgentRunError(c, err)
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&AgentRunListResponse{
		Count: count,
		Runs:  runs,
	}))
}

// @Summary 获取 Run 事件
// @Description 按序号补发当前用户可访问的 run 事件
// @Tags AgentRun
// @Produce json
// @Security BearerAuth
// @Param run_id path string true "Run ID"
// @Param after_seq query int false "补发起始序号"
// @Param limit query int false "事件上限"
// @Success 200 {object} model.CommonResponse{data=[]model.AgentRunEvent}
// @Failure 400 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Router /api/agent-runs/{run_id}/events [get]
func GetAgentRunEvents(c *gin.Context) {
	runID := c.Param("run_id")

	var query AgentRunEventsQuery
	if err := c.ShouldBindQuery(&query); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	events, err := agentRunService.ListEventsForUser(c.Request.Context(), config.GetEID(c), config.GetUserId(c), config.GetUserRole(c), runID, query.AfterSeq, query.Limit)
	if err != nil {
		writeAgentRunError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(events))
}

// @Summary 获取 Run 回放数据
// @Description 获取当前用户可访问的 run 详情和事件列表，供历史回放页一次性加载
// @Tags AgentRun
// @Produce json
// @Security BearerAuth
// @Param run_id path string true "Run ID"
// @Param after_seq query int false "事件起始序号"
// @Param limit query int false "事件上限"
// @Success 200 {object} model.CommonResponse{data=AgentRunReplayResponse}
// @Failure 400 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Router /api/agent-runs/{run_id}/replay [get]
func GetAgentRunReplay(c *gin.Context) {
	runID := c.Param("run_id")

	var query AgentRunReplayQuery
	if err := c.ShouldBindQuery(&query); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	run, err := agentRunService.GetRunForUser(c.Request.Context(), config.GetEID(c), config.GetUserId(c), config.GetUserRole(c), runID)
	if err != nil {
		writeAgentRunError(c, err)
		return
	}

	events, err := agentRunService.ListEventsAfterSeq(c.Request.Context(), config.GetEID(c), run.RunID, query.AfterSeq, query.Limit)
	if err != nil {
		writeAgentRunError(c, err)
		return
	}

	views := make([]*AgentRunEventView, 0, len(events))
	for _, event := range events {
		views = append(views, newAgentRunEventView(event))
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&AgentRunReplayResponse{
		Run:    run,
		Events: views,
	}))
}

// @Summary 订阅 Run 事件
// @Description 以 SSE 方式持续订阅当前用户可访问的 run 事件，支持通过 after_seq 断线重连补发
// @Tags AgentRun
// @Produce text/event-stream
// @Security BearerAuth
// @Param run_id path string true "Run ID"
// @Param after_seq query int false "已接收的最后事件序号"
// @Param limit query int false "单次补发事件上限"
// @Success 200 {string} string "SSE event stream"
// @Failure 404 {object} model.CommonResponse
// @Router /api/agent-runs/{run_id}/subscribe [get]
func SubscribeAgentRunEvents(c *gin.Context) {
	runID := c.Param("run_id")

	var query AgentRunEventsQuery
	if err := c.ShouldBindQuery(&query); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eventsCh, errCh, err := agentRunService.WatchEventsForUser(
		c.Request.Context(),
		config.GetEID(c),
		config.GetUserId(c),
		config.GetUserRole(c),
		runID,
		query.AfterSeq,
		query.Limit,
		500*time.Millisecond,
	)
	if err != nil {
		writeAgentRunError(c, err)
		return
	}

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(fmt.Errorf("streaming not supported")))
		return
	}

	c.Header("Content-Type", "text/event-stream; charset=utf-8")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)

	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case event, ok := <-eventsCh:
			if !ok {
				return
			}
			c.SSEvent(event.EventType, event)
			flusher.Flush()
		case streamErr, ok := <-errCh:
			if !ok {
				return
			}
			if streamErr != nil {
				logger.Warnf(c.Request.Context(), "agent run stream failed: eid=%d, run_id=%s, err=%v", config.GetEID(c), runID, streamErr)
				c.SSEvent("error", gin.H{"message": streamErr.Error()})
				flusher.Flush()
			}
			return
		case <-heartbeat.C:
			if _, err := c.Writer.Write([]byte(": ping\n\n")); err != nil {
				logger.Warnf(c.Request.Context(), "agent run stream heartbeat failed: eid=%d, run_id=%s, err=%v", config.GetEID(c), runID, err)
				return
			}
			flusher.Flush()
		case <-c.Request.Context().Done():
			return
		}
	}
}

// @Summary 请求取消 Run
// @Description 登记取消请求并停止正在执行的任务。系统会在下一个轮次检测到取消请求后终止 agent_loop。
// @Tags AgentRun
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param run_id path string true "Run ID"
// @Success 200 {object} model.CommonResponse{data=model.AgentRun}
// @Failure 404 {object} model.CommonResponse
// @Router /api/agent-runs/{run_id}/cancel [post]
func CancelAgentRun(c *gin.Context) {
	runID := c.Param("run_id")
	run, err := agentRunService.RequestCancelRun(c.Request.Context(), config.GetEID(c), config.GetUserId(c), config.GetUserRole(c), runID)
	if err != nil {
		writeAgentRunError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(run))
}

func writeAgentRunError(c *gin.Context, err error) {
	if errors.Is(err, service.ErrAgentRunNotFound) {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}
	c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
}

func newAgentRunEventView(event *model.AgentRunEvent) *AgentRunEventView {
	if event == nil {
		return nil
	}

	view := &AgentRunEventView{AgentRunEvent: event}
	if event.PayloadJSON == "" {
		return view
	}

	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(event.PayloadJSON), &payload); err != nil {
		view.Payload = map[string]interface{}{
			"raw": event.PayloadJSON,
		}
		return view
	}
	view.Payload = payload
	return view
}
