package controller

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/middleware"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

type RecordingCognitionQuery struct {
	Status        string `form:"status"`
	Layer         string `form:"layer"`
	CognitionType string `form:"cognition_type"`
	DomainID      int64  `form:"domain_id"`
	SourceType    string `form:"source_type"`
	Keyword       string `form:"keyword"`
	Limit         int    `form:"limit"`
	Offset        int    `form:"offset"`
}

// splitSourceTypes 将逗号分隔的 source_type 拆分为筛选项。
func splitSourceTypes(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	values := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			values = append(values, p)
		}
	}
	return values
}

type CreateRecordingCognitionRequest struct {
	Title            string                                  `json:"title" binding:"required"`
	Statement        string                                  `json:"statement" binding:"required"`
	CognitionType    string                                  `json:"cognition_type" binding:"required"`
	Layer            string                                  `json:"layer" binding:"required"`
	DomainID         int64                                   `json:"domain_id"`
	Scope            []string                                `json:"scope"`
	SourceType       string                                  `json:"source_type"`
	Confidence       float64                                 `json:"confidence"`
	SourceFileID     int64                                   `json:"source_file_id"`
	SourceSegmentIDs []string                                `json:"source_segment_ids"`
	EvidenceRefs     []service.RecordingCognitionEvidenceRef `json:"evidence_refs"`
}

type ImportRecordingCognitionItemRequest struct {
	Title          string                                  `json:"title" binding:"required"`
	Statement      string                                  `json:"statement" binding:"required"`
	CognitionType  string                                  `json:"cognition_type" binding:"required"`
	DomainID       int64                                   `json:"domain_id"`
	Layer          string                                  `json:"layer" binding:"required"`
	Scope          []string                                `json:"scope"`
	Confidence     float64                                 `json:"confidence"`
	ExternalSource string                                  `json:"external_source" binding:"required"`
	ExternalRef    string                                  `json:"external_ref" binding:"required"`
	ObservedAt     int64                                   `json:"observed_at"`
	EvidenceRefs   []service.RecordingCognitionEvidenceRef `json:"evidence_refs"`
}

type ImportRecordingCognitionsRequest struct {
	Items []ImportRecordingCognitionItemRequest `json:"items" binding:"required,min=1,max=100"`
}

type UpdateRecordingCognitionRequest struct {
	Title            *string                                 `json:"title"`
	Statement        *string                                 `json:"statement"`
	CognitionType    *string                                 `json:"cognition_type"`
	Layer            *string                                 `json:"layer"`
	DomainID         *int64                                  `json:"domain_id"`
	Scope            *[]string                               `json:"scope"`
	Status           *string                                 `json:"status"`
	Confidence       *float64                                `json:"confidence"`
	ValidUntil       *int64                                  `json:"valid_until"`
	SourceFileID     int64                                   `json:"source_file_id"`
	SourceSegmentIDs []string                                `json:"source_segment_ids"`
	EvidenceRefs     []service.RecordingCognitionEvidenceRef `json:"evidence_refs"`
}

type ReviewRecordingCognitionCandidateRequest struct {
	Title         string   `json:"title"`
	Statement     string   `json:"statement"`
	Scope         []string `json:"scope"`
	CognitionType string   `json:"cognition_type"`
	DomainID      int64    `json:"domain_id"`
	Layer         string   `json:"layer"`
	Reason        string   `json:"reason"`
}

// UpdateRecordingCognitionCandidateRequest 是待确认认知候选的编辑入参，仅传需要修改的字段。
type UpdateRecordingCognitionCandidateRequest struct {
	Title         *string   `json:"title"`
	Statement     *string   `json:"statement"`
	CognitionType *string   `json:"cognition_type"`
	Layer         *string   `json:"layer"`
	DomainID      *int64    `json:"domain_id"`
	Scope         *[]string `json:"scope"`
}

type CreateRecordingCognitionDomainRequest struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
	Logo        string `json:"logo"`
	Sort        int    `json:"sort"`
}

type UpdateRecordingCognitionDomainRequest struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
	Logo        *string `json:"logo"`
	Sort        *int    `json:"sort"`
}

// ListRecordingCognitions godoc
// @Summary 获取老板认知列表
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param status query string false "认知状态：confirmed/conflicted/expired/rejected"
// @Param layer query string false "认知层：core/situational"
// @Param cognition_type query string false "认知类型：principle/priority/criterion/preference/boundary/assumption/trigger"
// @Param domain_id query string false "领域认知 ID (HashID)"
// @Param source_type query string false "来源类型（可逗号分隔传多个值）：boss_authored/boss_confirmed/auto_confirmed"
// @Param keyword query string false "标题或认知表述"
// @Param limit query int false "返回条数" default(50)
// @Param offset query int false "跳过条数" default(0)
// @Success 200 {object} model.CommonResponse{data=service.RecordingCognitionList}
// @Failure 400 {object} model.CommonResponse
// @Failure 403 {object} model.CommonResponse
// @Router /api/recordings/cognitions [get]
func ListRecordingCognitions(c *gin.Context) {
	var req RecordingCognitionQuery
	if err := c.ShouldBindQuery(&req); err != nil || req.Limit < 0 || req.Limit > 100 || req.Offset < 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("查询参数不合法"))
		return
	}
	data, err := service.NewRecordingCognitionService(config.GetEID(c)).List(
		c.Request.Context(), config.GetUserId(c),
		strings.TrimSpace(req.Status),
		strings.TrimSpace(req.Layer),
		strings.TrimSpace(req.CognitionType), req.DomainID,
		splitSourceTypes(req.SourceType),
		strings.TrimSpace(req.Keyword), req.Limit, req.Offset,
	)
	if respondRecordingCognitionError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// GetRecordingCognitionOverview godoc
// @Summary 获取老板认知统计
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=service.RecordingCognitionOverview}
// @Failure 403 {object} model.CommonResponse
// @Router /api/recordings/cognitions/overview [get]
func GetRecordingCognitionOverview(c *gin.Context) {
	data, err := service.NewRecordingCognitionService(config.GetEID(c)).Overview(c.Request.Context(), config.GetUserId(c))
	if respondRecordingCognitionError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// GetRecordingCognitionCoreStats godoc
// @Summary 获取核心认知数量（按 7 类规范统计）
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=service.RecordingCognitionCoreStats}
// @Failure 403 {object} model.CommonResponse
// @Router /api/recordings/cognitions/core-stats [get]
func GetRecordingCognitionCoreStats(c *gin.Context) {
	data, err := service.NewRecordingCognitionService(config.GetEID(c)).CoreStats(c.Request.Context(), config.GetUserId(c))
	if respondRecordingCognitionError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// ExpireRecordingCognition godoc
// @Summary 废止认知（删除接口，状态流转为 expired）
// @Description 将认知状态流转为 expired（已失效），保留版本审计链并退出洞察召回池。
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param cognition_id path string true "认知ID（HashID）"
// @Success 200 {object} model.CommonResponse
// @Failure 400 {object} model.CommonResponse
// @Failure 403 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Router /api/recordings/cognitions/{cognition_id} [delete]
func ExpireRecordingCognition(c *gin.Context) {
	cognitionID, ok := parseRecordingCognitionID(c, "cognition_id")
	if !ok {
		return
	}
	err := service.NewRecordingCognitionService(config.GetEID(c)).Expire(c.Request.Context(), config.GetUserId(c), cognitionID)
	if respondRecordingCognitionError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// ListRecordingCognitionDomains godoc
// @Summary 获取当前企业认知领域列表（合并系统预置、企业自建与重写项）
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=[]service.RecordingCognitionDomainView}
// @Failure 403 {object} model.CommonResponse
// @Router /api/recordings/cognition-domains [get]
func ListRecordingCognitionDomains(c *gin.Context) {
	data, err := service.NewRecordingCognitionDomainService(config.GetEID(c), config.GetUserId(c)).List(c.Request.Context())
	if respondRecordingCognitionError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// CreateRecordingCognitionDomain godoc
// @Summary 创建企业自建认知领域
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body CreateRecordingCognitionDomainRequest true "领域信息"
// @Success 200 {object} model.CommonResponse{data=service.RecordingCognitionDomainView}
// @Failure 400 {object} model.CommonResponse
// @Failure 403 {object} model.CommonResponse
// @Router /api/recordings/cognition-domains [post]
func CreateRecordingCognitionDomain(c *gin.Context) {
	var req CreateRecordingCognitionDomainRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	data, err := service.NewRecordingCognitionDomainService(config.GetEID(c), config.GetUserId(c)).Create(c.Request.Context(), service.CreateDomainInput{
		Name:        req.Name,
		Description: req.Description,
		Logo:        req.Logo,
		Sort:        req.Sort,
	})
	if respondRecordingCognitionError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// UpdateRecordingCognitionDomain godoc
// @Summary 修改企业认知领域（支持写时复制修改系统预置项）
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param domain_id path string true "领域 ID (HashID)"
// @Param request body UpdateRecordingCognitionDomainRequest true "修改信息"
// @Success 200 {object} model.CommonResponse{data=service.RecordingCognitionDomainView}
// @Failure 400 {object} model.CommonResponse
// @Failure 403 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Router /api/recordings/cognition-domains/{domain_id} [put]
func UpdateRecordingCognitionDomain(c *gin.Context) {
	domainID, ok := parseRecordingCognitionID(c, "domain_id")
	if !ok {
		return
	}
	var req UpdateRecordingCognitionDomainRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	data, err := service.NewRecordingCognitionDomainService(config.GetEID(c), config.GetUserId(c)).Update(c.Request.Context(), domainID, service.UpdateDomainInput{
		Name:        req.Name,
		Description: req.Description,
		Logo:        req.Logo,
		Sort:        req.Sort,
	})
	if respondRecordingCognitionError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// DeleteRecordingCognitionDomain godoc
// @Summary 删除企业认知领域（自建软删除，系统项生成屏蔽遮罩；须先删完该分类下全部认知）
// @Description 分类下的已确认认知与待确认认知（含待确认候选）必须全部删除后才能删除分类，否则返回 400。
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param domain_id path string true "领域 ID (HashID)"
// @Success 200 {object} model.CommonResponse
// @Failure 400 {object} model.CommonResponse "分类下仍有已确认或待确认认知"
// @Failure 403 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Router /api/recordings/cognition-domains/{domain_id} [delete]
func DeleteRecordingCognitionDomain(c *gin.Context) {
	domainID, ok := parseRecordingCognitionID(c, "domain_id")
	if !ok {
		return
	}
	err := service.NewRecordingCognitionDomainService(config.GetEID(c), config.GetUserId(c)).Delete(c.Request.Context(), domainID)
	if respondRecordingCognitionError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// ResetRecordingCognitionDomain godoc
// @Summary 恢复系统预置领域（清除租户覆盖或屏蔽）
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param domain_id path string true "领域 ID (HashID)"
// @Success 200 {object} model.CommonResponse
// @Failure 400 {object} model.CommonResponse
// @Failure 403 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Router /api/recordings/cognition-domains/{domain_id}/reset [post]
func ResetRecordingCognitionDomain(c *gin.Context) {
	domainID, ok := parseRecordingCognitionID(c, "domain_id")
	if !ok {
		return
	}
	err := service.NewRecordingCognitionDomainService(config.GetEID(c), config.GetUserId(c)).Reset(c.Request.Context(), domainID)
	if respondRecordingCognitionError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// GetRecordingCognition godoc
// @Summary 获取老板认知详情及版本
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param cognition_id path string true "认知ID（HashID）"
// @Success 200 {object} model.CommonResponse{data=service.RecordingCognitionDetail}
// @Failure 403 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Router /api/recordings/cognitions/{cognition_id} [get]
func GetRecordingCognition(c *gin.Context) {
	cognitionID, ok := parseRecordingCognitionID(c, "cognition_id")
	if !ok {
		return
	}
	data, err := service.NewRecordingCognitionService(config.GetEID(c)).Detail(c.Request.Context(), config.GetUserId(c), cognitionID)
	if respondRecordingCognitionError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// CreateRecordingCognition godoc
// @Summary 老板主动创建认知
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body CreateRecordingCognitionRequest true "认知内容"
// @Success 200 {object} model.CommonResponse{data=service.RecordingCognitionDetail}
// @Failure 400 {object} model.CommonResponse
// @Failure 403 {object} model.CommonResponse
// @Router /api/recordings/cognitions [post]
func CreateRecordingCognition(c *gin.Context) {
	var req CreateRecordingCognitionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	data, err := service.NewRecordingCognitionService(config.GetEID(c)).Create(c.Request.Context(), config.GetUserId(c), service.CreateRecordingCognitionInput{
		Title: req.Title, Statement: req.Statement, CognitionType: req.CognitionType, Layer: req.Layer, DomainID: req.DomainID, Scope: req.Scope,
		SourceType: req.SourceType, Confidence: req.Confidence, SourceFileID: req.SourceFileID, SourceSegmentIDs: req.SourceSegmentIDs, EvidenceRefs: req.EvidenceRefs,
	})
	if respondRecordingCognitionError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// ImportRecordingCognitions godoc
// @Summary 导入外部老板认知候选
// @Description 外部数据只进入待校准候选，不会绕过老板确认进入正式认知注册表。
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body ImportRecordingCognitionsRequest true "外部认知候选"
// @Success 200 {object} model.CommonResponse{data=service.RecordingCognitionCandidateList}
// @Failure 400 {object} model.CommonResponse
// @Failure 403 {object} model.CommonResponse
// @Router /api/recordings/cognitions/import [post]
func ImportRecordingCognitions(c *gin.Context) {
	var req ImportRecordingCognitionsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	items := make([]service.ImportRecordingCognitionItemInput, 0, len(req.Items))
	for _, item := range req.Items {
		items = append(items, service.ImportRecordingCognitionItemInput{
			Title: item.Title, Statement: item.Statement, CognitionType: item.CognitionType, DomainID: item.DomainID, Layer: item.Layer,
			Scope: item.Scope, Confidence: item.Confidence, ExternalSource: item.ExternalSource,
			ExternalRef: item.ExternalRef, ObservedAt: item.ObservedAt, EvidenceRefs: item.EvidenceRefs,
		})
	}
	data, err := service.NewRecordingCognitionService(config.GetEID(c)).ImportCognitions(c.Request.Context(), config.GetUserId(c), items)
	if respondRecordingCognitionError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// UpdateRecordingCognition godoc
// @Summary 修改或变更老板认知版本
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param cognition_id path string true "认知ID（HashID）"
// @Param request body UpdateRecordingCognitionRequest true "修改内容"
// @Success 200 {object} model.CommonResponse{data=service.RecordingCognitionDetail}
// @Failure 400 {object} model.CommonResponse
// @Failure 403 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Router /api/recordings/cognitions/{cognition_id} [patch]
func UpdateRecordingCognition(c *gin.Context) {
	cognitionID, ok := parseRecordingCognitionID(c, "cognition_id")
	if !ok {
		return
	}
	var req UpdateRecordingCognitionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	data, err := service.NewRecordingCognitionService(config.GetEID(c)).Update(c.Request.Context(), config.GetUserId(c), cognitionID, service.UpdateRecordingCognitionInput{
		Title: req.Title, Statement: req.Statement, CognitionType: req.CognitionType, Layer: req.Layer, DomainID: req.DomainID, Scope: req.Scope,
		Status: req.Status, Confidence: req.Confidence, ValidUntil: req.ValidUntil, SourceFileID: req.SourceFileID,
		SourceSegmentIDs: req.SourceSegmentIDs, EvidenceRefs: req.EvidenceRefs,
	})
	if respondRecordingCognitionError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// ListRecordingCognitionCandidates godoc
// @Summary 获取会议中的待校准认知候选
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param file_id path string true "录音文件ID（HashID）"
// @Param status query string false "候选状态：candidate/confirmed/rejected/ignored"
// @Param layer query string false "层级：core（核心）/ situational（领域）"
// @Param cognition_type query string false "7大哲学分类：principle/priority/criterion/preference/boundary/assumption/trigger"
// @Param domain_id query string false "领域ID（HashID，如 UkLWZg）"
// @Param source_type query string false "证据来源（可逗号分隔多值）：explicit_statement/behavior_observation/ai_inference/external_import"
// @Param keyword query string false "标题或认知表述"
// @Param limit query int false "返回条数" default(50)
// @Param offset query int false "跳过条数" default(0)
// @Success 200 {object} model.CommonResponse{data=service.RecordingCognitionCandidateList}
// @Failure 400 {object} model.CommonResponse
// @Failure 403 {object} model.CommonResponse
// @Router /api/recordings/files/{file_id}/cognition-candidates [get]
func ListRecordingCognitionCandidates(c *gin.Context) {
	fileID, ok := parseRecordingCognitionID(c, "file_id")
	if !ok {
		return
	}
	var req RecordingCognitionQuery
	if err := c.ShouldBindQuery(&req); err != nil || req.Limit < 0 || req.Limit > 100 || req.Offset < 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("查询参数不合法"))
		return
	}
	data, err := service.NewRecordingCognitionService(config.GetEID(c)).ListCandidates(c.Request.Context(), config.GetUserId(c), fileID, strings.TrimSpace(req.Status), strings.TrimSpace(req.Layer), strings.TrimSpace(req.CognitionType), req.DomainID, splitSourceTypes(req.SourceType), strings.TrimSpace(req.Keyword), req.Limit, req.Offset)
	if respondRecordingCognitionError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// ListRecordingCognitionCandidatesGlobal godoc
// @Summary 获取待确认认知候选列表（全局，与已确认认知列表对应）
// @Description 返回当前用户全部待校准候选（含 AI 会议提炼与外部导入），不指定 file_id；支持按 status/layer/cognition_type/domain_id/source_type 多维筛选。
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param status query string false "候选状态：candidate/confirmed/rejected/ignored"
// @Param layer query string false "层级：core（核心）/ situational（领域）"
// @Param cognition_type query string false "7大哲学分类：principle/priority/criterion/preference/boundary/assumption/trigger"
// @Param domain_id query string false "领域ID（HashID，如 UkLWZg）"
// @Param source_type query string false "证据来源（可逗号分隔多值）：explicit_statement/behavior_observation/ai_inference/external_import"
// @Param keyword query string false "标题或认知表述"
// @Param limit query int false "返回条数" default(50)
// @Param offset query int false "跳过条数" default(0)
// @Success 200 {object} model.CommonResponse{data=service.RecordingCognitionCandidateList}
// @Failure 400 {object} model.CommonResponse
// @Failure 403 {object} model.CommonResponse
// @Router /api/recordings/cognition-candidates [get]
func ListRecordingCognitionCandidatesGlobal(c *gin.Context) {
	var req RecordingCognitionQuery
	if err := c.ShouldBindQuery(&req); err != nil || req.Limit < 0 || req.Limit > 100 || req.Offset < 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("查询参数不合法"))
		return
	}
	data, err := service.NewRecordingCognitionService(config.GetEID(c)).ListCandidates(c.Request.Context(), config.GetUserId(c), -1, strings.TrimSpace(req.Status), strings.TrimSpace(req.Layer), strings.TrimSpace(req.CognitionType), req.DomainID, splitSourceTypes(req.SourceType), strings.TrimSpace(req.Keyword), req.Limit, req.Offset)
	if respondRecordingCognitionError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// GetRecordingDecisionContext godoc
// @Summary 获取当前会议的认知与业务记忆上下文
// @Description 返回当前会议事实、已确认认知、历史业务记忆、证据策略和被排除原因；Memory V2 仅标记为 shadow。
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param file_id path string true "录音文件ID（HashID）"
// @Param knowledge_library_id query []string false "显式授权知识库ID（HashID，可重复传入）"
// @Param knowledge_query query string false "企业知识检索问题；仅在显式传入知识库范围时生效"
// @Success 200 {object} model.CommonResponse{data=service.RecordingDecisionContextPackage}
// @Router /api/recordings/files/{file_id}/decision-context [get]
func GetRecordingDecisionContext(c *gin.Context) {
	fileID, ok := parseRecordingCognitionID(c, "file_id")
	if !ok {
		return
	}
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	file, err := service.GetAccessibleRecordingFile(c.Request.Context(), eid, userID, fileID, false)
	if err != nil {
		respondRecordingCognitionError(c, err)
		return
	}
	recordingConfig, err := model.ValidateOrCreateRecordingConfig(eid)
	if err != nil {
		respondRecordingCognitionError(c, err)
		return
	}
	memCfg := recordingConfig.MemoryExtraction
	if memCfg == nil {
		memCfg = &model.MemoryExtractionConfig{Enabled: true, Types: []string{model.EntityTypePerson, model.EntityTypeMatter, model.EntityTypeCommitment}}
	}
	result, err := service.BuildRecordingDecisionContext(c.Request.Context(), eid, userID, fileID, file.InsightGeneration, memCfg, nil)
	if err != nil {
		respondRecordingCognitionError(c, err)
		return
	}
	libraryIDs, parseErr := parseRecordingKnowledgeLibraryIDs(c.QueryArray("knowledge_library_id"))
	if parseErr != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("知识库范围必须使用有效 HashID"))
		return
	}
	knowledgeQuery := strings.TrimSpace(c.Query("knowledge_query"))
	if len(libraryIDs) > 0 && knowledgeQuery == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("显式知识库范围必须同时提供检索问题"))
		return
	}
	var candidates []service.RecordingDecisionEnterpriseKnowledgeCandidate
	if len(libraryIDs) > 0 {
		var omitted []string
		var searchErr error
		candidates, omitted, searchErr = service.SearchRecordingEnterpriseKnowledge(c.Request.Context(), service.RecordingEnterpriseKnowledgeSearchRequest{EID: eid, UserID: userID, Query: knowledgeQuery, LibraryIDs: libraryIDs, TopK: 5})
		if searchErr != nil {
			result.Public.OmittedReasons = appendRecordingDecisionOmittedReason(result.Public.OmittedReasons, "enterprise_knowledge_search_failed")
		} else {
			result.Public.OmittedReasons = appendRecordingDecisionOmittedReason(result.Public.OmittedReasons, omitted...)
		}
	} else {
		result.Public.OmittedReasons = appendRecordingDecisionOmittedReason(result.Public.OmittedReasons, "enterprise_knowledge_scope_missing")
	}
	audit, auditErr := service.BuildRecordingDecisionContextAuditPackage(eid, userID, fileID, result)
	if auditErr == nil {
		if appendErr := service.AppendEnterpriseKnowledgeCandidates(audit, candidates); appendErr != nil {
			result.Public.OmittedReasons = appendRecordingDecisionOmittedReason(result.Public.OmittedReasons, "enterprise_knowledge_adapt_failed")
		} else if runtime, compileErr := service.CompileRecordingDecisionRuntimeContext(audit); compileErr == nil {
			result.Public.RuntimeContext = runtime
		} else {
			result.Public.OmittedReasons = appendRecordingDecisionOmittedReason(result.Public.OmittedReasons, "decision_runtime_compile_failed")
		}
	} else {
		result.Public.OmittedReasons = appendRecordingDecisionOmittedReason(result.Public.OmittedReasons, "decision_runtime_audit_failed")
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(result.Public))
}

func appendRecordingDecisionOmittedReason(values []string, additions ...string) []string {
	for _, reason := range additions {
		reason = strings.TrimSpace(reason)
		if reason == "" {
			continue
		}
		seen := false
		for _, existing := range values {
			if existing == reason {
				seen = true
				break
			}
		}
		if !seen {
			values = append(values, reason)
		}
	}
	return values
}

func parseRecordingKnowledgeLibraryIDs(values []string) ([]int64, error) {
	ids := make([]int64, 0, len(values))
	seen := make(map[int64]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, numericErr := strconv.ParseInt(value, 10, 64); numericErr == nil || !hashids.IsValidHashid(value) {
			return nil, errors.New("invalid knowledge library hashid")
		}
		id, err := hashids.TryParseID(value)
		if err != nil || id <= 0 {
			return nil, errors.New("invalid knowledge library hashid")
		}
		if _, exists := seen[id]; !exists {
			seen[id] = struct{}{}
			ids = append(ids, id)
		}
	}
	return ids, nil
}

// GetRecordingMemoryV2Evaluation godoc
// @Summary 获取 Memory V2 shadow 对照结果
// @Description 返回当前文件最近一次现有结构化记忆与 Memory V2 shadow 的召回对照指标；不会改变洞察主链路。
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param file_id path string true "录音文件ID（HashID）"
// @Success 200 {object} model.CommonResponse{data=service.RecordingMemoryV2EvaluationView}
// @Router /api/recordings/files/{file_id}/memory-v2-evaluation [get]
func GetRecordingMemoryV2Evaluation(c *gin.Context) {
	fileID, ok := parseRecordingCognitionID(c, "file_id")
	if !ok {
		return
	}
	data, err := service.GetLatestRecordingMemoryV2Evaluation(c.Request.Context(), config.GetEID(c), config.GetUserId(c), fileID)
	if respondRecordingCognitionError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// ReviewRecordingCognitionCandidate godoc
// @Summary 确认、修改确认、拒绝或忽略认知候选
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path string true "录音文件ID（HashID）"
// @Param candidate_id path string true "候选ID（HashID）"
// @Param request body ReviewRecordingCognitionCandidateRequest false "确认或拒绝内容"
// @Success 200 {object} model.CommonResponse
// @Failure 400 {object} model.CommonResponse
// @Failure 403 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Router /api/recordings/files/{file_id}/cognition-candidates/{candidate_id}/confirm [post]
// @Failure 400 {object} model.CommonResponse
// @Failure 403 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Router /api/recordings/files/{file_id}/cognition-candidates/{candidate_id}/conflict [post]
// @Failure 400 {object} model.CommonResponse
// @Failure 403 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Router /api/recordings/files/{file_id}/cognition-candidates/{candidate_id}/reject [post]
// @Failure 400 {object} model.CommonResponse
// @Failure 403 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Router /api/recordings/files/{file_id}/cognition-candidates/{candidate_id}/ignore [post]
func ReviewRecordingCognitionCandidate(c *gin.Context) {
	fileID, ok := parseRecordingCognitionID(c, "file_id")
	if !ok {
		return
	}
	candidateID, ok := parseRecordingCognitionID(c, "candidate_id")
	if !ok {
		return
	}
	var req ReviewRecordingCognitionCandidateRequest
	if c.Request.ContentLength != 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
			return
		}
	}
	pathAction := strings.Trim(strings.TrimSpace(c.Request.URL.Path), "/")
	parts := strings.Split(pathAction, "/")
	action := ""
	if len(parts) > 0 {
		action = parts[len(parts)-1]
	}
	if fileID <= 0 || action == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("认知候选参数不合法"))
		return
	}
	data, err := service.NewRecordingCognitionService(config.GetEID(c)).ReviewCandidate(c.Request.Context(), config.GetUserId(c), fileID, candidateID, action, service.ReviewRecordingCognitionCandidateInput{
		Title: req.Title, Statement: req.Statement, Scope: req.Scope, CognitionType: req.CognitionType, DomainID: req.DomainID, Layer: req.Layer, Reason: req.Reason,
	})
	if respondRecordingCognitionError(c, err) {
		return
	}
	if data == nil {
		c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{"ok": true}))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// ReviewRecordingCognitionCandidateGlobal godoc
// @Summary 审核待确认认知候选（全局，与全局待确认列表对应）
// @Description 对全局待确认列表中的候选执行 confirm/reject/ignore/conflict 操作；候选可来自会议提炼或外部导入。
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param candidate_id path string true "候选ID（HashID）"
// @Param request body ReviewRecordingCognitionCandidateRequest false "确认或拒绝内容"
// @Success 200 {object} model.CommonResponse
// @Failure 400 {object} model.CommonResponse
// @Failure 403 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Router /api/recordings/cognition-candidates/{candidate_id}/{action} [post]
func ReviewRecordingCognitionCandidateGlobal(c *gin.Context) {
	candidateID, ok := parseRecordingCognitionID(c, "candidate_id")
	if !ok {
		return
	}
	var req ReviewRecordingCognitionCandidateRequest
	if c.Request.ContentLength != 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
			return
		}
	}
	pathAction := strings.Trim(strings.TrimSpace(c.Request.URL.Path), "/")
	parts := strings.Split(pathAction, "/")
	action := ""
	if len(parts) > 0 {
		action = parts[len(parts)-1]
	}
	data, err := service.NewRecordingCognitionService(config.GetEID(c)).ReviewCandidate(c.Request.Context(), config.GetUserId(c), -1, candidateID, action, service.ReviewRecordingCognitionCandidateInput{
		Title: req.Title, Statement: req.Statement, Scope: req.Scope, CognitionType: req.CognitionType, DomainID: req.DomainID, Layer: req.Layer, Reason: req.Reason,
	})
	if respondRecordingCognitionError(c, err) {
		return
	}
	if data == nil {
		c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{"ok": true}))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

// UpdateRecordingCognitionCandidate godoc
// @Summary 编辑待确认认知候选
// @Description 仅待校准（status=candidate）候选可编辑；已转正/已驳回/已忽略的候选不可修改。仅传需要修改的字段。
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param candidate_id path string true "候选ID (HashID)"
// @Param request body UpdateRecordingCognitionCandidateRequest true "编辑内容"
// @Success 200 {object} model.CommonResponse{data=service.RecordingCognitionCandidateView}
// @Failure 400 {object} model.CommonResponse
// @Failure 403 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Router /api/recordings/cognition-candidates/{candidate_id} [patch]
func UpdateRecordingCognitionCandidate(c *gin.Context) {
	candidateID, ok := parseRecordingCognitionID(c, "candidate_id")
	if !ok {
		return
	}
	var req UpdateRecordingCognitionCandidateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	data, err := service.NewRecordingCognitionService(config.GetEID(c)).UpdateCandidate(c.Request.Context(), config.GetUserId(c), candidateID, service.UpdateRecordingCognitionCandidateInput{
		Title: req.Title, Statement: req.Statement, CognitionType: req.CognitionType, Layer: req.Layer, DomainID: req.DomainID, Scope: req.Scope,
	})
	if respondRecordingCognitionError(c, err) {
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}

func parseRecordingCognitionID(c *gin.Context, key string) (int64, bool) {
	if decoded, ok := middleware.GetDecodedID(c, key); ok {
		return decoded, true
	}
	id, err := hashids.TryParseID(c.Param(key))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return 0, false
	}
	return id, true
}

func respondRecordingCognitionError(c *gin.Context, err error) bool {
	if err == nil {
		return false
	}
	switch {
	case errors.Is(err, service.ErrRecordingCognitionForbidden), errors.Is(err, service.ErrRecordingFileForbidden):
		c.JSON(http.StatusForbidden, model.ForbiddenError.ToNewErrorResponse("无权访问老板认知"))
	case errors.Is(err, service.ErrRecordingCognitionNotFound):
		c.JSON(http.StatusNotFound, model.ParamError.ToNewErrorResponse("老板认知或候选不存在"))
	case errors.Is(err, service.ErrRecordingCognitionDomainNotFound):
		c.JSON(http.StatusNotFound, model.ParamError.ToNewErrorResponse("认知领域不存在"))
	case errors.Is(err, service.ErrRecordingCognitionDomainDuplicateName):
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("已存在同名业务领域，不能重复创建"))
	case errors.Is(err, service.ErrRecordingCognitionDomainInvalid):
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("领域名称或描述长度超出限制"))
	case errors.Is(err, service.ErrRecordingCognitionDomainNotEmpty):
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("该分类下还有认知，请先删除其下全部认知（已确认/待确认）后再删除分类"))
	case errors.Is(err, service.ErrRecordingCognitionDomainUnavailable):
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("原分类已删除或不可用，请重新选择分类后再启用该认知"))
	case errors.Is(err, service.ErrRecordingCognitionLayerDomain):
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("核心认知不归属业务领域，请清空分类或把层级改为领域认知"))
	case errors.Is(err, service.ErrRecordingCognitionDomainRequired):
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("领域认知必须选择业务领域，请选择分类或把层级改为核心认知"))
	case errors.Is(err, service.ErrRecordingCognitionInvalid), errors.Is(err, service.ErrRecordingCognitionCandidate):
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("老板认知参数或状态不合法"))
	default:
		logger.SysErrorf("【老板认知】接口处理失败 eid=%d user_id=%d err=%v", config.GetEID(c), config.GetUserId(c), err)
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("老板认知操作失败"))
	}
	return true
}
