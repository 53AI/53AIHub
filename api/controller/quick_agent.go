package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/middleware"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

type QuickAgentCreateRequest struct {
	AgentID int64 `json:"agent_id" binding:"required"`
}

type QuickAgentPinRequest struct {
	IsPinned bool `json:"is_pinned" binding:"required"`
}

// @Summary 获取已添加快捷的 Agent ID 列表（Hashids 编码）
// @Description 返回当前用户已在 user_agent_shortcuts 表中添加的所有 agentID（Hashids 编码），前端用于判断哪些 agent 已添加
// @Tags AgentShortcut
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=[]string}
// @Router /api/my/agent-shortcuts/ids [get]
func GetUserAgentShortcutIDs(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	ids, err := model.QueryUserAgentShortcutIDs(eid, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	encodedIDs, err := middleware.BatchEncodeIDs(ids)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	if encodedIDs == nil {
		encodedIDs = []string{}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(encodedIDs))
}

// @Summary 添加快捷 Agent
// @Description 将 Agent 添加到用户的快捷列表中（短时间重复添加幂等）
// @Tags AgentShortcut
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param req body QuickAgentCreateRequest true "Agent ID"
// @Success 200 {object} model.CommonResponse{data=model.UserAgentShortcut}
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/my/agent-shortcuts [post]
func CreateUserAgentShortcut(c *gin.Context) {
	var req QuickAgentCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 校验 agent 是否存在
	if _, err := model.GetAgentByID(eid, req.AgentID); err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	shortcut, err := model.CreateUserAgentShortcut(eid, userID, req.AgentID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(shortcut))
}

// @Summary 获取快捷 Agent 列表
// @Description 获取当前用户的 Agent 快捷列表，按置顶+最近消息时间排序。
// @Description 列表包含用户手动添加的快捷记录，以及 AgentUsageSearch 和 AgentUsageWorkAI 两种默认内置 agent（用户无需手动添加）。
// @Tags AgentShortcut
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=[]model.UserAgentShortcutResponse}
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/my/agent-shortcuts [get]
func GetUserAgentShortcuts(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	results, err := model.GetUserAgentShortcuts(eid, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 确保空列表返回 [] 而非 null
	if results == nil {
		results = []*model.UserAgentShortcutResponse{}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(results))
}

// @Summary 移除快捷 Agent
// @Description 从用户的快捷列表中移除指定 Agent。
// @Description 注意：AgentUsageSearch 和 AgentUsageWorkAI 两种默认内置 agent 无法被移除，它们始终在列表中。
// @Tags AgentShortcut
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "Agent ID"
// @Success 200 {object} model.CommonResponse
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 404 {object} model.CommonResponse "快捷记录不存在"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/my/agent-shortcuts/{agent_id} [delete]
func DeleteUserAgentShortcut(c *gin.Context) {
	agentID, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	if err := model.DeleteUserAgentShortcut(eid, userID, agentID); err != nil {
		if errors.Is(err, model.ErrShortcutNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		} else {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		}
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// @Summary 置顶/取消置顶快捷 Agent
// @Description 设置 Agent 是否置顶，置顶的 agent 会排在列表最前面
// @Tags AgentShortcut
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id path int true "Agent ID"
// @Param req body QuickAgentPinRequest true "置顶状态"
// @Success 200 {object} model.CommonResponse
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "未授权"
// @Failure 404 {object} model.CommonResponse "快捷记录不存在"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/my/agent-shortcuts/{agent_id}/pin [patch]
func UpdateUserAgentShortcutPin(c *gin.Context) {
	agentID, err := strconv.ParseInt(c.Param("agent_id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	var req QuickAgentPinRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	if err := model.UpdateUserAgentShortcutPin(eid, userID, agentID, req.IsPinned); err != nil {
		if errors.Is(err, model.ErrShortcutNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		} else {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		}
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}
