package controller

import (
	"errors"
	"net/http"
	"strconv"
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
	EntityType     []string `form:"entity_type"`
	Keyword        string   `form:"keyword"`
	Name           string   `form:"name"`
	AttributeKey   string   `form:"attribute_key"`
	AttributeValue string   `form:"attribute_value"`
	SortBy         string   `form:"sort_by"`
	Limit          int      `form:"limit"`
	Offset         int      `form:"offset"`
}

// RecordingMemoryRelationGroupRequest 一组结构化关联：按 relation_type 替换该类型的关联集合。
// 未出现的 relation_type 保持不变；related_entity_ids 为空数组表示清空该类型。
type RecordingMemoryRelationGroupRequest struct {
	RelationType     string   `json:"relation_type"`
	RelatedEntityIDs []string `json:"related_entity_ids"`
}

type CreateRecordingMemoryEntityRequest struct {
	EntityType    string                                `json:"entity_type" binding:"required"`
	CanonicalName string                                `json:"canonical_name" binding:"required"`
	Summary       string                                `json:"summary"`
	Attributes    map[string]string                     `json:"attributes"`
	Aliases       *[]string                             `json:"aliases"`
	Facts         []CreateRecordingMemoryFactRequest    `json:"facts"`
	Relations     []RecordingMemoryRelationGroupRequest `json:"relations"`
}

type UpdateRecordingMemoryEntityRequest struct {
	CanonicalName  *string                               `json:"canonical_name"`
	Summary        *string                               `json:"summary"`
	Attributes     map[string]string                     `json:"attributes"`
	Aliases        *[]string                             `json:"aliases"` // 替换语义：缺省=不改，[]=清空
	Facts          []UpdateRecordingMemoryFactRequest    `json:"facts"`
	DeletedFactIDs []string                              `json:"deleted_fact_ids"`
	Relations      []RecordingMemoryRelationGroupRequest `json:"relations"` // 缺省=不改，按 relation_type 替换
}

type CreateRecordingMemoryFactRequest struct {
	RelatedEntityID int64             `json:"related_entity_id"` // 被关联实体 id（HashID 已解码）；>0 = 从其他实体关联过来的 fact（内容由详情回填）
	Content         string            `json:"content"`           // 普通人工事实内容（RelatedEntityID=0 时必填）
	Attributes      map[string]string `json:"attributes"`
}

type AddRecordingMemoryFactRequest struct {
	Content    string            `json:"content" binding:"required"` // 人工修正事实内容（必填）
	Attributes map[string]string `json:"attributes"`
}

type UpdateRecordingMemoryFactRequest struct {
	ID              int64             `json:"id"`                // 记录 id（>0 修改既有事实，仅人工可改）
	RelatedEntityID int64             `json:"related_entity_id"` // 被关联实体 id（HashID 已解码）；>0 = 修改关联目标
	Content         string            `json:"content"`           // 普通人工事实内容（RelatedEntityID=0 时用于修改内容）
	Attributes      map[string]string `json:"attributes"`
}

type MergeRecordingMemoryEntitiesRequest struct {
	SourceID  string   `json:"source_id"` // 兼容旧契约：单源融合
	TargetID  string   `json:"target_id" binding:"required"`
	SourceIDs []string `json:"source_ids"` // 多源融合：选定多个来源，融为 target_id
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
// @Param entity_type query []string false "实体类型，可重复传参或逗号分隔（?entity_type=person&entity_type=company / ?entity_type=person,company）：person/company/matter/risk/commitment/decision"
// @Param keyword query string false "实体名或总结关键词"
// @Param name query string false "只按名称搜索（只匹配人名/实体名）"
// @Param attribute_key query string false "属性筛选 key（须为 schema 内属性，如 person 的 relationship、company 的 industry）；不在 schema 内时返回空列表"
// @Param attribute_value query string false "属性筛选值，逗号分隔多值任一命中（如 potential_customer 或 潜在客户,关键决策人）；与 attribute_key 搭配使用。传了 attribute_key 但 value 全为空时返回空列表（不会退化为全量）"
// @Param sort_by query string false "排序字段：updated_time（默认，最近更新在前）/ created_time（最近创建在前）；同值按 id 降序稳定排序" default(updated_time)
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
	// 属性筛选值：逗号分隔多值（任一命中）；兼容枚举 value 与中文 label 双写，
	// 调用方可同时传两种写法（如 potential_customer,潜在客户）。
	attributeValues := make([]string, 0, 4)
	for _, raw := range strings.Split(req.AttributeValue, ",") {
		if value := strings.TrimSpace(raw); value != "" {
			attributeValues = append(attributeValues, value)
		}
	}
	data, err := service.NewRecordingMemoryEntityService(config.GetEID(c)).ListWithFilter(c.Request.Context(), config.GetUserId(c), service.RecordingMemoryEntityFilter{
		EntityTypes:     req.EntityType,
		Keyword:         strings.TrimSpace(req.Keyword),
		Name:            strings.TrimSpace(req.Name),
		AttributeKey:    strings.TrimSpace(req.AttributeKey),
		AttributeValues: attributeValues,
		SortBy:          strings.TrimSpace(req.SortBy),
		Limit:           req.Limit,
		Offset:          req.Offset,
	})
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

// GetRecordingCurrentView godoc
// @Summary 获取实体当前视图
// @Description 基于当前可见的实体事实、会议 Claim 和证据，在查询时编译只读的 Current View；不会写入记忆或认知数据。
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param entity_id path string true "实体ID（HashID）"
// @Success 200 {object} model.CommonResponse{data=service.RecordingCurrentView}
// @Failure 403 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Router /api/recordings/memories/entities/{entity_id}/current-view [get]
func GetRecordingCurrentView(c *gin.Context) {
	entityID, ok := parseRecordingMemoryID(c, "entity_id")
	if !ok {
		return
	}
	data, err := service.CompileRecordingCurrentView(c.Request.Context(), config.GetEID(c), config.GetUserId(c), entityID)
	if err != nil {
		if errors.Is(err, service.ErrRecordingCurrentViewNotFound) || errors.Is(err, service.ErrRecordingEntityMemoryNotFound) {
			c.JSON(http.StatusNotFound, model.ParamError.ToNewErrorResponse("记忆实体不存在"))
			return
		}
		if respondRecordingEntityMemoryError(c, err) {
			return
		}
		logger.SysErrorf("【当前视图】查询失败: eid=%d user_id=%d entity_id=%d err=%v", config.GetEID(c), config.GetUserId(c), entityID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToNewErrorResponse("获取当前视图失败"))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// GetRecordingMemoryTimeline godoc
// @Summary 获取实体记忆时间线
// @Description 返回实体相关 Fact/Claim 的历史时间线，保留被替换和失效记录；接口只读，不生成新的事实。
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param entity_id path string true "实体ID（HashID）"
// @Param offset query int false "跳过条数，默认0"
// @Param limit query int false "返回条数，默认50，最大200"
// @Success 200 {object} model.CommonResponse{data=service.RecordingMemoryTimeline}
// @Failure 403 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Router /api/recordings/memories/entities/{entity_id}/timeline [get]
func GetRecordingMemoryTimeline(c *gin.Context) {
	entityID, ok := parseRecordingMemoryID(c, "entity_id")
	if !ok {
		return
	}
	offset := 0
	if raw := strings.TrimSpace(c.Query("offset")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("offset 必须是非负整数")))
			return
		}
		offset = parsed
	}
	limit := 50
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("limit 必须是正整数")))
			return
		}
		limit = parsed
	}
	data, err := service.CompileRecordingMemoryTimeline(c.Request.Context(), config.GetEID(c), config.GetUserId(c), entityID, offset, limit)
	if err != nil {
		if errors.Is(err, service.ErrRecordingCurrentViewNotFound) || errors.Is(err, service.ErrRecordingEntityMemoryNotFound) {
			c.JSON(http.StatusNotFound, model.ParamError.ToNewErrorResponse("记忆实体不存在"))
			return
		}
		if respondRecordingEntityMemoryError(c, err) {
			return
		}
		logger.SysErrorf("【记忆时间线】查询失败: eid=%d user_id=%d entity_id=%d err=%v", config.GetEID(c), config.GetUserId(c), entityID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToNewErrorResponse("获取记忆时间线失败"))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// CreateRecordingMemoryEntity godoc
// @Summary 新增安心录实体记忆
// @Description 手工创建一条实体记忆（记录 manual 来源标记，内容可被后续会议编译覆盖）；同类型同名已存在时返回错误，请改用融合。
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body CreateRecordingMemoryEntityRequest true "新增实体"
// @Success 200 {object} model.CommonResponse{data=service.RecordingMemoryEntityDetail}
// @Router /api/recordings/memories/entities [post]
func CreateRecordingMemoryEntity(c *gin.Context) {
	var req CreateRecordingMemoryEntityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	relations, err := parseRecordingMemoryRelations(req.Relations)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	data, err := service.NewRecordingMemoryEntityService(config.GetEID(c)).Create(
		c.Request.Context(),
		config.GetUserId(c),
		service.CreateRecordingMemoryEntityInput{
			EntityType:    strings.TrimSpace(req.EntityType),
			CanonicalName: strings.TrimSpace(req.CanonicalName),
			Summary:       req.Summary,
			Attributes:    req.Attributes,
			Aliases:       req.Aliases,
			Facts:         convertCreateRecordingMemoryFacts(req.Facts),
			Relations:     relations,
		},
	)
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
	input, err := convertUpdateRecordingMemoryEntityInput(req)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	data, err := service.NewRecordingMemoryEntityService(config.GetEID(c)).Update(c.Request.Context(), config.GetUserId(c), entityID, input)
	if respondRecordingEntityMemoryError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

func convertCreateRecordingMemoryFacts(facts []CreateRecordingMemoryFactRequest) []service.CreateRecordingMemoryFactInput {
	result := make([]service.CreateRecordingMemoryFactInput, 0, len(facts))
	for _, fact := range facts {
		result = append(result, service.CreateRecordingMemoryFactInput{RelatedEntityID: fact.RelatedEntityID, Content: fact.Content, Attributes: fact.Attributes})
	}
	return result
}

// parseRecordingMemoryRelations 解析结构化关联分组（HashID → int64），未知 relation_type 交给 service 校验。
func parseRecordingMemoryRelations(groups []RecordingMemoryRelationGroupRequest) ([]service.RecordingMemoryRelationInput, error) {
	result := make([]service.RecordingMemoryRelationInput, 0, len(groups))
	for _, group := range groups {
		ids := make([]int64, 0, len(group.RelatedEntityIDs))
		for _, raw := range group.RelatedEntityIDs {
			raw = strings.TrimSpace(raw)
			if raw == "" {
				continue
			}
			id, err := hashids.TryParseID(raw)
			if err != nil {
				return nil, err
			}
			ids = append(ids, id)
		}
		result = append(result, service.RecordingMemoryRelationInput{RelationType: strings.TrimSpace(group.RelationType), RelatedEntityIDs: ids})
	}
	return result, nil
}

func convertUpdateRecordingMemoryEntityInput(req UpdateRecordingMemoryEntityRequest) (service.UpdateRecordingMemoryEntityInput, error) {
	input := service.UpdateRecordingMemoryEntityInput{CanonicalName: req.CanonicalName, Summary: req.Summary, Attributes: req.Attributes, Aliases: req.Aliases}
	for _, fact := range req.Facts {
		input.Facts = append(input.Facts, service.UpdateRecordingMemoryFactInput{ID: fact.ID, RelatedEntityID: fact.RelatedEntityID, Content: fact.Content, Attributes: fact.Attributes})
	}
	for _, raw := range req.DeletedFactIDs {
		id, err := hashids.TryParseID(raw)
		if err != nil {
			return input, errors.New("invalid deleted fact id")
		}
		input.DeletedFactIDs = append(input.DeletedFactIDs, id)
	}
	if req.Relations != nil {
		relations, err := parseRecordingMemoryRelations(req.Relations)
		if err != nil {
			return input, err
		}
		input.Relations = &relations
	}
	return input, nil
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
// @Param request body AddRecordingMemoryFactRequest true "人工事实"
// @Success 200 {object} model.CommonResponse{data=service.RecordingMemoryEntityDetail}
// @Router /api/recordings/memories/entities/{entity_id}/facts [post]
func CreateRecordingMemoryFact(c *gin.Context) {
	entityID, ok := parseRecordingMemoryID(c, "entity_id")
	if !ok {
		return
	}
	var req AddRecordingMemoryFactRequest
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

// MergeRecordingMemoryEntities godoc
// @Summary 融合安心录实体记忆
// @Description 支持多源融合：source_ids 中所有实体融为 target_id（仅同类型；描述经 LLM 合并去重，其余字段取基底）。兼容旧单源字段 source_id。
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body MergeRecordingMemoryEntitiesRequest true "来源实体与保留实体"
// @Success 200 {object} model.CommonResponse{data=service.RecordingMemoryEntityDetail}
// @Router /api/recordings/memories/entity-merges [post]
func MergeRecordingMemoryEntities(c *gin.Context) {
	var req MergeRecordingMemoryEntitiesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	targetID, err := hashids.TryParseID(req.TargetID)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	svc := service.NewRecordingMemoryEntityService(config.GetEID(c))
	ctx := c.Request.Context()
	userID := config.GetUserId(c)

	if len(req.SourceIDs) > 0 {
		sourceIDs := make([]int64, 0, len(req.SourceIDs))
		for _, raw := range req.SourceIDs {
			id, parseErr := hashids.TryParseID(raw)
			if parseErr != nil {
				c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(parseErr))
				return
			}
			sourceIDs = append(sourceIDs, id)
		}
		data, err := svc.MergeMany(ctx, userID, sourceIDs, targetID)
		if respondRecordingEntityMemoryError(c, err) {
			return
		}
		c.JSON(http.StatusOK, model.Success.ToResponse(data))
		return
	}

	sourceID, err := hashids.TryParseID(req.SourceID)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	data, err := svc.Merge(ctx, userID, sourceID, targetID)
	if respondRecordingEntityMemoryError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
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
// @Param category query string false "分组：memory（默认，记忆：事项/风险/承诺/决策）/relation（关系：人物、企业）/all（全部）" Enums(memory, relation, all)
// @Success 200 {object} model.CommonResponse{data=[]model.RecordingMemoryEntitySchemaView}
// @Router /api/recordings/memories/schema [get]
func GetRecordingMemoryEntitySchema(c *gin.Context) {
	category := strings.ToLower(strings.TrimSpace(c.Query("category")))
	c.JSON(http.StatusOK, model.Success.ToResponse(model.RecordingMemoryEntitySchemaArrayForCategory(category)))
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
	case errors.Is(err, service.ErrRecordingEntityMemoryDuplicate):
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("同类型同名实体已存在，请使用融合合并"))
	case errors.Is(err, service.ErrRecordingEntityMemoryCrossType):
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("仅支持同类型实体融合"))
	case errors.Is(err, service.ErrRecordingEntityMemoryMergeSelf):
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("基底实体不能同时作为来源实体"))
	case errors.Is(err, service.ErrRecordingEntityMemoryModelNotConfigured):
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("推理模型未配置，请先配置推理模型"))
	case errors.Is(err, service.ErrRecordingEntityMemoryRelationSelf):
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("不能关联自身"))
	case errors.Is(err, service.ErrRecordingEntityMemoryRelationTooMany):
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("一个人物只能关联一个企业"))
	case errors.Is(err, service.ErrRecordingEntityMemoryRelationTypeMismatch):
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("仅支持人物与企业之间的关联"))
	case errors.Is(err, service.ErrRecordingEntityMemoryRelationTypeUnsupported):
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("不支持的关联类型"))
	default:
		logger.SysErrorf("【实体记忆】接口处理失败 eid=%d user_id=%d err=%v", config.GetEID(c), config.GetUserId(c), err)
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("会议记忆操作失败"))
	}
	return true
}
