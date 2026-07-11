package controller

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/gin-gonic/gin"
)

// GetRAGJob 获取RAG任务详情
// @Summary 获取RAG任务详情
// @Description 根据任务ID获取RAG任务的详细信息
// @Tags RAG任务
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param job_id path int true "任务ID"
// @Success 200 {object} model.CommonResponse{data=model.RagJob} "获取成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "任务不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/rag/jobs/{job_id} [get]
func GetRAGJob(c *gin.Context) {
	// 获取任务ID
	jobIdStr := c.Param("job_id")
	jobId, err := strconv.ParseInt(jobIdStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("无效的任务ID"))
		return
	}

	// 查询任务
	var job model.RagJob
	if err := model.DB.First(&job, jobId).Error; err != nil {
		if err.Error() == "record not found" {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse("任务不存在"))
			return
		}

		logger.Errorf(c.Request.Context(), "Failed to get RAG job: %v", err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(job))
}

// RAGJobListResponse RAG任务列表响应
type RAGJobListResponse struct {
	Jobs      []model.RagJob `json:"jobs"`
	Total     int64          `json:"total"`
	Page      int            `json:"page"`
	PageSize  int            `json:"page_size"`
	TotalPage int64          `json:"total_page"`
}

// ListRAGJobs 获取RAG任务列表
// @Summary 获取RAG任务列表
// @Description 获取RAG任务列表，支持分页和筛选
// @Tags RAG任务
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param page query int false "页码" default(1)
// @Param page_size query int false "每页数量" default(10)
// @Param status query string false "任务状态"
// @Param type query string false "任务类型，多个类型用逗号分隔"
// @Param related_id query int false "关联ID"
// @Param start_time query int64 false "开始时间（毫秒时间戳），默认24小时前"
// @Param end_time query int64 false "结束时间（毫秒时间戳），默认当前时间+10分钟"
// @Success 200 {object} model.CommonResponse{data=RAGJobListResponse} "获取成功"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/rag/jobs [get]
func ListRAGJobs(c *gin.Context) {
	// 解析查询参数
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "10"))
	status := c.Query("status")
	jobType := c.Query("type")
	relatedIdStr := c.Query("related_id")
	startTimeStr := c.Query("start_time")
	endTimeStr := c.Query("end_time")

	// 获取企业ID（与其他控制器保持一致）
	eid := config.GetEID(c)

	// 构建查询
	db := model.DB.Model(&model.RagJob{})

	if eid > 0 {
		db = db.Where("eid = ?", eid)
	}

	if status != "" {
		db = db.Where("status = ?", status)
	}

	if jobType != "" {
		// 支持多个类型，用逗号分隔
		jobTypes := strings.Split(jobType, ",")
		// 去除每个类型的空格
		for i, t := range jobTypes {
			jobTypes[i] = strings.TrimSpace(t)
		}
		db = db.Where("type IN ?", jobTypes)
	}

	if relatedIdStr != "" {
		relatedId, err := strconv.ParseInt(relatedIdStr, 10, 64)
		if err == nil {
			db = db.Where("related_id = ?", relatedId)
		}
	}

	// 时间筛选逻辑
	now := time.Now().UnixMilli()
	var startTime, endTime int64

	if startTimeStr != "" {
		startTime, _ = strconv.ParseInt(startTimeStr, 10, 64)
	} else {
		// 默认 24 小时前
		startTime = now - 24*60*60*1000
	}

	if endTimeStr != "" {
		endTime, _ = strconv.ParseInt(endTimeStr, 10, 64)
	} else {
		// 默认当前时间往右偏移 10 分钟
		endTime = now + 10*60*1000
	}

	if startTime > 0 {
		db = db.Where("created_time >= ?", startTime)
	}
	if endTime > 0 {
		db = db.Where("created_time <= ?", endTime)
	}

	// 计算总数
	var total int64
	if err := db.Count(&total).Error; err != nil {
		logger.Errorf(c.Request.Context(), "Failed to count RAG jobs: %v", err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 查询数据
	var jobs []model.RagJob
	offset := (page - 1) * pageSize
	if err := db.Offset(offset).Limit(pageSize).Order("created_time DESC").Find(&jobs).Error; err != nil {
		logger.Errorf(c.Request.Context(), "Failed to list RAG jobs: %v", err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 构建响应
	response := RAGJobListResponse{
		Jobs:      jobs,
		Total:     total,
		Page:      page,
		PageSize:  pageSize,
		TotalPage: (total + int64(pageSize) - 1) / int64(pageSize),
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// CancelRAGJob 取消RAG任务
// @Summary 取消RAG任务
// @Description 取消一个状态为pending的RAG任务
// @Tags RAG任务
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param job_id path int true "任务ID"
// @Success 200 {object} model.CommonResponse{data=model.RagJob} "取消成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "任务不存在"
// @Failure 409 {object} model.CommonResponse "任务状态不允许取消"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/rag/jobs/{job_id}/cancel [put]
func CancelRAGJob(c *gin.Context) {
	// 获取任务ID
	jobIdStr := c.Param("job_id")
	jobId, err := strconv.ParseInt(jobIdStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("无效的任务ID"))
		return
	}

	// 查询任务
	var job model.RagJob
	if err := model.DB.First(&job, jobId).Error; err != nil {
		if err.Error() == "record not found" {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse("任务不存在"))
			return
		}

		logger.Errorf(c.Request.Context(), "Failed to get RAG job: %v", err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 检查任务状态是否允许取消
	if job.Status != model.RagJobStatusPending {
		c.JSON(http.StatusConflict, model.ParamError.ToResponse("只有状态为pending的任务可以取消"))
		return
	}

	// 更新任务状态为已取消
	if err := model.DB.Model(&job).Update("status", model.RagJobStatusCancelled).Error; err != nil {
		logger.Errorf(c.Request.Context(), "Failed to cancel RAG job: %v", err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 从队列中移除任务（如果Redis可用）
	if common.RDB != nil {
		// 从对应jobtype的队列中移除任务
		queueName := fmt.Sprintf("rag:job:queue:%s", job.Type)
		// 获取队列中的所有任务
		jobs, err := common.RDB.LRange(c.Request.Context(), queueName, 0, -1).Result()
		if err != nil {
			logger.Warnf(c.Request.Context(), "Failed to get job queue %s: %v", queueName, err)
		} else {
			// 查找并移除任务
			for _, jobData := range jobs {
				var wrapper model.JobWrapper
				if err := json.Unmarshal([]byte(jobData), &wrapper); err != nil {
					continue
				}

				if wrapper.JobID == jobId {
					common.RDB.LRem(c.Request.Context(), queueName, 1, jobData)
					break
				}
			}
		}
	}

	// 重新获取任务信息
	if err := model.DB.First(&job, jobId).Error; err != nil {
		logger.Errorf(c.Request.Context(), "Failed to refresh RAG job: %v", err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	// 更新相关文件的状态
	type OriginStatusStruct struct {
		OriginStatus string `json:"origin_status"` // 原始状态，用于取消后还原状态
	}
	var originStatus OriginStatusStruct
	if job.StartParameters != "" {
		if err := json.Unmarshal([]byte(job.StartParameters), &originStatus); err != nil {
			logger.Errorf(c.Request.Context(), "Failed to unmarshal parameters: %v", err)
			c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
			return
		}
	}

	// 取消还原相关文件状态
	if job.Type == "document_conversion" {
		model.UpdateFileConversionStatus(job.RelatedId, originStatus.OriginStatus)
	} else if job.Type == "ai_generate_index" {
		model.UpdateFileAIGenerateChunkStatus(job.RelatedId, originStatus.OriginStatus)
	} else if job.Type == "reindex" || job.Type == "rechunk_and_reindex" || job.Type == "auto_chunking" {
		model.UpdateFileParsingStatus(job.RelatedId, originStatus.OriginStatus)
	}
	// 这里需要更新文档的状态
	c.JSON(http.StatusOK, model.Success.ToResponse(job))
}
