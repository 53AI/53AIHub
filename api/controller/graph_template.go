package controller

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// CreateGraphTemplateRequest 创建模板请求
type CreateGraphTemplateRequest struct {
	Name        string                      `json:"name" binding:"required,min=2,max=100"`
	Description string                      `json:"description" binding:"max=500"`
	Logo        string                      `json:"logo"`
	Entities    []*model.EntityDefinition   `json:"entities" binding:"required,dive"`
	Relations   []*model.RelationDefinition `json:"relations"`
}

// UpdateGraphTemplateRequest 更新模板请求
type UpdateGraphTemplateRequest struct {
	Name        string                      `json:"name" binding:"required,min=2,max=100"`
	Description string                      `json:"description" binding:"max=500"`
	Logo        string                      `json:"logo"`
	Entities    []*model.EntityDefinition   `json:"entities" binding:"required,dive"`
	Relations   []*model.RelationDefinition `json:"relations"`
}

// GetGraphTemplateListRequest 获取模板列表请求
type GetGraphTemplateListRequest struct {
	Offset  int    `form:"offset" binding:"min=0"`
	Limit   int    `form:"limit" binding:"min=1,max=200"`
	Keyword string `form:"keyword" binding:"max=100"`
}

// GetGraphTemplateList godoc
// @Summary 获取模板列表
// @Description 分页查询图谱模板列表
// @Tags 图谱模板
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param offset query int false "偏移量" default(0)
// @Param limit query int false "每页数量" default(20)
// @Param keyword query string false "名称搜索"
// @Success 200 {object} model.CommonResponse{data=service.GraphTemplateListResponse}
// @Router /api/graph-templates [get]
func GetGraphTemplateList(c *gin.Context) {
	eid := config.GetEID(c)

	var req GetGraphTemplateListRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 设置默认值
	if req.Limit == 0 {
		req.Limit = 20
	}

	// 调用 Service 层
	response, err := service.GetGraphTemplateList(c, eid, req.Offset, req.Limit, req.Keyword)
	if err != nil {
		logger.SysError(fmt.Sprintf("Failed to get graph template list: %v", err))
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// GetGraphTemplateDetail godoc
// @Summary 获取模板详情
// @Description 获取图谱模板完整定义
// @Tags 图谱模板
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path string true "模板ID"
// @Success 200 {object} model.CommonResponse{data=model.GraphTemplate}
// @Router /api/graph-templates/{id} [get]
func GetGraphTemplateDetail(c *gin.Context) {
	eid := config.GetEID(c)

	// 获取模板ID（已经被 middleware 解码为真实 ID）
	templateIDStr := c.Param("id")
	templateID, err := strconv.ParseInt(templateIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 调用 Service 层
	template, err := service.GetGraphTemplateDetail(c, eid, templateID)
	if err != nil {
		if errors.Is(err, service.ErrTemplateNotFound) {
			c.JSON(http.StatusOK, model.NotFound.ToNewErrorResponse("模板不存在"))
			return
		}
		logger.SysError(fmt.Sprintf("Failed to get graph template detail: %v", err))
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(template))
}

// CreateGraphTemplate godoc
// @Summary 创建模板
// @Description 创建新的图谱模板
// @Tags 图谱模板
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body CreateGraphTemplateRequest true "模板信息"
// @Success 200 {object} model.CommonResponse{data=model.GraphTemplate}
// @Router /api/graph-templates [post]
func CreateGraphTemplate(c *gin.Context) {
	eid := config.GetEID(c)

	var req CreateGraphTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 调用 Service 层
	template, err := service.CreateGraphTemplate(c, eid, req.Name, req.Description, req.Logo, req.Entities, req.Relations)
	if err != nil {
		if errors.Is(err, service.ErrTemplateNameExists) {
			c.JSON(http.StatusOK, model.RecordAlreadyExists.ToNewErrorResponse("模板名称已存在"))
			return
		}
		// 校验错误
		if err.Error() != "" && (err.Error()[0] < '0' || err.Error()[0] > '9') {
			c.JSON(http.StatusOK, model.ParamError.ToNewErrorResponse(err.Error()))
			return
		}
		logger.SysError(fmt.Sprintf("Failed to create graph template: %v", err))
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	logger.Info(c, fmt.Sprintf("Graph template created, template_id: %d, name: %s", template.ID, template.Name))
	c.JSON(http.StatusOK, model.Success.ToResponse(template))
}

// UpdateGraphTemplate godoc
// @Summary 更新模板
// @Description 更新图谱模板信息
// @Tags 图谱模板
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path string true "模板ID"
// @Param request body UpdateGraphTemplateRequest true "模板信息"
// @Success 200 {object} model.CommonResponse{data=model.GraphTemplate}
// @Router /api/graph-templates/{id} [put]
func UpdateGraphTemplate(c *gin.Context) {
	eid := config.GetEID(c)

	// 获取模板ID
	templateIDStr := c.Param("id")
	templateID, err := strconv.ParseInt(templateIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	var req UpdateGraphTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 调用 Service 层
	template, err := service.UpdateGraphTemplate(c, eid, templateID, req.Name, req.Description, req.Logo, req.Entities, req.Relations)
	if err != nil {
		if errors.Is(err, service.ErrTemplateNotFound) {
			c.JSON(http.StatusOK, model.NotFound.ToNewErrorResponse("模板不存在"))
			return
		}
		if errors.Is(err, service.ErrTemplateNameExists) {
			c.JSON(http.StatusOK, model.RecordAlreadyExists.ToNewErrorResponse("模板名称已存在"))
			return
		}
		// 校验错误
		if err.Error() != "" && (err.Error()[0] < '0' || err.Error()[0] > '9') {
			c.JSON(http.StatusOK, model.ParamError.ToNewErrorResponse(err.Error()))
			return
		}
		logger.SysError(fmt.Sprintf("Failed to update graph template: %v", err))
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	logger.Info(c, fmt.Sprintf("Graph template updated, template_id: %d, name: %s", templateID, template.Name))
	c.JSON(http.StatusOK, model.Success.ToResponse(template))
}

// DeleteGraphTemplate godoc
// @Summary 删除模板
// @Description 删除图谱模板
// @Tags 图谱模板
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path string true "模板ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/graph-templates/{id} [delete]
func DeleteGraphTemplate(c *gin.Context) {
	eid := config.GetEID(c)

	// 获取模板ID
	templateIDStr := c.Param("id")
	templateID, err := strconv.ParseInt(templateIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 调用 Service 层
	err = service.DeleteGraphTemplate(c, eid, templateID)
	if err != nil {
		if errors.Is(err, service.ErrTemplateNotFound) {
			c.JSON(http.StatusOK, model.NotFound.ToNewErrorResponse("模板不存在"))
			return
		}
		logger.SysError(fmt.Sprintf("Failed to delete graph template: %v", err))
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	logger.Info(c, fmt.Sprintf("Graph template deleted, template_id: %d", templateID))
	c.JSON(http.StatusOK, model.Success.ToResponse(true))
}

// SuggestRelationsRequest 关系推荐请求（Controller 层）
type SuggestRelationsRequest struct {
	Entities []*model.EntityDefinition `json:"entities" binding:"required,min=1,max=100,dive"`
	Context  string                    `json:"context"`
}

// SuggestTemplateParamsRequest 长文本图谱模板参数生成请求
type SuggestTemplateParamsRequest struct {
	Content string `json:"content" binding:"required"`
}

const suggestTemplateParamsMinContentRunes = 40

var suggestTemplateParamsService = func(c *gin.Context, db *gorm.DB, eid int64, content string) (*service.SuggestTemplateParamsResponse, error) {
	return service.SuggestTemplateParams(c, db, eid, content)
}

// SuggestRelations godoc
// @Summary 推荐关系
// @Description 根据实体类型自动推荐可能的关系
// @Tags 图谱模板
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body SuggestRelationsRequest true "实体类型列表"
// @Success 200 {object} model.CommonResponse{data=model.SuggestRelationsResponse}
// @Router /api/graph-templates/suggest-relations [post]
func SuggestRelations(c *gin.Context) {
	eid := config.GetEID(c)

	var req SuggestRelationsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 参数校验
	if len(req.Entities) < 2 {
		c.JSON(http.StatusOK, model.ParamError.ToNewErrorResponse("实体数量至少需要 2 个"))
		return
	}
	if len(req.Entities) > 100 {
		c.JSON(http.StatusOK, model.ParamError.ToNewErrorResponse("实体数量不能超过 100 个"))
		return
	}

	// 调用 Service 层
	response, err := service.SuggestRelations(c, model.DB, eid, req.Entities, req.Context)
	if err != nil {
		logger.SysError(fmt.Sprintf("Failed to suggest relations: %v", err))
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	logger.Info(c, fmt.Sprintf("Suggest relations completed, entity_count: %d, relation_count: %d", len(req.Entities), len(response.Relations)))
	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// SuggestTemplateParams godoc
// @Summary 长文本生成图谱模板参数
// @Description 接收一段业务长文本，自动生成图谱模板创建所需参数，过程仅记录 debug 日志，接口只返回最终结果
// @Tags 图谱模板
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body SuggestTemplateParamsRequest true "长文本内容"
// @Success 200 {object} model.CommonResponse{data=service.SuggestTemplateParamsResponse}
// @Router /api/graph-templates/suggest-template-params [post]
func SuggestTemplateParams(c *gin.Context) {
	eid := config.GetEID(c)

	var req SuggestTemplateParamsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	if strings.TrimSpace(req.Content) == "" {
		c.JSON(http.StatusOK, model.ParamError.ToNewErrorResponse("文本内容不能为空"))
		return
	}
	if utf8.RuneCountInString(strings.TrimSpace(req.Content)) < suggestTemplateParamsMinContentRunes {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToNewErrorResponse(fmt.Sprintf("文本内容过短，至少需要 %d 个字符", suggestTemplateParamsMinContentRunes)))
		return
	}

	response, err := suggestTemplateParamsService(c, model.DB, eid, req.Content)
	if err != nil {
		if strings.Contains(err.Error(), "不能为空") {
			c.JSON(http.StatusOK, model.ParamError.ToNewErrorResponse(err.Error()))
			return
		}
		logger.SysError(fmt.Sprintf("Failed to suggest graph template params: %v", err))
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	logger.Info(c, fmt.Sprintf("Suggest template params completed, name: %s, entity_count: %d, relation_count: %d",
		response.Name, len(response.Entities), len(response.Relations)))
	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}
