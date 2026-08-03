package controller

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

type UpdateRecordingConfigRequest struct {
	Enabled               *bool   `json:"enabled"`
	ParserPlatform        *string `json:"parser_platform"`
	VoiceModelID          *int64  `json:"voice_model_id"`
	VoiceModelName        *string `json:"voice_model_name"`
	InferenceModelID      *int64  `json:"inference_model_id"`
	InferenceModelName    *string `json:"inference_model_name"`
	RecordingAgentEnabled *bool   `json:"recording_agent_enabled"`
}

type ListRecordingsRequest struct {
	UserIDs   string `form:"user_ids"`
	Keyword   string `form:"keyword"`
	StartTime int64  `form:"start_time"`
	EndTime   int64  `form:"end_time"`
	Offset    int    `form:"offset"`
	Limit     int    `form:"limit"`
	GroupID   int64  `form:"group_id"`
	SortBy    string `form:"sort_by"`
	Order     string `form:"order"`
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

	if req.Enabled == nil && req.ParserPlatform == nil && req.VoiceModelID == nil && req.InferenceModelID == nil && req.InferenceModelName == nil && req.RecordingAgentEnabled == nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("至少需要一个参数")))
		return
	}

	if req.ParserPlatform != nil && *req.ParserPlatform != "" && !service.IsValidParserPlatform(*req.ParserPlatform) {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("不支持的解析平台: %s", *req.ParserPlatform)))
		return
	}

	svc := service.NewRecordingAdminService(eid)
	if err := svc.UpdateRecordingConfig(c, req.Enabled, req.ParserPlatform, req.VoiceModelID, req.VoiceModelName, req.InferenceModelID, req.InferenceModelName, req.RecordingAgentEnabled); err != nil {
		logger.SysErrorf("【录音配置】更新失败: eid=%d err=%v", eid, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}

	logger.Infof(c, "【录音配置】更新成功: eid=%d", eid)
	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{"ok": true}))
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
// @Param sort_by query string false "排序字段(created_time/updated_time)" Enums(created_time, updated_time)
// @Param order query string false "排序方向(asc/desc)" Enums(asc, desc)
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
	result, err := svc.ListRecordings(c, userIDs, req.Keyword, req.StartTime, req.EndTime, req.Offset, req.Limit, req.GroupID, req.SortBy, req.Order)
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

type SummaryTemplateRequest struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
	Prompt      string `json:"prompt" binding:"required"`
	GroupID     *int64 `json:"group_id"`
}

// ListSummaryTemplates godoc
// @Summary 获取总结模板列表
// @Description 获取企业已配置的总结模板列表，支持按分组筛选
// @Tags 录音管理
// @Produce json
// @Security BearerAuth
// @Param group_id query int false "按分组 ID 筛选（0 或空表示全部）"
// @Success 200 {object} model.CommonResponse{data=[]model.RecordingSummaryTemplate}
// @Router /api/admin/recordings/templates [get]
func ListSummaryTemplates(c *gin.Context) {
	eid := config.GetEID(c)
	groupID, _ := strconv.ParseInt(c.Query("group_id"), 10, 64)
	svc := service.NewRecordingAdminService(eid)
	templates, err := svc.ListSummaryTemplates(c, groupID)
	if err != nil {
		logger.SysErrorf("【录音管理】获取总结模板列表失败: eid=%d err=%v", eid, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(templates))
}

// CreateSummaryTemplate godoc
// @Summary 创建总结模板
// @Description 创建新的总结模板
// @Tags 录音管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body controller.SummaryTemplateRequest true "模板创建请求"
// @Success 200 {object} model.CommonResponse{data=model.RecordingSummaryTemplate}
// @Router /api/admin/recordings/templates [post]
func CreateSummaryTemplate(c *gin.Context) {
	eid := config.GetEID(c)
	var req SummaryTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	groupID := int64(0)
	if req.GroupID != nil {
		groupID = *req.GroupID
	}

	svc := service.NewRecordingAdminService(eid)
	template, err := svc.CreateSummaryTemplate(c, req.Name, req.Description, req.Prompt, groupID)
	if err != nil {
		logger.SysErrorf("【录音管理】创建总结模板失败: eid=%d err=%v", eid, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(template))
}

// UpdateSummaryTemplate godoc
// @Summary 更新总结模板
// @Description 更新总结模板
// @Tags 录音管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param template_id path int true "模板ID"
// @Param request body controller.SummaryTemplateRequest true "模板更新请求"
// @Success 200 {object} model.CommonResponse
// @Router /api/admin/recordings/templates/{template_id} [put]
func UpdateSummaryTemplate(c *gin.Context) {
	eid := config.GetEID(c)
	templateID, err := hashids.TryParseID(c.Param("template_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	var req SummaryTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	groupID := int64(0)
	if req.GroupID != nil {
		groupID = *req.GroupID
	}

	svc := service.NewRecordingAdminService(eid)
	if err := svc.UpdateSummaryTemplate(c, templateID, req.Name, req.Description, req.Prompt, groupID); err != nil {
		logger.SysErrorf("【录音管理】更新总结模板失败: eid=%d err=%v", eid, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{"ok": true}))
}

// DeleteSummaryTemplate godoc
// @Summary 删除总结模板
// @Description 删除总结模板
// @Tags 录音管理
// @Produce json
// @Security BearerAuth
// @Param template_id path int true "模板ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/admin/recordings/templates/{template_id} [delete]
func DeleteSummaryTemplate(c *gin.Context) {
	eid := config.GetEID(c)
	templateID, err := hashids.TryParseID(c.Param("template_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	svc := service.NewRecordingAdminService(eid)
	if err := svc.DeleteSummaryTemplate(c, templateID); err != nil {
		logger.SysErrorf("【录音管理】删除总结模板失败: eid=%d err=%v", eid, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{"ok": true}))
}

// AdminCreateFileSummary godoc
// @Summary 后台生成文件总结
// @Description 对已解析文件生成总结
// @Tags 录音管理
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Param template_id query int true "模板ID"
// @Success 200 {object} model.CommonResponse{data=model.RecordingFileSummary}
// @Router /api/admin/recordings/files/{file_id}/summarize [post]
func AdminCreateFileSummary(c *gin.Context) {
	eid := config.GetEID(c)
	fileID, err := hashids.TryParseID(c.Param("file_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	templateID, err := hashids.TryParseID(c.Query("template_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("缺少 template_id 参数")))
		return
	}

	svc := service.NewRecordingAdminService(eid)
	summary, err := svc.CreateFileSummary(c, fileID, templateID)
	if err != nil {
		logger.SysErrorf("【录音管理】生成总结失败: eid=%d file_id=%d err=%v", eid, fileID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(summary))
}

// AdminListFileSummaries godoc
// @Summary 后台获取文件总结列表
// @Description 获取文件的所有总结
// @Tags 录音管理
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Success 200 {object} model.CommonResponse{data=[]model.RecordingFileSummary}
// @Router /api/admin/recordings/files/{file_id}/summaries [get]
func AdminListFileSummaries(c *gin.Context) {
	eid := config.GetEID(c)
	fileID, err := hashids.TryParseID(c.Param("file_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	svc := service.NewRecordingAdminService(eid)
	summaries, err := svc.ListFileSummaries(c, fileID)
	if err != nil {
		logger.SysErrorf("【录音管理】获取总结列表失败: eid=%d file_id=%d err=%v", eid, fileID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(summaries))
}

// AdminDeleteFileSummary godoc
// @Summary 后台删除文件总结
// @Description 删除总结
// @Tags 录音管理
// @Produce json
// @Security BearerAuth
// @Param summary_id path int true "总结ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/admin/recordings/summaries/{summary_id} [delete]
func AdminDeleteFileSummary(c *gin.Context) {
	eid := config.GetEID(c)
	summaryID, err := hashids.TryParseID(c.Param("summary_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	svc := service.NewRecordingAdminService(eid)
	if err := svc.DeleteFileSummary(c, summaryID); err != nil {
		logger.SysErrorf("【录音管理】删除总结失败: eid=%d summary_id=%d err=%v", eid, summaryID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{"ok": true}))
}

// GetParsingCount godoc
// @Summary 获取录音文件解析进度统计
// @Description 返回指定用户列表的录音文件解析中数量
// @Tags 录音管理
// @Produce json
// @Security BearerAuth
// @Param user_ids query string false "成员ID筛选（逗号分隔，如 1,2,3）"
// @Success 200 {object} model.CommonResponse{data=map[int64]int64}
// @Router /api/admin/recordings/parsing-count [get]
func GetParsingCount(c *gin.Context) {
	eid := config.GetEID(c)
	userIDs := parseUserIDs(c.Query("user_ids"))

	svc := service.NewRecordingAdminService(eid)
	result, err := svc.CountParsingStats(c, userIDs)
	if err != nil {
		logger.SysErrorf("【录音管理】查询解析统计失败: eid=%d err=%v", eid, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}

	userCounts := make([]map[string]int64, 0)
	for uid, count := range result {
		userCounts = append(userCounts, map[string]int64{"user_id": uid, "parsing_count": count})
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{"user_counts": userCounts}))
}

// GetQueueDepth godoc
// @Summary 查询 RAG 管线队列深度
// @Description 返回各步骤当前排队任务数
// @Tags 录音管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=object} "队列深度"
// @Router /api/admin/recordings/queue-depth [get]
func GetQueueDepth(c *gin.Context) {
	result := service.GetQueueDepth(c.Request.Context())
	c.JSON(http.StatusOK, model.Success.ToResponse(result))
}
