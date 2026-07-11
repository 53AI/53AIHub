package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"github.com/53AI/53AIHub/service/utils"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// DocumentExtensionResponse 文档扩展名映射响应结构体
type DocumentExtensionResponse struct {
	// 文档扩展名映射
	DocumentExtensionMap map[string][]string `json:"document_extension_map"`
	// 基础扩展名支持拆分策略映射
	BaseExtensionChunkTypeMap map[string][]string `json:"base_extension_chunk_type_map"`
}

// ChunkConfigRequest 分块配置请求结构体（完整配置，向后兼容）
type ChunkConfigRequest struct {
	LibraryID                *int64                  `json:"library_id" example:"1"`
	MinChunkSize             int                     `json:"min_chunk_size" example:"1000"`
	KnowledgeSplitRule       string                  `json:"knowledge_split_rule" example:"h2"`
	KnowledgeMaxLength       int                     `json:"knowledge_max_length" example:"2000"`
	KnowledgeOverlapSize     int                     `json:"knowledge_overlap_size" example:"100"`
	KnowledgeIncludeTitle    bool                    `json:"knowledge_include_title" example:"false"`
	KnowledgeIncludeFileName bool                    `json:"knowledge_include_filename" example:"false"`
	IndexSplitRule           string                  `json:"index_split_rule" example:"\n\n"`
	IndexMaxLength           int                     `json:"index_max_length" example:"2000"`
	IndexOverlapSize         int                     `json:"index_overlap_size" example:"100"`
	IndexIncludeTitle        bool                    `json:"index_include_title" example:"false"`
	IndexIncludeFileName     bool                    `json:"index_include_filename" example:"false"`
	SummaryGeneration        string                  `json:"summary_generation" example:"manual"`
	QuestionGeneration       string                  `json:"question_generation" example:"manual"`
	LogicChannelID           *int64                  `json:"logic_channel_id" example:"1"`
	LogicModelName           *string                 `json:"logic_model_name" example:"gpt-4o-mini"`
	EmbeddingChannelID       *int64                  `json:"embedding_channel_id" example:"2"`
	EmbeddingModelName       *string                 `json:"embedding_model_name" example:"text-embedding-3-small"`
	SearchConfig             *model.SearchConfigData `json:"search_config"`
	Type                     string                  `json:"type" gorm:"default:'default'" comment:"文档类型"`
	Name                     string                  `json:"name" gorm:"type:varchar(255);not null" comment:"配置名称"`
}

// ModelConfigJSONRequest 模型配置JSON请求结构体
type ModelConfigJSONRequest struct {
	ModelConfig *model.ModelConfigData `json:"model_config"`
}

// ChunkingConfigJSONRequest 资料拆分配置JSON请求结构体
type ChunkingConfigJSONRequest struct {
	ChunkingConfig *model.ChunkingConfigData `json:"chunking_config"`
}

// ModelConfigJSONResponse 模型配置JSON响应结构体
type ModelConfigJSONResponse struct {
	ID          int64                  `json:"id" example:"1"`
	Eid         int64                  `json:"eid" example:"1"`
	LibraryID   *int64                 `json:"library_id" example:"1"`
	FileID      *int64                 `json:"file_id" example:"1"`
	ModelConfig *model.ModelConfigData `json:"model_config"`
	CreatedTime int64                  `json:"created_time" example:"1672502400"`
	UpdatedTime int64                  `json:"updated_time" example:"1672502400"`
}

// ChunkingConfigJSONResponse 资料拆分配置JSON响应结构体
type ChunkingConfigJSONResponse struct {
	ID             int64                     `json:"id" example:"1"`
	Eid            int64                     `json:"eid" example:"1"`
	LibraryID      *int64                    `json:"library_id" example:"1"`
	FileID         *int64                    `json:"file_id" example:"1"`
	ChunkingConfig *model.ChunkingConfigData `json:"chunking_config"`
	CreatedTime    int64                     `json:"created_time" example:"1672502400"`
	UpdatedTime    int64                     `json:"updated_time" example:"1672502400"`
}

// ChannelValidateRequest 渠道验证请求结构体
type ChannelValidateRequest struct {
	LogicChannelID     *int64 `json:"logic_channel_id" example:"1"`
	EmbeddingChannelID *int64 `json:"embedding_channel_id" example:"2"`
}

// ChannelInfo 渠道信息结构体
type ChannelInfo struct {
	ID   int    `json:"id" example:"1"`
	Name string `json:"name" example:"OpenAI GPT-4"`
	Type string `json:"type" example:"openai"`
}

// GetChunkSettings godoc
// @Summary 获取分块配置列表
// @Description 获取分块配置列表，可按知识库ID筛选
// @Tags 分块配置管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param library_id query int false "知识库ID，用于筛选特定知识库的配置" example(1)
// @Success 200 {object} model.CommonResponse{data=[]ChunkingConfigJSONResponse} "成功返回分块配置列表"
// @Failure 400 {object} model.CommonResponse "请求参数错误"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunk-settings [get]
func GetChunkSettings(c *gin.Context) {
	eid := config.GetEID(c)

	// 获取查询参数
	libraryIDStr := c.Query("library_id")
	var libraryID *int64
	if libraryIDStr != "" {
		if id, err := strconv.ParseInt(libraryIDStr, 10, 64); err == nil {
			libraryID = &id
		}
	}

	// 创建配置服务
	configService := rag.NewChunkConfigService(model.DB)

	// 获取配置列表
	configs, err := configService.GetConfigsByEid(eid, libraryID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 转换为ChunkingConfigJSONResponse格式
	var response []ChunkingConfigJSONResponse
	for _, config := range configs {
		// 获取资料拆分配置JSON
		chunkingConfig, err := configService.GetChunkingConfigFromChunkConfig(config)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}

		resp := ChunkingConfigJSONResponse{
			ID:             config.ID,
			Eid:            config.Eid,
			LibraryID:      config.LibraryID,
			FileID:         nil,
			ChunkingConfig: chunkingConfig,
			CreatedTime:    config.CreatedTime,
			UpdatedTime:    config.UpdatedTime,
		}
		response = append(response, resp)
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// GetSiteChunkingConfig godoc
// @Summary 获取站点资料拆分配置
// @Description 获取站点级别的资料拆分配置JSON
// @Tags 资料拆分配置管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param type query string false "文档类型" Enums(default,data_table,qa,product_plan,product_catalog,video_course) example(default)
// @Success 200 {object} model.CommonResponse{data=ChunkingConfigJSONResponse} "成功获取站点资料拆分配置"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunk-settings/chunking-config/site [get]
func GetSiteChunkingConfig(c *gin.Context) {
	eid := config.GetEID(c)

	// 获取type参数，默认为default
	chunkType := c.DefaultQuery("type", model.ChunkTypeDefault)

	// 创建配置服务
	configService := rag.NewChunkConfigService(model.DB)

	// 获取站点配置
	chunkConfig, err := configService.GetConfig(eid, nil, chunkType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 获取资料拆分配置JSON
	chunkingConfig, err := configService.GetChunkingConfigFromChunkConfig(chunkConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	response := &ChunkingConfigJSONResponse{
		ID:             chunkConfig.ID,
		Eid:            chunkConfig.Eid,
		LibraryID:      chunkConfig.LibraryID,
		FileID:         nil,
		ChunkingConfig: chunkingConfig,
		CreatedTime:    chunkConfig.CreatedTime,
		UpdatedTime:    chunkConfig.UpdatedTime,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// GetDefaultChunkingConfig godoc
// @Summary 获取系统默认资料拆分配置
// @Description 获取系统级别的默认资料拆分配置JSON，支持不同类型文档的默认配置
// @Tags 资料拆分配置管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param type query string false "文档类型" Enums(default,data_table,qa,product_plan,product_catalog,video_course) example(default)
// @Success 200 {object} model.CommonResponse{data=ChunkingConfigJSONResponse} "成功获取系统默认资料拆分配置"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunk-settings/default [get]
func GetDefaultChunkingConfig(c *gin.Context) {
	// 获取type参数，默认为default
	chunkType := c.DefaultQuery("type", model.ChunkTypeDefault)

	// 创建配置服务
	configService := rag.NewChunkConfigService(model.DB)

	chunkConfig, err := configService.GetSystemDefaultConfig(chunkType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	chunkingConfig, err := configService.GetChunkingConfigFromChunkConfig(chunkConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	response := &ChunkingConfigJSONResponse{
		ID:             chunkConfig.ID,
		Eid:            chunkConfig.Eid,
		LibraryID:      chunkConfig.LibraryID,
		FileID:         nil,
		ChunkingConfig: chunkingConfig,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// UpdateSiteChunkingConfig godoc
// @Summary 更新站点资料拆分配置
// @Description 更新站点级别的资料拆分配置JSON
// @Tags 资料拆分配置管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body ChunkingConfigJSONRequest true "资料拆分配置JSON"
// @Success 200 {object} model.CommonResponse{data=ChunkingConfigJSONResponse} "成功更新站点资料拆分配置"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunk-settings/chunking-config/site [put]
func UpdateSiteChunkingConfig(c *gin.Context) {
	eid := config.GetEID(c)

	// 解析请求体
	var req ChunkingConfigJSONRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 从请求体中获取type参数，如果不存在则使用默认值
	chunkType := model.ChunkTypeDefault
	name := rag.DefaultName
	if req.ChunkingConfig != nil {
		if req.ChunkingConfig.Type != "" {
			chunkType = req.ChunkingConfig.Type
		}
		if req.ChunkingConfig.Name != "" {
			name = req.ChunkingConfig.Name
		}
	}

	// 创建配置服务
	configService := rag.NewChunkConfigService(model.DB)

	// 获取或创建站点配置
	chunkConfig, err := configService.GetConfig(eid, nil, chunkType)
	if err != nil {
		// 如果配置不存在，创建默认配置
		chunkConfig, err = configService.CreateDefaultConfig(eid, nil, chunkType, name)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
	}

	// 更新资料拆分配置
	err = configService.UpdateChunkingConfigInChunkConfig(chunkConfig, req.ChunkingConfig)
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

	// 获取更新后的资料拆分配置
	updatedChunkingConfig, err := configService.GetChunkingConfigFromChunkConfig(chunkConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	response := &ChunkingConfigJSONResponse{
		ID:             chunkConfig.ID,
		Eid:            chunkConfig.Eid,
		LibraryID:      chunkConfig.LibraryID,
		FileID:         nil,
		ChunkingConfig: updatedChunkingConfig,
		CreatedTime:    chunkConfig.CreatedTime,
		UpdatedTime:    chunkConfig.UpdatedTime,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// GetLibraryChunkingConfig godoc
// @Summary 获取知识库资料拆分配置
// @Description 获取指定知识库的资料拆分配置JSON，如果不存在则返回站点默认配置
// @Tags 资料拆分配置管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param library_id path int true "知识库ID" example(1)
// @Param type query string false "文档类型" Enums(default,data_table,qa,product_plan,product_catalog,video_course) example(default)
// @Success 200 {object} model.CommonResponse{data=ChunkingConfigJSONResponse} "成功获取知识库资料拆分配置"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunk-settings/chunking-config/library/{library_id} [get]
func GetLibraryChunkingConfig(c *gin.Context) {
	eid := config.GetEID(c)

	// 获取知识库ID
	libraryIDStr := c.Param("library_id")
	libraryID, err := strconv.ParseInt(libraryIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 获取type参数，默认为default
	chunkType := c.DefaultQuery("type", model.ChunkTypeDefault)

	// 创建配置服务
	configService := rag.NewChunkConfigService(model.DB)

	// 获取知识库配置
	chunkConfig, err := configService.GetConfig(eid, &libraryID, chunkType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 获取资料拆分配置JSON
	chunkingConfig, err := configService.GetChunkingConfigFromChunkConfig(chunkConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	response := &ChunkingConfigJSONResponse{
		ID:             chunkConfig.ID,
		Eid:            chunkConfig.Eid,
		LibraryID:      chunkConfig.LibraryID,
		FileID:         nil,
		ChunkingConfig: chunkingConfig,
		CreatedTime:    chunkConfig.CreatedTime,
		UpdatedTime:    chunkConfig.UpdatedTime,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// UpdateLibraryChunkingConfig godoc
// @Summary 更新知识库资料拆分配置
// @Description 更新指定知识库的资料拆分配置JSON
// @Tags 资料拆分配置管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param library_id path int true "知识库ID" example(1)
// @Param request body ChunkingConfigJSONRequest true "资料拆分配置JSON"
// @Success 200 {object} model.CommonResponse{data=ChunkingConfigJSONResponse} "成功更新知识库资料拆分配置"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunk-settings/chunking-config/library/{library_id} [put]
func UpdateLibraryChunkingConfig(c *gin.Context) {
	eid := config.GetEID(c)

	// 获取知识库ID
	libraryIDStr := c.Param("library_id")
	libraryID, err := strconv.ParseInt(libraryIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 解析请求体
	var req ChunkingConfigJSONRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 从请求体中获取type参数，如果不存在则使用默认值
	chunkType := model.ChunkTypeDefault
	name := rag.DefaultName
	if req.ChunkingConfig != nil {
		if req.ChunkingConfig.Type != "" {
			chunkType = req.ChunkingConfig.Type
		}
		if req.ChunkingConfig.Name != "" {
			name = req.ChunkingConfig.Name
		}
	}

	// 创建配置服务
	configService := rag.NewChunkConfigService(model.DB)

	// 获取或创建知识库配置
	chunkConfig, err := configService.GetConfig(eid, &libraryID, chunkType)
	if err != nil {
		// 如果配置不存在，创建默认配置
		chunkConfig, err = configService.CreateDefaultConfig(eid, &libraryID, chunkType, name)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
	}

	// 更新资料拆分配置
	err = configService.UpdateChunkingConfigInChunkConfig(chunkConfig, req.ChunkingConfig)
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

	// 获取更新后的资料拆分配置
	updatedChunkingConfig, err := configService.GetChunkingConfigFromChunkConfig(chunkConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	response := &ChunkingConfigJSONResponse{
		ID:             chunkConfig.ID,
		Eid:            chunkConfig.Eid,
		LibraryID:      chunkConfig.LibraryID,
		FileID:         nil,
		ChunkingConfig: updatedChunkingConfig,
		CreatedTime:    chunkConfig.CreatedTime,
		UpdatedTime:    chunkConfig.UpdatedTime,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// GetDocumentChunkingConfig godoc
// @Summary 获取文档资料拆分配置
// @Description 获取指定文档的资料拆分配置JSON，如果不存在则返回继承的配置
// @Tags 资料拆分配置管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID" example(1)
// @Success 200 {object} model.CommonResponse{data=ChunkingConfigJSONResponse} "成功获取文档资料拆分配置"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "文件不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunk-settings/chunking-config/document/{file_id} [get]
func GetDocumentChunkingConfig(c *gin.Context) {
	eid := config.GetEID(c)

	// 获取文件ID
	fileIDStr := c.Param("file_id")
	fileID, err := strconv.ParseInt(fileIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 获取文件信息
	var file model.File
	err = model.DB.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, model.CommonResponse{
				Code:    http.StatusNotFound,
				Message: "文件不存在",
				Data:    nil,
			})
		} else {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		}
		return
	}

	// 创建配置服务
	configService := rag.NewChunkConfigService(model.DB)

	// 获取文档配置（支持4层级联）
	chunkConfig, err := configService.GetConfigWithFileID(eid, &file.LibraryID, &fileID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 获取资料拆分配置JSON
	chunkingConfig, err := configService.GetChunkingConfigFromChunkConfig(chunkConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	response := &ChunkingConfigJSONResponse{
		ID:             chunkConfig.ID,
		Eid:            chunkConfig.Eid,
		LibraryID:      chunkConfig.LibraryID,
		FileID:         &fileID,
		ChunkingConfig: chunkingConfig,
		CreatedTime:    chunkConfig.CreatedTime,
		UpdatedTime:    chunkConfig.UpdatedTime,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// UpdateDocumentChunkingConfig godoc
// @Summary 更新文档资料拆分配置
// @Description 更新指定文档的资料拆分配置JSON
// @Tags 资料拆分配置管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID" example(1)
// @Param request body ChunkingConfigJSONRequest true "资料拆分配置JSON"
// @Success 200 {object} model.CommonResponse{data=ChunkingConfigJSONResponse} "成功更新文档资料拆分配置"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "文件不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunk-settings/chunking-config/document/{file_id} [put]
func UpdateDocumentChunkingConfig(c *gin.Context) {
	eid := config.GetEID(c)

	// 获取文件ID
	fileIDStr := c.Param("file_id")
	fileID, err := strconv.ParseInt(fileIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 解析请求体
	var req ChunkingConfigJSONRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 从请求体中获取type参数，如果不存在则使用默认值
	chunkType := model.ChunkTypeDefault
	name := rag.DefaultName
	if req.ChunkingConfig != nil {
		if req.ChunkingConfig.Type != "" {
			chunkType = req.ChunkingConfig.Type
		}
		if req.ChunkingConfig.Name != "" {
			name = req.ChunkingConfig.Name
		}
	}

	// 获取文件信息
	var file model.File
	err = model.DB.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, model.CommonResponse{
				Code:    http.StatusNotFound,
				Message: "文件不存在",
				Data:    nil,
			})
		} else {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		}
		return
	}

	// 创建配置服务
	configService := rag.NewChunkConfigService(model.DB)

	var chunkConfig *rag.ChunkConfig
	needUpdateFileConfigID := false

	// 根据新类型处理配置
	switch chunkType {
	case model.ChunkTypeDataTable, model.ChunkTypeQA:
		// 对于特殊类型，使用系统预设配置
		chunkConfig, err = configService.GetConfigByType(0, chunkType)
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}

		needUpdateFileConfigID = true
		// 如果文件之前使用的是default类型配置，需要删除旧配置
		if file.ConfigID != nil && *file.ConfigID != chunkConfig.ID {
			// 删除旧的default配置（不会删除系统预设的qa、data_table配置）
			_ = model.DeleteChunkSetting(eid, *file.ConfigID)
		}
	case model.ChunkTypeDefault:
		// 对于default类型，需要创建或更新具体配置
		if file.ConfigID != nil {
			// 获取现有配置
			chunkConfig, err = configService.GetConfigWithFileID(eid, nil, &file.ID)
			if err != nil {
				c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
				return
			}
		}
		if chunkConfig == nil || chunkConfig.Type != model.ChunkTypeDefault {
			// 没有文件专属配置，创建新的文档级配置
			chunkConfig, err = configService.CreateDefaultConfig(eid, nil, chunkType, name)
			if err != nil {
				c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
				return
			}
			needUpdateFileConfigID = true
		}
	default:
		c.JSON(http.StatusNotFound, model.ParamError.ToResponse(nil))
		return
	}

	// 只有当文件的配置ID与chunkConfig的ID不一致时才更新
	if (file.ConfigID == nil && chunkConfig.ID != 0) || (file.ConfigID != nil && *file.ConfigID != chunkConfig.ID) {
		needUpdateFileConfigID = true
	}

	if needUpdateFileConfigID {
		// 更新文件的配置ID
		err = model.DB.Model(&file).Update("config_id", chunkConfig.ID).Error
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
	}

	// 如果是default类型，更新具体的配置参数
	if chunkType == model.ChunkTypeDefault {
		// 更新资料拆分配置
		err = configService.UpdateChunkingConfigInChunkConfig(chunkConfig, req.ChunkingConfig)
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
	}

	// 获取更新后的资料拆分配置
	updatedChunkingConfig, err := configService.GetChunkingConfigFromChunkConfig(chunkConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	response := &ChunkingConfigJSONResponse{
		ID:             chunkConfig.ID,
		Eid:            chunkConfig.Eid,
		LibraryID:      chunkConfig.LibraryID,
		FileID:         &fileID,
		ChunkingConfig: updatedChunkingConfig,
		CreatedTime:    chunkConfig.CreatedTime,
		UpdatedTime:    chunkConfig.UpdatedTime,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// GetDocumentExtensionMapping 获取文档扩展名映射和分块类型映射信息
// @Summary 获取文档扩展名映射信息
// @Description 获取文档扩展名映射和分块类型映射信息，用于前端展示
// @Tags 资料拆分配置管理
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=DocumentExtensionResponse} "成功获取文档扩展名映射信息"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/chunk-settings/document-extension-map [get]
func GetDocumentExtensionMapping(c *gin.Context) {
	response := &DocumentExtensionResponse{
		DocumentExtensionMap:      utils.DocumentExtensionMap,
		BaseExtensionChunkTypeMap: utils.BaseExtensionChunkTypeMap,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}
