package controller

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"
	"unicode"

	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

// SSO 配置结构，存储于 enterprise-configs type="auth_sso" 的 JSON 内容
type SSOConfig struct {
	Enable         bool   `json:"enable"`
	EncryptEnabled bool   `json:"encrypt_enabled"`
	Secret         string `json:"secret"`
}

// SSO 登录请求体
type SSOLoginRequest struct {
	Username  string `json:"username" binding:"required"`
	Timestamp string `json:"timestamp"` // 10位秒
	Sign      string `json:"sign"`      // 加密启用时必须传
}

// SaasLoginResponse 复用现有返回体格式
type SaasLoginResponse struct {
	AccessToken string `json:"access_token"`
	UserID      int64  `json:"user_id"`
}

// @Summary API SSO Login
// @Description 站点API单点登录。时间戳为10位秒，窗口10分钟。eid无需传，使用站点环境。
// @Tags Auth
// @Accept json
// @Produce json
// @Param request body SSOLoginRequest true "SSO请求体"
// @Success 200 {object} model.CommonResponse{data=SaasLoginResponse} "成功，返回access_token与user_id"
// @Failure 401 {object} model.CommonResponse "未授权（超时或签名错误）"
// @Failure 403 {object} model.CommonResponse "拒绝（SSO关闭）"
// @Failure 404 {object} model.CommonResponse "用户不存在"
// @Router /api/auth/sso_login [post]
func ApiSSOSSOLogin(c *gin.Context) {
	eid := config.GetEID(c)

	// 加载 SSO 配置
	cfg := loadSSOConfig(eid)

	// 开关关闭：403
	if !cfg.Enable {
		c.JSON(http.StatusForbidden, model.ForbiddenError.ToNewErrorResponse("SSO登录功能未开启"))
		return
	}

	// 绑定请求参数
	var req SSOLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusForbidden, model.ParamError.ToResponse(err))
		return
	}

	// 签名校验（加密启用时）
	if cfg.EncryptEnabled {
		// 校验时间戳：必须10位数字
		if !isValid10DigitTimestamp(req.Timestamp) {
			c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToNewErrorResponse("sso timeout"))
			return
		}
		ts, _ := strconv.ParseInt(req.Timestamp, 10, 64)
		now := time.Now().Unix()
		// 且600秒内有效
		if now-ts > 600 {
			c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToNewErrorResponse("sso timeout"))
			return
		}

		if cfg.Secret == "" {
			c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToNewErrorResponse("invalid sign"))
			return
		}
		raw := helper.BuildSSORawString(req.Timestamp, req.Username, cfg.Secret)
		expected := helper.CalcSSOSignLowerHex(raw)
		if expected != req.Sign {
			c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToNewErrorResponse("invalid sign"))
			return
		}
	}

	isEmail := helper.IsValidEmail(req.Username)
	// 根据账号查找用户（邮箱或手机）
	var user model.User
	if isEmail {
		u, err := model.GetUserByEmail(eid, req.Username)
		if err != nil {
			c.JSON(http.StatusNotFound, model.NotFound.ToNewErrorResponse("user not found, email not exist"))
			return
		}
		user = u
	} else {
		u, err := model.GetUserByMobile(eid, req.Username)
		if err != nil {
			c.JSON(http.StatusNotFound, model.NotFound.ToNewErrorResponse("user not found，mobile not exist"))
			return
		}
		user = u
	}

	// 查找或创建 UserChannel（channel_type = sso, openid = username）
	channel, err := getOrCreateSSOUserChannel(eid, user.UserID, req.Username)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 使用复用 token 逻辑（不刷新 user.access_token）
	token, err := model.GetOrCreateUserChannelTokenWithRenewal(eid, user.UserID, channel.ID, 7*24*time.Hour)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(SaasLoginResponse{
		AccessToken: token.Token,
		UserID:      user.UserID,
	}))
}

func loadSSOConfig(eid int64) *SSOConfig {
	// 从 enterprise-configs 读取 type="auth_sso"
	conf, err := service.GetEnterpriseConfigByType(eid, model.EnterpriseConfigTypeSSO)
	if err != nil || conf.Content == "" {
		// 不存在则视为关闭
		return &SSOConfig{Enable: false, EncryptEnabled: true, Secret: ""}
	}
	var cfg SSOConfig
	_ = json.Unmarshal([]byte(conf.Content), &cfg)
	cfg.Enable = conf.Enabled
	return &cfg
}

func isValid10DigitTimestamp(ts string) bool {
	if len(ts) != 10 {
		return false
	}
	for _, r := range ts {
		if !unicode.IsDigit(r) {
			return false
		}
	}
	return true
}

func getOrCreateSSOUserChannel(eid, userID int64, username string) (*model.UserChannel, error) {
	// 查找现有 channel
	channel, err := model.GetUserChannelByOpenID(eid, username)
	if err == nil && channel != nil {
		return channel, nil
	}

	if err != model.ErrUserChannelNotFound {
		return nil, err
	}

	// 没找到，创建新 channel
	return model.CreateUserChannel(eid, userID, model.ChannelTypeSSO, username)
}
