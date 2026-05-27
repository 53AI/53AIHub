package controller

import (
	"net/http"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/gin-gonic/gin"
)

// GetAvailableChannels godoc
// @Summary 获取可用的渠道列表
// @Description 获取可用于分块配置的渠道列表，可按类型筛选
// @Tags 分块配置管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param type query string false "渠道类型筛选" Enums(embedding,logic) example(embedding)
// @Success 200 {object} model.CommonResponse{data=[]ChannelInfo} "成功返回可用渠道列表"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunk-settings/channels [get]
func GetAvailableChannels(c *gin.Context) {
	eid := config.GetEID(c)

	// 获取渠道类型
	channelType := c.Query("type") // embedding 或 logic

	// 创建配置服务
	configService := rag.NewChunkConfigService(model.DB)

	// 获取可用渠道
	channels, err := configService.GetAvailableChannels(eid, channelType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(channels))
}

// ValidateChannels godoc
// @Summary 验证渠道配置
// @Description 验证指定的逻辑推理渠道和向量嵌入渠道是否可用
// @Tags 分块配置管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body ChannelValidateRequest true "渠道验证信息，包含逻辑推理渠道ID和向量嵌入渠道ID"
// @Success 200 {object} model.CommonResponse "渠道验证通过"
// @Failure 400 {object} model.CommonResponse "参数错误或渠道验证失败"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunk-settings/validate-channels [post]
func ValidateChannels(c *gin.Context) {
	eid := config.GetEID(c)

	// 解析请求体
	var req ChannelValidateRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 创建配置服务
	configService := rag.NewChunkConfigService(model.DB)

	// 验证渠道
	err := configService.ValidateChannels(eid, req.LogicChannelID, req.EmbeddingChannelID)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}
