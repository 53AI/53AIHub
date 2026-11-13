package controller

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type WikiRetryQueueController struct {
	db      *gorm.DB
	listSvc service.WikiRetryQueueService
}

func NewWikiRetryQueueController(db *gorm.DB) *WikiRetryQueueController {
	return &WikiRetryQueueController{db: db, listSvc: service.NewWikiRetryQueueService(db)}
}

// ListTasks 获取当前用户在指定 Wiki 空间内可见的可重试任务。
// @Summary 获取 Wiki 重试队列
// @Tags Wiki 队列
// @Produce json
// @Security BearerAuth
// @Param space_id query string true "空间 ID（HashID）"
// @Param status query string false "状态：failed、pending、processing、success"
// @Param keyword query string false "页面标题或失败原因"
// @Param page query int false "页码"
// @Param size query int false "每页条数"
// @Success 200 {object} model.CommonResponse{data=service.WikiRetryQueueListResponse}
// @Failure 400 {object} model.CommonResponse "请求参数无效"
// @Failure 403 {object} model.CommonResponse "无权限查看空间 Wiki"
// @Router /api/wiki/queue/tasks [get]
func (c *WikiRetryQueueController) ListTasks(ctx *gin.Context) {
	eid, userID, spaceID, ok := c.queueContext(ctx)
	if !ok {
		return
	}
	status := strings.TrimSpace(ctx.Query("status"))
	if status != "" && status != model.RagJobStatusFailed && status != model.RagJobStatusPending && status != model.RagJobStatusProcessing && status != model.RagJobStatusSuccess {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("status 参数无效")))
		return
	}
	page, pageErr := parseOptionalPositiveInt(ctx.Query("page"), 1)
	size, sizeErr := parseOptionalPositiveInt(ctx.Query("size"), 20)
	if pageErr != nil || sizeErr != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("分页参数无效")))
		return
	}
	response, err := c.listSvc.List(ctx.Request.Context(), service.WikiRetryQueueListRequest{
		Eid: eid, UserID: userID, SpaceID: spaceID, Status: status,
		Keyword: ctx.Query("keyword"), Page: page, Size: size,
	})
	if err != nil {
		logger.Errorf(ctx.Request.Context(), "获取 Wiki 重试队列失败：%v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse("获取 Wiki 重试队列失败"))
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponseWithRequestID(response, ctx.GetString(helper.RequestIdKey)))
}

type WikiRetryQueueRequest struct {
	TaskIDs []string `json:"task_ids" binding:"required,min=1,max=100"`
}

type WikiRetryQueueResult struct {
	ID      string `json:"id"`
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

type WikiRetryQueueRetryResponse struct {
	Results []WikiRetryQueueResult `json:"results"`
}

// RetryTasks 逐项校验最新任务状态和资源编辑权限后重试失败任务。
// @Summary 重试 Wiki 任务
// @Tags Wiki 队列
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body WikiRetryQueueRequest true "Wiki 任务 ID 列表"
// @Param space_id query string true "空间 ID（HashID）"
// @Success 200 {object} model.CommonResponse{data=WikiRetryQueueRetryResponse}
// @Failure 400 {object} model.CommonResponse "请求参数无效"
// @Router /api/wiki/queue/retry [post]
func (c *WikiRetryQueueController) RetryTasks(ctx *gin.Context) {
	eid, userID, spaceID, ok := c.queueContext(ctx)
	if !ok {
		return
	}
	var request WikiRetryQueueRequest
	if err := ctx.ShouldBindJSON(&request); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	response := WikiRetryQueueRetryResponse{Results: make([]WikiRetryQueueResult, 0, len(request.TaskIDs))}
	for _, rawID := range request.TaskIDs {
		id, err := hashids.TryParseID(strings.TrimSpace(rawID))
		if err != nil || id <= 0 {
			response.Results = append(response.Results, WikiRetryQueueResult{ID: rawID, Error: "任务不存在或无权操作"})
			continue
		}
		err = c.retryOne(ctx, eid, userID, spaceID, id)
		result := WikiRetryQueueResult{ID: rawID, Success: err == nil}
		if err != nil {
			result.Error = err.Error()
		}
		response.Results = append(response.Results, result)
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponseWithRequestID(response, ctx.GetString(helper.RequestIdKey)))
}

func (c *WikiRetryQueueController) retryOne(ctx *gin.Context, eid, userID, spaceID, jobID int64) error {
	var job model.RagJob
	if err := c.db.WithContext(ctx.Request.Context()).Where("job_id = ? AND eid = ?", jobID, eid).First(&job).Error; err != nil || !model.IsWikiJobType(job.Type) {
		return errors.New("任务不存在或无权操作")
	}
	partialVectorization := job.Status == model.RagJobStatusSuccess && job.Type == service.WikiPageVectorizationJobType
	if job.Status != model.RagJobStatusFailed && !partialVectorization {
		return errors.New("任务状态已变化，请刷新后重试")
	}
	resourceType, resourceID := model.RESOURCE_TYPE_FILE, job.RelatedId
	if job.Type == "wiki_page_generation" {
		var file model.File
		if err := c.db.WithContext(ctx.Request.Context()).Where("id = ? AND eid = ? AND is_deleted = ?", job.RelatedId, eid, false).First(&file).Error; err != nil {
			return errors.New("任务关联资源不存在或无权操作")
		}
		var library model.Library
		if err := c.db.WithContext(ctx.Request.Context()).Where("id = ? AND eid = ? AND space_id = ?", file.LibraryID, eid, spaceID).First(&library).Error; err != nil {
			return errors.New("任务不属于当前空间")
		}
	} else {
		resourceType = model.RESOURCE_TYPE_WIKI_PAGE
		var page model.WikiPage
		if err := c.db.WithContext(ctx.Request.Context()).Where("id = ? AND eid = ? AND space_id = ?", job.RelatedId, eid, spaceID).First(&page).Error; err != nil {
			return errors.New("任务不属于当前空间")
		}
	}
	permission, err := common.GetUserPermission(eid, resourceType, resourceID, userID, ctx.Request.Context())
	if err != nil || permission < model.PERMISSION_EDIT_KNOWLEDGE {
		return errors.New("无权限重试该任务")
	}
	if partialVectorization {
		return service.RetryPartiallyFailedWikiPageVectorization(ctx.Request.Context(), c.db, &job)
	}
	if job.Type == service.WikiPageVectorizationJobType {
		if err := service.PrepareWikiPageVectorizationRetry(ctx.Request.Context(), c.db, &job); err != nil {
			return err
		}
	}
	if err := service.RetryJobStepV2WithOptions(ctx.Request.Context(), job.JobID, nil, service.RetryJobStepOptionsV2{}); err != nil {
		logger.Errorf(ctx.Request.Context(), "Wiki 任务 %d 重试失败：%v", jobID, err)
		return errors.New("任务重试失败，请稍后重试")
	}
	return nil
}

func (c *WikiRetryQueueController) queueContext(ctx *gin.Context) (int64, int64, int64, bool) {
	eid, userID := config.GetEID(ctx), config.GetUserId(ctx)
	if eid <= 0 || userID <= 0 {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse("用户上下文无效"))
		return 0, 0, 0, false
	}
	spaceID, err := hashids.TryParseID(strings.TrimSpace(ctx.Query("space_id")))
	if err != nil || spaceID <= 0 {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse("space_id 参数无效"))
		return 0, 0, 0, false
	}
	var space model.Space
	if err := c.db.WithContext(ctx.Request.Context()).Where("id = ? AND eid = ?", spaceID, eid).First(&space).Error; err != nil {
		ctx.JSON(http.StatusNotFound, model.NotFound.ToResponse("空间不存在"))
		return 0, 0, 0, false
	}
	if !common.IsAdmin(ctx) && !requireWikiSpacePermission(ctx, eid, userID, spaceID, model.PERMISSION_PUBLIC_ONLY, "无权限查看该空间的 Wiki 队列") {
		return 0, 0, 0, false
	}
	return eid, userID, spaceID, true
}

func parseOptionalPositiveInt(raw string, fallback int) (int, error) {
	if strings.TrimSpace(raw) == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 {
		return 0, errors.New("分页参数无效")
	}
	return value, nil
}
