package controller

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

// FeedbackRequest represents the request structure for feedback operations
type FeedbackRequest struct {
	MessageID    int64  `json:"message_id" binding:"required"`
	Question     string `json:"question" binding:"required"`      // 问题内容，用于搜索
	FeedbackType string `json:"feedback_type" binding:"required"` // satisfied, unsatisfied
	Reason       string `json:"reason"`
	Description  string `json:"description"`
}

// FeedbackListRequest represents the request structure for feedback list operations
type FeedbackListRequest struct {
	StartTime    int64  `form:"start_time" json:"start_time"`       // 开始时间
	EndTime      int64  `form:"end_time" json:"end_time"`           // 结束时间
	Question     string `form:"question" json:"question"`           // 提问内容
	FeedbackType string `form:"feedback_type" json:"feedback_type"` // 反馈类型
	Reason       string `form:"reason" json:"reason"`               // 原因
	UserID       int64  `form:"user_id" json:"user_id"`             // 用户ID
	AgentID      *int64 `form:"agent_id" json:"agent_id"`           // Agent ID 筛选
	Offset       int    `form:"offset" json:"offset"`               // 偏移量
	Limit        int    `form:"limit" json:"limit"`                 // 限制数量
}

// FeedbackConfigRequest represents the request structure for feedback configuration
type FeedbackConfigRequest struct {
	Type        string   `json:"type" form:"type" example:"message"` // message, knowledge_map
	Satisfied   []string `json:"satisfied"`
	Unsatisfied []string `json:"unsatisfied"`
}

// GetFeedbackConfig godoc
// @Summary 获取反馈配置
// @Description 获取消息反馈的配置选项
// @Tags 反馈
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param eid query int true "企业ID"
// @Param type query string false "配置类型(message, knowledge_map)"
// @Success 200 {object} model.CommonResponse{data=model.Setting}
// @Router /api/feedback/config [get]
func GetFeedbackConfig(c *gin.Context) {
	eid := config.GetEID(c)
	configType := c.DefaultQuery("type", service.FeedbackConfigTypeMessage)

	setting, err := service.GetFeedbackConfigByType(eid, configType)
	if err != nil {
		c.JSON(http.StatusOK, model.Success.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(setting))
}

// CreateFeedbackConfig godoc
// @Summary 创建或更新反馈配置
// @Description 为指定企业创建或更新反馈配置
// @Tags 反馈
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body FeedbackConfigRequest true "反馈配置信息"
// @Success 200 {object} model.CommonResponse{data=model.Setting}
// @Router /api/feedback/config [post]
func CreateFeedbackConfig(c *gin.Context) {
	eid := config.GetEID(c)

	var req FeedbackConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if req.Type == "" {
		req.Type = service.FeedbackConfigTypeMessage
	}

	// Serialize the configuration
	data, err := json.Marshal(&service.FeedbackConfig{
		Satisfied:   req.Satisfied,
		Unsatisfied: req.Unsatisfied,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// Create setting object
	setting := &model.Setting{
		Eid:       eid,
		LibraryID: 0,
		Value:     string(data),
	}

	// Save feedback config using service function
	if err := service.SaveFeedbackConfigByType(eid, req.Type, setting); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(setting))
}

// UpdateFeedbackConfig godoc
// @Summary 更新反馈配置
// @Description 更新消息反馈的配置选项
// @Tags 反馈
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body FeedbackConfigRequest true "反馈配置信息"
// @Success 200 {object} model.CommonResponse{data=model.Setting}
// @Router /api/feedback/config [put]
func UpdateFeedbackConfig(c *gin.Context) {
	eid := config.GetEID(c)

	var req FeedbackConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if req.Type == "" {
		req.Type = service.FeedbackConfigTypeMessage
	}

	setting, err := service.GetFeedbackConfigByType(eid, req.Type)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse("配置不存在，请先创建"))
		return
	}

	// Serialize the configuration
	data, err := json.Marshal(&service.FeedbackConfig{
		Satisfied:   req.Satisfied,
		Unsatisfied: req.Unsatisfied,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	setting.Value = string(data)

	if err := model.UpdateSetting(setting); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(setting))
}

// CreateFeedback godoc
// @Summary 创建反馈
// @Description 为指定消息创建反馈（点赞或点踩）
// @Tags 反馈
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body FeedbackRequest true "反馈信息"
// @Success 200 {object} model.CommonResponse{data=model.Feedback}
// @Router /api/feedback [post]
func CreateFeedback(c *gin.Context) {
	userID := config.GetUserId(c)
	eid := config.GetEID(c)

	var req FeedbackRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// Check if feedback already exists
	existingFeedback, err := model.GetFeedbackByMessageAndUser(eid, req.MessageID, userID)
	if err != nil && err.Error() != "record not found" {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// If feedback already exists, update it
	if existingFeedback != nil {
		updatedFeedback, err := service.UpdateFeedback(
			existingFeedback.ID,
			eid,
			req.FeedbackType,
			req.Question,
			req.Reason,
			req.Description,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
		c.JSON(http.StatusOK, model.Success.ToResponse(updatedFeedback))
		return
	}

	feedback, err := service.CreateFeedback(
		eid,
		req.MessageID,
		userID,
		req.FeedbackType,
		req.Question,
		req.Reason,
		req.Description,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(feedback))
}

// UpdateFeedback godoc
// @Summary 更新反馈
// @Description 更新指定反馈的内容
// @Tags 反馈
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "反馈ID"
// @Param request body FeedbackRequest true "反馈信息"
// @Success 200 {object} model.CommonResponse{data=model.Feedback}
// @Router /api/feedback/{id} [put]
func UpdateFeedback(c *gin.Context) {
	userID := config.GetUserId(c)
	eid := config.GetEID(c)

	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("无效的反馈ID"))
		return
	}

	// Check if feedback exists and belongs to user
	feedback, err := model.GetFeedbackByID(id)
	if err != nil {
		logger.Error(c.Request.Context(), "获取反馈失败: "+err.Error())
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse("反馈不存在"))
		return
	}

	if feedback.UserID != userID {
		c.JSON(http.StatusForbidden, model.ForbiddenError.ToResponse("无权限操作该反馈"))
		return
	}

	var req FeedbackRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	updatedFeedback, err := service.UpdateFeedback(
		id,
		eid,
		req.FeedbackType,
		req.Question,
		req.Reason,
		req.Description,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(updatedFeedback))
}

// DeleteFeedback godoc
// @Summary 删除反馈
// @Description 删除指定的反馈
// @Tags 反馈
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "反馈ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/feedback/{id} [delete]
func DeleteFeedback(c *gin.Context) {
	userID := config.GetUserId(c)

	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("无效的反馈ID"))
		return
	}

	// Check if feedback exists and belongs to user
	feedback, err := model.GetFeedbackByID(id)
	if err != nil {
		logger.Error(c.Request.Context(), "获取反馈失败: "+err.Error())
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse("反馈不存在"))
		return
	}

	if feedback.UserID != userID {
		c.JSON(http.StatusForbidden, model.ForbiddenError.ToResponse("无权限操作该反馈"))
		return
	}

	if err := service.DeleteFeedback(id); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{"message": "反馈删除成功"}))
}

// GetFeedbackStats godoc
// @Summary 获取企业反馈统计（管理员）
// @Description 管理员获取整个企业的反馈统计信息
// @Tags 反馈
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param start_time query int false "开始时间"
// @Param end_time query int false "结束时间"
// @Param agent_id query int false "Agent ID 筛选"
// @Success 200 {object} model.CommonResponse{data=FeedbackStatsResponse}
// @Router /api/admin/feedback/stats [get]
func GetFeedbackStats(c *gin.Context) {
	eid := config.GetEID(c)

	// 获取时间范围参数
	var req struct {
		StartTime int64  `form:"start_time" json:"start_time"`
		EndTime   int64  `form:"end_time" json:"end_time"`
		AgentID   *int64 `form:"agent_id" json:"agent_id"`
	}

	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	stats, err := service.GetEnterpriseFeedbackStats(eid, req.StartTime, req.EndTime, req.AgentID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 创建包含统计信息和当前时间的响应
	response := FeedbackStatsResponse{
		Stats: stats,
		Time:  time.Now().Unix(),
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// FeedbackStatsResponse represents the response structure for feedback stats including stats and timestamp
type FeedbackStatsResponse struct {
	Stats *model.EnterpriseFeedbackStats `json:"stats"`
	Time  int64                          `json:"time"` // 统计时间（当前时间）
}

// GetFeedbackList godoc
// @Summary 获取反馈列表（管理员）
// @Description 管理员获取所有反馈列表，支持多种查询参数和分页
// @Tags 反馈
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param start_time query int false "开始时间"
// @Param end_time query int false "结束时间"
// @Param question query string false "提问内容"
// @Param feedback_type query string false "反馈类型"
// @Param reason query string false "反馈原因"
// @Param user_id query int false "用户ID"
// @Param offset query int false "偏移量"
// @Param limit query int false "限制数量"
// @Success 200 {object} model.CommonResponse{data=FeedbackListResponse}
// @Router /api/admin/feedback [get]
func GetFeedbackList(c *gin.Context) {
	eid := config.GetEID(c)

	var req FeedbackListRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	total, feedbacks, err := model.GetFeedbackList(
		eid,
		req.StartTime,
		req.EndTime,
		req.Question,
		req.FeedbackType,
		req.Reason,
		req.UserID,
		req.Offset,
		req.Limit,
		req.AgentID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 组装 MessageInfo 和 UserInfo 到 feedbacks 中
	for _, feedback := range feedbacks {
		// 加载消息信息
		_ = feedback.LoadMessageInfo()
		// 加载用户信息
		_ = feedback.LoadUserInfo()
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&FeedbackListResponse{
		Total:     total,
		Feedbacks: feedbacks,
	}))
}

// FeedbackListResponse represents the response structure for feedback list
type FeedbackListResponse struct {
	Total     int64             `json:"total"`
	Feedbacks []*model.Feedback `json:"feedbacks"`
}

// GetFeedbackByMessageAndUser godoc
// @Summary 获取用户对指定消息的反馈
// @Description 根据消息ID和用户ID获取反馈信息
// @Tags 反馈
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param message_id query int true "消息ID"
// @Success 200 {object} model.CommonResponse{data=model.Feedback}
// @Router /api/feedback [get]
func GetFeedbackByMessageAndUser(c *gin.Context) {
	userID := config.GetUserId(c)
	eid := config.GetEID(c)

	messageIDStr := c.Query("message_id")
	messageID, err := strconv.ParseInt(messageIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("无效的消息ID"))
		return
	}

	feedback, err := model.GetFeedbackByMessageAndUser(eid, messageID, userID)
	if err != nil {
		if err.Error() == "record not found" {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse("未找到相关反馈"))
		} else {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		}
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(feedback))
}
