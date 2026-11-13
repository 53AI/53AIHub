package controller

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/middleware"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/botgateway"
	"github.com/gin-gonic/gin"
)

// BotGatewayCreateBinding token 优先建绑：网关签发 bot_token 并加密落库，返回填 saas 平台的回调地址。
// @Summary 创建 bot 绑定
// @Description token 优先创建绑定（必填 agent_id/token，bot_id/device_id/name 选填），返回 bot_token 与含 bot_token 的回调地址
// @Tags BotGateway
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body object true "绑定参数 {agent_id, token, provider, bot_id?, device_id?, name?}"
// @Success 200 {object} model.CommonResponse{data=object} "Success"
// @Router /api/bot-gateway/binds [post]
func BotGatewayCreateBinding(c *gin.Context) {
	var req struct {
		AgentID  int64  `json:"agent_id"`
		Token    string `json:"token"` // 必填：saas 平台专属 token
		Provider string `json:"provider"`
		BotID    string `json:"bot_id"`    // 选填：已知 botId 直接填入
		DeviceID string `json:"device_id"` // 选填：平台设备 ID（企微 guid / 个微 appId）；填入且未给 bot_id 时，建绑会按设备探测平台账号并回填
		Name     string `json:"name"`      // 选填：备注名
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.AgentID <= 0 || strings.TrimSpace(req.Token) == "" {
		respondErr(c, http.StatusBadRequest, model.ParamError, "请选择智能体并填写平台凭证")
		return
	}
	if req.Provider == "" {
		req.Provider = model.BotProviderWeWork
	}
	if req.Provider != model.BotProviderWeWork && req.Provider != model.BotProviderWeChat {
		respondErr(c, http.StatusBadRequest, model.ParamError, "暂不支持该渠道，请选择企业微信或个人微信")
		return
	}

	eid := config.GetEID(c)
	// 冲突检测：已知 bot_id 时按 bot_id 查
	var existing *model.BotBinding
	if strings.TrimSpace(req.BotID) != "" {
		if b, err := model.GetBotBindingByBotID(req.BotID, req.Provider); err == nil && b != nil && b.ID > 0 {
			existing = b
		}
	}
	if existing != nil {
		c.JSON(http.StatusOK, model.Success.ToResponse(map[string]any{
			"conflict": true,
			"message":  "该机器人已绑定其他智能体，请先解除原绑定",
			"id":       existing.ID,
			"bot_id":   existing.BotID, "provider": existing.Provider, "agent_id": existing.AgentID,
		}))
		return
	}

	agentRef := fmt.Sprintf("agent_%d", req.AgentID)
	result, err := botgateway.CreateBinding(c.Request.Context(), agentRef, req.Token, req.Provider, req.BotID, req.DeviceID, req.Name)
	if err != nil {
		respondGatewayError(c, err)
		return
	}
	encrypted, err := botgateway.EncryptBotToken(result.BotToken)
	if err != nil {
		respondInternal(c, err)
		return
	}
	hash := sha256Hex(result.BotToken)

	// 建绑时只给了设备 ID（还没收到平台回调）时，网关会在建绑流程内按设备探测一次平台账号，
	// 并通过 result.BotID 返回；这里直接落库，避免再发一次探测请求。
	binding := &model.BotBinding{
		Eid: eid, BotID: result.BotID, Provider: req.Provider, AgentID: req.AgentID,
		BotToken: encrypted, BotTokenHash: hash, PlatformCallbackURL: result.PlatformCallbackURL,
	}
	if err := model.CreateBotBinding(binding); err != nil {
		respondInternal(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]any{
		"id": binding.ID, "bot_id": binding.BotID, "provider": binding.Provider, "agent_id": binding.AgentID,
		"bot_token": result.BotToken, "platform_callback_url": result.PlatformCallbackURL,
	}))
}

// botGatewayUnavailable 我方故障的统一对外口径：用户只需要知道"现在不行、稍后再试"，
// 不暴露内部服务边界、部署地址与环境变量。
const botGatewayUnavailable = "服务暂时不可用，请稍后重试"

// respondErr 机器人接入相关接口的统一错误出口：文案原样返回（不再拼 "param error: " 这类
// 英文机器码前缀），并回填 request_id 供用户报障时提供。
func respondErr(c *gin.Context, status int, code model.ResponseCode, message string) {
	c.JSON(status, code.WithMessage(message).WithRequestID(c.GetString(helper.RequestIdKey)))
}

// respondInternal 我方内部处理失败（库/序列化/加解密等）：对外只给中性文案，原始错误进日志。
func respondInternal(c *gin.Context, err error) {
	logger.Warnf(c.Request.Context(), "【bot-gateway】内部处理失败（细节仅日志）：%v", err)
	respondErr(c, http.StatusInternalServerError, model.SystemError, botGatewayUnavailable)
}

// respondGatewayError 消息服务错误的唯一出口：按业务码映射 HTTP 语义与响应码。
//   - 冲突（4xxx）→ 200 + conflict=true，前端弹确认框引导先解绑；
//   - 不存在（6xxx）→ 404；鉴权（7xxx）→ 401；
//   - 我方故障（5xxx）→ 502 + 中性文案，细节只进日志；
//   - 其余（1xxx/2xxx/3xxx）→ 400 + 消息服务给出的可操作提示。
//
// 判定一律看业务码，不看文案：改文案不会悄悄改变业务分支。
func respondGatewayError(c *gin.Context, err error) {
	var be *botgateway.BizError
	if errors.As(err, &be) {
		// 限流单独处理：前端要拿到 429 才能做置灰倒计时。
		if be.Code == botgateway.CodeTooFrequent {
			respondErr(c, http.StatusTooManyRequests, model.OperateTooFast, be.Message)
			return
		}
		switch be.Segment() {
		case "conflict":
			c.JSON(http.StatusOK, model.Success.ToResponse(map[string]any{"conflict": true, "message": be.Message}).
				WithRequestID(c.GetString(helper.RequestIdKey)))
		case "not_found":
			respondErr(c, http.StatusNotFound, model.NotFound, be.Message)
		case "auth":
			respondErr(c, http.StatusUnauthorized, model.UnauthorizedError, be.Message)
		case "server":
			logger.Warnf(c.Request.Context(), "【bot-gateway】消息服务内部故障（细节仅日志）：code=%d message=%s", be.Code, be.Message)
			respondErr(c, http.StatusBadGateway, model.SystemError, botGatewayUnavailable)
		default:
			respondErr(c, http.StatusBadRequest, model.ParamError, be.Message)
		}
		return
	}
	logger.Warnf(c.Request.Context(), "【bot-gateway】调用消息服务失败（细节仅日志）：%v", err)
	respondErr(c, http.StatusBadGateway, model.SystemError, botGatewayUnavailable)
}

// sha256Hex 计算 bot_token 的 sha256 十六进制指纹（webhook 侧关联查询用）。
func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// BotGatewayListBindings 列出当前企业 bot 绑定（回调地址为完整明文，含 bot_token）。
// @Summary 查询 bot 绑定列表
// @Description 列出当前企业的 bot 绑定（含完整回调地址 platform_callback_url、bot_id、provider、agent_id、enabled）
// @Tags BotGateway
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param agent_id query string false "按 agent 过滤（hashids）"
// @Success 200 {object} model.CommonResponse{data=object} "Success"
// @Router /api/bot-gateway/binds [get]

func BotGatewayListBindings(c *gin.Context) {
	eid := config.GetEID(c)
	// 可选 ?agent_id=<hashids>：只看该 agent 关联的全部机器人
	var list []*model.BotBinding
	var err error
	if agentIDStr := strings.TrimSpace(c.Query("agent_id")); agentIDStr != "" {
		agentID, perr := hashids.TryParseID(agentIDStr)
		if perr != nil {
			respondErr(c, http.StatusBadRequest, model.ParamError, "智能体参数无效")
			return
		}
		list, err = model.ListBotBindingsByAgent(eid, agentID)
	} else {
		list, err = model.ListBotBindings(eid)
	}
	if err != nil {
		respondInternal(c, err)
		return
	}
	items := make([]map[string]any, 0, len(list))
	for _, b := range list {
		UpgradeLegacyBotVisitorUser(eid, b)
		items = append(items, map[string]any{
			"id": b.ID, "bot_id": b.BotID, "provider": b.Provider, "agent_id": b.AgentID,
			"platform_callback_url": b.PlatformCallbackURL,
			"enabled":               b.Enabled, "created_time": b.CreatedTime,
		})
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]any{"list": items}))
}

// BotGatewayBindingCallbackURL 取接入的完整回调地址（含 bot_token 明文）。
// @Summary 取回调地址（含凭据）
// @Description 单独返回该接入的完整回调地址（内含 bot_token）。列表接口已直接返回明文地址，本接口供"仅需复制单个地址"的场景使用
// @Tags BotGateway
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "绑定 ID"
// @Success 200 {object} model.CommonResponse{data=object} "Success"
// @Router /api/bot-gateway/binds/{id}/callback-url [get]
func BotGatewayBindingCallbackURL(c *gin.Context) {
	eid := config.GetEID(c)
	id, err := middleware.ParseIDParam(c, "id")
	if err != nil {
		respondErr(c, http.StatusBadRequest, model.ParamError, "绑定参数无效")
		return
	}
	binding, err := model.GetBotBindingByID(eid, id)
	if err != nil || binding == nil || binding.ID <= 0 {
		respondErr(c, http.StatusNotFound, model.NotFound, "该绑定不存在或已被删除")
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]any{
		"id": binding.ID, "bot_id": binding.BotID,
		"platform_callback_url": binding.PlatformCallbackURL,
	}))
}

// BotGatewayDeleteBinding 删除绑定（含网关侧绑定删除）。
// @Summary 删除 bot 绑定
// @Description 删除绑定（含 bot-gateway 侧绑定）
// @Tags BotGateway
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "绑定 ID"
// @Success 200 {object} model.CommonResponse "Success"
// @Router /api/bot-gateway/binds/{id} [delete]

func BotGatewayDeleteBinding(c *gin.Context) {
	eid := config.GetEID(c)
	id, err := middleware.ParseIDParam(c, "id")
	if err != nil {
		respondErr(c, http.StatusBadRequest, model.ParamError, "绑定参数无效")
		return
	}
	binding, err := model.GetBotBindingByID(eid, id)
	if err != nil {
		respondErr(c, http.StatusNotFound, model.NotFound, "该绑定不存在或已被删除")
		return
	}
	botToken, err := botgateway.DecryptBotToken(binding.BotToken)
	if err != nil {
		respondInternal(c, err)
		return
	}
	// 网关侧解绑 best-effort：网关侧已不存在/暂不可达时，仍删除本地记录，避免删不掉的死锁。
	if err := botgateway.DeleteBinding(c.Request.Context(), fmt.Sprintf("agent_%d", binding.AgentID), botToken); err != nil {
		logger.Warnf(c.Request.Context(), "【bot-gateway】网关侧解绑失败(忽略，继续删本地): id=%d err=%v", id, err)
	}
	if err := model.DeleteBotBinding(eid, id); err != nil {
		respondInternal(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// BotGatewayUpdateBinding 更新绑定（启停）。
// @Summary 更新绑定
// @Description 启停绑定（enabled=true/false）
// @Tags BotGateway
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "绑定 ID"
// @Param request body object true "更新参数 {enabled}"
// @Success 200 {object} model.CommonResponse "Success"
// @Router /api/bot-gateway/binds/{id} [patch]

func BotGatewayUpdateBinding(c *gin.Context) {
	eid := config.GetEID(c)
	id, err := middleware.ParseIDParam(c, "id")
	if err != nil {
		respondErr(c, http.StatusBadRequest, model.ParamError, "绑定参数无效")
		return
	}
	binding, err := model.GetBotBindingByID(eid, id)
	if err != nil {
		respondErr(c, http.StatusNotFound, model.NotFound, "该绑定不存在或已被删除")
		return
	}
	var req struct {
		Enabled *bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Enabled == nil {
		respondErr(c, http.StatusBadRequest, model.ParamError, "请指定启停状态")
		return
	}
	if err := model.UpdateBotBindingEnabled(eid, binding.ID, *req.Enabled); err != nil {
		respondInternal(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]any{"id": binding.ID, "enabled": *req.Enabled}))
}

// BotGatewayListBots 透传网关机器人列表与在线状态。
// @Summary 查询机器人列表
// @Description 透传 bot-gateway 机器人列表与在线状态
// @Tags BotGateway
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=object} "Success"
// @Router /api/bot-gateway/bots [get]
