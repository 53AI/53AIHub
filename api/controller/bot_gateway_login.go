package controller

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/botgateway"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// BotGatewayLocator 登录链路的接入定位参数。
// 优先 id（绑定 ID）；其次 bot_id（已登录账号）；bot_token 仅为兼容旧调用保留。
// 注意：id 是 int64 —— RequestDecoder 中间件已把请求体里的 hashids 解码为数字，
// 写成 string 会因「数字解入字符串字段」直接绑失败；bot_id 是平台账号（非本地 ID）故仍为字符串。
// 必须导出：匿名嵌入的未导出类型会被 encoding/json 整体忽略。
type BotGatewayLocator struct {
	ID       int64  `json:"id"`
	BotID    string `json:"bot_id"`
	BotToken string `json:"bot_token"`
}

// resolveLocatorBinding 定位接入：返回绑定记录（兼容路径按 token 指纹反查，查不到为 nil）与可转发给网关的 bot_token。
// 失败时已写入响应，调用方直接 return。
func resolveLocatorBinding(c *gin.Context, loc BotGatewayLocator) (*model.BotBinding, string, bool) {
	if token := strings.TrimSpace(loc.BotToken); token != "" {
		var binding *model.BotBinding
		if b, err := model.GetBotBindingByBotTokenHash(sha256Hex(token)); err == nil && b != nil && b.ID > 0 {
			binding = b
		}
		return binding, token, true
	}

	eid := config.GetEID(c)
	var binding *model.BotBinding
	var err error
	switch {
	case loc.ID > 0:
		binding, err = model.GetBotBindingByID(eid, loc.ID)
	case strings.TrimSpace(loc.BotID) != "":
		binding, err = model.GetBotBindingByEidAndBotID(eid, strings.TrimSpace(loc.BotID))
	default:
		respondErr(c, http.StatusBadRequest, model.ParamError, "请指定要登录的机器人")
		return nil, "", false
	}
	if err != nil || binding == nil || binding.ID <= 0 {
		respondErr(c, http.StatusNotFound, model.NotFound, "该机器人未接入或已被解绑")
		return nil, "", false
	}

	token, err := botgateway.DecryptBotToken(binding.BotToken)
	if err != nil {
		respondInternal(c, err)
		return nil, "", false
	}
	return binding, token, true
}

// BotGatewayLoginRegions 获取扫码登录地区列表。
// @Summary 获取登录地区列表
// @Description 支持按 ?provider=wework|wechat 或 ?id=绑定ID 区分企微与个微的专属地区列表与提示
// @Tags BotGateway
// @Produce json
// @Security BearerAuth
// @Param provider query string false "渠道类型：wework（企微）或 wechat（个微）"
// @Param id query string false "绑定记录 ID（hashids），传入时自动解析其 provider"
// @Success 200 {object} model.CommonResponse{data=botgateway.LoginRegionsResult} "Success"
// @Router /api/bot-gateway/login/regions [get]
func BotGatewayLoginRegions(c *gin.Context) {
	provider := strings.TrimSpace(c.Query("provider"))
	idStr := strings.TrimSpace(c.Query("id"))
	if provider == "" && idStr != "" {
		eid := config.GetEID(c)
		if id, err := hashids.TryParseID(idStr); err == nil && id > 0 {
			if b, err := model.GetBotBindingByID(eid, id); err == nil && b != nil {
				provider = b.Provider
			}
		}
	}
	res := botgateway.GetLoginRegions(provider)
	c.JSON(http.StatusOK, model.Success.ToResponse(res))
}

// BotGatewayLoginQR 获取扫码登录二维码。
// @Summary 获取登录二维码
// @Description 按 id（绑定 ID）/bot_id 定位接入取扫码登录二维码；region 仅在新建设备时生效
// @Tags BotGateway
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body object true "取码参数 {id 或 bot_id（二选一）, region, type, provider?, bot_token?（兼容）}"
// @Success 200 {object} model.CommonResponse{data=object} "Success"
// @Router /api/bot-gateway/login/qrcode [post]
func BotGatewayLoginQR(c *gin.Context) {
	var req struct {
		BotGatewayLocator
		Provider string `json:"provider"`
		Region   string `json:"region"`
		Type     string `json:"type"`
		ProxyIP  string `json:"proxy_ip"`  // 个微代理 IP（可选）
		TTUID    string `json:"ttuid"`     // 个微代理本机 ID（可选）
		DeviceID string `json:"device_id"` // 可选：显式指定设备 ID 覆盖已存设备
		ForceNew bool   `json:"force_new"` // 可选：强制换新设备实例取码
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		respondErr(c, http.StatusBadRequest, model.ParamError, "登录参数无效")
		return
	}
	_, botToken, ok := resolveLocatorBinding(c, req.BotGatewayLocator)
	if !ok {
		return
	}
	out, err := botgateway.LoginQR(c.Request.Context(), botgateway.LoginQRInput{
		BotToken: botToken, Provider: req.Provider, Region: req.Region,
		Type: req.Type, ProxyIP: req.ProxyIP, TTUID: req.TTUID,
		DeviceID: req.DeviceID, ForceNew: req.ForceNew,
	})
	if err != nil {
		respondGatewayError(c, err)
		return
	}
	out.RegionApplied = !out.Reuse
	c.JSON(http.StatusOK, model.Success.ToResponse(out))
}

// BotGatewayLoginPoll 轮询扫码登录结果。
// @Summary 轮询登录结果
// @Description 按 id（绑定 ID）/bot_id 定位接入，轮询扫码结果，成功回填 bot_id/device_id
// @Tags BotGateway
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body object true "轮询参数 {id 或 bot_id（二选一）, device_id, uuid, captch_code, bot_token?（兼容）}"
// @Success 200 {object} model.CommonResponse{data=object} "Success"
// @Router /api/bot-gateway/login/poll [post]
func BotGatewayLoginPoll(c *gin.Context) {
	var req struct {
		BotGatewayLocator
		DeviceID   string `json:"device_id"`
		UUID       string `json:"uuid"`
		CaptchCode string `json:"captch_code"`
		Type       string `json:"type"` // 设备类型：个微 mac/ipad，决定是否允许自动滑验证
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		respondErr(c, http.StatusBadRequest, model.ParamError, "登录参数无效")
		return
	}
	binding, botToken, ok := resolveLocatorBinding(c, req.BotGatewayLocator)
	if !ok {
		return
	}
	out, err := botgateway.LoginPoll(c.Request.Context(), botgateway.LoginPollInput{
		BotToken: botToken, DeviceID: req.DeviceID, UUID: req.UUID,
		CaptchCode: req.CaptchCode, Type: req.Type,
	})
	if err != nil {
		respondGatewayError(c, err)
		return
	}
	// 登录成功即回填平台账号：否则 /binds 一直显示"待识别"，与"刷新列表自动补上"的承诺矛盾
	// （那个回填只发生在网关侧的 /bots）。仅在原值为空时写，不覆盖既有身份。
	if out.IsLogin && binding != nil {
		botID := out.BotID
		if botID == "" {
			botID = binding.BotID
		}
		if botID != "" && binding.BotID == "" {
			if err := model.UpdateBotBindingLoginIfEmpty(binding.Eid, binding.ID, botID); err != nil {
				logger.Warnf(c.Request.Context(), "【bot-gateway】登录成功回填 bot_id 失败(忽略): id=%d err=%v", binding.ID, err)
			} else {
				binding.BotID = botID
			}
		}
		// 登录成功同步更新 user 表中 bot 对应的 visitor 用户名称（便于后台与对话列表中直观识别）
		if err := syncBotVisitorUserNickname(c.Request.Context(), binding.Eid, binding.ID, binding.Provider, botID, out.Nickname, out.CorpName); err != nil {
			logger.Warnf(c.Request.Context(), "【bot-gateway】登录成功同步用户昵称失败(忽略): id=%d err=%v", binding.ID, err)
		}
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(out))
}

// BotVisitorUsername 构造 bot visitor 用户的规范 username：
// 规则：bot_<type>_<botid>（如 "bot_wework_1688851323177747" 或 "bot_wechat_wxid_123"）。
// 确保同一个平台 bot 在当前企业（eid）下无论重绑多少次，永远稳定映射到同一个用户主体，
// 杜绝产生游离僵尸用户，并可用于查询去重与跨绑定会话承接。若 botID 尚未获取则回退为 bindingID。
func BotVisitorUsername(provider, botID string, fallbackBindingID int64) string {
	p := strings.TrimSpace(provider)
	bid := strings.TrimSpace(botID)
	if p != "" && bid != "" {
		return fmt.Sprintf("bot_%s_%s", p, bid)
	}
	if bid != "" {
		return fmt.Sprintf("bot_%s", bid)
	}
	return fmt.Sprintf("bot_visitor_%d", fallbackBindingID)
}

// UpgradeLegacyBotVisitorUser 检查并平滑升级历史用户的 username 和昵称。
// 对于已登录/已存绑定的 bot，将历史 "bot_visitor_<id>" 用户平滑升级为 "bot_<provider>_<botID>"，
// 同时规范化其 nickname。原 user_id 和 conversations 关联完全不受影响。
func UpgradeLegacyBotVisitorUser(eid int64, b *model.BotBinding) {
	if b == nil || b.BotID == "" {
		return
	}
	newUsername := BotVisitorUsername(b.Provider, b.BotID, b.ID)
	// 若新规范 username 已存在，无需迁移
	if _, err := model.GetUserByUserName(eid, newUsername); err == nil {
		return
	}
	oldUsername := fmt.Sprintf("bot_visitor_%d", b.ID)
	if oldUser, err := model.GetUserByUserName(eid, oldUsername); err == nil && oldUser != nil && oldUser.UserID > 0 {
		updates := map[string]any{"username": newUsername}
		if !strings.HasPrefix(oldUser.Nickname, "[") {
			updates["nickname"] = FormatBotUserNickname(b.Provider, b.BotID, oldUser.Nickname, "")
		}
		_ = model.DB.Model(&model.User{}).
			Where("eid = ? AND user_id = ?", eid, oldUser.UserID).
			Updates(updates)
	}
}

// FormatBotUserNickname 组合出方便识别的 bot 对应用户昵称：
// - 企微且有企业名：[企微] 昵称（企业名），如 "[企微] 客服助手（腾讯）"
// - 企微无企业名：[企微] 昵称，如 "[企微] 客服助手"
// - 微信：[微信] 昵称，如 "[微信] 奕飒"
// - 平台昵称为空时回退账号：[渠道] Bot_账号，如 "[微信] Bot_wxid_123"
func FormatBotUserNickname(provider, botID, nickname, corpName string) string {
	tag := "Bot"
	switch provider {
	case model.BotProviderWeWork:
		tag = "企微"
	case model.BotProviderWeChat:
		tag = "微信"
	}
	name := strings.TrimSpace(nickname)
	if name == "" {
		bid := strings.TrimSpace(botID)
		if bid != "" {
			name = fmt.Sprintf("Bot_%s", bid)
		} else {
			name = "机器人"
		}
	}
	corp := strings.TrimSpace(corpName)
	if corp != "" && provider == model.BotProviderWeWork {
		return fmt.Sprintf("[%s] %s（%s）", tag, name, corp)
	}
	return fmt.Sprintf("[%s] %s", tag, name)
}

// syncBotVisitorUserNickname 登录成功后将 bot 昵称同步到 users 表中对应的 visitor 用户：
// username 规则为 "bot_<type>_<botid>"，保证同一个 bot 实体对应唯一的 user 记录。
// 兼容平滑迁移：若存在原 "bot_visitor_<bindingID>" 历史用户，自动平滑升级为新 username。
func syncBotVisitorUserNickname(ctx context.Context, eid, bindingID int64, provider, botID, nickname, corpName string) error {
	username := BotVisitorUsername(provider, botID, bindingID)
	compositeName := FormatBotUserNickname(provider, botID, nickname, corpName)

	user, err := model.GetUserByUserName(eid, username)
	if err == nil && user != nil && user.UserID > 0 {
		return model.DB.Model(&model.User{}).
			Where("eid = ? AND user_id = ?", eid, user.UserID).
			Update("nickname", compositeName).Error
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	// 兼容平滑迁移：若存在历史 "bot_visitor_<bindingID>" 记录，将其升级为规范 username 并更新昵称
	oldUsername := fmt.Sprintf("bot_visitor_%d", bindingID)
	if oldUser, oerr := model.GetUserByUserName(eid, oldUsername); oerr == nil && oldUser != nil && oldUser.UserID > 0 {
		return model.DB.Model(&model.User{}).
			Where("eid = ? AND user_id = ?", eid, oldUser.UserID).
			Updates(map[string]any{
				"username": username,
				"nickname": compositeName,
			}).Error
	}

	newUser := &model.User{
		Eid:      eid,
		Username: username,
		Nickname: compositeName,
		Role:     model.RoleGuestUser,
		Status:   model.UserStatusJoined,
		Type:     model.UserTypeVisitor,
		Salt:     helper.RandomString(6),
	}
	return model.DB.Create(newUser).Error
}

// BotGatewayLoginVerify 提交辅助验证码。
// @Summary 提交登录验证码
// @Description 按 id（绑定 ID）/bot_id 定位接入，登录需要辅助验证码时提交
// @Tags BotGateway
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body object true "验证码参数 {id 或 bot_id（二选一）, device_id, code, bot_token?（兼容）}"
// @Success 200 {object} model.CommonResponse "Success"
// @Router /api/bot-gateway/login/verify [post]
func BotGatewayLoginVerify(c *gin.Context) {
	var req struct {
		BotGatewayLocator
		DeviceID string `json:"device_id"`
		Code     string `json:"code"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.DeviceID == "" || req.Code == "" {
		respondErr(c, http.StatusBadRequest, model.ParamError, "请填写设备与验证码")
		return
	}
	_, botToken, ok := resolveLocatorBinding(c, req.BotGatewayLocator)
	if !ok {
		return
	}
	if err := botgateway.LoginVerify(c.Request.Context(), botToken, req.DeviceID, req.Code); err != nil {
		respondGatewayError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]any{"verify": true}))
}

// BotGatewayLoginLogout 退出登录。
// @Summary 退出登录
// @Description 按 id（绑定 ID）/bot_id 定位接入，退出该接入登录态；device_id 缺省用接入已存设备
// @Tags BotGateway
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body object true "退出参数 {id 或 bot_id（二选一）, device_id?, bot_token?（兼容）}"
// @Success 200 {object} model.CommonResponse "Success"
// @Router /api/bot-gateway/login/logout [post]
func BotGatewayLoginLogout(c *gin.Context) {
	var req struct {
		BotGatewayLocator
		DeviceID string `json:"device_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		respondErr(c, http.StatusBadRequest, model.ParamError, "登录参数无效")
		return
	}
	_, botToken, ok := resolveLocatorBinding(c, req.BotGatewayLocator)
	if !ok {
		return
	}
	if err := botgateway.LoginLogout(c.Request.Context(), botToken, req.DeviceID); err != nil {
		respondGatewayError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]any{"ok": true}))
}
