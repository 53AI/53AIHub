package controller

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/common/utils"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/payment"
	"github.com/gin-gonic/gin"
)

// PaySettingRequest represents the request for creating or updating a payment setting
type PaySettingRequest struct {
	// Payment type: 1:WeChat Pay 2:Manual Transfer 3:PayPal 4:alipay
	PayType int `json:"pay_type" binding:"required" example:"1" enums:"1,2,3,4"`
	// PayConfig is the payment configuration in JSON format
	// - For WeChat Pay: Required fields include appId, mchId, serialNo, apiV3Key, notifyUrl, privateKeyPath, platformCertPath
	// - For Alipay: Required fields include appId, privateKey, alipayPublicKey
	PayConfig   string `json:"pay_config" binding:"required" example:"{\"appId\":\"wx123456\",\"mchId\":\"1900000109\",\"serialNo\":\"1DDE55AD98ED71EB\",\"apiV3Key\":\"Aa111111\",\"notifyUrl\":\"https://example.com/notify\",\"privateKeyPath\":\"/path/to/apiclient_key.pem\",\"certPath\":\"\",\"platformCertPath\":\"/path/to/platform_cert.pem\"}"`
	PayStatus   bool   `json:"pay_status" example:"true" description:"Payment status, true for enabled, false for disabled"`
	ExtraConfig string `json:"extra_config" example:"{}" description:"Extra configuration"`
}

// PaySettingsResponse represents the response for listing payment settings
type PaySettingsResponse struct {
	Count       int64               `json:"count"`
	PaySettings []*model.PaySetting `json:"pay_settings"`
}

// CreatePaySetting creates a new payment setting
// @Summary Create payment setting
// @Description Create a new payment setting. For WeChat Pay, certificate files will be read from the specified paths and encrypted
// @Tags PaySetting
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param setting body PaySettingRequest true "Payment setting information including payment type, configuration and status. For WeChat Pay, configuration must include certificate file paths"
// @Success 200 {object} model.CommonResponse{data=model.PaySetting} "Payment setting created successfully"
// @Failure 400 {object} model.CommonResponse "Invalid parameters or payment setting already exists"
// @Failure 500 {object} model.CommonResponse "Internal server error"
// @Router /api/pay_settings [post]
func CreatePaySetting(c *gin.Context) {
	var req PaySettingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)

	// Validate payment type
	if !isValidPayType(req.PayType) {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("Invalid payment type"))
		return
	}

	// Check if payment setting already exists
	existing, _ := model.GetPaySettingByType(eid, req.PayType)
	if existing != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("Payment setting of this type already exists"))
		return
	}

	// Process configuration based on payment type
	var err error
	if req.PayType == model.PayTypeWechat {
		req.PayConfig, err = processWechatConfig(req.PayConfig)
		if err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err.Error()))
			return
		}
	}

	// Set default status if not provided
	if !req.PayStatus {
		req.PayStatus = model.PayStatusEnabled
	}

	paySetting := &model.PaySetting{
		Eid:         eid,
		PayType:     req.PayType,
		PayConfig:   req.PayConfig,
		PayStatus:   req.PayStatus,
		ExtraConfig: req.ExtraConfig,
	}

	if err = paySetting.Create(); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	payText, err := model.GetPayTypeText(paySetting.PayType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	log := model.SystemLog{
		Eid:      eid,
		UserID:   config.GetUserId(c),
		Nickname: config.GetUserNickname(c),
		Module:   model.SystemLogModulePayment,
		Action:   model.SystemLogActionCreate,
		Content:  fmt.Sprintf("设置%s", payText),
		IP:       utils.GetClientIP(c),
	}
	model.CreateSystemLog(&log)

	c.JSON(http.StatusOK, model.Success.ToResponse(paySetting))
}

// UpdatePaySetting updates an existing payment setting
// @Summary Update payment setting
// @Description Update an existing payment setting
// @Tags PaySetting
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "Payment setting ID"
// @Param setting body PaySettingRequest true "Payment setting information"
// @Success 200 {object} model.CommonResponse{data=model.PaySetting}
// @Router /api/pay_settings/{id} [put]
func UpdatePaySetting(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("Invalid ID"))
		return
	}

	eid := config.GetEID(c)

	// Get existing payment setting
	paySetting, err := model.GetPaySettingByID(eid, id)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse("Payment setting not found"))
		return
	}

	var req PaySettingRequest
	if err = c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// Validate payment type
	if !isValidPayType(req.PayType) {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("Invalid payment type"))
		return
	}

	// Process configuration based on payment type
	if req.PayType == model.PayTypeWechat {
		req.PayConfig, err = processWechatConfig(req.PayConfig)
		if err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err.Error()))
			return
		}
	}

	// Update payment setting
	paySetting.PayType = req.PayType
	paySetting.PayConfig = req.PayConfig
	paySetting.PayStatus = req.PayStatus
	paySetting.ExtraConfig = req.ExtraConfig

	if err := paySetting.Update(); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(paySetting))
}

// DeletePaySetting deletes a payment setting
// @Summary Delete payment setting
// @Description Delete a specific payment setting
// @Tags PaySetting
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "Payment setting ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/pay_settings/{id} [delete]
func DeletePaySetting(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("Invalid ID"))
		return
	}

	paySetting, err := model.GetPaySettingByID(config.GetEID(c), id)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	if err := paySetting.Delete(); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// GetPaySetting gets a payment setting by ID
// @Summary Get payment setting
// @Description Get a specific payment setting by ID
// @Tags PaySetting
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "Payment setting ID"
// @Success 200 {object} model.CommonResponse{data=model.PaySetting}
// @Router /api/pay_settings/{id} [get]
func GetPaySetting(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("Invalid ID"))
		return
	}

	paySetting, err := model.GetPaySettingByID(config.GetEID(c), id)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(paySetting))
}

// GetPaySettings gets all payment settings for the current enterprise
// @Summary Get all payment settings
// @Description Get all payment settings for the current enterprise
// @Tags PaySetting
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=PaySettingsResponse}
// @Router /api/pay_settings [get]
func GetPaySettings(c *gin.Context) {
	paySettings, err := model.GetPaySettingsByEid(config.GetEID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(&PaySettingsResponse{
		Count:       int64(len(paySettings)),
		PaySettings: paySettings,
	}))
}

// GetPaySettingByType gets a payment setting by type
// @Summary Get payment setting by type
// @Description Get a payment setting by payment type
// @Tags PaySetting
// @Accept json
// @Produce json
// @Param type path int true "Payment type (1: WeChat Pay, 2: Manual Transfer, 3: PayPal)"
// @Success 200 {object} model.CommonResponse{data=model.PaySetting}
// @Router /api/pay_settings/type/{type} [get]
func GetPaySettingByType(c *gin.Context) {
	typeStr := c.Param("type")
	payType, err := strconv.Atoi(typeStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("Invalid payment type"))
		return
	}

	// Validate payment type
	if !isValidPayType(payType) {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("Invalid payment type"))
		return
	}

	paySetting, err := model.GetPaySettingByType(config.GetEID(c), payType)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(paySetting))
}

// PayConfigRequest represents the request for updating payment configuration
type PayConfigRequest struct {
	PayConfig   string `json:"pay_config" binding:"required" example:"{\"appId\":\"wx123456\",\"mchId\":\"1900000109\",\"serialNo\":\"1DDE55AD98ED71EB\",\"apiV3Key\":\"Aa111111\",\"notifyUrl\":\"https://example.com/notify\",\"privateKeyPath\":\"/path/to/apiclient_key.pem\",\"certPath\":\"\",\"platformCertPath\":\"/path/to/platform_cert.pem\"}"`
	ExtraConfig string `json:"extra_config" example:"{}"`
}

// PayStatusRequest represents the request for updating payment status
type PayStatusRequest struct {
	PayStatus *bool `json:"pay_status" binding:"required" example:"false"`
}

// UpdatePayConfig updates the payment configuration
// @Summary Update payment configuration
// @Description Update the configuration of an existing payment setting
// @Tags PaySetting
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "Payment setting ID"
// @Param setting body PayConfigRequest true "Payment configuration"
// @Success 200 {object} model.CommonResponse{data=model.PaySetting}
// @Router /api/pay_settings/{id}/config [patch]
func UpdatePayConfig(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("Invalid ID"))
		return
	}

	paySetting, err := model.GetPaySettingByID(config.GetEID(c), id)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	var req PayConfigRequest
	if err = c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// Validate configuration based on payment type
	if paySetting.PayType == model.PayTypeWechat {
		paySetting.PayConfig, err = processWechatConfig(req.PayConfig)
		if err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err.Error()))
			return
		}
	} else {
		paySetting.PayConfig = req.PayConfig
	}
	paySetting.ExtraConfig = req.ExtraConfig

	if err = paySetting.Update(); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	payText, err := model.GetPayTypeText(paySetting.PayType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	log := model.SystemLog{
		Eid:      config.GetEID(c),
		UserID:   config.GetUserId(c),
		Nickname: config.GetUserNickname(c),
		Module:   model.SystemLogModulePayment,
		Action:   model.SystemLogActionUpdate,
		Content:  fmt.Sprintf("设置%s", payText),
		IP:       utils.GetClientIP(c),
	}
	model.CreateSystemLog(&log)

	c.JSON(http.StatusOK, model.Success.ToResponse(paySetting))
}

// UpdatePayStatus updates the payment status
// @Summary Update payment status
// @Description Update the status of an existing payment setting
// @Tags PaySetting
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "Payment setting ID"
// @Param status body PayStatusRequest true "Payment status (1: Enabled, 0: Disabled)"
// @Success 200 {object} model.CommonResponse{data=model.PaySetting}
// @Router /api/pay_settings/{id}/status [patch]
func UpdatePayStatus(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("Invalid ID"))
		return
	}

	paySetting, err := model.GetPaySettingByID(config.GetEID(c), id)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	var req PayStatusRequest
	if err = c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	paySetting.PayStatus = *req.PayStatus

	if err = paySetting.Update(); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	statusText := "启用"
	if !paySetting.PayStatus {
		statusText = "禁用"
	}

	payText, err := model.GetPayTypeText(paySetting.PayType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	log := model.SystemLog{
		Eid:      paySetting.Eid,
		UserID:   config.GetUserId(c),
		Nickname: config.GetUserNickname(c),
		Module:   model.SystemLogModuleAdmin,
		Action:   model.SystemLogActionToggle,
		Content:  fmt.Sprintf("%s%s", statusText, payText),
		IP:       utils.GetClientIP(c),
	}
	model.CreateSystemLog(&log)

	c.JSON(http.StatusOK, model.Success.ToResponse(paySetting))
}

// isValidPayType checks if the payment type is valid
func isValidPayType(payType int) bool {
	return payType >= model.PayTypeWechat && payType <= model.PayTypeAlipay
}

// processWechatConfig processes and validates WeChat payment configuration
func processWechatConfig(payConfig string) (string, error) {
	wechatConfig, err := payment.ValidateWechatConfig(payConfig)
	if err != nil {
		return "", err
	}

	configBytes, err := json.Marshal(wechatConfig)
	if err != nil {
		return "", fmt.Errorf("failed to marshal config: %v", err)
	}

	return string(configBytes), nil
}
