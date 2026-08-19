package controller

import (
	"errors"
	"net/http"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

type RecordingMemoryOverviewQuery struct {
	Kind    string `form:"kind"`
	Keyword string `form:"keyword"`
	Limit   int    `form:"limit"`
}

type RecordingMemoryEntityQuery struct {
	EntityType string `form:"entity_type"`
	Keyword    string `form:"keyword"`
	Limit      int    `form:"limit"`
	Offset     int    `form:"offset"`
}

type UpdateRecordingMemoryEntityRequest struct {
	CanonicalName *string           `json:"canonical_name"`
	Summary       *string           `json:"summary"`
	Attributes    map[string]string `json:"attributes"`
}

type CreateRecordingMemoryFactRequest struct {
	Content    string            `json:"content" binding:"required"`
	Attributes map[string]string `json:"attributes"`
}

type MergeRecordingMemoryEntitiesRequest struct {
	SourceID string `json:"source_id" binding:"required"`
	TargetID string `json:"target_id" binding:"required"`
}

type CreateRecordingMemoryRelationRequest struct {
	RelatedEntityID string `json:"related_entity_id" binding:"required"`
}

// GetRecordingMemoryOverview godoc
// @Summary 获取会议记忆总览
// @Description 返回当前用户录音产生的结构化会议记忆统计和最近条目。只返回当前用户有权访问的个人录音记忆。
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param kind query string false "记忆类型：decision/commitment/action/risk/opportunity/viewpoint/issue/open_question/quote"
// @Param keyword query string false "记忆内容或来源文件关键词"
// @Param limit query int false "返回条数" default(30)
// @Success 200 {object} model.CommonResponse{data=service.RecordingMemoryOverview}
// @Failure 400 {object} model.CommonResponse
// @Failure 403 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/recordings/memories/overview [get]
func GetRecordingMemoryOverview(c *gin.Context) {
	var req RecordingMemoryOverviewQuery
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	if req.Limit < 0 || req.Limit > 100 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("limit 必须在 0 到 100 之间"))
		return
	}

	data, err := service.NewRecordingMemoryService(config.GetEID(c)).GetOverview(
		c.Request.Context(),
		config.GetUserId(c),
		strings.TrimSpace(req.Kind),
		strings.TrimSpace(req.Keyword),
		req.Limit,
	)
	if err != nil {
		if errors.Is(err, service.ErrRecordingMemoryForbidden) {
			c.JSON(http.StatusForbidden, model.ForbiddenError.ToNewErrorResponse("无权查看会议记忆"))
			return
		}
		logger.SysErrorf("【会议记忆】总览查询失败: eid=%d user_id=%d err=%v", config.GetEID(c), config.GetUserId(c), err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToNewErrorResponse("获取会议记忆失败"))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// ListRecordingMemoryEntities godoc
// @Summary 获取安心录实体记忆列表
// @Description 返回当前用户可见的安心录实体记忆，按最近事实时间倒序。
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param entity_type query string false "人物/事项/风险/原则：person/matter/risk/principle"
// @Param keyword query string false "实体名或总结关键词"
// @Param limit query int false "返回条数" default(50)
// @Param offset query int false "跳过条数" default(0)
// @Success 200 {object} model.CommonResponse{data=service.RecordingMemoryEntityList}
// @Router /api/recordings/memories/entities [get]
func ListRecordingMemoryEntities(c *gin.Context) {
	var req RecordingMemoryEntityQuery
	if err := c.ShouldBindQuery(&req); err != nil || req.Limit < 0 || req.Limit > 100 || req.Offset < 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("查询参数不合法"))
		return
	}
	data, err := service.NewRecordingMemoryEntityService(config.GetEID(c)).List(c.Request.Context(), config.GetUserId(c), strings.TrimSpace(req.EntityType), strings.TrimSpace(req.Keyword), req.Limit, req.Offset)
	if respondRecordingEntityMemoryError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// GetRecordingMemoryEntity godoc
// @Summary 获取安心录实体记忆详情
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param entity_id path string true "实体ID（HashID）"
// @Success 200 {object} model.CommonResponse{data=service.RecordingMemoryEntityDetail}
// @Router /api/recordings/memories/entities/{entity_id} [get]
func GetRecordingMemoryEntity(c *gin.Context) {
	entityID, ok := parseRecordingMemoryID(c, "entity_id")
	if !ok {
		return
	}
	data, err := service.NewRecordingMemoryEntityService(config.GetEID(c)).Detail(c.Request.Context(), config.GetUserId(c), entityID)
	if respondRecordingEntityMemoryError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// UpdateRecordingMemoryEntity godoc
// @Summary 编辑安心录实体记忆
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param entity_id path string true "实体ID（HashID）"
// @Param request body UpdateRecordingMemoryEntityRequest true "编辑内容"
// @Success 200 {object} model.CommonResponse{data=service.RecordingMemoryEntityDetail}
// @Router /api/recordings/memories/entities/{entity_id} [patch]
func UpdateRecordingMemoryEntity(c *gin.Context) {
	entityID, ok := parseRecordingMemoryID(c, "entity_id")
	if !ok {
		return
	}
	var req UpdateRecordingMemoryEntityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	data, err := service.NewRecordingMemoryEntityService(config.GetEID(c)).Update(c.Request.Context(), config.GetUserId(c), entityID, service.UpdateRecordingMemoryEntityInput{CanonicalName: req.CanonicalName, Summary: req.Summary, Attributes: req.Attributes})
	if respondRecordingEntityMemoryError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// DeleteRecordingMemoryEntity godoc
// @Summary 删除空的安心录实体记忆
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param entity_id path string true "实体ID（HashID）"
// @Success 200 {object} model.CommonResponse
// @Router /api/recordings/memories/entities/{entity_id} [delete]
func DeleteRecordingMemoryEntity(c *gin.Context) {
	entityID, ok := parseRecordingMemoryID(c, "entity_id")
	if !ok {
		return
	}
	err := service.NewRecordingMemoryEntityService(config.GetEID(c)).DeleteEntity(c.Request.Context(), config.GetUserId(c), entityID)
	if respondRecordingEntityMemoryError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{"ok": true}))
}

// CreateRecordingMemoryFact godoc
// @Summary 添加安心录实体人工修正事实
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param entity_id path string true "实体ID（HashID）"
// @Param request body CreateRecordingMemoryFactRequest true "人工事实"
// @Success 200 {object} model.CommonResponse{data=service.RecordingMemoryEntityDetail}
// @Router /api/recordings/memories/entities/{entity_id}/facts [post]
func CreateRecordingMemoryFact(c *gin.Context) {
	entityID, ok := parseRecordingMemoryID(c, "entity_id")
	if !ok {
		return
	}
	var req CreateRecordingMemoryFactRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	data, err := service.NewRecordingMemoryEntityService(config.GetEID(c)).AddManualCorrection(c.Request.Context(), config.GetUserId(c), entityID, service.AddRecordingMemoryFactInput{Content: req.Content, Attributes: req.Attributes})
	if respondRecordingEntityMemoryError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// DeleteRecordingMemoryFact godoc
// @Summary 删除安心录实体事实
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param entity_id path string true "实体ID（HashID）"
// @Param fact_id path string true "事实ID（HashID）"
// @Success 200 {object} model.CommonResponse
// @Router /api/recordings/memories/entities/{entity_id}/facts/{fact_id} [delete]
func DeleteRecordingMemoryFact(c *gin.Context) {
	entityID, ok := parseRecordingMemoryID(c, "entity_id")
	if !ok {
		return
	}
	factID, ok := parseRecordingMemoryID(c, "fact_id")
	if !ok {
		return
	}
	err := service.NewRecordingMemoryEntityService(config.GetEID(c)).DeleteFact(c.Request.Context(), config.GetUserId(c), entityID, factID)
	if respondRecordingEntityMemoryError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{"ok": true}))
}

// MergeRecordingMemoryEntities godoc
// @Summary 融合两个安心录实体记忆
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body MergeRecordingMemoryEntitiesRequest true "源实体与保留实体"
// @Success 200 {object} model.CommonResponse{data=service.RecordingMemoryEntityDetail}
// @Router /api/recordings/memories/entity-merges [post]
func MergeRecordingMemoryEntities(c *gin.Context) {
	var req MergeRecordingMemoryEntitiesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	sourceID, err := hashids.TryParseID(req.SourceID)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	targetID, err := hashids.TryParseID(req.TargetID)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	data, err := service.NewRecordingMemoryEntityService(config.GetEID(c)).Merge(c.Request.Context(), config.GetUserId(c), sourceID, targetID)
	if respondRecordingEntityMemoryError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// CreateRecordingMemoryRelation godoc
// @Summary 添加安心录实体关联
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param entity_id path string true "实体ID（HashID）"
// @Param request body CreateRecordingMemoryRelationRequest true "关联实体"
// @Success 200 {object} model.CommonResponse{data=service.RecordingMemoryEntityDetail}
// @Router /api/recordings/memories/entities/{entity_id}/relations [post]
func CreateRecordingMemoryRelation(c *gin.Context) {
	entityID, ok := parseRecordingMemoryID(c, "entity_id")
	if !ok {
		return
	}
	var req CreateRecordingMemoryRelationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	relatedID, err := hashids.TryParseID(req.RelatedEntityID)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	data, err := service.NewRecordingMemoryEntityService(config.GetEID(c)).AddRelation(c.Request.Context(), config.GetUserId(c), entityID, relatedID)
	if respondRecordingEntityMemoryError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// DeleteRecordingMemoryRelation godoc
// @Summary 删除安心录实体关联
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param entity_id path string true "实体ID（HashID）"
// @Param relation_id path string true "关联ID（HashID）"
// @Success 200 {object} model.CommonResponse
// @Router /api/recordings/memories/entities/{entity_id}/relations/{relation_id} [delete]
func DeleteRecordingMemoryRelation(c *gin.Context) {
	entityID, ok := parseRecordingMemoryID(c, "entity_id")
	if !ok {
		return
	}
	relationID, ok := parseRecordingMemoryID(c, "relation_id")
	if !ok {
		return
	}
	err := service.NewRecordingMemoryEntityService(config.GetEID(c)).DeleteRelation(c.Request.Context(), config.GetUserId(c), entityID, relationID)
	if respondRecordingEntityMemoryError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{"ok": true}))
}

func parseRecordingMemoryID(c *gin.Context, key string) (int64, bool) {
	id, err := hashids.TryParseID(c.Param(key))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return 0, false
	}
	return id, true
}

// GetRecordingMemoryEntitySchema godoc
// @Summary 获取安心录实体记忆 Schema
// @Description 返回实体类型/属性/枚举定义（含中文 label），供前端展示与筛选。后端代码为唯一权威。
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=map[string]model.RecordingMemoryEntitySchema}
// @Router /api/recordings/memories/schema [get]
func GetRecordingMemoryEntitySchema(c *gin.Context) {
	c.JSON(http.StatusOK, model.Success.ToResponse(model.RecordingMemoryEntitySchemas))
}

func respondRecordingEntityMemoryError(c *gin.Context, err error) bool {
	if err == nil {
		return false
	}
	switch {
	case errors.Is(err, service.ErrRecordingMemoryForbidden):
		c.JSON(http.StatusForbidden, model.ForbiddenError.ToNewErrorResponse("无权操作会议记忆"))
	case errors.Is(err, service.ErrRecordingEntityMemoryNotFound):
		c.JSON(http.StatusNotFound, model.ParamError.ToNewErrorResponse("记忆实体或事实不存在"))
	case errors.Is(err, service.ErrRecordingEntityMemoryHasFacts):
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("请先删除该实体的全部有效事实"))
	default:
		logger.SysErrorf("【实体记忆】接口处理失败 eid=%d user_id=%d err=%v", config.GetEID(c), config.GetUserId(c), err)
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("会议记忆操作失败"))
	}
	return true
}
