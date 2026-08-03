package controller

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var agentAPIKeyService = service.NewAgentAPIKeyService()

type CreateAgentAPIKeyRequest struct {
	AgentID     int64 `json:"agent_id" binding:"required" example:"1"`
	ExpiredDays int   `json:"expired_days" example:"0"`
}

type CreateAgentAPIKeyResponse struct {
	SecretKey string `json:"secret_key"`
	AgentID   int64  `json:"agent_id"`
	Source    string `json:"source"`
	ExpiresAt int64  `json:"expires_at"`
	Status    string `json:"status"`
}

type AgentAPIKeyItem struct {
	ID        int64  `json:"id"`
	AgentID   int64  `json:"agent_id"`
	Source    string `json:"source"`
	SecretKey string `json:"secret_key"`
	Status    string `json:"status"`
	ExpiresAt int64  `json:"expires_at"`
	CreatedAt int64  `json:"created_at"`
}

type ListAgentAPIKeyResponse struct {
	Count int64              `json:"count"`
	List  []*AgentAPIKeyItem `json:"list"`
}

// @Summary 创建 Agent API 密钥
// @Description 为指定 agent 创建一个 API 密钥（secret_key 仅在创建时返回一次）
// @Tags Agent
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body CreateAgentAPIKeyRequest true "API 密钥参数"
// @Success 200 {object} model.CommonResponse{data=CreateAgentAPIKeyResponse} "Success"
// @Router /api/agents/api/keys [post]
func CreateAgentAPIKey(c *gin.Context) {
	var req CreateAgentAPIKeyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)
	ttl := time.Duration(req.ExpiredDays) * 24 * time.Hour

	record, err := agentAPIKeyService.CreateAPIKey(c.Request.Context(), eid, req.AgentID, ttl)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
			return
		}
		c.JSON(http.StatusBadRequest, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&CreateAgentAPIKeyResponse{
		SecretKey: record.Token,
		AgentID:   record.AgentID,
		Source:    record.Source,
		ExpiresAt: record.ExpiresAt,
		Status:    record.Status,
	}))
}

type ListAgentAPIKeyRequest struct {
	AgentID int64 `json:"agent_id" form:"agent_id" example:"1"`
	Offset  int   `json:"offset" form:"offset" example:"0"`
	Limit   int   `json:"limit" form:"limit" example:"10"`
}

// @Summary 获取 Agent API 密钥列表
// @Description 获取企业下所有 Agent API 密钥，secret_key 只显示前 8 位掩码
// @Tags Agent
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id query int false "agent_id 过滤（可选）"
// @Param offset query int false "偏移量" default(0)
// @Param limit query int false "每页数量" default(10)
// @Success 200 {object} model.CommonResponse{data=ListAgentAPIKeyResponse} "Success"
// @Router /api/agents/api/keys [get]
func ListAgentAPIKey(c *gin.Context) {
	var req ListAgentAPIKeyRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if req.Limit == 0 {
		req.Limit = 10
	}

	eid := config.GetEID(c)
	total, records, err := model.GetAgentAccessKeyList(eid, req.AgentID, model.SourceAPI, req.Offset, req.Limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	items := make([]*AgentAPIKeyItem, 0, len(records))
	for _, r := range records {
		items = append(items, &AgentAPIKeyItem{
			ID:        r.ID,
			AgentID:   r.AgentID,
			Source:    r.Source,
			SecretKey: r.Token,
			Status:    r.Status,
			ExpiresAt: r.ExpiresAt,
			CreatedAt: r.CreatedTime,
		})
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(ListAgentAPIKeyResponse{
		Count: total,
		List:  items,
	}))
}

// @Summary 轮换 Agent API 密钥
// @Description 生成新密钥，旧密钥标记为 rotated 状态（重叠期内仍可用）
// @Tags Agent
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "密钥 ID"
// @Success 200 {object} model.CommonResponse{data=CreateAgentAPIKeyResponse} "Success"
// @Router /api/agents/api/keys/{id}/rotate [post]
func RotateAgentAPIKey(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("invalid key id")))
		return
	}

	eid := config.GetEID(c)

	existingKey, err := model.GetAgentAccessKeyByID(id, eid)
	if err != nil {
		if errors.Is(err, model.ErrAgentAccessKeyNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
			return
		}
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if existingKey.Source != model.SourceAPI {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("key is not an API key")))
		return
	}

	if err := model.UpdateAgentAccessKeyStatus(id, "rotated"); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	var ttl time.Duration
	if existingKey.ExpiresAt > 0 {
		remaining := time.Until(time.UnixMilli(existingKey.ExpiresAt))
		if remaining > 0 {
			ttl = remaining
		}
	}

	newKey, err := model.CreateAgentAccessKey(eid, existingKey.AgentID, model.SourceAPI, ttl)
	if err != nil {
		_ = model.UpdateAgentAccessKeyStatus(id, "active")
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&CreateAgentAPIKeyResponse{
		SecretKey: newKey.Token,
		AgentID:   newKey.AgentID,
		Source:    newKey.Source,
		ExpiresAt: newKey.ExpiresAt,
		Status:    newKey.Status,
	}))
}

// @Summary 吊销 Agent API 密钥
// @Description 将密钥状态设为 revoked，吊销后密钥立即失效
// @Tags Agent
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "密钥 ID"
// @Success 200 {object} model.CommonResponse{data=map[string]bool} "Success"
// @Router /api/agents/api/keys/{id} [delete]
func RevokeAgentAPIKey(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("invalid key id")))
		return
	}

	eid := config.GetEID(c)

	existingKey, err := model.GetAgentAccessKeyByID(id, eid)
	if err != nil {
		if errors.Is(err, model.ErrAgentAccessKeyNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
			return
		}
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if existingKey.Source != model.SourceAPI {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("key is not an API key")))
		return
	}

	if existingKey.Status == "revoked" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("key already revoked")))
		return
	}

	if err := model.UpdateAgentAccessKeyStatus(id, "revoked"); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]bool{"revoked": true}))
}
