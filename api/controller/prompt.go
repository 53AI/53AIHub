package controller

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// PromptListRequest 定义获取提示词列表的请求参数
type PromptListRequest struct {
	Keyword   string `form:"keyword" json:"keyword"`       // 关键词搜索
	GroupId   string `form:"group_id" json:"group_id"`     // 分组ID，多个ID用逗号分隔，为空时查询全部
	GroupType int64  `form:"group_type" json:"group_type"` // 分组类型筛选
	Offset    int    `form:"offset" json:"offset"`         // 分页偏移量
	Limit     int    `form:"limit" json:"limit"`           // 分页大小
}

// PromptsResponse 定义提示词列表的响应结构
type PromptsResponse struct {
	Count   int64           `json:"count"`   // 总数
	Prompts []*model.Prompt `json:"prompts"` // 提示词列表
}

// PromptRequest 定义创建或更新提示词的请求参数
type PromptRequest struct {
	Name                 string     `json:"name" binding:"required" example:"智能写作助手"`                                                                                                                                                                                                                                                                                                                                                                // 提示词名称
	Logo                 string     `json:"logo" example:"https://example.com/logo.png"`                                                                                                                                                                                                                                                                                                                                                             // 图标URL
	Content              string     `json:"content" binding:"required" example:"请帮我总结以下文档的主要内容..."`                                                                                                                                                                                                                                                                                                                                                  // 提示词内容
	Description          string     `json:"description" example:"用于快速总结文档内容"`                                                                                                                                                                                                                                                                                                                                                                        // 提示词描述
	GroupIds             []int64    `json:"group_ids" binding:"required" example:"[1, 2]"`                                                                                                                                                                                                                                                                                                                                                           // 所属分组IDs
	SubscriptionGroupIds []int64    `json:"subscription_group_ids" example:"[3, 4]"`                                                                                                                                                                                                                                                                                                                                                                 // 订阅分组IDs
	UserGroupIds         []int64    `json:"user_group_ids" example:"[5, 6]"`                                                                                                                                                                                                                                                                                                                                                                         // 用户分组IDs
	Sort                 int        `json:"sort" example:"0"`                                                                                                                                                                                                                                                                                                                                                                                        // 排序
	CustomConfig         string     `json:"custom_config"`                                                                                                                                                                                                                                                                                                                                                                                           // 自定义配置
	Status               *int       `json:"status" example:"1"`                                                                                                                                                                                                                                                                                                                                                                        // 状态，0未启用，1正常，2删除
	AILinks              []LinkItem `json:"ai_links" example:"[{\"ai_link\":{\"name\":\"link1\",\"logo\":\"https://example.com/logo1.png\",\"url\":\"https://example.com/link1\",\"description\":\"Description for link1\",\"sort\":0},\"delete\":false},{\"ai_link\":{\"name\":\"link2\",\"logo\":\"https://example.com/logo2.png\",\"url\":\"https://example.com/link2\",\"description\":\"Description for link2\",\"sort\":1},\"delete\":true}]"` // 网站配置列表，支持增删改
}

func buildPromptAILinks(defaultLinks []model.AILinkInfo, linkItems []LinkItem) []model.AILinkInfo {
	if len(linkItems) == 0 {
		if defaultLinks == nil {
			return []model.AILinkInfo{}
		}
		return defaultLinks
	}

	updatedLinks := make([]model.AILinkInfo, 0, len(linkItems))
	for _, linkItem := range linkItems {
		if linkItem.Delete {
			continue
		}
		updatedLinks = append(updatedLinks, linkItem.AILink)
	}

	if updatedLinks == nil {
		return []model.AILinkInfo{}
	}

	return updatedLinks
}

// GetPrompts 获取提示词列表
// @Summary 获取提示词列表
// @Description 获取提示词列表，支持分页、关键词搜索、按分组筛选、按分组类型筛选
// @Tags Prompt
// @Produce json
// @Param keyword query string false "关键词搜索"
// @Param group_id query string false "分组ID，多个ID用逗号分隔，为空时查询全部"
// @Param group_type query int false "分组类型筛选（5=系统提示，6=个人提示等）"
// @Param offset query int false "分页偏移量"
// @Param limit query int false "分页大小" default(10)
// @Success 200 {object} model.CommonResponse{data=PromptsResponse} "成功"
// @Router /api/prompts [get]
// @Router /api/prompts/admin [get]
func GetPrompts(c *gin.Context) {
	var promptListRequest PromptListRequest
	if err := c.ShouldBindQuery(&promptListRequest); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 设置默认分页大小为10
	if promptListRequest.Limit == 0 {
		promptListRequest.Limit = 10
	}

	var userId int64
	eid := config.GetEID(c)
	user, err := model.GetLoginUser(c)
	if err == nil {
		userId = user.UserID
		eid = user.Eid
	}

	status := -1
	if !strings.Contains(c.Request.URL.Path, "/admin") {
		status = model.PromptStatusNormal
	}

	// 处理 groupType 参数
	// 注意：如果同时提供 groupType 和 GroupId，groupType 优先级更高
	if promptListRequest.GroupType > 0 {
		firstGroup, err := model.GetFirstGroupByEid(eid, promptListRequest.GroupType)
		if err == nil {
			// 成功找到分组，使用其ID
			promptListRequest.GroupId = strconv.FormatInt(firstGroup.GroupId, 10)
		} else {
			// 如果没有找到对应类型的分组（gorm.ErrRecordNotFound），
			// 设置 GroupId 为不存在的值以返回空结果
			promptListRequest.GroupId = ""
		}
	} else if promptListRequest.GroupId == "" {
		// 如果没有提供 GroupId，则获取所有系统提示词分组的 ID
		systemGroups, err := model.GetGroupsByEid(eid, model.SYSTEM_PROMPT_TYPE)
		if err == nil && len(systemGroups) > 0 {
			var groupIds []string
			for _, group := range systemGroups {
				groupIds = append(groupIds, strconv.FormatInt(group.GroupId, 10))
			}
			promptListRequest.GroupId = strings.Join(groupIds, ",")
		}
	}

	// 获取提示词列表
	var total int64
	var prompts []*model.Prompt

	// 可以查看所有提示词
	total, prompts, err = model.GetPromptList(
		eid,
		promptListRequest.Keyword,
		promptListRequest.GroupId,
		status,
		promptListRequest.Offset,
		promptListRequest.Limit,
	)

	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	// 加载每个提示词的分组信息
	for _, prompt := range prompts {
		// 反序列化 AILinks 字段
		var links []model.AILinkInfo
		if prompt.AILinks != "" {
			if err := json.Unmarshal([]byte(prompt.AILinks), &links); err != nil {
				// 记录日志并使用默认值
				links = []model.AILinkInfo{}
			}
		}
		prompt.AILinksData = links // 将解析后的数据赋值到 AILinksData

		if err := prompt.LoadPromptGroups(); err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
			return
		}
		if userId > 0 {
			if err := prompt.LoadIsLiked(userId); err != nil {
				c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
				return
			}
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(PromptsResponse{
		Count:   total,
		Prompts: prompts,
	}))
}

// CreatePrompt 创建提示词
// @Summary 创建提示词
// @Description 创建新的提示词，支持指定用途类型
// @Tags Prompt
// @Accept json
// @Produce json
// @Security BearerAuth
//
//	@Param request body PromptRequest true "提示词信息"{
//		"name": "智能写作助手",
//		"logo": "https://example.com/logo.png",
//		"content": "请帮我总结以下文档的主要内容...",
//		"description": "用于快速总结文档内容",
//		"group_ids": [1, 2],
//		"subscription_group_ids": [3, 4],
//		"user_group_ids": [5, 6],
//		"sort": 0,
//		"status": 1,
//		"ai_links": [
//			{"ai_link":{"name":"link1","logo":"https://example.com/logo1.png","url":"https://example.com/link1","description":"Description for link1","sort":0},"delete":false}
//		]
//	}
//
// @Success 200 {object} model.CommonResponse{data=model.Prompt} "成功"
// @Router /api/prompts/system [post]
// @Router /api/prompts/personal [post]
func CreatePrompt(c *gin.Context) {
	var promptReq PromptRequest
	if err := c.ShouldBindJSON(&promptReq); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	var promptType int
	if strings.Contains(c.Request.URL.Path, "/system") {
		promptType = model.PromptTypeSystem
	} else if strings.Contains(c.Request.URL.Path, "/personal") {
		promptType = model.PromptTypePersonal
	}

	if promptType == model.PromptTypeSystem && !common.IsAdmin(c) {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(nil))
		return
	}

	// 获取默认网站配置
	defaultLinks, err := model.GetDefaultPromptLinks(eid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	links := buildPromptAILinks(defaultLinks, promptReq.AILinks)

	// 序列化 AILinks 为 JSON 字符串
	linksJSON, err := json.Marshal(links)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ParamError.ToResponse(err))
		return
	}

	// 创建提示词对象
	status := model.PromptStatusNormal
	if promptReq.Status != nil {
		status = *promptReq.Status
	}
	prompt := &model.Prompt{
		Name:         promptReq.Name,
		Logo:         promptReq.Logo,
		Content:      promptReq.Content,
		Description:  promptReq.Description,
		Type:         promptType,
		Status:       status,
		UserID:       userID,
		Eid:          eid,
		Sort:         promptReq.Sort,
		CustomConfig: promptReq.CustomConfig,
		AILinks:      string(linksJSON),
		AILinksData:  links,
	}

	// 开始事务
	tx := model.DB.Begin()
	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	// 创建提示词
	if err := tx.Create(prompt).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	// 添加分组关联
	allGroupIds := make([]int64, 0)

	// 添加普通分组
	if len(promptReq.GroupIds) > 0 {
		allGroupIds = append(allGroupIds, promptReq.GroupIds...)
	}

	// 添加订阅分组
	if len(promptReq.SubscriptionGroupIds) > 0 {
		allGroupIds = append(allGroupIds, promptReq.SubscriptionGroupIds...)
	}

	// 添加用户分组
	if len(promptReq.UserGroupIds) > 0 {
		allGroupIds = append(allGroupIds, promptReq.UserGroupIds...)
	}

	// 使用通用方法更新资源权限
	if err := service.UpdateResourcePermissions(c, tx, int64(prompt.PromptID), model.ResourceTypePrompt, allGroupIds); err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	// 提交事务
	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	// 加载提示词的分组信息
	if err := prompt.LoadPromptGroups(); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(prompt))
}

// GetPrompt 获取单个提示词
// @Summary 获取单个提示词
// @Description 根据ID获取提示词详情
// @Tags Prompt
// @Produce json
// @Security BearerAuth
// @Param pid path int true "提示词ID"
// @Success 200 {object} model.CommonResponse{data=model.Prompt} "成功"
// @Router /api/prompts/{pid} [get]
func GetPrompt(c *gin.Context) {
	promptID, err := strconv.Atoi(c.Param("pid"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	var eid int64
	user, err := model.GetLoginUser(c)
	if err == nil {
		eid = user.Eid
	} else {
		eid = config.GetEID(c)
	}
	prompt, err := model.GetPromptByID(promptID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	// 检查提示词是否属于当前企业
	if prompt.Eid != eid {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	// 加载提示词的分组信息
	if err := prompt.LoadPromptGroups(); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	// 反序列化 AILinks 字段
	var links []model.AILinkInfo
	if prompt.AILinks != "" {
		if err := json.Unmarshal([]byte(prompt.AILinks), &links); err != nil {
			// 记录日志并使用默认值
			links = []model.AILinkInfo{}
		}
	}
	prompt.AILinksData = links

	if err := prompt.LoadIsLiked(config.GetUserId(c)); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	prompt.Views++
	prompt.Update()

	c.JSON(http.StatusOK, model.Success.ToResponse(prompt))
}

// UpdatePrompt 更新提示词
// @Summary 更新提示词
// @Description 更新提示词信息，包括提示词的名称、内容、描述、用途类型、排序、自定义配置、状态，以及分组关联和网站配置的增删改。
// @Tags Prompt
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param pid path int true "提示词ID"
//
//	@Param request body PromptRequest true "提示词信息，包括分组关联和网站配置的增删改"{
//		"name": "智能写作助手",
//		"logo": "https://example.com/logo.png",
//		"content": "请帮我总结以下文档的主要内容...",
//		"description": "用于快速总结文档内容",
//		"group_ids": [1, 2],
//		"subscription_group_ids": [3, 4],
//		"user_group_ids": [5, 6],
//		"sort": 0,
//		"status": 1
//	}
//
// @Success 200 {object} model.CommonResponse{data=model.Prompt} "成功返回更新后的提示词信息"
// @Failure 400 {object} model.CommonResponse "请求参数错误"
// @Failure 403 {object} model.CommonResponse "权限不足"
// @Failure 404 {object} model.CommonResponse "提示词不存在或不属于当前企业"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/prompts/{pid} [put]
func UpdatePrompt(c *gin.Context) {
	promptID, err := strconv.Atoi(c.Param("pid"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	var promptReq PromptRequest
	if err = c.ShouldBindJSON(&promptReq); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	eid := config.GetEID(c)
	prompt, err := model.GetPromptByID(promptID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	if prompt.Type == model.PromptTypeSystem && !common.IsAdmin(c) {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(nil))
		return
	}

	// 检查提示词是否属于当前企业
	if prompt.Eid != eid {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	// 开始事务
	tx := model.DB.Begin()
	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	// 更新提示词字段
	prompt.Name = promptReq.Name
	prompt.Logo = promptReq.Logo
	prompt.Content = promptReq.Content
	prompt.Description = promptReq.Description
	prompt.Sort = promptReq.Sort
	prompt.CustomConfig = promptReq.CustomConfig
	if promptReq.Status != nil {
		prompt.Status = *promptReq.Status
	}

	links := buildPromptAILinks(nil, promptReq.AILinks)

	// 序列化更新后的 AILinks 为 JSON 字符串
	linksJSON, err := json.Marshal(links)
	if err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, model.ParamError.ToResponse(err))
		return
	}
	prompt.AILinks = string(linksJSON)

	if err := tx.Save(prompt).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	// 添加分组关联
	allGroupIds := make([]int64, 0)

	// 添加普通分组
	if len(promptReq.GroupIds) > 0 {
		allGroupIds = append(allGroupIds, promptReq.GroupIds...)
	}

	// 添加订阅分组
	if len(promptReq.SubscriptionGroupIds) > 0 {
		allGroupIds = append(allGroupIds, promptReq.SubscriptionGroupIds...)
	}

	// 添加用户分组
	if len(promptReq.UserGroupIds) > 0 {
		allGroupIds = append(allGroupIds, promptReq.UserGroupIds...)
	}

	// 使用通用方法更新资源权限
	if err := service.UpdateResourcePermissions(c, tx, int64(prompt.PromptID), model.ResourceTypePrompt, allGroupIds); err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	// 提交事务
	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	// 加载提示词的分组信息
	if err := prompt.LoadPromptGroups(); err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(prompt))
}

// DeletePrompt 删除提示词
// @Summary 删除提示词
// @Description 根据ID删除提示词
// @Tags Prompt
// @Produce json
// @Security BearerAuth
// @Param pid path int true "提示词ID"
// @Success 200 {object} model.CommonResponse "成功"
// @Router /api/prompts/{pid} [delete]
func DeletePrompt(c *gin.Context) {
	promptID, err := strconv.Atoi(c.Param("pid"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	prompt, err := model.GetPromptByID(promptID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	if prompt.Type == model.PromptTypeSystem && !common.IsAdmin(c) {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(nil))
		return
	}

	// 检查提示词是否属于当前企业
	if prompt.Eid != eid {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	// 开始事务
	tx := model.DB.Begin()
	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	// 删除提示词（软删除）
	if err := prompt.Delete(); err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	// 删除关联的权限
	if err := tx.Where("resource_id = ? AND resource_type = ?", promptID, model.ResourceTypePrompt).Delete(&model.ResourcePermission{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	// 提交事务
	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// UpdatePromptLike 更新提示词点赞
// @Summary 更新提示词点赞
// @Description 更新提示词点赞
// @Tags Prompt
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param pid path int true "提示词ID"
// @Success 200 {object} model.CommonResponse "成功"
// @Router /api/prompts/{pid}/like [patch]
func UpdatePromptLike(c *gin.Context) {
	promptID, err := strconv.Atoi(c.Param("pid"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	prompt, err := model.GetPromptByID(promptID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	// 检查提示词是否属于当前企业
	if prompt.Eid != eid {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	userID := config.GetUserId(c)
	likeType := model.LikeTypePrompt
	objectID := prompt.PromptID

	// 开始事务
	tx := model.DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 查询是否存在点赞记录
	var like model.Like
	result := tx.Where("user_id = ? AND type = ? AND object_id = ?", userID, likeType, objectID).First(&like)
	if result.Error != nil && !errors.Is(result.Error, gorm.ErrRecordNotFound) {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	var likeChange int64 = 0
	if result.Error == nil { // 记录存在
		// 切换点赞状态
		newStatus := model.LikeStatusCancel
		if like.Status == model.LikeStatusCancel {
			newStatus = model.LikeStatusActive
			likeChange = 1 // 从取消变为点赞，点赞数+1
		} else {
			likeChange = -1 // 从点赞变为取消，点赞数-1
		}

		// 更新点赞状态
		if err := tx.Model(&like).Update("status", newStatus).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
			return
		}
	} else { // 记录不存在，创建新记录
		newLike := &model.Like{
			UserID:   userID,
			Type:     likeType,
			ObjectID: objectID,
			Status:   model.LikeStatusActive,
		}

		if err := tx.Create(newLike).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
			return
		}

		likeChange = 1 // 新增点赞，点赞数+1
	}

	// 更新提示词的点赞数
	if likeChange != 0 {
		// 使用原生SQL更新点赞数，避免并发问题
		if err := tx.Exec("UPDATE prompts SET likes = likes + ? WHERE prompt_id = ?", likeChange, objectID).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
			return
		}
	}

	// 提交事务
	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

type UpdatePromptStatusRequest struct {
	Status *int `form:"status" json:"status" default:"1" binding:"required"` // 状态，0未启用，1正常
}

// UpdatePromptStatus 更新提示词状态
// @Summary 更新提示词状态
// @Description 更新提示词状态
// @Tags Prompt
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param pid path int true "提示词ID"
// @Param request body UpdatePromptStatusRequest true "提示词状态"
// @Success 200 {object} model.CommonResponse "成功"
// @Router /api/prompts/{pid}/status [patch]
func UpdatePromptStatus(c *gin.Context) {
	promptID, err := strconv.Atoi(c.Param("pid"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	prompt, err := model.GetPromptByID(promptID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	// 检查提示词是否属于当前企业
	if prompt.Eid != eid {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	var promptReq UpdatePromptStatusRequest
	if err = c.ShouldBindJSON(&promptReq); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	if prompt.Status != model.PromptStatusNormal && prompt.Status != model.PromptStatusDisable {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(errors.New("prompt status is not normal")))
		return
	}

	status := *promptReq.Status
	prompt.Status = status
	prompt.Update()
	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// GetPromptGroups 获取提示词所在的所有分组
// @Summary 获取提示词所在的所有分组
// @Description 获取提示词关联的所有分组
// @Tags Prompt
// @Produce json
// @Security BearerAuth
// @Param pid path int true "提示词ID"
// @Success 200 {object} model.CommonResponse{data=[]model.Group} "成功"
// @Router /api/prompts/{pid}/groups [get]
func GetPromptGroups(c *gin.Context) {
	promptID, err := strconv.Atoi(c.Param("pid"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	eid := config.GetEID(c)
	prompt, err := model.GetPromptByID(promptID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	// 检查提示词是否属于当前企业
	if prompt.Eid != eid {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	// 获取提示词关联的所有分组ID
	var groupIDs []int64
	err = model.DB.Model(&model.ResourcePermission{}).
		Where("resource_id = ? AND resource_type = ?", promptID, model.ResourceTypePrompt).
		Pluck("group_id", &groupIDs).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
		return
	}

	// 获取所有分组信息
	var groups []*model.Group
	if len(groupIDs) > 0 {
		err = model.DB.Where("group_id IN (?)", groupIDs).Find(&groups).Error
		if err != nil {
			c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(nil))
			return
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(groups))
}

// 辅助函数：根据ID列表获取提示词列表
func getPromptListWithIDs(eid int64, keyword string, groupIDStr string, promptIDs []int64, offset int, limit int, sortDesc bool) (int64, []*model.Prompt, error) {
	if len(promptIDs) == 0 {
		return 0, []*model.Prompt{}, nil
	}

	db := model.DB.Model(&model.Prompt{}).Where("status = ? AND eid = ? AND prompt_id IN (?)", model.PromptStatusNormal, eid, promptIDs)

	if keyword != "" {
		db = db.Where("name LIKE ?", "%"+keyword+"%")
	}

	if groupIDStr != "" {
		// 解析多个分组ID
		groupIDStrings := strings.Split(groupIDStr, ",")
		groupIDs := make([]int64, 0, len(groupIDStrings))

		for _, idStr := range groupIDStrings {
			idStr = strings.TrimSpace(idStr)
			if idStr == "" {
				continue
			}

			id, err := strconv.ParseInt(idStr, 10, 64)
			if err != nil {
				continue // 忽略无效的ID
			}

			if id > 0 {
				groupIDs = append(groupIDs, id)
			}
		}

		if len(groupIDs) > 0 {
			// 通过 ResourcePermission 表关联查询
			db = db.Joins("JOIN resource_permissions ON prompts.prompt_id = resource_permissions.resource_id").
				Where("resource_permissions.group_id IN (?) AND resource_permissions.resource_type = ?", groupIDs, model.ResourceTypePrompt).
				Group("prompts.prompt_id") // 确保结果不重复
		}
	}

	var count int64
	db.Count(&count)

	var prompts []*model.Prompt
	if sortDesc {
		db = db.Order("sort DESC, prompt_id DESC")
	} else {
		db = db.Order("created_time DESC")
	}

	err := db.Offset(offset).Limit(limit).Find(&prompts).Error

	return count, prompts, err
}
