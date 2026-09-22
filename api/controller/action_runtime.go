package controller

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

type ActionOpportunityPatchRequest struct {
	Status string `json:"status" binding:"required"`
}

type ActionRunReplayQuery struct {
	AfterSeq int64 `form:"after_seq"`
	Limit    int   `form:"limit"`
}

var actionRuntimeService = service.DefaultActionRuntimeService()

// GetAction 读取 Action 聚合（Action + Plan + Run + 产物 + 成果）。
func GetAction(c *gin.Context) {
	view, err := actionRuntimeService.GetAction(c.Request.Context(), config.GetEID(c), config.GetUserId(c), c.Param("action_id"))
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(view))
}

// PatchActionOpportunity 更新机会状态（candidate / dismissed）。
func PatchActionOpportunity(c *gin.Context) {
	var req ActionOpportunityPatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("请求参数无效"))
		return
	}
	view, err := actionRuntimeService.PatchActionOpportunity(c.Request.Context(), config.GetEID(c), config.GetUserId(c), c.Param("opportunity_id"), strings.TrimSpace(req.Status))
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(view))
}

func RetryActionRun(c *gin.Context) {
	confirmation, err := service.DefaultActionRuntimeService().RetryActionRun(c.Request.Context(), config.GetEID(c), config.GetUserId(c), c.Param("run_id"))
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusAccepted, model.Success.ToResponse(confirmation))
}

func AcceptActionRun(c *gin.Context) {
	asset, err := service.DefaultActionRuntimeService().AcceptActionRun(c.Request.Context(), config.GetEID(c), config.GetUserId(c), c.Param("run_id"))
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, model.Success.ToResponse(asset))
}

func RefineActionRun(c *gin.Context) {
	var request struct {
		Feedback string `json:"feedback"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("行动任务参数无效"))
		return
	}
	confirmation, err := service.DefaultActionRuntimeService().RefineActionRun(c.Request.Context(), config.GetEID(c), config.GetUserId(c), c.Param("run_id"), request.Feedback)
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusAccepted, model.Success.ToResponse(confirmation))
}

func GetActionRun(c *gin.Context) {
	run, err := actionRuntimeService.GetActionRun(c.Request.Context(), config.GetEID(c), config.GetUserId(c), c.Param("run_id"))
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(run))
}

func GetActionRunReplay(c *gin.Context) {
	var query ActionRunReplayQuery
	if err := c.ShouldBindQuery(&query); err != nil || query.AfterSeq < 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("回放游标无效"))
		return
	}
	replay, err := actionRuntimeService.GetActionRunReplay(c.Request.Context(), config.GetEID(c), config.GetUserId(c), c.Param("run_id"), query.AfterSeq, query.Limit)
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(replay))
}

func SubscribeActionRun(c *gin.Context) {
	var query ActionRunReplayQuery
	if err := c.ShouldBindQuery(&query); err != nil || query.AfterSeq < 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("回放游标无效"))
		return
	}
	eid, userID, runID := config.GetEID(c), config.GetUserId(c), c.Param("run_id")
	initial, err := actionRuntimeService.GetActionRunReplay(c.Request.Context(), eid, userID, runID, query.AfterSeq, query.Limit)
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	seq := query.AfterSeq
	pending := initial
	c.Stream(func(w io.Writer) bool {
		replay := pending
		pending = nil
		if replay == nil {
			replay, err = actionRuntimeService.GetActionRunReplay(c.Request.Context(), eid, userID, runID, seq, query.Limit)
			if err != nil {
				return false
			}
		}
		for _, event := range replay.Events {
			if event == nil || event.Seq <= seq {
				continue
			}
			c.SSEvent("action.event", event)
			seq = event.Seq
		}
		c.SSEvent("action.run", replay.Run)
		if replay.Run != nil && model.IsActionRunStatusTerminal(replay.Run.Status) {
			return false
		}
		timer := time.NewTimer(time.Second)
		defer timer.Stop()
		select {
		case <-c.Request.Context().Done():
			return false
		case <-timer.C:
			return true
		}
	})
}

func CancelActionRun(c *gin.Context) {
	run, err := actionRuntimeService.CancelActionRun(c.Request.Context(), config.GetEID(c), config.GetUserId(c), c.Param("run_id"))
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusAccepted, model.Success.ToResponse(run))
}

func DownloadActionArtifact(c *gin.Context) {
	serveActionArtifact(c, false)
}

func PreviewActionArtifact(c *gin.Context) {
	serveActionArtifact(c, true)
}

func serveActionArtifact(c *gin.Context, preview bool) {
	artifact, err := actionRuntimeService.GetArtifactFile(c.Request.Context(), config.GetEID(c), config.GetUserId(c), c.Param("run_id"), c.Param("artifact_id"), preview)
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	path := artifact.StoragePath
	contentType := artifact.MimeType
	contentDisposition := "attachment"
	if preview {
		path = artifact.PreviewPath
		contentType = "application/pdf"
		contentDisposition = "inline"
	}
	filename := strings.TrimSpace(artifact.Name)
	if preview {
		filename = service.ActionArtifactPreviewName(filename)
	}
	if filename == "" {
		filename = "action-artifact"
	}
	contentDispositionValue := mime.FormatMediaType(contentDisposition, map[string]string{"filename": filename})
	c.Header("Content-Type", contentType)
	c.Header("Content-Disposition", contentDispositionValue)
	c.File(path)
}

func writeActionRuntimeError(c *gin.Context, err error) {
	status := http.StatusInternalServerError
	message := "行动任务处理失败"
	responseCode := model.SystemError
	switch {
	case errors.Is(err, service.ErrActionNotFound), errors.Is(err, service.ErrActionRunNotFound), errors.Is(err, service.ErrActionArtifactNotFound), errors.Is(err, service.ErrActionResultAssetNotFound):
		status, message, responseCode = http.StatusNotFound, "行动资源不存在", model.NotFound
	case errors.Is(err, service.ErrActionOpportunityNotFound), errors.Is(err, service.ErrActionPlanNotFound):
		status, message, responseCode = http.StatusNotFound, "行动规划资源不存在", model.NotFound
	case errors.Is(err, service.ErrActionForbidden):
		status, message, responseCode = http.StatusForbidden, "无权操作该行动任务", model.ForbiddenError
	case errors.Is(err, service.ErrActionInsightNotReady):
		status, message, responseCode = http.StatusConflict, "会议洞察尚未准备好", model.ParamError
	case errors.Is(err, service.ErrActionInsightChanged):
		status, message, responseCode = http.StatusConflict, "会议洞察已更新，请重新创建行动任务", model.ParamError
	case errors.Is(err, service.ErrRefinementAlreadyRunning):
		status, message, responseCode = http.StatusConflict, "refinement_already_running：当前返工仍在执行，请等它结束后再提交新的 refine", model.ParamError
	case errors.Is(err, service.ErrActionState), errors.Is(err, service.ErrActionRunState), errors.Is(err, service.ErrActionRunNotActive), errors.Is(err, service.ErrActionPreviewUnavailable), errors.Is(err, service.ErrActionOpportunityState), errors.Is(err, service.ErrActionPlanState), errors.Is(err, service.ErrActionQualityNotReady):
		status, message, responseCode = http.StatusConflict, "行动任务当前状态不允许该操作", model.ParamError
	case errors.Is(err, service.ErrActionInvalidRequest), errors.Is(err, service.ErrActionPlanInvalid), errors.Is(err, service.ErrActionCapabilityUnavailable):
		status, message, responseCode = http.StatusBadRequest, "行动任务参数无效", model.ParamError
	case errors.Is(err, service.ErrActionPrimaryArtifactMissing):
		status, message, responseCode = http.StatusBadRequest, "primary_artifact_missing：方案里没有可交付的主交付物", model.ParamError
	case errors.Is(err, service.ErrActionMultiplePrimaryArtifacts):
		status, message, responseCode = http.StatusBadRequest, "multiple_primary_artifacts：方案里有多个主交付物，请只保留一个", model.ParamError
	case errors.Is(err, service.ErrActionPrimaryArtifactTitleInvalid):
		status, message, responseCode = http.StatusBadRequest, "invalid_primary_artifact_title：主交付物标题无法作为文件名，请修改", model.ParamError
	case errors.Is(err, service.ErrActionArtifactFormatUnsupported):
		status, message, responseCode = http.StatusBadRequest, "unsupported_artifact_format：主交付物格式只支持 DOCX / XLSX / PPTX", model.ParamError
	case errors.Is(err, service.ErrActionArtifactTitleFormatConflict):
		status, message, responseCode = http.StatusBadRequest, "artifact_title_format_conflict：标题里的扩展名与所选格式冲突，请修改标题或格式", model.ParamError
	case errors.Is(err, service.ErrActionRuntimeDisabled), errors.Is(err, service.ErrActionRuntimeNotConfigured):
		status, message, responseCode = http.StatusServiceUnavailable, "行动执行环境尚未配置", model.SystemError
	case errors.Is(err, service.ErrActionOpportunityUnavailable):
		status, message, responseCode = http.StatusServiceUnavailable, "行动机会识别暂不可用，请稍后重试", model.SystemError
	case errors.Is(err, service.ErrActionPlanGenerationFailed):
		status, message, responseCode = http.StatusUnprocessableEntity, "行动规划生成失败，请稍后重试", model.ParamError
	default:
		logger.SysErrorf("【Action Runtime】请求失败 err=%v", err)
	}
	c.JSON(status, responseCode.ToNewErrorResponse(message))
}
