package controller

import (
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// GraphPipelineController 图谱管线/策略管理控制器。
// 与 RAG 管线共用同一套实现（RagPipelineController.kind=graph），
// 本控制器只提供带独立 Swagger 注解的薄包装，避免重复业务逻辑。
type GraphPipelineController struct {
	inner *RagPipelineController
}

func NewGraphPipelineController(db *gorm.DB) *GraphPipelineController {
	return &GraphPipelineController{inner: &RagPipelineController{DB: db, kind: model.PipelineKindGraph}}
}

// ListPipelines godoc
// @Summary 获取图谱管线列表
// @Description 获取所有图谱管线配置
// @Tags 图谱管线
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=[]RagPipelineResponse}
// @Failure 500 {object} model.CommonResponse
// @Router /api/rag/v2/graph-pipelines [get]
func (c *GraphPipelineController) ListPipelines(ctx *gin.Context) { c.inner.ListPipelines(ctx) }

// GetPipeline godoc
// @Summary 获取单个图谱管线详情
// @Description 根据ID获取图谱管线配置
// @Tags 图谱管线
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "图谱管线ID"
// @Success 200 {object} model.CommonResponse{data=model.RagPipelineProfile}
// @Failure 400 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Router /api/rag/v2/graph-pipelines/{id} [get]
func (c *GraphPipelineController) GetPipeline(ctx *gin.Context) { c.inner.GetPipeline(ctx) }

// CreatePipeline godoc
// @Summary 创建图谱管线
// @Description 创建新的图谱管线配置（profile 必须包含 graph_generation 步骤；开关 enabled 默认开启，未配置模板时自动开启智能匹配）
// @Tags 图谱管线
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body CreatePipelineRequest true "创建参数"
// @Success 201 {object} model.CommonResponse{data=model.RagPipelineProfile}
// @Failure 400 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/rag/v2/graph-pipelines [post]
func (c *GraphPipelineController) CreatePipeline(ctx *gin.Context) { c.inner.CreatePipeline(ctx) }

// UpdatePipeline godoc
// @Summary 更新图谱管线
// @Description 更新图谱管线配置（profile 校验同创建）
// @Tags 图谱管线
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "图谱管线ID"
// @Param body body UpdatePipelineRequest true "更新参数"
// @Success 200 {object} model.CommonResponse{data=model.RagPipelineProfile}
// @Failure 400 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/rag/v2/graph-pipelines/{id} [put]
func (c *GraphPipelineController) UpdatePipeline(ctx *gin.Context) { c.inner.UpdatePipeline(ctx) }

// DeletePipeline godoc
// @Summary 删除图谱管线
// @Description 删除图谱管线配置（物理删除，且检查是否有策略关联；默认图谱管线不允许删除）
// @Tags 图谱管线
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "图谱管线ID"
// @Success 200 {object} model.CommonResponse
// @Failure 400 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/rag/v2/graph-pipelines/{id} [delete]
func (c *GraphPipelineController) DeletePipeline(ctx *gin.Context) { c.inner.DeletePipeline(ctx) }

// ListStrategies godoc
// @Summary 获取图谱策略列表
// @Description 获取所有图谱策略路由规则，按优先级排序
// @Tags 图谱策略
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param detail query int false "是否返回关联图谱管线详情(1:是)"
// @Success 200 {object} model.CommonResponse{data=[]model.RoutingStrategyDetail}
// @Failure 500 {object} model.CommonResponse
// @Router /api/rag/v2/graph-strategies [get]
func (c *GraphPipelineController) ListStrategies(ctx *gin.Context) { c.inner.ListStrategies(ctx) }

// CreateStrategy godoc
// @Summary 创建图谱策略
// @Description 创建新的图谱策略路由规则（pipeline_id 必须是当前企业的图谱管线）
// @Tags 图谱策略
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body CreateStrategyRequest true "创建参数"
// @Success 201 {object} model.CommonResponse{data=model.RagRoutingStrategy}
// @Failure 400 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/rag/v2/graph-strategies [post]
func (c *GraphPipelineController) CreateStrategy(ctx *gin.Context) { c.inner.CreateStrategy(ctx) }

// UpdateStrategy godoc
// @Summary 更新图谱策略
// @Description 更新图谱策略路由规则
// @Tags 图谱策略
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "策略ID"
// @Param body body UpdateStrategyRequest true "更新参数"
// @Success 200 {object} model.CommonResponse{data=model.RagRoutingStrategy}
// @Failure 400 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/rag/v2/graph-strategies/{id} [put]
func (c *GraphPipelineController) UpdateStrategy(ctx *gin.Context) { c.inner.UpdateStrategy(ctx) }

// ReorderStrategies godoc
// @Summary 图谱策略重排
// @Description 批量更新图谱策略优先级，按传入的 ID 顺序重新设置 priority (从1开始)
// @Tags 图谱策略
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body ReorderStrategiesRequest true "重排参数"
// @Success 200 {object} model.CommonResponse
// @Failure 400 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/rag/v2/graph-strategies/reorder [post]
func (c *GraphPipelineController) ReorderStrategies(ctx *gin.Context) { c.inner.ReorderStrategies(ctx) }

// DeleteStrategy godoc
// @Summary 删除图谱策略
// @Description 删除图谱策略路由规则（默认兜底策略不允许删除）
// @Tags 图谱策略
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "策略ID"
// @Success 200 {object} model.CommonResponse
// @Failure 400 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/rag/v2/graph-strategies/{id} [delete]
func (c *GraphPipelineController) DeleteStrategy(ctx *gin.Context) { c.inner.DeleteStrategy(ctx) }
