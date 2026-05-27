package controller

import (
	"encoding/json"
	"net/http"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

// EnterpriseInfoItem 表示一个企业信息项目，包含URL和启用状态
type EnterpriseInfoItem struct {
	URL     string `json:"url" example:"https://example.com/terms"`
	Enabled bool   `json:"enabled" example:"true"`
}

// EnterpriseInfoRequest 企业信息请求结构体
type EnterpriseInfoRequest struct {
	TermsOfService EnterpriseInfoItem `json:"terms_of_service"`
	PrivacyPolicy  EnterpriseInfoItem `json:"privacy_policy"`
	AIPrivacyPolicy EnterpriseInfoItem `json:"ai_privacy_policy"`
}

// EnterpriseInfoResponse 企业信息响应结构体
type EnterpriseInfoResponse struct {
	TermsOfService EnterpriseInfoItem `json:"terms_of_service"`
	PrivacyPolicy  EnterpriseInfoItem `json:"privacy_policy"`
	AIPrivacyPolicy EnterpriseInfoItem `json:"ai_privacy_policy"`
}

// internalGetEnterpriseInfo 是获取企业信息的内部实现
func internalGetEnterpriseInfo(c *gin.Context) {
	eid := config.GetEID(c)

	// 获取企业信息设置
	setting, err := model.GetSettingByEidAndKey(eid, string(model.EnterpriseInfo))
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	response := EnterpriseInfoResponse{
		TermsOfService: EnterpriseInfoItem{URL: "", Enabled: false},
		PrivacyPolicy:  EnterpriseInfoItem{URL: "", Enabled: false},
		AIPrivacyPolicy: EnterpriseInfoItem{URL: "", Enabled: false},
	}

	if setting != nil {
		// 解析JSON数据
		if err := json.Unmarshal([]byte(setting.Value), &response); err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// @Summary 获取企业信息
// @Description 获取企业服务协议、隐私政策和AI隐私政策URL及启用状态
// @Tags 企业信息
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=EnterpriseInfoResponse} "成功获取企业信息"
// @Router /api/enterprise-info [get]
func GetEnterpriseInfo(c *gin.Context) {
	internalGetEnterpriseInfo(c)
}

// @Summary 获取企业信息（无需认证）
// @Description 获取企业服务协议、隐私政策和AI隐私政策URL及启用状态（无需认证）
// @Tags 企业信息
// @Produce json
// @Success 200 {object} model.CommonResponse{data=EnterpriseInfoResponse} "成功获取企业信息"
// @Router /api/public/enterprise-info [get]
func GetPublicEnterpriseInfo(c *gin.Context) {
	internalGetEnterpriseInfo(c)
}

// @Summary 更新企业信息
// @Description 更新企业服务协议、隐私政策和AI隐私政策URL及启用状态
// @Tags 企业信息
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param enterprise_info body EnterpriseInfoRequest true "企业信息"
// @Success 200 {object} model.CommonResponse "成功更新企业信息"
// @Router /api/enterprise-info [put]
func UpdateEnterpriseInfo(c *gin.Context) {
	var req EnterpriseInfoRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)

	// 将请求数据序列化为JSON
	infoJSON, err := json.Marshal(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 更新企业信息设置
	if err := model.UpdateOrCreateSetting(eid, string(model.EnterpriseInfo), string(infoJSON), 0); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}