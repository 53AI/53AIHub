package controller

import (
	"context"
	"fmt"
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/embedding"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/53AI/53AIHub/common/utils"
	"github.com/gin-gonic/gin"
)

// GetSiteModelConfig godoc
// @Summary 获取站点模型配置
// @Description 获取站点级别的模型配置JSON
// @Tags 模型配置管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=ModelConfigJSONResponse} "成功获取站点模型配置"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunk-settings/model-config/site [get]
func GetSiteModelConfig(c *gin.Context) {
	eid := config.GetEID(c)

	// 创建配置服务
	configService := rag.NewChunkConfigService(model.DB)

	// 获取站点配置
	chunkConfig, err := configService.GetConfig(eid, nil, model.ChunkTypeDefault)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 获取模型配置JSON
	modelConfig, err := configService.GetModelConfigFromChunkConfig(chunkConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	response := &ModelConfigJSONResponse{
		ID:          chunkConfig.ID,
		Eid:         chunkConfig.Eid,
		LibraryID:   chunkConfig.LibraryID,
		FileID:      nil,
		ModelConfig: modelConfig,
		CreatedTime: chunkConfig.CreatedTime,
		UpdatedTime: chunkConfig.UpdatedTime,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// UpdateSiteModelConfig godoc
// @Summary 更新站点模型配置
// @Description 更新站点级别的模型配置JSON
// @Tags 模型配置管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body ModelConfigJSONRequest true "模型配置JSON"
// @Success 200 {object} model.CommonResponse{data=ModelConfigJSONResponse} "成功更新站点模型配置"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunk-settings/model-config/site [put]
func UpdateSiteModelConfig(c *gin.Context) {
	eid := config.GetEID(c)

	// 解析请求体
	var req ModelConfigJSONRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 创建配置服务
	configService := rag.NewChunkConfigService(model.DB)

	// 获取或创建站点配置
	chunkConfig, err := configService.GetConfig(eid, nil, model.ChunkTypeDefault)
	if err != nil {
		// 如果配置不存在，创建默认配置
		chunkConfig, err = configService.CreateDefaultConfig(eid, nil, model.ChunkTypeDefault, rag.DefaultName)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
	}

	oldModelConfig, oldModelConfigErr := configService.GetModelConfigFromChunkConfig(chunkConfig)
	if oldModelConfigErr != nil {
		logger.SysErrorf("[SiteReindex] 获取旧站点模型配置失败，跳过向量重建差异判断: eid=%d, err=%v", eid, oldModelConfigErr)
	}

	// 更新模型配置
	err = configService.UpdateModelConfigInChunkConfig(chunkConfig, req.ModelConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 保存配置
	err = configService.UpdateConfig(chunkConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 获取更新后的模型配置
	updatedModelConfig, err := configService.GetModelConfigFromChunkConfig(chunkConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if oldModelConfigErr == nil && rag.VectorEmbeddingChanged(oldModelConfig, updatedModelConfig) {
		triggerSiteEmbeddingReindex(eid, oldModelConfig, updatedModelConfig)
	}
	triggerSiteThresholdCalibration(eid, chunkConfig.EmbeddingChannelID, chunkConfig.EmbeddingModelName)

	logContent := fmt.Sprintf("修改站点模型配置，逻辑推理: %s → %s，向量嵌入: %s → %s，快速推理: %s → %s",
		safeModelChannelName(oldModelConfig, func(c *model.ModelConfigData) model.ModelChannelConfig { return c.LogicReasoning }),
		safeModelChannelName(updatedModelConfig, func(c *model.ModelConfigData) model.ModelChannelConfig { return c.LogicReasoning }),
		safeModelChannelName(oldModelConfig, func(c *model.ModelConfigData) model.ModelChannelConfig { return c.VectorEmbedding }),
		safeModelChannelName(updatedModelConfig, func(c *model.ModelConfigData) model.ModelChannelConfig { return c.VectorEmbedding }),
		safeModelChannelName(oldModelConfig, func(c *model.ModelConfigData) model.ModelChannelConfig { return c.FastReasoning }),
		safeModelChannelName(updatedModelConfig, func(c *model.ModelConfigData) model.ModelChannelConfig { return c.FastReasoning }),
	)
	model.CreateSystemLog(&model.SystemLog{
		Eid:      eid,
		UserID:   config.GetUserId(c),
		Nickname: config.GetUserNickname(c),
		Module:   model.SystemLogModuleModelConfig,
		Action:   model.SystemLogActionUpdate,
		Content:  logContent,
		IP:       utils.GetClientIP(c),
	})

	response := &ModelConfigJSONResponse{
		ID:          chunkConfig.ID,
		Eid:         chunkConfig.Eid,
		LibraryID:   chunkConfig.LibraryID,
		FileID:      nil,
		ModelConfig: updatedModelConfig,
		CreatedTime: chunkConfig.CreatedTime,
		UpdatedTime: chunkConfig.UpdatedTime,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

var triggerSiteEmbeddingReindex = triggerSiteEmbeddingReindexAsync

func triggerSiteEmbeddingReindexAsync(eid int64, oldCfg, newCfg *model.ModelConfigData) {
	oldChannelID, oldModelName := extractVectorEmbeddingConfig(oldCfg)
	newChannelID, newModelName := extractVectorEmbeddingConfig(newCfg)
	if newChannelID <= 0 || newModelName == "" {
		logger.SysWarnf("[SiteReindex] 站点向量模型为空，跳过重新向量化: eid=%d, channel_id=%d, model=%s", eid, newChannelID, newModelName)
		return
	}

	common.SafeGo(context.Background(), func() {
		ctx := context.Background()
		service := rag.NewSiteEmbeddingReindexService(model.DB)
		run, err := service.Start(ctx, rag.SiteEmbeddingReindexStartRequest{
			Eid:          eid,
			OldChannelID: oldChannelID,
			OldModelName: oldModelName,
			NewChannelID: newChannelID,
			NewModelName: newModelName,
		})
		if err != nil {
			logger.SysErrorf("[SiteReindex] 批次创建失败: eid=%d, old_channel=%d, old_model=%s, new_channel=%d, new_model=%s, err=%v",
				eid, oldChannelID, oldModelName, newChannelID, newModelName, err)
			return
		}
		if err := service.ProcessNextPage(ctx, run.RunID, 100); err != nil {
			logger.SysErrorf("[SiteReindex] 首批调度失败: eid=%d, run_id=%s, err=%v", eid, run.RunID, err)
		}
	})
}

func extractVectorEmbeddingConfig(cfg *model.ModelConfigData) (int64, string) {
	if cfg == nil {
		return 0, ""
	}
	var channelID int64
	if cfg.VectorEmbedding.ChannelID != nil {
		channelID = *cfg.VectorEmbedding.ChannelID
	}
	var modelName string
	if cfg.VectorEmbedding.ModelName != nil {
		modelName = *cfg.VectorEmbedding.ModelName
	}
	return channelID, modelName
}

var triggerSiteThresholdCalibration = triggerSiteThresholdCalibrationAsync

func triggerSiteThresholdCalibrationAsync(eid int64, channelID *int64, modelName *string) {
	if channelID == nil || modelName == nil || *modelName == "" {
		return
	}

	common.SafeGo(context.Background(), func() {
		calibrationService := rag.NewThresholdCalibrationService(model.DB)
		if err := calibrationService.RecalculateSiteThreshold(context.Background(), eid, *channelID, *modelName); err != nil {
			// 仅记录错误，不影响知识库正常使用
			logger.SysErrorf("【阈值校准】站点阈值计算失败: eid=%d, channelID=%d, model=%s, err=%v", eid, *channelID, *modelName, err)
		}
	})
}

// GetLibraryModelConfig godoc
// @Summary 获取知识库模型配置
// @Description 获取指定知识库的模型配置JSON，如果不存在则返回站点默认配置
// @Tags 模型配置管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param library_id path int true "知识库ID" example(1)
// @Success 200 {object} model.CommonResponse{data=ModelConfigJSONResponse} "成功获取知识库模型配置"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunk-settings/model-config/library/{library_id} [get]
func GetLibraryModelConfig(c *gin.Context) {
	eid := config.GetEID(c)

	// 获取知识库ID
	libraryIDStr := c.Param("library_id")
	libraryID, err := strconv.ParseInt(libraryIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 创建配置服务
	configService := rag.NewChunkConfigService(model.DB)

	// 获取知识库配置
	chunkConfig, err := configService.GetConfig(eid, &libraryID, model.ChunkTypeDefault)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 获取模型配置JSON
	modelConfig, err := configService.GetModelConfigFromChunkConfig(chunkConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	response := &ModelConfigJSONResponse{
		ID:          chunkConfig.ID,
		Eid:         chunkConfig.Eid,
		LibraryID:   chunkConfig.LibraryID,
		FileID:      nil,
		ModelConfig: modelConfig,
		CreatedTime: chunkConfig.CreatedTime,
		UpdatedTime: chunkConfig.UpdatedTime,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// UpdateLibraryModelConfig godoc
// @Summary 更新知识库模型配置
// @Description 更新指定知识库的模型配置JSON
// @Tags 模型配置管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param library_id path int true "知识库ID" example(1)
// @Param request body ModelConfigJSONRequest true "模型配置JSON"
// @Success 200 {object} model.CommonResponse{data=ModelConfigJSONResponse} "成功更新知识库模型配置"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunk-settings/model-config/library/{library_id} [put]
func UpdateLibraryModelConfig(c *gin.Context) {
	eid := config.GetEID(c)

	// 获取知识库ID
	libraryIDStr := c.Param("library_id")
	libraryID, err := strconv.ParseInt(libraryIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 解析请求体
	var req ModelConfigJSONRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 创建配置服务
	configService := rag.NewChunkConfigService(model.DB)

	// 获取或创建知识库配置
	chunkConfig, err := configService.GetConfig(eid, &libraryID, model.ChunkTypeDefault)
	if err != nil {
		// 如果配置不存在，创建默认配置
		chunkConfig, err = configService.CreateDefaultConfig(eid, &libraryID, model.ChunkTypeDefault, rag.DefaultName)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
	}

	// 更新模型配置
	err = configService.UpdateModelConfigInChunkConfig(chunkConfig, req.ModelConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 保存配置
	err = configService.UpdateConfig(chunkConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 获取更新后的模型配置
	updatedModelConfig, err := configService.GetModelConfigFromChunkConfig(chunkConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	response := &ModelConfigJSONResponse{
		ID:          chunkConfig.ID,
		Eid:         chunkConfig.Eid,
		LibraryID:   chunkConfig.LibraryID,
		FileID:      nil,
		ModelConfig: updatedModelConfig,
		CreatedTime: chunkConfig.CreatedTime,
		UpdatedTime: chunkConfig.UpdatedTime,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// GetEmbeddingModelsForConfig godoc
// @Summary 获取可用于配置的embedding模型列表
// @Description 获取可用于分块配置的embedding模型列表，包含模型详细信息
// @Tags 分块配置管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=[]embedding.EmbeddingModelInfo} "成功返回embedding模型列表"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunk-settings/embedding-models [get]
func GetEmbeddingModelsForConfig(c *gin.Context) {
	eid := config.GetEID(c)

	// 创建embedding模型服务
	modelService := embedding.NewEmbeddingModelService(model.DB)

	// 获取可用的embedding模型
	models, err := modelService.GetAvailableEmbeddingModels(eid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(models))
}

// ValidateEmbeddingModelForConfig godoc
// @Summary 验证分块配置中的embedding模型
// @Description 验证指定渠道的embedding模型是否可用于分块配置
// @Tags 分块配置管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body ValidateEmbeddingModelRequest true "验证请求"
// @Success 200 {object} model.CommonResponse "模型验证成功"
// @Failure 400 {object} model.CommonResponse "参数错误或模型不可用"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunk-settings/validate-embedding-model [post]
func ValidateEmbeddingModelForConfig(c *gin.Context) {
	eid := config.GetEID(c)

	// 解析请求体
	var req ValidateEmbeddingModelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 创建embedding模型服务
	modelService := embedding.NewEmbeddingModelService(model.DB)

	err := modelService.ValidateEmbeddingModel(eid, req.ChannelID, req.ModelName)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse("模型验证成功"))
}

func safeModelChannelName(cfg *model.ModelConfigData, getter func(*model.ModelConfigData) model.ModelChannelConfig) string {
	if cfg == nil {
		return "-"
	}
	ch := getter(cfg)
	if ch.ModelName != nil {
		return *ch.ModelName
	}
	return "-"
}
