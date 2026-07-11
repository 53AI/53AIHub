package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type CreateShortcutRequest struct {
	Type      string `json:"type" binding:"required" example:"agent"`
	RelatedID int64  `json:"related_id" binding:"required" example:"123"`
}

type ShortcutItem struct {
	ID           int64  `json:"id"`
	Type         string `json:"type"`
	RelatedID    string `json:"related_id"`
	RawRelatedID int64  `json:"raw_related_id"` // 原始未加密的关联ID，用于暂时兼容前端逻辑
	Name         string `json:"name"`
	Logo         string `json:"logo"`
	Url          string `json:"url"`
}

type ShortcutListResponse struct {
	Shortcuts []ShortcutItem `json:"shortcuts"`
}

// CreateShortcut godoc
// @Summary 创建快捷方式
// @Description 为当前登录用户创建快捷方式（支持智能体/知识库/AI工具），同一类型+关联ID 幂等
// @Tags 快捷方式
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body CreateShortcutRequest true "创建快捷方式请求"
// @Success 200 {object} model.CommonResponse{data=ShortcutItem} "创建成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "关联对象不存在"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/shortcuts [post]
func CreateShortcut(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	var req CreateShortcutRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if err := validateShortcutType(req.Type); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if req.RelatedID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("关联ID无效")))
		return
	}

	if err := validateShortcutRelatedObjectExists(eid, req.Type, req.RelatedID); err != nil {
		if errors.Is(err, errInvalidShortcutType) {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
			return
		}
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	s, err := model.EnsureShortcut(eid, userID, req.Type, req.RelatedID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	item, err := buildShortcutItem(eid, *s)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(item))
}

// ListShortcuts godoc
// @Summary 获取快捷方式列表
// @Description 获取当前登录用户的快捷方式列表，并返回关联对象的名称与图标（logo）
// @Tags 快捷方式
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=ShortcutListResponse} "获取成功"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/shortcuts [get]
func ListShortcuts(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	shortcuts, err := model.GetUserShortcuts(eid, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	items, err := buildShortcutItems(eid, shortcuts)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(ShortcutListResponse{
		Shortcuts: items,
	}))
}

type GetShortcutByTypeRelatedIDRequest struct {
	Type      string `form:"type" binding:"required" example:"library"`
	RelatedID int64  `form:"related_id" binding:"required" example:"123"`
}

// GetShortcutByTypeRelatedID godoc
// @Summary 根据类型与关联ID获取快捷方式
// @Description 根据快捷方式类型(type)与关联ID(related_id)获取当前用户的快捷方式
// @Tags 快捷方式
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param type query string true "快捷方式类型：agent/library/ai_link"
// @Param related_id query int true "关联对象ID（解码后的数字ID）"
// @Success 200 {object} model.CommonResponse{data=ShortcutItem} "获取成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "快捷方式不存在"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/shortcuts/by_related [get]
func GetShortcutByTypeRelatedID(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	var req GetShortcutByTypeRelatedIDRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if err := validateShortcutType(req.Type); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if req.RelatedID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("关联ID无效")))
		return
	}

	s, err := model.GetShortcutByUserTypeRelatedID(eid, userID, req.Type, req.RelatedID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("快捷方式不存在")))
			return
		}
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	item, err := buildShortcutItem(eid, *s)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(item))
}

// DeleteShortcut godoc
// @Summary 删除快捷方式
// @Description 删除指定ID的快捷方式（仅能删除当前登录用户自己的快捷方式）
// @Tags 快捷方式
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "快捷方式ID"
// @Success 200 {object} model.CommonResponse "删除成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "快捷方式不存在"
// @Failure 500 {object} model.CommonResponse "服务器错误"
// @Router /api/shortcuts/{id} [delete]
func DeleteShortcut(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("快捷方式ID无效")))
		return
	}

	var s model.Shortcut
	if err := model.DB.Where("eid = ? AND user_id = ? AND id = ?", eid, userID, id).First(&s).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse(errors.New("快捷方式不存在")))
			return
		}
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	if err := model.DB.Delete(&s).Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

var errInvalidShortcutType = errors.New("快捷方式类型无效")

func validateShortcutType(shortcutType string) error {
	switch shortcutType {
	case model.ShortcutTypeAgent, model.ShortcutTypeLibrary, model.ShortcutTypeAILink:
		return nil
	default:
		return errInvalidShortcutType
	}
}

func validateShortcutRelatedObjectExists(eid int64, shortcutType string, relatedID int64) error {
	switch shortcutType {
	case model.ShortcutTypeAgent:
		agent, err := model.GetAgentByID(eid, relatedID)
		if err != nil || agent == nil {
			return errors.New("智能体不存在")
		}
		return nil
	case model.ShortcutTypeLibrary:
		lib, err := model.GetLibraryByID(eid, relatedID)
		if err != nil || lib == nil {
			return errors.New("知识库不存在")
		}
		return nil
	case model.ShortcutTypeAILink:
		link, err := model.GetAILinkByID(relatedID)
		if err != nil || link == nil || link.Eid != eid {
			return errors.New("AI工具不存在")
		}
		return nil
	default:
		return errInvalidShortcutType
	}
}

func buildShortcutItem(eid int64, s model.Shortcut) (ShortcutItem, error) {
	encodedRelatedID, err := hashids.Encode(s.RelatedID)
	if err != nil {
		return ShortcutItem{}, err
	}

	item := ShortcutItem{
		ID:           s.ID,
		Type:         s.Type,
		RelatedID:    encodedRelatedID,
		RawRelatedID: s.RelatedID,
		Name:         "",
		Logo:         "",
	}

	switch s.Type {
	case model.ShortcutTypeAgent:
		agent, err := model.GetAgentByID(eid, s.RelatedID)
		if err != nil || agent == nil {
			return ShortcutItem{}, errors.New("智能体不存在")
		}
		item.Name = agent.Name
		item.Logo = agent.Logo
	case model.ShortcutTypeLibrary:
		lib, err := model.GetLibraryByID(eid, s.RelatedID)
		if err != nil || lib == nil {
			return ShortcutItem{}, errors.New("知识库不存在")
		}
		item.Name = lib.Name
		item.Logo = lib.Icon
	case model.ShortcutTypeAILink:
		link, err := model.GetAILinkByID(s.RelatedID)
		if err != nil || link == nil || link.Eid != eid {
			return ShortcutItem{}, errors.New("AI工具不存在")
		}
		item.Name = link.Name
		item.Logo = link.Logo
		item.Url = link.URL
	default:
		return ShortcutItem{}, errInvalidShortcutType
	}

	return item, nil
}

func buildShortcutItems(eid int64, shortcuts []model.Shortcut) ([]ShortcutItem, error) {
	if len(shortcuts) == 0 {
		return []ShortcutItem{}, nil
	}

	agentIDs := make([]int64, 0)
	libraryIDs := make([]int64, 0)
	aiLinkIDs := make([]int64, 0)

	for _, s := range shortcuts {
		switch s.Type {
		case model.ShortcutTypeAgent:
			agentIDs = append(agentIDs, s.RelatedID)
		case model.ShortcutTypeLibrary:
			libraryIDs = append(libraryIDs, s.RelatedID)
		case model.ShortcutTypeAILink:
			aiLinkIDs = append(aiLinkIDs, s.RelatedID)
		}
	}

	type agentMeta struct {
		AgentID int64  `gorm:"column:agent_id"`
		Name    string `gorm:"column:name"`
		Logo    string `gorm:"column:logo"`
	}
	type libraryMeta struct {
		ID   int64  `gorm:"column:id"`
		Name string `gorm:"column:name"`
		Icon string `gorm:"column:icon"`
	}
	type aiLinkMeta struct {
		ID   int64  `gorm:"column:id"`
		Eid  int64  `gorm:"column:eid"`
		Name string `gorm:"column:name"`
		Logo string `gorm:"column:logo"`
		Url  string `gorm:"column:url"`
	}

	agentMap := map[int64]agentMeta{}
	if len(agentIDs) > 0 {
		var agents []agentMeta
		if err := model.DB.Model(&model.Agent{}).
			Select("agent_id, name, logo").
			Where("eid = ? AND agent_id IN ?", eid, agentIDs).
			Find(&agents).Error; err != nil {
			return nil, err
		}
		for _, a := range agents {
			agentMap[a.AgentID] = a
		}
	}

	libraryMap := map[int64]libraryMeta{}
	if len(libraryIDs) > 0 {
		var libs []libraryMeta
		if err := model.DB.Model(&model.Library{}).
			Select("id, name, icon").
			Where("eid = ? AND id IN ?", eid, libraryIDs).
			Find(&libs).Error; err != nil {
			return nil, err
		}
		for _, l := range libs {
			libraryMap[l.ID] = l
		}
	}

	aiLinkMap := map[int64]aiLinkMeta{}
	if len(aiLinkIDs) > 0 {
		var links []aiLinkMeta
		if err := model.DB.Model(&model.AILink{}).
			Select("id, eid, name, logo, url").
			Where("eid = ? AND id IN ?", eid, aiLinkIDs).
			Find(&links).Error; err != nil {
			return nil, err
		}
		for _, l := range links {
			aiLinkMap[l.ID] = l
		}
	}

	out := make([]ShortcutItem, 0, len(shortcuts))
	for _, s := range shortcuts {
		encodedRelatedID, err := hashids.Encode(s.RelatedID)
		if err != nil {
			return nil, err
		}

		item := ShortcutItem{
			ID:           s.ID,
			Type:         s.Type,
			RelatedID:    encodedRelatedID,
			RawRelatedID: s.RelatedID,
			Name:         "",
			Logo:         "",
			Url:          "",
		}

		switch s.Type {
		case model.ShortcutTypeAgent:
			if a, ok := agentMap[s.RelatedID]; ok {
				item.Name = a.Name
				item.Logo = a.Logo
				out = append(out, item)
			}
		case model.ShortcutTypeLibrary:
			if l, ok := libraryMap[s.RelatedID]; ok {
				item.Name = l.Name
				item.Logo = l.Icon
				out = append(out, item)
			}
		case model.ShortcutTypeAILink:
			if l, ok := aiLinkMap[s.RelatedID]; ok {
				item.Name = l.Name
				item.Logo = l.Logo
				item.Url = l.Url
				out = append(out, item)
			}
		}
	}

	return out, nil
}
