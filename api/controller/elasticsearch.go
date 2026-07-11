package controller

import (
	"net/http"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/elasticsearch"
	"github.com/gin-gonic/gin"
)

// GetElasticsearchStatus godoc
// @Summary 获取 Elasticsearch 状态
// @Description 获取 Elasticsearch 连接状态和索引统计信息
// @Tags Elasticsearch管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse
// @Router /api/admin/elasticsearch/status [get]
func GetElasticsearchStatus(c *gin.Context) {
	userID := config.GetUserId(c)

	logger.SysLogf("用户 %d 查询 Elasticsearch 状态", userID)

	client := elasticsearch.GetGlobalClient()
	if client == nil {
		c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{
			"enabled": false,
			"message": "Elasticsearch 客户端未初始化",
		}))
		return
	}

	if client.IsDisabled() {
		c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{
			"enabled": false,
			"message": "Elasticsearch 已禁用",
		}))
		return
	}

	// 测试连接
	if err := client.Ping(); err != nil {
		c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{
			"enabled":   false,
			"connected": false,
			"message":   "Elasticsearch 连接失败: " + err.Error(),
		}))
		return
	}

	// 获取索引统计信息
	indexManager := elasticsearch.NewIndexManager(client)
	stats, err := indexManager.GetIndexStats()
	if err != nil {
		logger.SysLogf("获取 Elasticsearch 索引统计失败: %v", err)
		stats = map[string]interface{}{"error": err.Error()}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{
		"enabled":     true,
		"connected":   true,
		"index_name":  client.GetIndexName(),
		"addresses":   client.GetAddresses(),
		"index_stats": stats,
	}))
}

// RefreshElasticsearchIndex godoc
// @Summary 刷新 Elasticsearch 索引
// @Description 强制刷新 Elasticsearch 索引，使最新更改可见
// @Tags Elasticsearch管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse
// @Router /api/admin/elasticsearch/refresh [post]
func RefreshElasticsearchIndex(c *gin.Context) {
	userID := config.GetUserId(c)

	logger.SysLogf("用户 %d 请求刷新 Elasticsearch 索引", userID)

	client := elasticsearch.GetGlobalClient()
	if client == nil || client.IsDisabled() {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("Elasticsearch 服务未启用"))
		return
	}

	// 刷新索引
	indexManager := elasticsearch.NewIndexManager(client)
	if err := indexManager.RefreshIndex(); err != nil {
		logger.SysLogf("刷新 Elasticsearch 索引失败: %v", err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	logger.SysLogf("Elasticsearch 索引刷新成功")
	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{
		"message": "索引刷新成功",
	}))
}
