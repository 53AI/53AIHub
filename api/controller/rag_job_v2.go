package controller

import (
	"bytes"
	"encoding/json"
	"errors"
	"math"
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
	Config   json.RawMessage `json:"config" binding:"-" swaggertype:"string"`
	Continue bool            `json:"continue" enums:"true,false" description:"是否继续执行后续步骤：true-执行完当前步骤后自动触发下一步；false-仅执行当前步骤（默认）"`
}

type BatchRetryRagJobStepItemV2 struct {
	JobID     int64           `json:"job_id" description:"任务ID"`
	StepKey   string          `json:"step_key" description:"步骤 Key（首次运行/无 job_id 场景）"`
	StepIndex *int            `json:"step_index" description:"步骤序号（首次运行/无 job_id 场景）"`
	RunMode   string          `json:"run_mode" description:"运行模式：auto/manual/skip（仅首次运行场景有效）"`
	Config    json.RawMessage `json:"config" swaggertype:"string" description:"可选，新的步骤配置 JSON"`
}

type BatchRunContextV2 struct {
	// RelatedID 为文件 ID；HashID 与原始正整数均可。
	RelatedID json.RawMessage `json:"related_id" swaggertype:"string"`
	// StrategyID 指定图谱路由策略；HashID 与原始正整数均可。
	StrategyID json.RawMessage `json:"strategy_id,omitempty" swaggertype:"string"`
	// PipelineID 指定图谱管线；HashID 与原始正整数均可。
	PipelineID json.RawMessage `json:"pipeline_id,omitempty" swaggertype:"string"`
	// PipelineKind 为 graph 时启动独立图谱管线；省略时保持 RAG 行为。
	PipelineKind string `json:"pipeline_kind,omitempty"`
	// SourceJobID 可选引用同一文件的旧 graph_generation job，仅用于审计。
	SourceJobID json.RawMessage `json:"source_job_id,omitempty" swaggertype:"string"`
	RunID       string          `json:"run_id,omitempty"`
	// StartParameters 为 RAG run 模式的启动参数；图谱 run 不接受客户端覆盖。
	StartParameters json.RawMessage `json:"start_parameters,omitempty" swaggertype:"string"`
}

type BatchRetryRagJobStepRequestV2 struct {
	Run  *BatchRunContextV2           `json:"run,omitempty"`
	Jobs []BatchRetryRagJobStepItemV2 `json:"jobs" binding:"required" description:"批量操作的 RAG 或图谱任务步骤"`
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
	RelatedID        int64                           `json:"related_id"`
	RunID            string                          `json:"run_id"`
	Jobs             []RagJobWithStepsV2             `json:"jobs"`
	LegacyGraphJob   *service.GraphRelatedJobSummary `json:"legacy_graph_job,omitempty"`
	GraphPipelineJob *service.GraphRelatedJobSummary `json:"graph_pipeline_job,omitempty"`
}

// @Summary 通过 related_id 获取最近一次任务批次
// @Description 通过 related_id 查询最后一次相同 run_id 的 RAG 批次，包含 rag_job_steps 数据；旧图谱 job 和独立图谱管线 job 作为单独摘要返回
// @Tags RAG任务V2
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param related_id query string true "关联ID(文件HashID或原始正整数)"
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
	relatedID, err := hashids.TryParseID(relatedIdStr)
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
	legacyGraphJob, graphPipelineJob, err := service.GetRelatedGraphJobSummaries(c.Request.Context(), eid, relatedID)
	if err != nil {
		logger.Errorf(c.Request.Context(), "【图谱任务】系统查询文件%d关联的图谱任务：失败（%v）", relatedID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}

	resp := RagJobBatchByRelatedResponseV2{
		RelatedID:        relatedID,
		RunID:            runID,
		Jobs:             respJobs,
		LegacyGraphJob:   legacyGraphJob,
		GraphPipelineJob: graphPipelineJob,
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
// @Description 批量修改参数并按请求顺序发送重试指令；run.pipeline_kind=graph 时创建独立图谱管线运行并生成新的 run_id
// @Tags RAG任务V2
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param body body BatchRetryRagJobStepRequestV2 true "批量重试请求参数"
// @Success 200 {object} model.CommonResponse "操作成功"
// @Failure 400 {object} model.CommonResponse "参数错误"
// @Failure 409 {object} model.CommonResponse "该文件已有图谱任务运行中"
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
		var err error
		if len(req.Run.RelatedID) > 0 && string(req.Run.RelatedID) != "null" {
			relatedID, _ = parseBatchRunID(req.Run.RelatedID)
		}
		if relatedID <= 0 {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("无效的 run.related_id"))
			return
		}

		var pipelineID int64
		if len(req.Run.PipelineID) > 0 && string(req.Run.PipelineID) != "null" {
			pipelineID, err = parseBatchRunID(req.Run.PipelineID)
			if err != nil {
				c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("无效的 run.pipeline_id"))
				return
			}
		}

		var strategyID int64
		if len(req.Run.StrategyID) > 0 && string(req.Run.StrategyID) != "null" {
			strategyID, err = parseBatchRunID(req.Run.StrategyID)
			if err != nil {
				c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("无效的 run.strategy_id"))
				return
			}
		}
		var sourceJobID int64
		if len(req.Run.SourceJobID) > 0 && string(req.Run.SourceJobID) != "null" {
			sourceJobID, err = parseBatchRunID(req.Run.SourceJobID)
			if err != nil {
				c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("无效的 run.source_job_id"))
				return
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
			PipelineKind:    req.Run.PipelineKind,
			SourceJobID:     sourceJobID,
			RunID:           req.Run.RunID,
			StartParameters: req.Run.StartParameters,
		}, steps)
		if err != nil {
			logger.Errorf(c.Request.Context(), "Failed to batch run job steps: %v", err)
			if errors.Is(err, service.ErrInvalidBatchRunRequest) || errors.Is(err, service.ErrInvalidGraphPipelineStart) {
				c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
				return
			}
			if errors.Is(err, service.ErrGraphPipelineAlreadyRunning) {
				c.JSON(http.StatusConflict, model.ParamError.ToResponse(err))
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

func parseBatchRunID(value interface{}) (int64, error) {
	switch id := value.(type) {
	case json.RawMessage:
		decoder := json.NewDecoder(bytes.NewReader(id))
		decoder.UseNumber()
		var decoded interface{}
		if err := decoder.Decode(&decoded); err != nil {
			return 0, err
		}
		return parseBatchRunID(decoded)
	case json.Number:
		parsed, err := strconv.ParseInt(string(id), 10, 64)
		if err != nil || parsed <= 0 {
			return 0, errors.New("invalid id")
		}
		return parsed, nil
	case string:
		return hashids.TryParseID(id)
	case float64:
		if id <= 0 || id != math.Trunc(id) || id >= float64(math.MaxInt64) {
			return 0, errors.New("invalid id")
		}
		return int64(id), nil
	case int:
		if id <= 0 {
			return 0, errors.New("invalid id")
		}
		return int64(id), nil
	case int64:
		if id <= 0 {
			return 0, errors.New("invalid id")
		}
		return id, nil
	default:
		return 0, errors.New("invalid id")
	}
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
