package controller

import (
	"net/http"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

type HealthData struct {
	Version   string `json:"version"`
	StartTime string `json:"start_time"`
}

// HealthCheck HealthCheck
// @Summary HealthCheck
// @Description HealthCheck
// @Tags System
// @Produce json
// @Success 200 {object} model.CommonResponse{data=HealthData} "Success response"
// @Router /health [get]
func HealthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, model.Success.ToResponse(HealthData{
		Version:   config.Version + "." + config.VersionTime + "-" + config.Server,
		StartTime: config.StartTime,
	}))
}

type RedisPoolStats struct {
	Enabled    bool   `json:"enabled"`
	Hits       uint32 `json:"hits,omitempty"`
	Misses     uint32 `json:"misses,omitempty"`
	Timeouts   uint32 `json:"timeouts,omitempty"`
	TotalConns uint32 `json:"total_conns,omitempty"`
	IdleConns  uint32 `json:"idle_conns,omitempty"`
	StaleConns uint32 `json:"stale_conns,omitempty"`
}

// GetRedisPoolStatus 获取Redis连接池状态
// @Summary 获取Redis连接池状态
// @Description 获取Redis连接池的实时状态信息
// @Tags System
// @Produce json
// @Success 200 {object} model.CommonResponse{data=RedisPoolStats} "Success response"
// @Router /api/system/redis-stats [get]
func GetRedisPoolStatus(c *gin.Context) {
	stats := common.GetRedisPoolStats()
	
	// 转换为结构化响应
	response := RedisPoolStats{
		Enabled: stats["enabled"].(bool),
	}
	
	if response.Enabled {
		response.Hits = uint32(stats["hits"].(int64))
		response.Misses = uint32(stats["misses"].(int64))
		response.Timeouts = uint32(stats["timeouts"].(int64))
		response.TotalConns = uint32(stats["total_conns"].(int64))
		response.IdleConns = uint32(stats["idle_conns"].(int64))
		response.StaleConns = uint32(stats["stale_conns"].(int64))
	}
	
	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

type CodeInfo struct {
	Code        int    `json:"code"`
	Description string `json:"description"`
}

// GetAllResponseCodes Get all response codes and their descriptions
// @Summary Get all response codes
// @Description Returns all defined response codes and their descriptions in the system
// @Tags System
// @Produce json
// @Success 200 {object} []CodeInfo "Success response"
// @Router /api/response_codes [get]
func GetAllResponseCodes(c *gin.Context) {
	codes := make([]CodeInfo, 0, len(model.CodeMessage))

	for code, description := range model.CodeMessage {
		codes = append(codes, CodeInfo{
			Code:        int(code),
			Description: description,
		})
	}

	c.JSON(http.StatusOK, codes)
}