//go:build saas

package controller

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/saas/saas_dingtalk"
	"github.com/53AI/53AIHub/saas/saas_wecom"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
)

// @Summary Sync organization structure
// @Description Synchronize enterprise organization structure based on source
// @Tags Department
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param from path int true "Source identifier (1=WeCom, 2=DingTalk)"
// @Param body body service.SyncOrganizationParams true "Sync parameters"
// @Success 200 {object} model.CommonResponse "Operation succeeded"
// @Failure 400 {object} model.CommonResponse "Parameter error"
// @Failure 500 {object} model.CommonResponse "Server error"
// @Router /api/departments/sync/{from} [post]
func SyncOrganization(c *gin.Context) {
	fromStr := c.Param("from")
	from, err := strconv.Atoi(fromStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	eid := config.GetEID(c)
	enterprise, err := model.GetEnterpriseByID(eid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.DBError.ToResponse(err))
		return
	}

	var params service.SyncOrganizationParams
	if err = c.ShouldBindJSON(&params); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	lockKey := fmt.Sprintf("%s:%s:%d", model.LockOrganizationKeyPre, fromStr, enterprise.Eid)
	isLock := common.LOCKER.TryLock(lockKey, 60*5*time.Second)
	if !isLock {
		c.JSON(http.StatusNotFound, model.OperateTooFast.ToResponse(nil))
		return
	}

	switch from {
	case model.DepartmentFromWecom:
		go func() {
			err := service.WeComRunSyncOrganization(enterprise, params)
			if err != nil {
				logger.SysErrorf("sync organization from wecom failed: %v", err)
			}
		}()
	case model.DepartmentFromDingtalk:
		go func() {
			params.SuiteID = config.GetDingtalkSuiteID()
			err := service.DingtalkRunSyncOrganization(enterprise, params)
			if err != nil {
				// 当同步失败时，删除锁
				common.LOCKER.Unlock(lockKey)
				logger.SysErrorf("sync organization from dingtalk failed: %v", err)
			}
		}()
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(nil))
}

// GetSyncProgress 获取同步进度
// @Summary Get sync progress
// @Description Get synchronization progress
// @Tags Synchronization
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param from path int true "Source: 1=WeCom, 2=DingTalk"
// @Success 200 {object} model.CommonResponse{data=interface{}} "Operation succeeded"
// @Failure 400 {object} model.CommonResponse "Parameter error"
// @Failure 404 {object} model.CommonResponse "Enterprise not found"
// @Router /api/sync-progress/{from} [get]
func GetSyncProgress(c *gin.Context) {
	fromStr := c.Param("from")
	from, err := strconv.Atoi(fromStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 验证 from 参数
	if from != model.DepartmentFromWecom && from != model.DepartmentFromDingtalk {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("invalid from parameter: %d", from)))
		return
	}

	var eid = config.GetEID(c)

	var progress interface{}

	switch from {
	case model.DepartmentFromWecom:
		wecomProgressManager := saas_wecom.GetWecomSyncProgressManager()
		progress = wecomProgressManager.GetProgress(from, eid)
	case model.DepartmentFromDingtalk:
		dingtalkProgressManager := saas_dingtalk.GetDingtalkSyncProgressManager()
		progress = dingtalkProgressManager.GetProgress(from, eid)
	default:
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("unsupported from parameter: %d", from)))
		return
	}

	// 检查指针类型的nil值
	if progress == nil || (progress.(*saas_wecom.SyncProgress)) == nil {
		// 默认返回同步失败状态
		defaultProgress := &saas_wecom.SyncProgress{
			From:      from,
			Eid:       eid,
			Progress:  0,
			Status:    "failed",
			Message:   "未找到同步进度记录",
			StartTime: time.Now(),
			EndTime:   time.Now(),
		}
		c.JSON(http.StatusOK, model.Success.ToResponse(defaultProgress))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(progress))
}

// GetAllSyncProgress 获取所有同步进度
// @Summary Get all sync progress
// @Description Get all synchronization progress
// @Tags SyncProgress
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=map[string]interface{}} "Operation succeeded"
// // @Router /api/sync-progress [get]
func GetAllSyncProgress(c *gin.Context) {
	wecomProgressManager := saas_wecom.GetWecomSyncProgressManager()
	wecomProgress := wecomProgressManager.GetAllProgress()

	dingtalkProgressManager := saas_dingtalk.GetDingtalkSyncProgressManager()
	dingtalkProgress := dingtalkProgressManager.GetAllProgress()

	// 合并两个进度管理器的数据
	allProgress := make(map[string]interface{})
	for key, progress := range wecomProgress {
		allProgress[key] = progress
	}
	for key, progress := range dingtalkProgress {
		allProgress[key] = progress
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(allProgress))
}

// GetSyncProgressByFrom 根据来源获取同步进度
// @Summary Get sync progress by source
// @Description Get synchronization progress by source type
// @Tags SyncProgress
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param from path int true "Source identifier (1=WeCom, 2=DingTalk)"
// @Success 200 {object} model.CommonResponse{data=map[int64]interface{}} "Operation succeeded"
// @Failure 400 {object} model.CommonResponse "Parameter error"
// // @Router /api/sync-progress/{from}/all [get]
func GetSyncProgressByFrom(c *gin.Context) {
	fromStr := c.Param("from")
	from, err := strconv.Atoi(fromStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 验证 from 参数
	if from != model.DepartmentFromWecom && from != model.DepartmentFromDingtalk {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("invalid from parameter: %d", from)))
		return
	}

	var progressByFrom map[int64]interface{}

	switch from {
	case model.DepartmentFromWecom:
		wecomProgressManager := saas_wecom.GetWecomSyncProgressManager()
		wecomProgress := wecomProgressManager.GetProgressByFrom(from)
		progressByFrom = make(map[int64]interface{})
		for eid, progress := range wecomProgress {
			progressByFrom[eid] = progress
		}
	case model.DepartmentFromDingtalk:
		dingtalkProgressManager := saas_dingtalk.GetDingtalkSyncProgressManager()
		dingtalkProgress := dingtalkProgressManager.GetProgressByFrom(from)
		progressByFrom = make(map[int64]interface{})
		for eid, progress := range dingtalkProgress {
			progressByFrom[eid] = progress
		}
	default:
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("unsupported from parameter: %d", from)))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(progressByFrom))
}
