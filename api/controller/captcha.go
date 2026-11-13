package controller

import (
	"errors"
	"net/http"

	"github.com/53AI/53AIHub/common/utils"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/sms"
	"github.com/gin-gonic/gin"
)

// @Summary 获取字符验证码（人机校验）
// @Description 生成字符验证码图片（base64 PNG）。发送短信验证码前调用，随后把 captcha_id/captcha_answer 随 sendcode 提交
// @Tags SMS
// @Produce json
// @Success 200 {object} model.CommonResponse{data=map[string]string}
// @Failure 429 {object} model.CommonResponse "请求过于频繁"
// @Router /api/captcha [get]
func GetCaptcha(c *gin.Context) {
	clientIP := utils.GetClientIP(c)
	if err := sms.CheckCaptchaIPRateLimit(clientIP); err != nil {
		if errors.Is(err, sms.ErrCaptchaIPRateLimit) {
			c.JSON(http.StatusTooManyRequests, model.OperateTooFast.ToResponse("请求过于频繁，请稍后重试"))
			return
		}
	}

	captchaID, imageBase64, err := sms.GenerateCaptcha()
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse("验证码生成失败"))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]string{
		"captcha_id":   captchaID,
		"image_base64": imageBase64,
	}))
}
