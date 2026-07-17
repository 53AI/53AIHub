package controller

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"runtime/debug"
	"strconv"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

// AgentMemoryRequest 更新Agent记忆请求
type AgentMemoryRequest struct {
	Items string `json:"items" example:"[{\"fact\":\"偏好简洁回答\",\"category\":\"preference\",\"source\":\"user_input\",\"time\":1718000000000}]"`
}

// AgentMemoryItemRequest 追加Agent记忆条目请求
type AgentMemoryItemRequest struct {
	Fact       string `json:"fact" binding:"required" example:"用户偏好简洁回答"`
	Category   string `json:"category,omitempty" example:"preference"` // 可选：preference | fact，其他值会被归并为 fact
	Source     string `json:"source,omitempty" example:"user_input"`
	Tags       string `json:"tags,omitempty" example:"简洁,效率"`
	Topic      string `json:"topic,omitempty" example:"回答风格"`
	Keywords   string `json:"keywords,omitempty" example:"简洁,结论优先"`
	MemoryType string `json:"memory_type,omitempty" example:"preference"`
	Evidence   string `json:"evidence,omitempty" example:"用户明确要求"`
}

// ToolLessonItemRequest 追加工具教训请求
type ToolLessonItemRequest struct {
	ToolName string `json:"tool_name" example:"web_search"`
	Lesson   string `json:"lesson" binding:"required" example:"中文内容优先用百度搜索"`
	Category string `json:"category" example:"常用工具注意事项"`
	Success  bool   `json:"success" example:"true"`
	Time     int64  `json:"time,omitempty" example:"1718000000000"` // 可选，不传则使用服务器当前时间
}

// ToolLessonsUpdateRequest 全量更新工具教训请求
type ToolLessonsUpdateRequest struct {
	Lessons string `json:"lessons" example:"[{\"tool_name\":\"web_search\",\"lesson\":\"中文优先用百度\",\"success\":true,\"time\":1718000000000}]"`
}

// checkAgentAccess 检查用户是否有权限访问智能体
// 返回 agent 对象，如果无权限则返回 nil 并设置响应
func checkAgentAccess(c *gin.Context, eid, userID, agentID int64) *model.Agent {
	// admin 跳过权限检查
	if common.IsAdmin(c) {
		agent, _ := model.GetAgentByID(eid, agentID)
		if agent == nil {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		}
		return agent
	}

	canAccess, agent, err := model.CanUserAccessAgent(eid, userID, agentID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return nil
	}
	if !canAccess {
		c.JSON(http.StatusForbidden, model.ForbiddenError.ToNewErrorResponse("无权访问该智能体"))
		return nil
	}
	return agent
}

// @Summary 获取Agent对用户的记忆（MEMORY.md）
// @Description 获取指定智能体对当前用户的记忆数据（个人智能体或企业智能体）。
// @Tags AgentMemory
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "智能体ID"
// @Success 200 {object} model.CommonResponse{data=model.AgentUserMemory} "成功返回记忆数据，无记录时返回空对象"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 403 {object} model.CommonResponse "无权访问"
// @Failure 404 {object} model.CommonResponse "智能体不存在"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/my/agents/{agent_id}/memory [get]
func GetAgentMemory(c *gin.Context) {
	agentID, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	if checkAgentAccess(c, eid, userID, agentID) == nil {
		return
	}

	memory, err := model.GetAgentUserMemory(eid, agentID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if memory == nil {
		memory = &model.AgentUserMemory{
			Items: "[]",
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(memory.WithMemoryContent()))
}

// @Summary 更新Agent对用户的记忆（MEMORY.md）
// @Description 全量替换指定智能体对当前用户的记忆。传入 items 结构化 JSON。
// @Tags AgentMemory
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "智能体ID"
// @Param body body AgentMemoryRequest true "items 结构化 JSON"
// @Success 200 {object} model.CommonResponse{data=model.AgentUserMemory} "成功返回更新后的记忆"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 403 {object} model.CommonResponse "无权访问"
// @Failure 404 {object} model.CommonResponse "智能体不存在"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/my/agents/{agent_id}/memory [put]
func UpdateAgentMemory(c *gin.Context) {
	agentID, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	var req AgentMemoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	if checkAgentAccess(c, eid, userID, agentID) == nil {
		return
	}

	memory, err := model.GetAgentUserMemory(eid, agentID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if memory == nil {
		memory = &model.AgentUserMemory{
			Eid:     eid,
			AgentID: agentID,
			UserID:  userID,
		}
	}

	var warning string
	if model.ContainsSensitiveInfo(req.Items) {
		warning = "记忆内容包含敏感信息（API Key/密码/身份证/银行卡号等），已自动脱敏处理"
	}

	incomingItems, err := model.ParseItemsJSON(req.Items)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("items JSON 格式错误: "+err.Error()))
		return
	}

	existingItems, _ := memory.GetItems()
	if err := memory.SetItems(model.MergeMemoryItemsForReplacement(existingItems, incomingItems)); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if err := memory.Upsert(); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	resp := model.Success.ToResponse(memory.WithMemoryContent())
	if warning != "" {
		resp = model.Success.ToResponseWithWarning(memory.WithMemoryContent(), warning)
	}
	c.JSON(http.StatusOK, resp)
}

// @Summary 触发Agent记忆压缩
// @Description 触发AI对Agent记忆进行压缩/总结。由后台异步处理，将Agent与用户的对话历史分析后生成新的记忆摘要。
// @Tags AgentMemory
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "智能体ID"
// @Success 200 {object} model.CommonResponse{data=map[string]string} "成功返回 {message: 压缩任务已提交}"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 403 {object} model.CommonResponse "无权访问"
// @Failure 404 {object} model.CommonResponse "智能体不存在"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/my/agents/{agent_id}/memory/compress [post]
func CompressAgentMemory(c *gin.Context) {
	agentID, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	if checkAgentAccess(c, eid, userID, agentID) == nil {
		return
	}

	go func() {
		ctx := context.Background()
		defer func() {
			if r := recover(); r != nil {
				logger.Errorf(ctx,
					"【记忆压缩】异步压缩 panic: eid=%d, agent_id=%d, user_id=%d, panic=%v\nstack:\n%s",
					eid, agentID, userID, r, debug.Stack())
			}
		}()
		compressSvc := service.NewAgentMemoryCompressService()
		if err := compressSvc.CompressAgentMemory(ctx, eid, agentID, userID, 0); err != nil {
			logger.Warnf(ctx, "【记忆压缩】压缩Agent记忆失败: eid=%d, agent_id=%d, user_id=%d, err=%v", eid, agentID, userID, err)
		}
	}()

	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{
		"message": "压缩任务已提交，后台处理中",
	}))
}

// @Summary 获取Agent工具教训（TOOLS.md）
// @Description 获取指定智能体的工具使用经验教训
// @Tags AgentMemory
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "智能体ID"
// @Success 200 {object} model.CommonResponse{data=model.AgentToolLesson} "成功返回工具教训数据，无记录时返回空对象"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 403 {object} model.CommonResponse "无权访问"
// @Failure 404 {object} model.CommonResponse "智能体不存在"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/my/agents/{agent_id}/tool-lessons [get]
func GetAgentToolLessons(c *gin.Context) {
	agentID, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	if checkAgentAccess(c, eid, userID, agentID) == nil {
		return
	}

	lessons, err := model.GetAgentToolLessons(eid, agentID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if lessons == nil {
		lessons = &model.AgentToolLesson{
			Lessons: "[]",
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(lessons))
}

// @Summary 更新Agent工具教训（TOOLS.md）
// @Description 全量替换指定智能体的工具使用经验教训
// @Tags AgentMemory
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "智能体ID"
// @Param body body ToolLessonsUpdateRequest true "工具教训数据"
// @Success 200 {object} model.CommonResponse{data=model.AgentToolLesson} "成功返回更新后的工具教训"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 403 {object} model.CommonResponse "无权访问"
// @Failure 404 {object} model.CommonResponse "智能体不存在"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/my/agents/{agent_id}/tool-lessons [put]
func UpdateAgentToolLessons(c *gin.Context) {
	agentID, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	var req ToolLessonsUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	if checkAgentAccess(c, eid, userID, agentID) == nil {
		return
	}

	lessons, err := model.GetAgentToolLessons(eid, agentID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if lessons == nil {
		lessons = &model.AgentToolLesson{
			Eid:     eid,
			AgentID: agentID,
			UserID:  userID,
		}
	}

	var lessonItems []model.ToolLessonItem
	if req.Lessons != "" && req.Lessons != "[]" {
		if err := json.Unmarshal([]byte(req.Lessons), &lessonItems); err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("lessons JSON 格式错误: "+err.Error()))
			return
		}
	}

	if err := lessons.SetLessons(lessonItems); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}
	if err := lessons.Upsert(); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(lessons))
}

// @Summary 追加工具教训条目
// @Description 向Agent的工具教训中追加一条经验教训（去重）。由LLM或系统自动调用。
// @Tags AgentMemory
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "智能体ID"
// @Param body body ToolLessonItemRequest true "工具教训条目"
// @Success 200 {object} model.CommonResponse{data=model.AgentToolLesson} "成功返回更新后的工具教训"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 403 {object} model.CommonResponse "无权访问"
// @Failure 404 {object} model.CommonResponse "智能体不存在"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/my/agents/{agent_id}/tool-lessons/append [post]
func AppendAgentToolLesson(c *gin.Context) {
	agentID, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	var req ToolLessonItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	if checkAgentAccess(c, eid, userID, agentID) == nil {
		return
	}

	now := time.Now().UnixMilli()
	if req.Time > 0 {
		now = req.Time
	}
	if err := model.AppendToolLesson(eid, agentID, userID, model.ToolLessonItem{
		ToolName: req.ToolName,
		Lesson:   req.Lesson,
		Category: req.Category,
		Success:  req.Success,
		Time:     now,
	}); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	lessons, err := model.GetAgentToolLessons(eid, agentID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(lessons))
}

// @Summary 删除单条工具教训
// @Description 删除指定索引位置的工具教训条目
// @Tags AgentMemory
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "智能体ID"
// @Param index path int true "教训条目索引（从0开始）"
// @Success 200 {object} model.CommonResponse{data=model.AgentToolLesson} "成功返回更新后的工具教训"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 403 {object} model.CommonResponse "无权访问"
// @Failure 404 {object} model.CommonResponse "智能体不存在或索引超出范围"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/my/agents/{agent_id}/tool-lessons/{index} [delete]
func DeleteAgentToolLessonItem(c *gin.Context) {
	agentID, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	index, err := strconv.Atoi(c.Param("index"))
	if err != nil || index < 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	if checkAgentAccess(c, eid, userID, agentID) == nil {
		return
	}

	lessons, err := model.GetAgentToolLessons(eid, agentID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if lessons == nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	if err := model.DeleteToolLessonByIndex(eid, agentID, userID, index); err != nil {
		switch {
		case errors.Is(err, model.ErrToolLessonRecordNotFound), errors.Is(err, model.ErrToolLessonIndexOutOfRange):
			c.JSON(http.StatusNotFound, model.NotFound.ToNewErrorResponse(err.Error()))
		default:
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		}
		return
	}

	// 重新读取最新状态返回
	lessons, err = model.GetAgentToolLessons(eid, agentID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(lessons))
}

// @Summary 追加单条Agent记忆
// @Description 向指定智能体的记忆中追加一条结构化记忆条目（去重）。自动同步生成 Markdown 快照。
// @Tags AgentMemory
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "智能体ID"
// @Param body body AgentMemoryItemRequest true "记忆条目"
// @Success 200 {object} model.CommonResponse{data=model.AgentUserMemory} "成功返回更新后的记忆"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 403 {object} model.CommonResponse "无权访问"
// @Failure 404 {object} model.CommonResponse "智能体不存在"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/my/agents/{agent_id}/memory/items [post]
func AppendAgentMemoryItem(c *gin.Context) {
	agentID, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	var req AgentMemoryItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	if checkAgentAccess(c, eid, userID, agentID) == nil {
		return
	}

	var warning string
	if model.ContainsSensitiveInfo(req.Fact) ||
		model.ContainsSensitiveInfo(req.Tags) ||
		model.ContainsSensitiveInfo(req.Topic) ||
		model.ContainsSensitiveInfo(req.Keywords) ||
		model.ContainsSensitiveInfo(req.Evidence) {
		warning = "记忆内容包含敏感信息（API Key/密码/身份证/银行卡号等），已自动脱敏处理"
	}

	normalizedCategory := model.NormalizeMemoryCategory(req.Category)

	now := time.Now().UnixMilli()
	item := model.NormalizeMemoryItem(model.MemoryItem{
		Fact:       req.Fact,
		Category:   normalizedCategory,
		Source:     model.NormalizeMemorySource(req.Source, "user_input"),
		Tags:       req.Tags,
		Topic:      req.Topic,
		Keywords:   req.Keywords,
		MemoryType: req.MemoryType,
		Evidence:   req.Evidence,
		Time:       now,
	}, "user_input")

	if err := model.AppendAgentMemoryItem(eid, agentID, userID, item); err != nil {
		if errors.Is(err, model.ErrMemoryVersionConflict) {
			c.JSON(http.StatusConflict, gin.H{
				"code":    http.StatusConflict,
				"message": "记忆并发冲突，请稍后重试",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	memory, err := model.GetAgentUserMemory(eid, agentID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	resp := model.Success.ToResponse(memory.WithMemoryContent())
	if warning != "" {
		resp = model.Success.ToResponseWithWarning(memory.WithMemoryContent(), warning)
	}
	c.JSON(http.StatusOK, resp)
}

// AgentMemoryTypeItem 智能体记忆类型条目
type AgentMemoryTypeItem struct {
	Name string `json:"name" example:"MEMORY.md"`
	Path string `json:"path" example:"/api/my/agents/10/memory"`
}

// @Summary 获取智能体记忆列表（固定数据）
// @Description 返回当前智能体支持的记忆类型列表，前端据此渲染标签页。固定返回 MEMORY.md 和 TOOLS.md 两个条目。
// @Tags AgentMemory
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "智能体ID"
// @Success 200 {object} model.CommonResponse{data=[]AgentMemoryTypeItem} "成功返回记忆类型列表"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 403 {object} model.CommonResponse "无权访问"
// @Failure 404 {object} model.CommonResponse "智能体不存在"
// @Router /api/my/agents/{agent_id}/memory-list [get]
func GetAgentMemoryList(c *gin.Context) {
	agentID, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	if checkAgentAccess(c, eid, userID, agentID) == nil {
		return
	}

	encodedID, err := hashids.Encode(agentID)
	if err != nil {
		encodedID = strconv.FormatInt(agentID, 10)
	}

	result := []AgentMemoryTypeItem{
		{Name: "MEMORY.md", Path: fmt.Sprintf("/api/my/agents/%s/memory", encodedID)},
		{Name: "TOOLS.md", Path: fmt.Sprintf("/api/my/agents/%s/tool-lessons", encodedID)},
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(result))
}

// @Summary 删除单条Agent记忆条目
// @Description 删除指定索引位置的Agent记忆条目。自动同步生成 Markdown 快照。
// @Tags AgentMemory
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "智能体ID"
// @Param index path int true "记忆条目索引（从0开始）"
// @Success 200 {object} model.CommonResponse{data=model.AgentUserMemory} "成功返回更新后的记忆"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 403 {object} model.CommonResponse "无权访问"
// @Failure 404 {object} model.CommonResponse "智能体不存在或索引超出范围"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/my/agents/{agent_id}/memory/items/{index} [delete]
func DeleteAgentMemoryItem(c *gin.Context) {
	agentID, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	index, err := strconv.Atoi(c.Param("index"))
	if err != nil || index < 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	if checkAgentAccess(c, eid, userID, agentID) == nil {
		return
	}

	if err := model.DeleteAgentMemoryItemByIndex(eid, agentID, userID, index); err != nil {
		switch {
		case errors.Is(err, model.ErrMemoryItemShifted), errors.Is(err, model.ErrMemoryVersionConflict):
			c.JSON(http.StatusConflict, gin.H{
				"code":    http.StatusConflict,
				"message": "记忆并发冲突，请稍后重试",
			})
			return
		case errors.Is(err, model.ErrMemoryRecordNotFound), errors.Is(err, model.ErrMemoryIndexOutOfRange):
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
			return
		default:
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
	}

	memory, err := model.GetAgentUserMemory(eid, agentID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(memory.WithMemoryContent()))
}
