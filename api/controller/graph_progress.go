package controller

import (
	"errors"
	"net/http"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// GraphProgressController 图谱管线进度控制器（对齐 Wiki 进度接口形态）。
type GraphProgressController struct {
	progressSvc service.GraphProgressService
}

type GraphProgressQuery struct {
	Status string `form:"status"`
	Offset int    `form:"offset"`
	Limit  int    `form:"limit"`
}

// NewGraphProgressController 创建图谱管线进度控制器
func NewGraphProgressController(db *gorm.DB) *GraphProgressController {
	return &GraphProgressController{progressSvc: service.NewGraphProgressService(db)}
}

// parseGraphPathID 解析路径参数 ID，支持 hashID 与纯数字（>0）
func parseGraphPathID(raw string) (int64, bool) {
	id, err := hashids.TryParseID(strings.TrimSpace(raw))
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

// ListProgress godoc
// @Summary 获取空间图谱管线进度列表
// @Description 列出知识库内全部文件及其最新图谱管线进度
// @Tags 图谱管线
// @Produce json
// @Security BearerAuth
// @Param space_id path string true "空间ID（hashID 或原始 int64）"
// @Param library_id query string true "知识库ID（hashID 或原始 int64）"
// @Param status query string false "状态过滤，支持 not_started,pending,processing,success,failed，不传或 all 返回全部"
// @Param offset query int false "分页偏移量"
// @Param limit query int false "每页条数"
// @Success 200 {object} model.CommonResponse{data=object{items=[]service.GraphProgressItem,total=int64}}
// @Failure 400 {object} model.CommonResponse "请求参数错误"
// @Failure 403 {object} model.CommonResponse "无权限查看空间"
// @Failure 404 {object} model.CommonResponse "空间不存在"
// @Router /api/spaces/{space_id}/graph/progress [get]
func (c *GraphProgressController) ListProgress(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	spaceID, ok := parseGraphPathID(ctx.Param("space_id"))
	if !ok {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("space_id 参数无效")))
		return
	}
	if !requireGraphSpaceView(ctx, eid, config.GetUserId(ctx), spaceID) {
		return
	}
	var query GraphProgressQuery
	if err := ctx.ShouldBindQuery(&query); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	libraryID, ok := parseGraphPathID(ctx.Query("library_id"))
	if !ok {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("library_id 必填")))
		return
	}

	items, total, err := c.progressSvc.ListFiles(ctx.Request.Context(), service.GraphProgressListRequest{
		Eid:       eid,
		LibraryID: libraryID,
		Status:    query.Status,
		Offset:    query.Offset,
		Limit:     query.Limit,
	})
	if err != nil {
		logger.Errorf(ctx.Request.Context(), "graph list progress failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(gin.H{
		"items": items,
		"total": total,
	}))
}

// GetProgress godoc
// @Summary 获取空间图谱管线文件进度详情
// @Description 获取空间内某文件的图谱管线任务及其步骤详情
// @Tags 图谱管线
// @Produce json
// @Security BearerAuth
// @Param space_id path string true "空间ID（hashID 或原始 int64）"
// @Param file_id path string true "文件ID（hashID 或原始 int64）"
// @Success 200 {object} model.CommonResponse{data=service.GraphProgressDetail}
// @Failure 400 {object} model.CommonResponse "请求参数错误"
// @Failure 403 {object} model.CommonResponse "无权限查看空间"
// @Failure 404 {object} model.CommonResponse "空间或文件不存在"
// @Router /api/spaces/{space_id}/graph/progress/{file_id} [get]
func (c *GraphProgressController) GetProgress(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	spaceID, ok := parseGraphPathID(ctx.Param("space_id"))
	if !ok {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("space_id 参数无效")))
		return
	}
	if !requireGraphSpaceView(ctx, eid, config.GetUserId(ctx), spaceID) {
		return
	}

	fileID, ok := parseGraphPathID(ctx.Param("file_id"))
	if !ok {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("file_id 参数无效")))
		return
	}

	detail, err := c.progressSvc.GetFile(ctx.Request.Context(), eid, spaceID, fileID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			ctx.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("图谱进度不存在")))
			return
		}
		logger.Errorf(ctx.Request.Context(), "graph get progress failed: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(detail))
}

// requireGraphSpaceView 校验空间可见性（与空间图谱配置接口一致）
func requireGraphSpaceView(ctx *gin.Context, eid, userID, spaceID int64) bool {
	sps := service.NewSpacePermissionService(eid)
	canView, err := sps.CheckSpacePermission(userID, spaceID, model.PERMISSION_PUBLIC_ONLY)
	if (!canView || err != nil) && !common.IsAdmin(ctx) {
		ctx.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(errors.New("无权限访问此空间")))
		return false
	}
	return true
}
