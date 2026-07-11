package controller

import (
	"net/http"

	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/sms"
	"github.com/gin-gonic/gin"
)

// SendSMSCodeRequest SMS验证码发送请求
type SendSMSCodeRequest struct {
	Mobile string `json:"mobile" binding:"required" example:"13800138000"` // 手机号
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
// @Success 200 {object} model.CommonResponse{data=SendSMSCodeResponse} "成功响应"
// @Failure 400 {object} model.CommonResponse "参数错误或手机号格式不正确"
// @Failure 429 {object} model.CommonResponse "发送过于频繁或超过每日限制"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/sms/sendcode [post]
func SendSMSCode(c *gin.Context) {
	var req SendSMSCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 获取SMS管理器
	manager := sms.GetManager()
	if manager == nil || !manager.IsEnabled() {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse("SMS service is not enabled"))
		return
	}

	// 验证手机号格式
	if !sms.IsValidMobile(req.Mobile) {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("invalid mobile number format"))
		return
	}

	// 发送验证码
	_, err := manager.SendVerificationCode(req.Mobile)
	if err != nil {
		// 根据不同错误类型返回不同的HTTP状态码
		if err.Error() == "SMS code already sent, please try again after 1 minute" {
			c.JSON(http.StatusTooManyRequests, model.OperateTooFast.ToResponse(err.Error()))
		} else if err.Error() == "maximum SMS codes sent today (10), please try again tomorrow" {
			c.JSON(http.StatusTooManyRequests, model.OperateTooFast.ToResponse(err.Error()))
		} else {
			c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		}
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&SendSMSCodeResponse{
		Message: "Verification code sent successfully",
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

	// 验证验证码
	if err := manager.VerifyCode(mobile, code); err != nil {
		c.JSON(http.StatusBadRequest, model.InvalidVerificationCodeError.ToResponse(err.Error()))
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
