package controller

import (
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// WikiPipelineController Wiki 管线/策略管理控制器。
// 与 RAG、图谱管线共用同一套实现，通过 kind=wiki 做数据隔离。
type WikiPipelineController struct {
	inner *RagPipelineController
}

func NewWikiPipelineController(db *gorm.DB) *WikiPipelineController {
	return &WikiPipelineController{inner: &RagPipelineController{DB: db, kind: model.PipelineKindWiki}}
}

// ListPipelines godoc
// @Summary 获取 Wiki 管线列表
// @Description 获取所有 Wiki 管线配置
// @Tags Wiki 管线
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=[]RagPipelineResponse}
// @Router /api/rag/v2/wiki-pipelines [get]
func (c *WikiPipelineController) ListPipelines(ctx *gin.Context) { c.inner.ListPipelines(ctx) }

// GetPipeline godoc
// @Summary 获取 Wiki 管线详情
// @Tags Wiki 管线
// @Security BearerAuth
// @Param id path int true "Wiki 管线ID"
// @Success 200 {object} model.CommonResponse{data=model.RagPipelineProfile}
// @Router /api/rag/v2/wiki-pipelines/{id} [get]
func (c *WikiPipelineController) GetPipeline(ctx *gin.Context) { c.inner.GetPipeline(ctx) }

// CreatePipeline godoc
// @Summary 创建 Wiki 管线
// @Tags Wiki 管线
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body CreatePipelineRequest true "Wiki 管线参数"
// @Success 201 {object} model.CommonResponse{data=model.RagPipelineProfile}
// @Router /api/rag/v2/wiki-pipelines [post]
func (c *WikiPipelineController) CreatePipeline(ctx *gin.Context) { c.inner.CreatePipeline(ctx) }

// UpdatePipeline godoc
// @Summary 更新 Wiki 管线
// @Tags Wiki 管线
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "Wiki 管线ID"
// @Param body body UpdatePipelineRequest true "Wiki 管线参数"
// @Success 200 {object} model.CommonResponse{data=model.RagPipelineProfile}
// @Router /api/rag/v2/wiki-pipelines/{id} [put]
func (c *WikiPipelineController) UpdatePipeline(ctx *gin.Context) { c.inner.UpdatePipeline(ctx) }

// DeletePipeline godoc
// @Summary 删除 Wiki 管线
// @Tags Wiki 管线
// @Security BearerAuth
// @Param id path int true "Wiki 管线ID"
// @Router /api/rag/v2/wiki-pipelines/{id} [delete]
func (c *WikiPipelineController) DeletePipeline(ctx *gin.Context) { c.inner.DeletePipeline(ctx) }

// ListStrategies godoc
// @Summary 获取 Wiki 策略列表
// @Tags Wiki 策略
// @Security BearerAuth
// @Param detail query int false "是否返回管线详情"
// @Router /api/rag/v2/wiki-strategies [get]
func (c *WikiPipelineController) ListStrategies(ctx *gin.Context) { c.inner.ListStrategies(ctx) }

// CreateStrategy godoc
// @Summary 创建 Wiki 策略
// @Tags Wiki 策略
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body CreateStrategyRequest true "Wiki 策略参数"
// @Router /api/rag/v2/wiki-strategies [post]
func (c *WikiPipelineController) CreateStrategy(ctx *gin.Context) { c.inner.CreateStrategy(ctx) }

// UpdateStrategy godoc
// @Summary 更新 Wiki 策略
// @Tags Wiki 策略
// @Security BearerAuth
// @Param id path int true "Wiki 策略ID"
// @Param body body UpdateStrategyRequest true "Wiki 策略参数"
// @Router /api/rag/v2/wiki-strategies/{id} [put]
func (c *WikiPipelineController) UpdateStrategy(ctx *gin.Context) { c.inner.UpdateStrategy(ctx) }

// ReorderStrategies godoc
// @Summary 重排 Wiki 策略
// @Tags Wiki 策略
// @Security BearerAuth
// @Param body body ReorderStrategiesRequest true "Wiki 策略顺序"
// @Router /api/rag/v2/wiki-strategies/reorder [post]
func (c *WikiPipelineController) ReorderStrategies(ctx *gin.Context) { c.inner.ReorderStrategies(ctx) }

// DeleteStrategy godoc
// @Summary 删除 Wiki 策略
// @Tags Wiki 策略
// @Security BearerAuth
// @Param id path int true "Wiki 策略ID"
// @Router /api/rag/v2/wiki-strategies/{id} [delete]
func (c *WikiPipelineController) DeleteStrategy(ctx *gin.Context) { c.inner.DeleteStrategy(ctx) }
