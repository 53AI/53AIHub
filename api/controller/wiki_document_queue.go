package controller

import (
	"errors"
	"net/http"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type WikiDocumentQueueController struct {
	queue   *WikiRetryQueueController
	service *service.WikiDocumentQueueService
}

func NewWikiDocumentQueueController(db *gorm.DB) *WikiDocumentQueueController {
	return &WikiDocumentQueueController{queue: NewWikiRetryQueueController(db), service: service.NewWikiDocumentQueueService(db)}
}

// ListDocuments 获取用户可见的文档维度 Wiki 队列。
// @Summary 获取 Wiki 文档队列
// @Tags Wiki 队列
// @Produce json
// @Security BearerAuth
// @Param space_id query string true "空间 ID（HashID）"
// @Param library_id query string false "知识库 ID（HashID）"
// @Param status query string false "状态：pending、processing、failed、success、waiting"
// @Param keyword query string false "文档名、关联页标题或失败原因"
// @Param page query int false "页码，默认 1"
// @Param size query int false "每页条数，默认 10，最大 100"
// @Success 200 {object} model.CommonResponse{data=service.WikiDocumentQueueResponse}
// @Failure 400 {object} model.CommonResponse "请求参数无效"
// @Failure 401 {object} model.CommonResponse "未登录"
// @Failure 403 {object} model.CommonResponse "无权限查看空间 Wiki"
// @Failure 404 {object} model.CommonResponse "空间不存在"
// @Router /api/wiki/queue/documents [get]
func (c *WikiDocumentQueueController) ListDocuments(ctx *gin.Context) {
	req, ok := c.request(ctx, 10)
	if !ok {
		return
	}
	response, err := c.service.List(ctx.Request.Context(), req)
	if err != nil {
		logger.Errorf(ctx.Request.Context(), "获取 Wiki 文档队列失败：%v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse("获取 Wiki 文档队列失败"))
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponseWithRequestID(response, ctx.GetString(helper.RequestIdKey)))
}

// ListPages 获取文档关联的可见 Wiki 页面。
// @Summary 获取 Wiki 文档关联页面
// @Tags Wiki 队列
// @Produce json
// @Security BearerAuth
// @Param file_id path string true "源文档 ID（HashID）"
// @Param space_id query string true "空间 ID（HashID）"
// @Param page query int false "页码，默认 1"
// @Param size query int false "每页条数，默认 20，最大 100"
// @Success 200 {object} model.CommonResponse{data=service.WikiDocumentQueuePagesResponse}
// @Failure 400 {object} model.CommonResponse "请求参数无效"
// @Failure 401 {object} model.CommonResponse "未登录"
// @Failure 403 {object} model.CommonResponse "无权限查看空间 Wiki"
// @Failure 404 {object} model.CommonResponse "文档不存在或无权查看"
// @Router /api/wiki/queue/documents/{file_id}/pages [get]
func (c *WikiDocumentQueueController) ListPages(ctx *gin.Context) {
	req, ok := c.request(ctx, 20)
	if !ok {
		return
	}
	fileID, err := hashids.TryParseID(ctx.Param("file_id"))
	if err != nil || fileID <= 0 {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse("file_id 参数无效"))
		return
	}
	response, err := c.service.Pages(ctx.Request.Context(), req, fileID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		ctx.JSON(http.StatusNotFound, model.NotFound.ToResponse("文档不存在或无权查看"))
		return
	}
	if err != nil {
		logger.Errorf(ctx.Request.Context(), "获取 Wiki 文档关联页面失败：%v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse("获取 Wiki 文档关联页面失败"))
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponseWithRequestID(response, ctx.GetString(helper.RequestIdKey)))
}

func (c *WikiDocumentQueueController) request(ctx *gin.Context, defaultSize int) (service.WikiDocumentQueueRequest, bool) {
	eid, userID, spaceID, ok := c.queue.queueContext(ctx)
	if !ok {
		return service.WikiDocumentQueueRequest{}, false
	}
	req := service.WikiDocumentQueueRequest{Eid: eid, UserID: userID, SpaceID: spaceID, Status: strings.TrimSpace(ctx.Query("status")), Keyword: ctx.Query("keyword")}
	switch req.Status {
	case "", "pending", "processing", "failed", "success", "waiting":
	default:
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse("status 参数无效"))
		return req, false
	}
	if raw, exists := ctx.GetQuery("library_id"); exists {
		id, err := hashids.TryParseID(strings.TrimSpace(raw))
		if err != nil || id <= 0 {
			ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse("library_id 参数无效"))
			return req, false
		}
		req.LibraryID = id
	}
	page, pageErr := parseOptionalPositiveInt(ctx.Query("page"), 1)
	size, sizeErr := parseOptionalPositiveInt(ctx.Query("size"), defaultSize)
	if pageErr != nil || sizeErr != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse("分页参数无效"))
		return req, false
	}
	if size > 100 {
		size = 100
	}
	req.Page, req.Size = page, size
	return req, true
}
