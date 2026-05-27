package controller

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// RetryRagJobStepRequestV2 重试RAG任务步骤请求参数 (V2)
type RetryRagJobStepRequestV2 struct {
	Config   json.RawMessage `json:"config" binding:"-"`
	Continue bool            `json:"continue" enums:"true,false" description:"是否继续执行后续步骤：true-执行完当前步骤后自动触发下一步；false-仅执行当前步骤（默认）"`
}

type BatchRetryRagJobStepItemV2 struct {
	JobID     int64           `json:"job_id" binding:"-" description:"任务ID"`
	StepKey   string          `json:"step_key" binding:"-" description:"步骤 Key（首次运行/无 job_id 场景）"`
	StepIndex *int            `json:"step_index" binding:"-" description:"步骤序号（首次运行/无 job_id 场景）"`
	RunMode   string          `json:"run_mode" binding:"-" description:"运行模式：auto/manual/skip（仅首次运行场景有效）"`
	Config    json.RawMessage `json:"config" binding:"-" description:"可选，新的步骤配置 JSON"`
}

type BatchRunContextV2 struct {
	RelatedID       interface{}     `json:"related_id" binding:"-" description:"关联ID（文件ID），支持数字或 HashID"`
	StrategyID      interface{}     `json:"strategy_id" binding:"-" description:"可选，指定策略ID，支持数字或 HashID"`
	PipelineID      interface{}     `json:"pipeline_id" binding:"-" description:"可选，指定流水线ID，支持数字或 HashID"`
	RunID           string          `json:"run_id" binding:"-" description:"可选，指定 run_id"`
	StartParameters json.RawMessage `json:"start_parameters" binding:"-" description:"可选，启动参数 JSON"`
}

type BatchRetryRagJobStepRequestV2 struct {
	Run  *BatchRunContextV2           `json:"run" binding:"-"`
	Jobs []BatchRetryRagJobStepItemV2 `json:"jobs" binding:"required"`
}

type BatchRetryRagJobStepResponseV2 struct {
	Mode  string  `json:"mode"`
	RunID string  `json:"run_id,omitempty"`
	Jobs  []int64 `json:"jobs,omitempty"`
}

type RagJobWithStepsV2 struct {
	model.RagJob
	Steps []model.RagJobStep `json:"steps"`
}

type RagJobBatchByRelatedResponseV2 struct {
	RelatedID int64               `json:"related_id"`
	RunID     string              `json:"run_id"`
	Jobs      []RagJobWithStepsV2 `json:"jobs"`
}

// @Summary 通过 related_id 获取最近一次任务批次
// @Description 通过 related_id 查询最后一次相同 run_id 的一批次任务列表，包含 rag_job_steps 数据
// @Tags RAG任务V2
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param related_id query int true "关联ID(文件ID)"
// @Success 200 {object} model.CommonResponse{data=RagJobBatchByRelatedResponseV2} "获取成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/rag/v2/jobs/by-related [get]
func GetRagJobsByRelatedIDV2(c *gin.Context) {
	relatedIdStr := c.Query("related_id")
	if relatedIdStr == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("缺少 related_id"))
		return
	}
	relatedID, err := strconv.ParseInt(relatedIdStr, 10, 64)
	if err != nil || relatedID <= 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("无效的 related_id"))
		return
	}

	eid := config.GetEID(c)
	runID, jobs, stepMap, err := service.GetLatestRunJobsWithStepsByRelatedID(c.Request.Context(), eid, relatedID)
	if err != nil {
		logger.Errorf(c.Request.Context(), "Failed to get v2 jobs by related id: %v", err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	respJobs := make([]RagJobWithStepsV2, 0, len(jobs))
	for _, job := range jobs {
		respJobs = append(respJobs, RagJobWithStepsV2{
			RagJob: job,
			Steps:  stepMap[job.JobID],
		})
	}

	resp := RagJobBatchByRelatedResponseV2{
		RelatedID: relatedID,
		RunID:     runID,
		Jobs:      respJobs,
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(resp))
}

// RetryRagJobStepV2 重试 RAG 任务步骤 (V2)
// @Summary 重试 RAG 任务步骤
// @Description 重试指定的 RAG 任务步骤，支持修改配置，支持仅执行当前步骤或继续执行后续步骤
// @Tags RAG任务V2
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param job_id path int true "任务ID"
// @Param body body RetryRagJobStepRequestV2 false "配置参数"
// @Success 200 {object} model.CommonResponse "操作成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "任务不存在"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/rag/v2/jobs/{job_id}/retry [post]
func RetryRagJobStepV2(c *gin.Context) {
	jobIdStr := c.Param("job_id")
	jobId, err := strconv.ParseInt(jobIdStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("无效的任务ID"))
		return
	}

	var req RetryRagJobStepRequestV2
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("参数格式错误"))
		return
	}

	if err := service.RetryJobStepV2WithOptions(c.Request.Context(), jobId, req.Config, service.RetryJobStepOptionsV2{
		Continue: req.Continue,
	}); err != nil {
		logger.Errorf(c.Request.Context(), "Failed to retry job step: %v", err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse("重试指令已发送"))
}

// BatchRetryRagJobStepV2 批量重试 RAG 任务步骤 (V2)
// @Summary 批量重试 RAG 任务步骤
// @Description 批量修改参数并按请求顺序发送重试指令，仅执行传入的步骤
// @Tags RAG任务V2
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body BatchRetryRagJobStepRequestV2 true "批量重试请求参数"
// @Success 200 {object} model.CommonResponse "操作成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/rag/v2/jobs/batch-retry [post]
func BatchRetryRagJobStepV2(c *gin.Context) {
	var req BatchRetryRagJobStepRequestV2
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("参数格式错误"))
		return
	}
	if len(req.Jobs) == 0 {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("任务列表不能为空"))
		return
	}

	if req.Run != nil {
		var relatedID int64
		if req.Run.RelatedID != nil {
			switch v := req.Run.RelatedID.(type) {
			case string:
				relatedID, _ = hashids.TryParseID(v)
			case float64:
				relatedID = int64(v)
			case int64:
				relatedID = v
			}
		}
		if relatedID <= 0 {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("无效的 run.related_id"))
			return
		}

		var pipelineID int64
		if req.Run.PipelineID != nil {
			switch v := req.Run.PipelineID.(type) {
			case string:
				pipelineID, _ = hashids.TryParseID(v)
			case float64:
				pipelineID = int64(v)
			case int64:
				pipelineID = v
			}
		}

		var strategyID int64
		if req.Run.StrategyID != nil {
			switch v := req.Run.StrategyID.(type) {
			case string:
				strategyID, _ = hashids.TryParseID(v)
			case float64:
				strategyID = int64(v)
			case int64:
				strategyID = v
			}
		}

		steps := make([]service.BatchRunJobStepItemV2, 0, len(req.Jobs))
		for _, job := range req.Jobs {
			steps = append(steps, service.BatchRunJobStepItemV2{
				StepKey:   job.StepKey,
				StepIndex: job.StepIndex,
				RunMode:   job.RunMode,
				Config:    job.Config,
			})
		}

		eid := config.GetEID(c)
		runID, jobIDs, err := service.BatchRunJobStepsV2(c.Request.Context(), eid, service.BatchRunContextV2{
			RelatedID:       relatedID,
			StrategyID:      strategyID,
			PipelineID:      pipelineID,
			RunID:           req.Run.RunID,
			StartParameters: req.Run.StartParameters,
		}, steps)
		if err != nil {
			logger.Errorf(c.Request.Context(), "Failed to batch run job steps: %v", err)
			if errors.Is(err, service.ErrInvalidBatchRunRequest) {
				c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
				return
			}
			c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
			return
		}

		c.JSON(http.StatusOK, model.Success.ToResponse(BatchRetryRagJobStepResponseV2{
			Mode:  "run",
			RunID: runID,
			Jobs:  jobIDs,
		}))
		return
	}

	items := make([]service.BatchRetryJobStepItemV2, 0, len(req.Jobs))
	for _, job := range req.Jobs {
		if job.JobID <= 0 {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("job_id 不能为空"))
			return
		}
		items = append(items, service.BatchRetryJobStepItemV2{
			JobID:  job.JobID,
			Config: job.Config,
		})
	}

	if err := service.BatchRetryJobStepsV2(c.Request.Context(), items); err != nil {
		logger.Errorf(c.Request.Context(), "Failed to batch retry job steps: %v", err)
		if errors.Is(err, service.ErrInvalidBatchRetryRequest) {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
			return
		}
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse("批量重试指令已发送"))
}

// CancelRagJobV2 取消 RAG 任务 (V2)
// @Summary 取消 RAG 任务 (V2)
// @Description 取消一个处于排队中的 RAG 任务，支持 RunID 内批量取消
// @Tags RAG任务V2
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param job_id path int true "任务ID"
// @Success 200 {object} model.CommonResponse{data=[]model.RagJob} "取消成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 404 {object} model.CommonResponse "任务不存在"
// @Failure 409 {object} model.CommonResponse "任务状态不允许取消"
// @Failure 500 {object} model.CommonResponse "服务器内部错误"
// @Router /api/rag/v2/jobs/{job_id}/cancel [put]
func CancelRagJobV2(c *gin.Context) {
	jobIdStr := c.Param("job_id")
	jobId, err := strconv.ParseInt(jobIdStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("无效的任务ID"))
		return
	}

	jobs, err := service.CancelRagJobV2(c.Request.Context(), jobId)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse("任务不存在"))
			return
		}
		if errors.Is(err, service.ErrJobProcessing) {
			c.JSON(http.StatusConflict, model.ParamError.ToResponse("任务进行中不可取消"))
			return
		}
		if errors.Is(err, service.ErrJobNotCancelable) {
			c.JSON(http.StatusConflict, model.ParamError.ToResponse("任务状态不允许取消"))
			return
		}
		logger.Errorf(c.Request.Context(), "Failed to cancel v2 job: %v", err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(jobs))
}
