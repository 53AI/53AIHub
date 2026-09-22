package controller

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/utils/helper"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

// AppLoginRequest 移动端 App 登录请求体。
// 两种凭证模式二选一：
//   - 账号密码：username + password（username 可为邮箱或手机号）
//   - 手机号验证码：mobile + verify_code
//
// platform/device_id 必填；device_id 为 App 端安装期 UUID，作为 UserChannel.openid，
// 每设备一个 channel，多设备可同时在线互不挤下线。
type AppLoginRequest struct {
	Platform   string `json:"platform" binding:"required"` // ios/android/...，非空即可，不做白名单（新平台零适配）
	DeviceID   string `json:"device_id" binding:"required"`
	DeviceName string `json:"device_name"` // 可选，存 ExtraData

	Username string `json:"username"` // 模式1：账号(邮箱/手机) + 密码
	Password string `json:"password"`

	Mobile     string `json:"mobile"` // 模式2：手机号 + 验证码
	VerifyCode string `json:"verify_code"`
}

// AppLogoutResponse 退出登录响应
type AppLogoutResponse struct {
	Revoked bool `json:"revoked"`
}

// @Summary 移动端 App 登录
// @Description 移动端 App 登录（账号密码或手机号验证码）。按设备（device_id）建立独立登录态，多设备可同时在线，不影响 web 登录
// @Tags Auth
// @Accept json
// @Produce json
// @Param request body AppLoginRequest true "App 登录信息"
// @Success 200 {object} model.CommonResponse{data=SaasLoginResponse} "成功，返回access_token与user_id"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 401 {object} model.CommonResponse "账号/密码/验证码错误"
// @Router /api/app_login [post]
func AppLogin(c *gin.Context) {
	var req AppLoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	req.Platform = strings.TrimSpace(req.Platform)
	req.DeviceID = strings.TrimSpace(req.DeviceID)
	if req.Platform == "" || req.DeviceID == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("platform and device_id are required"))
		return
	}

	hasPassword := req.Username != "" && req.Password != ""
	hasSMS := req.Mobile != "" && req.VerifyCode != ""
	if hasPassword == hasSMS {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("provide username+password or mobile+verify_code"))
		return
	}

	eid := config.GetEID(c)

	var user model.User
	var err error
	if hasPassword {
		policy, _ := model.GetPasswordSecurityPolicySetting(eid)
		username := strings.TrimSpace(req.Username)
		if locked, remainingMinutes := checkLoginLock(eid, username, policy); locked {
			c.JSON(http.StatusForbidden, model.ForbiddenError.ToNewErrorResponse(fmt.Sprintf("密码连续输错次数过多，账号已被锁定，请 %d 分钟后再试", remainingMinutes)))
			return
		}

		isEmail := helper.IsValidEmail(username)
		isMobile := helper.IsValidPhone(username)
		switch {
		case isEmail:
			user, err = model.GetUserByEmail(eid, username)
		case isMobile:
			user, err = model.GetUserByMobile(eid, username)
		default:
			c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToNewErrorResponse("invalid username"))
			return
		}
		if err != nil {
			if locked, lockMinutes := recordLoginFailure(eid, username, policy); locked {
				c.JSON(http.StatusForbidden, model.ForbiddenError.ToNewErrorResponse(fmt.Sprintf("密码连续输错 %d 次，账号已被锁定 %d 分钟", policy.LockAfterFailures, lockMinutes)))
				return
			}
			c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToResponse(err))
			return
		}
		if err = user.VerifyPassword(req.Password); err != nil {
			if locked, lockMinutes := recordLoginFailure(eid, username, policy); locked {
				c.JSON(http.StatusForbidden, model.ForbiddenError.ToNewErrorResponse(fmt.Sprintf("密码连续输错 %d 次，账号已被锁定 %d 分钟", policy.LockAfterFailures, lockMinutes)))
				return
			}
			c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToResponse(err))
			return
		}
		clearLoginFailure(eid, username, policy)
	} else {
		mobile := strings.TrimSpace(req.Mobile)
		if !helper.IsValidPhone(mobile) {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(model.InvalidMobileOrEmail))
			return
		}
		redisKey := fmt.Sprintf("Api:CheckVerificationCode:%s", mobile)
		code, err := common.RedisGet(redisKey)
		if err != nil || code != req.VerifyCode {
			c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToNewErrorResponse(model.InvalidVerificationCode))
			return
		}
		user, err = model.GetUserByMobile(eid, mobile)
		if err != nil {
			c.JSON(http.StatusUnauthorized, model.UnauthorizedError.ToResponse(err))
			return
		}
	}

	channel, err := getOrCreateAppUserChannel(eid, user.UserID, req.DeviceID, req.Platform, req.DeviceName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 7 天 token 复用续期机制；不刷新 user.access_token，web 登录不受影响
	token, err := model.GetOrCreateUserChannelTokenWithRenewal(eid, user.UserID, channel.ID, 7*24*time.Hour)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if err = user.UpdateStatusToJoin(); err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	service.InvalidateInternalUserListCache(eid)

	c.JSON(http.StatusOK, model.Success.ToResponse(SaasLoginResponse{
		AccessToken: token.Token,
		UserID:      user.UserID,
		ExpiresAt:   token.ExpiresAt,
	}))
}

// getOrCreateAppUserChannel 按设备查找或创建 app channel（channel_type=app, openid=device_id）
func getOrCreateAppUserChannel(eid, userID int64, deviceID, platform, deviceName string) (*model.UserChannel, error) {
	channel, err := model.GetUserChannelByOpenID(eid, deviceID)
	if err == nil && channel != nil {
		// lazy: 共享设备跨账号登录时 channel.user_id 保持首登用户，不重绑；token 按 token.user_id 鉴权，无安全问题，
		// 若产品要求"设备归属最近登录用户"再改为更新 user_id
		return channel, nil
	}
	if err != model.ErrUserChannelNotFound {
		return nil, err
	}

	extra, _ := json.Marshal(map[string]string{
		"platform":    platform,
		"device_name": deviceName,
	})
	return model.CreateUserChannel(eid, userID, model.ChannelTypeApp, deviceID,
		model.WithExtraData(string(extra)))
}

// @Summary 移动端 App 退出登录
// @Description 撤销当前 Authorization 中携带的 app channel token，撤销后该设备登录态立即失效
// @Tags Auth
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=AppLogoutResponse} "Success"
// @Router /api/app_logout [post]
func AppLogout(c *gin.Context) {
	token := strings.TrimSpace(strings.Replace(c.Request.Header.Get("Authorization"), "Bearer ", "", 1))
	if token == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	revoked, err := model.DeleteUserChannelTokenByToken(token)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(AppLogoutResponse{Revoked: revoked}))
}
