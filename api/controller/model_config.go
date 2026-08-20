package controller

import (
	"context"
	"fmt"
	"net/http"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	appservice "github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/embedding"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/53AI/53AIHub/service/vectorstore"
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
	chunkConfig, err := configService.GetEnterpriseEmbeddingConfig(eid)
	if err != nil {
		// 站点级模型配置尚未建立（未初始化/渠道未配置）时，退回系统默认配置供前端展示与编辑，
		// 避免 500 阻断前端页面；写入由 UpdateSiteModelConfig 自动创建站点配置。
		chunkConfig, err = configService.GetConfig(eid, nil, model.ChunkTypeDefault)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
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
	chunkConfig, err := configService.GetEnterpriseEmbeddingConfig(eid)
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

	if err := configService.ValidateAndNormalizeModelConfig(chunkConfig, req.ModelConfig); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(err.Error()))
		return
	}

	// 提取新旧向量模型配置，预检新模型可用性
	_, newModelName := extractVectorEmbeddingConfig(req.ModelConfig)
	oldChannelID, oldModelName := extractVectorEmbeddingConfig(oldModelConfig)
	newChannelID, _ := extractVectorEmbeddingConfig(req.ModelConfig)

	vectorModelChanged := newChannelID > 0 && newModelName != "" &&
		(oldModelConfigErr != nil || oldChannelID != newChannelID || oldModelName != newModelName)

	var actualVectorDim int
	if vectorModelChanged {
		// 预检：调用新模型 API 验证可用性并检测实际维度
		dim, err := verifyNewEmbeddingModelForConfig(eid, newChannelID, newModelName)
		if err != nil {
			logger.SysErrorf("[SiteReindex] 新向量模型验证失败: eid=%d, channel=%d, model=%s, err=%v", eid, newChannelID, newModelName, err)
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(fmt.Sprintf("新模型验证失败: %v", err)))
			return
		}
		actualVectorDim = dim
		logger.SysLogf("[SiteReindex] 新向量模型验证通过: eid=%d, channel=%d, model=%s, actual_dim=%d", eid, newChannelID, newModelName, dim)
	}

	// 更新模型配置
	err = configService.UpdateModelConfigInChunkConfig(chunkConfig, req.ModelConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToErrorResponse(err))
		return
	}

	// 保存配置
	err = configService.UpdateConfig(chunkConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToErrorResponse(err))
		return
	}

	// 获取更新后的模型配置
	updatedModelConfig, err := configService.GetModelConfigFromChunkConfig(chunkConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToErrorResponse(err))
		return
	}

	// 向量模型变更后：重建集合 + 触发 reindex
	if vectorModelChanged {
		// 重建集合：删除旧集合，创建新集合
		collectionName := model.GetDocumentVectorCollectionName(eid)
		rebuildLog := fmt.Sprintf("旧集合: %s (dim=%d), 新集合: %s (dim=%d)",
			oldModelName, resolveCatalogDimension(oldModelName), newModelName, actualVectorDim)
		logger.SysLogf("[SiteReindex] 开始重建向量集合: eid=%d, %s", eid, rebuildLog)

		if err := rebuildVectorCollectionForConfig(eid, actualVectorDim); err != nil {
			logger.SysErrorf("[SiteReindex] 重建向量集合失败: eid=%d, err=%v", eid, err)
			c.JSON(http.StatusInternalServerError, model.SystemError.ToNewErrorResponse(fmt.Sprintf("重建向量集合失败: %v", err)))
			return
		}
		logger.SysLogf("[SiteReindex] 向量集合重建完成: eid=%d, collection=%s, dim=%d", eid, collectionName, actualVectorDim)

		// 异步触发 reindex
		triggerSiteEmbeddingReindex(eid, oldModelConfig, updatedModelConfig, actualVectorDim)

		// 永久日志：记录向量模型切换和维度变化
		dimLog := fmt.Sprintf("向量模型切换，集合: %s\n旧模型: %s (channel=%d, dim=%d)\n新模型: %s (channel=%d, dim=%d)\n集合重建: %d → %d",
			collectionName,
			oldModelName, oldChannelID, resolveCatalogDimension(oldModelName),
			newModelName, newChannelID, actualVectorDim,
			resolveCatalogDimension(oldModelName), actualVectorDim)
		model.CreateSystemLog(&model.SystemLog{
			Eid:      eid,
			UserID:   config.GetUserId(c),
			Nickname: config.GetUserNickname(c),
			Module:   model.SystemLogModuleModelConfig,
			Action:   model.SystemLogActionUpdate,
			Content:  dimLog,
			IP:       utils.GetClientIP(c),
		})
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
var triggerWikiVectorReindex = triggerWikiVectorReindexAsync
var verifyNewEmbeddingModelForConfig = verifyNewEmbeddingModel
var rebuildVectorCollectionForConfig = rebuildVectorCollection

func triggerSiteEmbeddingReindexAsync(eid int64, oldCfg, newCfg *model.ModelConfigData, actualVectorDim int) {
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
			Eid:             eid,
			OldChannelID:    oldChannelID,
			OldModelName:    oldModelName,
			NewChannelID:    newChannelID,
			NewModelName:    newModelName,
			ActualVectorDim: actualVectorDim,
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
	triggerWikiVectorReindex(eid)
}

func triggerWikiVectorReindexAsync(eid int64) {
	common.SafeGo(context.Background(), func() {
		ctx := context.Background()
		reindexer, err := appservice.NewWikiVectorReindexService(model.DB)
		if err != nil {
			logger.SysErrorf("【Wiki重向量化】服务初始化失败: eid=%d err=%v", eid, err)
			return
		}
		result, err := reindexer.ReindexEnterprise(ctx, eid)
		logger.SysLogf("【Wiki重向量化】模型切换完成: eid=%d pages=%d succeeded=%d failed=%d", eid, result.PagesTotal, result.PagesSucceeded, result.PagesFailed)
		if err != nil {
			logger.SysErrorf("【Wiki重向量化】模型切换失败: eid=%d err=%v", eid, err)
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

// verifyNewEmbeddingModel 调用新模型 API 验证可用性并检测实际向量维度
func verifyNewEmbeddingModel(eid int64, channelID int64, modelName string) (int, error) {
	channel, err := model.GetChannelByID(channelID)
	if err != nil {
		return 0, fmt.Errorf("获取渠道失败: %v", err)
	}

	embeddingSvc := rag.NewEmbeddingService(model.DB)
	ctx := rag.NewEmptyEmbeddingContext()
	vector, err := embeddingSvc.CallEmbeddingAPIWithModel("53AI KM 向量模型验证", channel, modelName, ctx)
	if err != nil {
		return 0, fmt.Errorf("调用新模型 API 失败: %v (请检查渠道配置和模型名称)", err)
	}
	if len(vector) == 0 {
		return 0, fmt.Errorf("新模型返回空向量")
	}
	return len(vector), nil
}

// rebuildVectorCollection 删除旧向量集合并创建新集合
func rebuildVectorCollection(eid int64, dimension int) error {
	// 先刷新全局 buffer，确保所有待写入的旧向量都落盘
	if globalStore, err := vectorstore.GetGlobalVectorStore(); err == nil {
		if qdrantStore, ok := globalStore.(*vectorstore.QdrantStore); ok {
			logger.SysLogf("[SiteReindex] 刷新全局 buffer: eid=%d", eid)
			qdrantStore.FlushBuffer()
		}
	}

	cfg := vectorstore.LoadFromEnv()
	store, err := vectorstore.NewVectorStore(cfg)
	if err != nil {
		return fmt.Errorf("创建向量存储实例失败: %v", err)
	}

	ctx := context.Background()
	if err := store.Connect(ctx); err != nil {
		return fmt.Errorf("连接向量存储失败: %v", err)
	}
	defer store.Disconnect(ctx)

	collectionName := model.GetDocumentVectorCollectionName(eid)

	// 删除旧集合（忽略不存在错误）
	if err := store.DeleteCollection(ctx, collectionName); err != nil {
		if !vectorstore.IsNotFoundError(err) {
			return fmt.Errorf("删除旧集合 %s 失败: %v", collectionName, err)
		}
		logger.SysLogf("[SiteReindex] 旧集合不存在，跳过删除: %s", collectionName)
	} else {
		logger.SysLogf("[SiteReindex] 已删除旧集合: %s", collectionName)
	}

	// 创建新集合
	if err := store.CreateCollection(ctx, vectorstore.CollectionConfig{
		Name:      collectionName,
		Dimension: dimension,
		Metric:    cfg.DistanceMetric,
	}); err != nil {
		return fmt.Errorf("创建新集合 %s 失败: %v", collectionName, err)
	}
	logger.SysLogf("[SiteReindex] 已创建新集合: %s, dimension=%d", collectionName, dimension)

	return nil
}

// resolveCatalogDimension 从模型 catalog 解析维度（用于日志，失败时返回 0）
func resolveCatalogDimension(modelName string) int {
	if modelName == "" {
		return 0
	}
	meta, err := common.GetModelCatalogLoader().GetEmbeddingModelMeta(modelName)
	if err != nil || meta == nil {
		return 0
	}
	return meta.Dimensions
}
