package controller

import (
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

type AILinkRequest struct {
	GroupID       int64  `json:"group_id" example:"1"`
	Name          string `json:"name" example:"ai_link_name"`
	Logo          string `json:"logo" example:"logo_url"`
	URL           string `json:"url" example:"ai_link_url"`
	Description   string `json:"description" example:"ai_link_description"`
	Sort          int64  `json:"sort" example:"0"`
	SharedAccount string `json:"shared_account" example:"[{'account':'admin', 'password':'<PASSWORD>', 'remark':''}]"`
	// 使用范围
	SubscriptionGroupIds []int64 `json:"subscription_group_ids"`
	UserGroupIds         []int64 `json:"user_group_ids"`
}

// @Summary Create AI Link
// @Description Create new AI link entry
// @Tags AI Link
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param link body AILinkRequest true "AI Link data"
// @Success 200 {object} model.CommonResponse
// @Router /api/ai_links [post]
func CreateAILink(c *gin.Context) {
	var req AILinkRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	link := model.AILink{
		Eid:           config.GetEID(c),
		GroupID:       req.GroupID,
		Name:          req.Name,
		Logo:          req.Logo,
		URL:           req.URL,
		Description:   req.Description,
		Sort:          req.Sort,
		CreatedBy:     config.GetUserId(c),
		SharedAccount: req.SharedAccount,
	}

	if err := model.CreateAILink(&link); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 添加分组关联
	allGroupIds := make([]int64, 0)

	// 添加订阅分组
	if len(req.SubscriptionGroupIds) > 0 {
		allGroupIds = append(allGroupIds, req.SubscriptionGroupIds...)
	}

	// 添加用户分组
	if len(req.UserGroupIds) > 0 {
		allGroupIds = append(allGroupIds, req.UserGroupIds...)
	}

	// 创建资源范围；没有指定分组时写入企业范围。
	tx := model.DB.Begin()
	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}
	if err := service.UpdateResourcePermissions(c, tx, link.ID, model.ResourceTypeAILink, allGroupIds); err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}
	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}
	if err := link.LoadUserGroupIds(); err != nil {
		link.UserGroupIds = []int64{}
		link.Scopes = []model.ResourceScopeItem{}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(link))
}

// @Summary Get AI Link
// @Description Get AI link by ID
// @Tags AI Link
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "Link ID"
// @Success 200 {object} model.CommonResponse{data=model.AILink}
// @Router /api/ai_links/{id} [get]
func GetAILink(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	link, err := model.GetAILinkByID(int64(id))

	if err != nil || link.Eid != config.GetEID(c) {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}
	if user, userErr := model.GetLoginUser(c); userErr == nil {
		accessible, accessErr := service.CheckResourceScopeAccess(user.UserID, link.Eid, link.ID, model.ResourceTypeAILink)
		if accessErr != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
			return
		}
		if !accessible {
			c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(nil))
			return
		}
	}
	err = link.LoadUserGroupIds()
	if err != nil {
		link.UserGroupIds = []int64{}
	}
	link.LoadHasSharedAccount()

	c.JSON(http.StatusOK, model.Success.ToResponse(link))
}

// @Summary Update AI Link
// @Description Update existing AI link
// @Tags AI Link
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "Link ID"
// @Param link body AILinkRequest true "Update data"
// @Success 200 {object} model.CommonResponse
// @Router /api/ai_links/{id} [put]
func UpdateAILink(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	link, err := model.GetAILinkByID(int64(id))

	if err != nil || link.Eid != config.GetEID(c) {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	var req AILinkRequest
	if c.ShouldBindJSON(&req) != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	link.GroupID = req.GroupID
	link.Name = req.Name
	link.Logo = req.Logo
	link.URL = req.URL
	link.Description = req.Description
	link.Sort = req.Sort
	link.SharedAccount = req.SharedAccount

	if err := model.UpdateAILink(link); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	// 更新分组关联
	allGroupIds := make([]int64, 0)

	// 添加订阅分组
	if len(req.SubscriptionGroupIds) > 0 {
		allGroupIds = append(allGroupIds, req.SubscriptionGroupIds...)
	}

	// 添加用户分组
	if len(req.UserGroupIds) > 0 {
		allGroupIds = append(allGroupIds, req.UserGroupIds...)
	}

	tx := model.DB.Begin()
	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 使用通用方法更新资源权限
	if err := service.UpdateResourcePermissions(c, tx, link.ID, model.ResourceTypeAILink, allGroupIds); err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	// 提交事务
	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}
	err = link.LoadUserGroupIds()
	if err != nil {
		link.UserGroupIds = []int64{}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(link))
}

// @Summary Delete AI Link
// @Description Delete AI link by ID
// @Tags AI Link
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path int true "Link ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/ai_links/{id} [delete]
func DeleteAILink(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	link, err := model.GetAILinkByID(int64(id))

	if err != nil || link.Eid != config.GetEID(c) {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	// 开始事务
	tx := model.DB.Begin()
	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(tx.Error))
		return
	}

	// 使用通用方法删除资源权限
	if err := service.UpdateResourcePermissions(c, tx, int64(id), model.ResourceTypeAILink, []int64{}); err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	// 删除AI链接
	if err := tx.Delete(link).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	// 提交事务
	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// @Summary Get AI Links
// @Description Get AI links by group ID
// @Tags AI Link
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param group_id query int false "Empty for all groups or group ID"
// @Param keyword query string false "Search by name"
// @Success 200 {object} model.CommonResponse{data=[]model.AILink}
// @Router /api/ai_links [get]
func GetAILinks(c *gin.Context) {
	groupID, _ := strconv.ParseInt(c.Query("group_id"), 10, 64)
	keyword := c.Query("keyword")
	var links []model.AILink
	var err error

	if groupID != 0 {
		if keyword != "" {
			links, err = model.GetAILinksByEidAndGroupIdWithKeyword(config.GetEID(c), groupID, keyword)
		} else {
			links, err = model.GetAILinksByEidAndGroupId(config.GetEID(c), groupID)
		}
	} else {
		if keyword != "" {
			links, err = model.GetAILinksGroupedBySortWithKeyword(config.GetEID(c), keyword)
		} else {
			links, err = model.GetAILinksGroupedBySort(config.GetEID(c))
		}
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(links))
}

// @Summary Get current site AI links
// @Description Get all AI links for current site
// @Tags AI Link
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=[]model.AILink}
// @Router /api/ai_links/current [get]
func GetCurrentSiteAILinks(c *gin.Context) {
	eid := config.GetEID(c)
	links, err := model.GetAILinksGroupedBySort(eid)

	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}
	if user, userErr := model.GetLoginUser(c); userErr == nil {
		filtered := make([]model.AILink, 0, len(links))
		for _, link := range links {
			accessible, accessErr := service.CheckResourceScopeAccess(user.UserID, eid, link.ID, model.ResourceTypeAILink)
			if accessErr != nil {
				c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
				return
			}
			if accessible {
				filtered = append(filtered, link)
			}
		}
		links = filtered
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(links))
}

// @Summary 获取默认AI链接数据
// @Description 获取预定义的AI工具分组及对应链接列表（如AI搜索、智能对话等分组）
// @Tags AI Link
// @Accept json
// @Produce json
// @Success 200 {object} model.CommonResponse{data=[]model.GroupInfo} "成功返回默认AI链接数据"
// @Router /api/ai_links/default [get]
func GetDefaultAILinks(c *gin.Context) {
	links := model.GetDefaultGroupData()

	c.JSON(http.StatusOK, model.Success.ToResponse(links))
}

type SortItem struct {
	ID      int64 `json:"id" example:"1"`
	Sort    int64 `json:"sort" example:"5"`
	GroupID int64 `json:"group_id" example:"1"`
}

type BatchSortRequest struct {
	Items []SortItem `json:"items"`
}

// @Summary Batch Sort AI Links
// @Description Batch update sort order of AI links
// @Tags AI Link
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param data body BatchSortRequest true "Batch sort data"
// @Success 200 {object} model.CommonResponse
// @Router /api/ai_links/batch/sort [post]
func BatchSortAILinks(c *gin.Context) {
	var req BatchSortRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)
	tx := model.DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	for _, item := range req.Items {
		link, err := model.GetAILinkByID(item.ID)
		if err != nil || link.Eid != eid {
			tx.Rollback()
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
			return
		}

		link.Sort = item.Sort
		link.GroupID = item.GroupID
		if err := tx.Model(&link).Updates(link).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
			return
		}
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}
