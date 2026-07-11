package controller

import (
	"encoding/json"
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

// ListUserRecentUsed
// @Summary 获取最近使用列表
// @Description 获取当前用户的最近使用记录（空间/知识库/文件），按更新时间降序，已删除资源自动过滤
// @Tags 最近使用
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=[]service.UserRecentUsedItem} "成功"
// @Failure 500 {object} model.CommonResponse "系统错误"
// @Router /api/recent-used [get]
func ListUserRecentUsed(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	items, err := service.ListUserRecentUsed(eid, userID)
	if err != nil {
		logger.Errorf(c.Request.Context(), "获取最近使用记录失败: %v", err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToNewErrorResponse("获取最近使用记录失败"))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(items))
}

// SaveUserRecentUsed
// @Summary 保存最近使用记录
// @Description 保存用户对空间/知识库/文件的使用记录（upsert），每类型最多保留20条。支持单条对象或数组批量。
// @Tags 最近使用
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body service.RecentUsedSaveItem true "单条: {\"resource_type\":0,\"resource_id\":474} 或批量: [{\"resource_type\":0,\"resource_id\":474},...]"
// @Success 200 {object} model.CommonResponse "成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "系统错误"
// @Router /api/recent-used [post]
func SaveUserRecentUsed(c *gin.Context) {
	body, err := c.GetRawData()
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("无法读取请求体"))
		return
	}

	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	// 判断是数组（批量）还是对象（单条）
	trimmed := strings.TrimSpace(string(body))
	if strings.HasPrefix(trimmed, "[") {
		var records []service.RecentUsedSaveItem
		if err := json.Unmarshal(body, &records); err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("参数格式错误: "+err.Error()))
			return
		}
		if len(records) == 0 {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("批量记录不能为空"))
			return
		}
		for _, r := range records {
			if r.ResourceType == nil || *r.ResourceType < model.RESOURCE_TYPE_SPACE || *r.ResourceType > model.RESOURCE_TYPE_FILE {
				c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("资源类型无效"))
				return
			}
			if r.ResourceID <= 0 {
				c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("资源ID无效"))
				return
			}
		}
		if err := service.BatchSaveUserRecentUsed(eid, userID, records); err != nil {
			logger.Errorf(c.Request.Context(), "批量保存最近使用记录失败: %v", err)
			c.JSON(http.StatusInternalServerError, model.SystemError.ToNewErrorResponse("保存失败"))
			return
		}
	} else {
		var req service.RecentUsedSaveItem
		if err := json.Unmarshal(body, &req); err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("参数错误: "+err.Error()))
			return
		}
		if req.ResourceType == nil || *req.ResourceType < model.RESOURCE_TYPE_SPACE || *req.ResourceType > model.RESOURCE_TYPE_FILE {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("资源类型无效"))
			return
		}
		if err := service.SaveUserRecentUsed(eid, userID, *req.ResourceType, req.ResourceID); err != nil {
			logger.Errorf(c.Request.Context(), "保存最近使用记录失败: %v", err)
			c.JSON(http.StatusInternalServerError, model.SystemError.ToNewErrorResponse("保存失败"))
			return
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// BatchDeleteUserRecentUsed
// @Summary 批量删除最近使用记录
// @Description 传 ids 参数则按 ID 删除，不传则删除用户所有最近使用记录
// @Tags 最近使用
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param ids query string false "要删除的ID列表，逗号分隔（不传则删除全部）"
// @Success 200 {object} model.CommonResponse "成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "系统错误"
// @Router /api/recent-used [delete]
func BatchDeleteUserRecentUsed(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	idsStr := c.Query("ids")
	var ids []int64
	if idsStr != "" {
		parts := strings.Split(idsStr, ",")
		for _, p := range parts {
			p = strings.TrimSpace(p)
			if p == "" {
				continue
			}
			// 尝试 hashID 解码
			if id, err := hashids.Decode(p); err == nil {
				ids = append(ids, id)
				continue
			}
			// 尝试原始 int64
			if id, err := strconv.ParseInt(p, 10, 64); err == nil {
				ids = append(ids, id)
				continue
			}
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("无效的ID格式: "+p))
			return
		}
	}

	if err := service.BatchDeleteUserRecentUsed(eid, userID, ids); err != nil {
		logger.Errorf(c.Request.Context(), "删除最近使用记录失败: %v", err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToNewErrorResponse("删除失败"))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}
