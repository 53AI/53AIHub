package controller

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

type UpdateRecordingConfigRequest struct {
	Enabled        *bool   `json:"enabled"`
	ParserPlatform *string `json:"parser_platform"`
}

type ListRecordingsRequest struct {
	UserIDs   string `form:"user_ids"`
	Keyword   string `form:"keyword"`
	StartTime int64  `form:"start_time"`
	EndTime   int64  `form:"end_time"`
	Offset    int    `form:"offset"`
	Limit     int    `form:"limit"`
}

type RecordingStatsRequest struct {
	UserIDs   string `form:"user_ids"`
	StartTime int64  `form:"start_time"`
	EndTime   int64  `form:"end_time"`
}

func parseUserIDs(s string) []int64 {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	var ids []int64
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if id, err := strconv.ParseInt(part, 10, 64); err == nil && id > 0 {
			ids = append(ids, id)
		}
	}
	return ids
}

// GetRecordingConfig godoc
// @Summary 获取录音配置
// @Description 获取录音功能开关和解析平台选择
// @Tags 录音管理
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=service.RecordingConfigResult}
// @Router /api/admin/recordings/config [get]
func GetRecordingConfig(c *gin.Context) {
	eid := config.GetEID(c)
	svc := service.NewRecordingAdminService(eid)

	result, err := svc.GetRecordingConfig(c)
	if err != nil {
		logger.SysErrorf("【录音配置】获取失败: eid=%d err=%v", eid, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(result))
}

// UpdateRecordingConfig godoc
// @Summary 更新录音配置
// @Description 更新录音功能开关和解析平台选择
// @Tags 录音管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body controller.UpdateRecordingConfigRequest true "配置更新请求"
// @Success 200 {object} model.CommonResponse
// @Router /api/admin/recordings/config [put]
func UpdateRecordingConfig(c *gin.Context) {
	eid := config.GetEID(c)

	var req UpdateRecordingConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if req.Enabled == nil && req.ParserPlatform == nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("至少需要一个参数: enabled 或 parser_platform")))
		return
	}

	if req.ParserPlatform != nil && *req.ParserPlatform != "" {
		if _, ok := model.GetDefaultPlatformSettingDisplayMeta(*req.ParserPlatform); !ok {
			c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(fmt.Errorf("不支持的解析平台: %s", *req.ParserPlatform)))
			return
		}
	}

	svc := service.NewRecordingAdminService(eid)
	if err := svc.UpdateRecordingConfig(c, req.Enabled, req.ParserPlatform); err != nil {
		logger.SysErrorf("【录音配置】更新失败: eid=%d err=%v", eid, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}

	logger.Infof(c, "【录音配置】更新成功: eid=%d", eid)
	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{"ok": true}))
}

// ListParserPlatforms godoc
// @Summary 获取可用解析平台列表
// @Description 获取已配置且可用的解析平台列表（从platform_settings获取）
// @Tags 录音管理
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=[]service.ParserPlatformResult}
// @Router /api/admin/recordings/parser-platforms [get]
func ListParserPlatforms(c *gin.Context) {
	eid := config.GetEID(c)
	svc := service.NewRecordingAdminService(eid)

	platforms, err := svc.ListParserPlatforms(c)
	if err != nil {
		logger.SysErrorf("【录音管理】获取解析平台列表失败: eid=%d err=%v", eid, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{"platforms": platforms}))
}

// ListAllRecordings godoc
// @Summary 获取所有录音列表（管理员）
// @Description 分页查询企业所有用户的录音文件，支持按成员、名称、时间筛选
// @Tags 录音管理
// @Produce json
// @Security BearerAuth
// @Param user_ids query string false "成员ID筛选（逗号分隔，如 1,2,3）"
// @Param keyword query string false "文件名称模糊搜索"
// @Param start_time query int false "开始时间（毫秒时间戳）"
// @Param end_time query int false "结束时间（毫秒时间戳）"
// @Param offset query int false "偏移量" default(0)
// @Param limit query int false "每页数量" default(20)
// @Success 200 {object} model.CommonResponse{data=service.RecordingListResult}
// @Router /api/admin/recordings [get]
func ListAllRecordings(c *gin.Context) {
	eid := config.GetEID(c)

	var req ListRecordingsRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if req.Offset < 0 {
		req.Offset = 0
	}
	if req.Limit <= 0 || req.Limit > 100 {
		req.Limit = 20
	}

	userIDs := parseUserIDs(req.UserIDs)

	svc := service.NewRecordingAdminService(eid)
	result, err := svc.ListRecordings(c, userIDs, req.Keyword, req.StartTime, req.EndTime, req.Offset, req.Limit)
	if err != nil {
		logger.SysErrorf("【录音列表】查询失败: eid=%d err=%v", eid, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(result))
}

// GetRecordingStats godoc
// @Summary 获取录音数据统计
// @Description 获取录音总数、磁盘存储、录音总时长，支持按成员和创建时间筛选
// @Tags 录音管理
// @Produce json
// @Security BearerAuth
// @Param user_ids query string false "成员ID筛选（逗号分隔，如 1,2,3）"
// @Param start_time query int false "开始时间（毫秒时间戳）"
// @Param end_time query int false "结束时间（毫秒时间戳）"
// @Success 200 {object} model.CommonResponse{data=service.RecordingStatsResult}
// @Router /api/admin/recordings/stats [get]
func GetRecordingStats(c *gin.Context) {
	eid := config.GetEID(c)

	var req RecordingStatsRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	userIDs := parseUserIDs(req.UserIDs)

	svc := service.NewRecordingAdminService(eid)
	result, err := svc.GetRecordingStats(c, userIDs, req.StartTime, req.EndTime)
	if err != nil {
		logger.SysErrorf("【录音统计】查询失败: eid=%d err=%v", eid, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(result))
}
