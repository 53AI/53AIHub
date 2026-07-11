package controller

import (
	"net/http"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

// InitializeInstallationRequest 初始化安装请求
type InitializeInstallationRequest struct {
	Enterprise *InitializeInstallationEnterpriseParams `json:"enterprise" binding:"required"`
	User       *InitializeInstallationUserParams       `json:"user" binding:"required"`
	Channel    *InitializeInstallationChannelParams    `json:"channel"`
}

// InitializeInstallationEnterpriseParams 初始化安装企业参数
type InitializeInstallationEnterpriseParams struct {
	EnterpriseName string `json:"enterprise_name" binding:"required" example:"53AIHub"`
}

// InitializeInstallationUserParams 初始化安装用户参数
type InitializeInstallationUserParams struct {
	AccountName string `json:"account_name" binding:"required,email" example:"admin@53ai.com"`
	Password    string `json:"password" binding:"required" example:"12345678"`
}

// InitializeInstallationChannelParams 初始化安装渠道参数
type InitializeInstallationChannelParams struct {
	Type    int    `json:"type" binding:"required" example:"17"`
	BaseURL string `json:"base_url" example:"https://api.example.com/v1"`
	Key     string `json:"key" binding:"required" example:"sk-xxxxxx"`
}

// InitializeInstallationResponse 初始化安装响应
type InitializeInstallationResponse struct {
	LoginResponse
}

// InitInstallation godoc
// @Summary 初始化本地版企业
// @Description 一次性完成企业信息修改、初始化用户注册，并可选完成默认渠道配置，成功后返回自动登录 token
// @Tags 系统
// @Accept json
// @Produce json
// @Param request body InitializeInstallationRequest true "初始化安装信息"
// @Success 200 {object} model.CommonResponse{data=InitializeInstallationResponse} "Success"
// @Router /api/init [post]
func InitInstallation(c *gin.Context) {
	var req InitializeInstallationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	result, err := service.InitializeEnterpriseInstallation(c.Request.Context(), config.GetEID(c), service.InitializeEnterpriseInstallationRequest{
		Enterprise: service.InitializeEnterpriseInstallationEnterpriseParams{
			EnterpriseName: req.Enterprise.EnterpriseName,
		},
		User: service.InitializeEnterpriseInstallationUserParams{
			AccountName: req.User.AccountName,
			Password:    req.User.Password,
		},
		Channel: func() *service.InitializeEnterpriseInstallationChannelParams {
			if req.Channel == nil {
				return nil
			}
			return &service.InitializeEnterpriseInstallationChannelParams{
				Type:    req.Channel.Type,
				BaseURL: req.Channel.BaseURL,
				Key:     req.Channel.Key,
			}
		}(),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(InitializeInstallationResponse{
		LoginResponse: LoginResponse{
			AccessToken: result.AccessToken,
			UserID:      result.UserID,
		},
	}))
}
