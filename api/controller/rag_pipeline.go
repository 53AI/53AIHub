package controller

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type RagPipelineController struct {
	DB *gorm.DB
}

func NewRagPipelineController(db *gorm.DB) *RagPipelineController {
	return &RagPipelineController{DB: db}
}

func normalizeJSONString(raw json.RawMessage) (string, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return "", nil
	}
	if trimmed[0] == '"' {
		var s string
		if err := json.Unmarshal(trimmed, &s); err != nil {
			return "", err
		}
		return s, nil
	}
	return string(trimmed), nil
}

// PipelineStats 定义流水线统计信息
type PipelineStats struct {
	SuccessCount int64   `json:"success_count"`
	FailureCount int64   `json:"failure_count"`
	SuccessRate  float64 `json:"success_rate"`
	LastRunTime  int64   `json:"last_run_time"`
}

// RagPipelineResponse 包含统计信息的流水线响应
type RagPipelineResponse struct {
	model.RagPipelineProfile
	Stats PipelineStats `json:"stats"`
}

// ListPipelines godoc
// @Summary 获取流水线列表
// @Description 获取所有RAG流水线配置
// @Tags RAG流水线
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=[]RagPipelineResponse}
// @Failure 500 {object} model.CommonResponse
// @Router /api/rag/v2/pipelines [get]
func (c *RagPipelineController) ListPipelines(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	var pipelines []model.RagPipelineProfile
	if err := c.DB.Where("eid = ?", eid).Find(&pipelines).Error; err != nil {
		logger.Errorf(ctx, "获取流水线列表失败: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}

	var resp []RagPipelineResponse
	for _, p := range pipelines {
		rate := 0.0
		total := p.SuccessCount + p.FailureCount
		if total > 0 {
			rate = float64(p.SuccessCount) / float64(total)
		}

		resp = append(resp, RagPipelineResponse{
			RagPipelineProfile: p,
			Stats: PipelineStats{
				SuccessCount: p.SuccessCount,
				FailureCount: p.FailureCount,
				SuccessRate:  rate,
				LastRunTime:  p.LastRunTime,
			},
		})
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(resp))
}

// GetPipeline godoc
// @Summary 获取单个流水线详情
// @Description 根据ID获取RAG流水线配置
// @Tags RAG流水线
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "流水线ID"
// @Success 200 {object} model.CommonResponse{data=model.RagPipelineProfile}
// @Failure 400 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Router /api/rag/v2/pipelines/{id} [get]
func (c *RagPipelineController) GetPipeline(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	idStr := ctx.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("无效的ID"))
		return
	}

	var pipeline model.RagPipelineProfile
	if err := c.DB.Where("id = ? AND eid = ?", id, eid).First(&pipeline).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			ctx.JSON(http.StatusNotFound, model.NotFound.ToNewErrorResponse("流水线不存在"))
		} else {
			logger.Errorf(ctx, "获取流水线详情失败: %v", err)
			ctx.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		}
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(pipeline))
}

// CreatePipelineRequest 创建流水线请求参数
type CreatePipelineRequest struct {
	Name        string          `json:"name" binding:"required" example:"合同处理流程"`
	Icon        string          `json:"icon" example:"base64 or url"`
	ProfileJSON json.RawMessage `json:"profile_json" binding:"required" swaggertype:"object"` // 使用 RawMessage 接收任意 JSON
}

// CreatePipeline godoc
// @Summary 创建流水线
// @Description 创建新的RAG流水线配置
// @Tags RAG流水线
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body CreatePipelineRequest true "创建参数"
// @Success 201 {object} model.CommonResponse{data=model.RagPipelineProfile}
// @Failure 400 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/rag/v2/pipelines [post]
func (c *RagPipelineController) CreatePipeline(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	var req CreatePipelineRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}

	profileStr, err := normalizeJSONString(req.ProfileJSON)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}

	pipeline := &model.RagPipelineProfile{
		Eid:         eid,
		Name:        req.Name,
		Icon:        req.Icon,
		Status:      model.RagPipelineStatusEnabled,
		ProfileJSON: profileStr,
	}

	if err := c.DB.Create(pipeline).Error; err != nil {
		logger.Errorf(ctx, "创建流水线失败: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}

	ctx.JSON(http.StatusCreated, model.Success.ToResponse(pipeline))
}

// UpdatePipelineRequest 更新流水线请求参数
type UpdatePipelineRequest struct {
	Name        *string          `json:"name" example:"新名称"`
	Icon        *string          `json:"icon" example:"新图标"`
	Status      *int             `json:"status" example:"1"`
	ProfileJSON *json.RawMessage `json:"profile_json" swaggertype:"object"`
}

// UpdatePipeline godoc
// @Summary 更新流水线
// @Description 更新流水线配置
// @Tags RAG流水线
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "流水线ID"
// @Param body body UpdatePipelineRequest true "更新参数"
// @Success 200 {object} model.CommonResponse{data=model.RagPipelineProfile}
// @Failure 400 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/rag/v2/pipelines/{id} [put]
func (c *RagPipelineController) UpdatePipeline(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	idStr := ctx.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("无效的ID"))
		return
	}

	var req UpdatePipelineRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}

	updates := make(map[string]interface{})
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Icon != nil {
		updates["icon"] = *req.Icon
	}
	if req.Status != nil {
		updates["status"] = *req.Status
	}
	if req.ProfileJSON != nil {
		profileStr, err := normalizeJSONString(*req.ProfileJSON)
		if err != nil {
			ctx.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
			return
		}
		updates["profile_json"] = profileStr
	}

	if len(updates) > 0 {
		if err := c.DB.Model(&model.RagPipelineProfile{ID: id}).Where("eid = ?", eid).Updates(updates).Error; err != nil {
			logger.Errorf(ctx, "更新流水线失败: %v", err)
			ctx.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
			return
		}
	}

	var pipeline model.RagPipelineProfile
	if err := c.DB.Where("id = ? AND eid = ?", id, eid).First(&pipeline).Error; err != nil {
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(pipeline))
}

// DeletePipeline godoc
// @Summary 删除流水线
// @Description 删除流水线配置（物理删除，且检查是否有策略关联）
// @Tags RAG流水线
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "流水线ID"
// @Success 200 {object} model.CommonResponse
// @Failure 400 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/rag/v2/pipelines/{id} [delete]
func (c *RagPipelineController) DeletePipeline(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	idStr := ctx.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("无效的ID"))
		return
	}

	// 1. 验证流水线归属
	var pipeline model.RagPipelineProfile
	if err := c.DB.Where("id = ? AND eid = ?", id, eid).First(&pipeline).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			ctx.JSON(http.StatusNotFound, model.NotFound.ToNewErrorResponse("流水线不存在"))
		} else {
			ctx.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		}
		return
	}
	if pipeline.Name == "默认流水线" {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("默认流水线不允许删除"))
		return
	}

	// 2. 检查是否有策略正在使用该流水线
	var strategyCount int64
	if err := c.DB.Model(&model.RagRoutingStrategy{}).Where("pipeline_id = ?", id).Count(&strategyCount).Error; err != nil {
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}
	if strategyCount > 0 {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("该流水线已被策略引用，请先删除或修改关联策略"))
		return
	}

	// 3. 执行删除
	if err := c.DB.Delete(&pipeline).Error; err != nil {
		logger.Errorf(ctx, "删除流水线失败: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// ListStrategies godoc
// @Summary 获取策略路由列表
// @Description 获取所有策略路由规则，按优先级排序
// @Tags RAG策略路由
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=[]model.RoutingStrategyDetail}
// @Failure 500 {object} model.CommonResponse
// @Router /api/rag/v2/strategies [get]
func (c *RagPipelineController) ListStrategies(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	var strategies []model.RoutingStrategyDetail
	// 关联 Pipeline 名称
	err := c.DB.Table("rag_routing_strategies").
		Select("rag_routing_strategies.*, rag_pipeline_profiles.name as pipeline_name").
		Joins("JOIN rag_pipeline_profiles ON rag_pipeline_profiles.id = rag_routing_strategies.pipeline_id").
		Where("rag_routing_strategies.eid = ?", eid).
		Order("rag_routing_strategies.priority ASC").
		Scan(&strategies).Error

	if err != nil {
		logger.Errorf(ctx, "获取策略列表失败: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(strategies))
}

// CreateStrategyRequest 创建策略请求
type CreateStrategyRequest struct {
	Name           string          `json:"name" binding:"required" example:"规章制度策略"`
	Icon           string          `json:"icon" example:"图标"`
	Priority       int             `json:"priority" binding:"required" example:"10"`
	PipelineID     int64           `json:"pipeline_id" binding:"required" example:"1"`
	Logic          int             `json:"logic" binding:"required" example:"1"`
	ConditionsJSON json.RawMessage `json:"conditions_json" binding:"required" swaggertype:"string" example:"{}"`
	Enabled        bool            `json:"enabled" example:"true"`
}

// CreateStrategy godoc
// @Summary 创建策略
// @Description 创建新的策略路由规则
// @Tags RAG策略路由
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body CreateStrategyRequest true "创建参数"
// @Success 201 {object} model.CommonResponse{data=model.RagRoutingStrategy}
// @Failure 400 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/rag/v2/strategies [post]
func (c *RagPipelineController) CreateStrategy(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	var req CreateStrategyRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}

	conditionsStr, err := normalizeJSONString(req.ConditionsJSON)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}

	// 验证 Pipeline 是否属于当前企业
	var count int64
	if err := c.DB.Model(&model.RagPipelineProfile{}).Where("id = ? AND eid = ?", req.PipelineID, eid).Count(&count).Error; err != nil {
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}
	if count == 0 {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("无效的 Pipeline ID"))
		return
	}

	strategy := &model.RagRoutingStrategy{
		Eid:            eid,
		Name:           req.Name,
		Icon:           req.Icon,
		Priority:       req.Priority,
		PipelineID:     req.PipelineID,
		Logic:          req.Logic,
		ConditionsJSON: conditionsStr,
		Enabled:        req.Enabled,
	}

	if err := c.DB.Create(strategy).Error; err != nil {
		logger.Errorf(ctx, "创建策略失败: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}

	ctx.JSON(http.StatusCreated, model.Success.ToResponse(strategy))
}

// UpdateStrategyRequest 更新策略请求
type UpdateStrategyRequest struct {
	Name           *string          `json:"name" example:"新名称"`
	Icon           *string          `json:"icon" example:"新图标"`
	Priority       *int             `json:"priority" example:"20"`
	PipelineID     *int64           `json:"pipeline_id" example:"2"`
	Logic          *int             `json:"logic" example:"2"`
	ConditionsJSON *json.RawMessage `json:"conditions_json" swaggertype:"string" example:"{}"`
	Enabled        *bool            `json:"enabled" example:"false"`
}

type ReorderStrategiesRequest struct {
	StrategyIDs []int64 `json:"strategy_ids" binding:"required"`
}

// UpdateStrategy godoc
// @Summary 更新策略
// @Description 更新策略路由规则
// @Tags RAG策略路由
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "策略ID"
// @Param body body UpdateStrategyRequest true "更新参数"
// @Success 200 {object} model.CommonResponse{data=model.RagRoutingStrategy}
// @Failure 400 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/rag/v2/strategies/{id} [put]
func (c *RagPipelineController) UpdateStrategy(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	idStr := ctx.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("无效的ID"))
		return
	}

	var req UpdateStrategyRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}

	updates := make(map[string]interface{})
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Icon != nil {
		updates["icon"] = *req.Icon
	}
	if req.Priority != nil {
		updates["priority"] = *req.Priority
	}
	if req.PipelineID != nil {
		updates["pipeline_id"] = *req.PipelineID
	}
	if req.Logic != nil {
		updates["logic"] = *req.Logic
	}
	if req.ConditionsJSON != nil {
		conditionsStr, err := normalizeJSONString(*req.ConditionsJSON)
		if err != nil {
			ctx.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
			return
		}
		updates["conditions_json"] = conditionsStr
	}
	if req.Enabled != nil {
		updates["enabled"] = *req.Enabled
	}

	// 验证策略归属
	var existingStrategy model.RagRoutingStrategy
	if err := c.DB.Where("id = ? AND eid = ?", id, eid).First(&existingStrategy).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			ctx.JSON(http.StatusNotFound, model.NotFound.ToNewErrorResponse("策略不存在"))
		} else {
			ctx.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		}
		return
	}

	// 如果更新了 PipelineID，验证新 Pipeline 是否属于当前企业
	if req.PipelineID != nil && *req.PipelineID != existingStrategy.PipelineID {
		var count int64
		if err := c.DB.Model(&model.RagPipelineProfile{}).Where("id = ? AND eid = ?", *req.PipelineID, eid).Count(&count).Error; err != nil {
			ctx.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
			return
		}
		if count == 0 {
			ctx.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("无效的 Pipeline ID"))
			return
		}
	}

	if err := c.DB.Model(&model.RagRoutingStrategy{ID: id}).Updates(updates).Error; err != nil {
		logger.Errorf(ctx, "更新策略失败: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}

	var strategy model.RagRoutingStrategy
	if err := c.DB.First(&strategy, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			ctx.JSON(http.StatusNotFound, model.NotFound.ToNewErrorResponse("策略不存在"))
			return
		}
		logger.Errorf(ctx, "更新策略后查询详情失败: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(strategy))
}

// ReorderStrategies godoc
// @Summary 策略重排
// @Description 批量更新策略优先级，按传入的 ID 顺序重新设置 priority (从1开始)
// @Tags RAG策略路由
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body ReorderStrategiesRequest true "重排参数"
// @Success 200 {object} model.CommonResponse
// @Failure 400 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/rag/v2/strategies/reorder [post]
func (c *RagPipelineController) ReorderStrategies(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	var req ReorderStrategiesRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToErrorResponse(err))
		return
	}
	if len(req.StrategyIDs) == 0 {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("strategy_ids 不能为空"))
		return
	}

	seen := make(map[int64]struct{}, len(req.StrategyIDs))
	for _, id := range req.StrategyIDs {
		if _, exists := seen[id]; exists {
			ctx.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("strategy_ids 存在重复值"))
			return
		}
		seen[id] = struct{}{}
	}

	var count int64
	if err := c.DB.Model(&model.RagRoutingStrategy{}).Where("eid = ? AND id IN ?", eid, req.StrategyIDs).Count(&count).Error; err != nil {
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}
	if count != int64(len(req.StrategyIDs)) {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("strategy_ids 存在无效ID或不属于当前企业的策略"))
		return
	}

	tx := c.DB.Begin()
	for index, id := range req.StrategyIDs {
		priority := index + 1
		if err := tx.Model(&model.RagRoutingStrategy{}).Where("eid = ? AND id = ?", eid, id).Update("priority", priority).Error; err != nil {
			tx.Rollback()
			ctx.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
			return
		}
	}
	if err := tx.Commit().Error; err != nil {
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// DeleteStrategy godoc
// @Summary 删除策略
// @Description 删除策略路由规则
// @Tags RAG策略路由
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "策略ID"
// @Success 200 {object} model.CommonResponse
// @Failure 400 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/rag/v2/strategies/{id} [delete]
func (c *RagPipelineController) DeleteStrategy(ctx *gin.Context) {
	eid := config.GetEID(ctx)
	idStr := ctx.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("无效的ID"))
		return
	}

	// 验证策略归属
	var existingStrategy model.RagRoutingStrategy
	if err := c.DB.Where("id = ? AND eid = ?", id, eid).First(&existingStrategy).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			ctx.JSON(http.StatusNotFound, model.NotFound.ToNewErrorResponse("策略不存在"))
		} else {
			ctx.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		}
		return
	}

	if existingStrategy.IsDefault {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("默认策略不允许删除"))
		return
	}

	if err := c.DB.Delete(&model.RagRoutingStrategy{}, id).Error; err != nil {
		logger.Errorf(ctx, "删除策略失败: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}

	ctx.JSON(http.StatusOK, model.Success.ToResponse(nil))
}
