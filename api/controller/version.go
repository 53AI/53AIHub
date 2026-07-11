package controller

import (
	"net/http"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

// GetVersion 获取系统版本信息
// @Summary 获取系统版本
// @Description 获取系统的版本号信息
// @Tags System
// @Produce json
// @Success 200 {object} model.CommonResponse{data=VersionInfo}
// @Failure 500 {object} model.CommonResponse
// @Router /api/version [get]
func GetVersion(c *gin.Context) {
	versionInfo := VersionInfo{
		Version:   config.Version,
		BuildTime: config.BuildTime,
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(versionInfo))
}

// VersionInfo 版本信息结构
type VersionInfo struct {
	Version   string `json:"version" example:"v1.0.0"`
	BuildTime string `json:"build_time" example:"20250101120000"`
}

// EnvConfigInfo 环境变量配置信息响应结构
type EnvConfigInfo struct {
	APIHost   string `json:"api_host" example:"https://api.example.com/"`
	KKBaseURL string `json:"kk_base_url" example:"https://kk.example.com/"`
}

// GetEnvConfig godoc
// @Summary      获取环境变量配置
// @Description  返回 API_HOST 和 KK_BASE_URL 环境变量的值
// @Tags         System
// @Accept       json
// @Produce      json
// @Success      200  {object}  model.CommonResponse{data=EnvConfigInfo}
// @Router       /api/env-config [get]
func GetEnvConfig(c *gin.Context) {
	envConfig := EnvConfigInfo{
		APIHost:   config.GetApiHost(),
		KKBaseURL: config.KKBaseURL,
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(envConfig))
}
