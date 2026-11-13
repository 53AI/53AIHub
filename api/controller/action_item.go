package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

// ListActionItems godoc
// @Summary 统一业务事项列表（提议、行动、成果共用唯一事项 ID）
// @Description 支持业务阶段、执行状态、阅读状态、来源会议/洞察、回收站、类型筛选与分页。
// @Tags Action System
// @Security BearerAuth
// @Produce json
// @Param stage query string false "业务阶段 proposal/action/result/all"
// @Param status query string false "行动状态 running/pending_review/needs_attention，支持逗号分隔多值（如 running,needs_attention）"
// @Param read query string false "提议阅读状态 read/unread"
// @Param type query string false "业务类型"
// @Param meeting_id query string false "规范会议 ID"
// @Param recording_file_id query string false "录音文件公开 ID，与 meeting_id/insight_id 互斥"
// @Param insight_id query string false "规范洞察 ID"
// @Param trashed query bool false "是否回收站"
// @Param page query int false "页码，起始 1"
// @Param page_size query int false "页容量 1-100"
// @Success 200 {object} model.CommonResponse
// @Router /api/actions/items [get]
func ListActionItems(c *gin.Context) {
	page, pageSize := 1, 20
	if p := c.Query("page"); p != "" {
		n, err := strconv.Atoi(p)
		if err != nil || n < 1 {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("分页参数无效"))
			return
		}
		page = n
	}
	if p := c.Query("page_size"); p != "" {
		n, err := strconv.Atoi(p)
		if err != nil || n < 1 || n > 100 {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("分页参数无效"))
			return
		}
		pageSize = n
	}
	stage := strings.TrimSpace(c.Query("stage"))
	if stage != "" && stage != "all" && stage != model.ActionItemStageProposal && stage != model.ActionItemStageAction && stage != model.ActionItemStageResult {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("阶段参数无效"))
		return
	}
	var recordingLegacyID string
	if raw := strings.TrimSpace(c.Query("recording_file_id")); raw != "" {
		fileID, err := hashids.TryParseID(raw)
		if err != nil || fileID <= 0 {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("录音文件ID无效"))
			return
		}
		recordingLegacyID = strconv.FormatInt(fileID, 10)
	}
	filter := model.ActionItemFilter{Stage: stage, Status: c.Query("status"), Read: c.Query("read"), Type: c.Query("type"), MeetingID: c.Query("meeting_id"), InsightID: c.Query("insight_id"), RecordingFileID: recordingLegacyID,
		SourceType: c.Query("source_type"), SourceID: c.Query("source_id"), Trashed: c.Query("trashed") == "true", Page: page, PageSize: pageSize}
	if (filter.MeetingID != "" && filter.InsightID != "") || (filter.RecordingFileID != "" && (filter.MeetingID != "" || filter.InsightID != "")) {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("来源参数冲突"))
		return
	}
	result, err := service.DefaultActionRuntimeService().ListActionItems(c.Request.Context(), config.GetEID(c), config.GetUserId(c), filter)
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(result))
}

// GetActionItem godoc
// @Summary 获取一条业务事项的最新阶段与关联规划、行动、成果
// @Tags Action System
// @Security BearerAuth
// @Produce json
// @Param item_id path string true "稳定业务事项 ID（opportunity_id）"
// @Success 200 {object} model.CommonResponse
// @Router /api/actions/items/{item_id} [get]
func GetActionItem(c *gin.Context) {
	item, err := service.DefaultActionRuntimeService().GetActionItem(c.Request.Context(), config.GetEID(c), config.GetUserId(c), c.Param("item_id"))
	if err != nil {
		writeActionRuntimeError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(item))
}
