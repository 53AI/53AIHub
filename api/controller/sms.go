package controller

import (
	"errors"
	"net/http"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/sms"
	"github.com/gin-gonic/gin"
)

// SendSMSCodeRequest SMS验证码发送请求
type SendSMSCodeRequest struct {
	Mobile        string `json:"mobile" binding:"required" example:"13800138000"` // 手机号
	CaptchaID     string `json:"captcha_id" example:"a1b2c3d4"`                   // 图形验证码 ID（可选/灰度，SMS_CAPTCHA_REQUIRED=true 时必填）
	CaptchaAnswer string `json:"captcha_answer" example:"4x8k"`               // 用户填写的验证码答案
}

// SendSMSCodeResponse SMS验证码发送响应
type SendSMSCodeResponse struct {
	Message string `json:"message" example:"Verification code sent successfully"` // 响应信息
}

// @Summary 发送短信验证码
// @Description 发送短信验证码到指定手机号，验证码存储在Redis中，key为Api:CheckVerificationCode:{手机号}
// @Tags SMS
// @Accept json
// @Produce json
// @Param request body SendSMSCodeRequest true "手机号"
// @Success 200 {object} model.CommonResponse{data=SendSMSCodeResponse} "统一回复：验证码已发送（防刷，不暴露真实发送状态）"
// @Failure 400 {object} model.CommonResponse "参数错误或手机号格式不正确"
// @Router /api/sms/sendcode [post]
func SendSMSCode(c *gin.Context) {
	var req SendSMSCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 手机号格式校验（输入契约，保留 400）
	if !sms.IsValidMobile(req.Mobile) {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("invalid mobile number format"))
		return
	}

	// 图形人机校验（防刷防爆破）
	if config.SMS_CAPTCHA_REQUIRED {
		if req.CaptchaID == "" || req.CaptchaAnswer == "" {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("captcha_id and captcha_answer are required"))
			return
		}
		if !sms.VerifyCaptcha(req.CaptchaID, req.CaptchaAnswer) {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("invalid or expired captcha"))
			return
		}
	} else if req.CaptchaID != "" || req.CaptchaAnswer != "" {
		// 平滑灰度期：未强制要求验证码，但若客户端携带了验证码字段，则严格校验
		if req.CaptchaID == "" || req.CaptchaAnswer == "" || !sms.VerifyCaptcha(req.CaptchaID, req.CaptchaAnswer) {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("invalid or expired captcha"))
			return
		}
	}

	// 防刷：发送结果统一回复，不向调用方暴露真实发送/限流状态；真实结果仅记服务端日志
	manager := sms.GetManager()
	if manager == nil || !manager.IsEnabled() {
		logger.SysWarn("【短信发送】对手机号的发送判定：未启用（SMS 服务未启用，统一回复）")
		c.JSON(http.StatusOK, model.Success.ToResponse(&SendSMSCodeResponse{Message: "验证码已发送，请注意查收"}))
		return
	}

	if _, err := manager.SendVerificationCode(req.Mobile, utils.GetClientIP(c), config.GetEID(c)); err != nil {
		logger.SysWarnf("【短信发送】对手机号 %s 的发送判定：失败（%v，统一回复）", req.Mobile, err)
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&SendSMSCodeResponse{
		Message: "验证码已发送，请注意查收",
	}))
}

// @Summary 验证短信验证码（内部使用）
// @Description 验证短信验证码是否正确
// @Tags SMS
// @Accept json
// @Produce json
// @Param mobile query string true "手机号"
// @Param code query string true "验证码"
// @Success 200 {object} model.CommonResponse "验证成功"
// @Failure 400 {object} model.CommonResponse "验证码错误或过期"
// @Router /api/sms/verify [get]
func VerifySMSCode(c *gin.Context) {
	mobile := c.Query("mobile")
	code := c.Query("code")

	if mobile == "" || code == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("mobile and code are required"))
		return
	}

	// 获取SMS管理器
	manager := sms.GetManager()
	if manager == nil || !manager.IsEnabled() {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse("SMS service is not enabled"))
		return
	}

	// 验证验证码（带 IP：校验侧防爆破限频 + 失败冷却；限频/冷却状态不向调用方暴露，与普通校验失败同响应，防指纹）
	if err := manager.VerifyCode(mobile, code, utils.GetClientIP(c)); err != nil {
		switch {
		case errors.Is(err, sms.ErrVerifyTooManyTries):
			c.JSON(http.StatusBadRequest, model.InvalidVerificationCodeError.ToResponse("验证码已失效，请重新获取"))
		case errors.Is(err, sms.ErrVerifyIPLimit), errors.Is(err, sms.ErrVerifyCooldown):
			// 不暴露限频/冷却状态：与"验证码错误"返回相同响应（防枚举/防指纹）
			c.JSON(http.StatusBadRequest, model.InvalidVerificationCodeError.ToResponse("invalid verification code"))
		default:
			c.JSON(http.StatusBadRequest, model.InvalidVerificationCodeError.ToResponse(err.Error()))
		}
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse("Verification code verified successfully"))
}

// @Summary 获取SMS服务状态
// @Description 获取当前SMS服务是否启用及相关配置信息
// @Tags SMS
// @Produce json
// @Success 200 {object} model.CommonResponse{data=map[string]interface{}} "服务状态"
// @Router /api/sms/status [get]
func GetSMSStatus(c *gin.Context) {
	manager := sms.GetManager()

	statusData := map[string]interface{}{
		"enabled": false,
	}

	if manager != nil && manager.IsEnabled() {
		config := manager.GetConfig()
		statusData = map[string]interface{}{
			"enabled":     true,
			"provider":    config.Provider,
			"code_length": config.CodeLength,
			"expiry_time": config.ExpiryTime,
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(statusData))
}

// GetSMSSecurityStatus 短信防刷运行时状态（管理端，不对外开放、不生成 swagger 文档）
func GetSMSSecurityStatus(c *gin.Context) {
	c.JSON(http.StatusOK, model.Success.ToResponse(sms.GetSecurityStatus()))
}

// GetSMSAnalytics 短信用量实时快照（管理端，不对外开放、不生成 swagger 文档）
func GetSMSAnalytics(c *gin.Context) {
	c.JSON(http.StatusOK, model.Success.ToResponse(sms.GetSMSAnalytics()))
}
