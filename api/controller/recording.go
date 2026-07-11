package controller

import (
	"errors"
	"net/http"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/middleware"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type FFmpegHealthResponse struct {
	Available bool   `json:"available"`
	Error     string `json:"error,omitempty"`
}

type RecordingSystemStatusResponse struct {
	FFmpegAvailable bool   `json:"ffmpeg_available"`
	FFmpegError     string `json:"ffmpeg_error,omitempty"`
	MaxTotalSizeMB  int    `json:"max_total_size_mb"`
	SourceFormat    string `json:"source_format"`
	DefaultFormat   string `json:"default_format"`
}

var checkFFmpegCapabilities = service.CheckFFmpegCapabilities

const recordingSourceFormat = "webm"

// GetRecordingSystemStatus godoc
// @Summary 录音系统完整状态
// @Description 返回 FFmpeg 状态及系统限制配置，用于运维诊断（无需登录）
// @Tags 录音
// @Produce json
// @Success 200 {object} model.CommonResponse{data=controller.RecordingSystemStatusResponse}
// @Router /api/recordings/system-status [get]
func GetRecordingSystemStatus(c *gin.Context) {
	ffmpegResult := checkFFmpegCapabilities()
	logger.Infof(nil, "【录音系统状态】FFmpeg 路径: %s, 版本: %s, 可用: %v, AAC: %v, Opus: %v, WebM: %v",
		ffmpegResult.Path, ffmpegResult.Version, ffmpegResult.Available, ffmpegResult.HasAAC, ffmpegResult.HasLibOpus, ffmpegResult.HasWebMDemux)
	if ffmpegResult.Error != "" {
		logger.Errorf(nil, "【录音系统状态】FFmpeg 错误: %s", ffmpegResult.Error)
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(RecordingSystemStatusResponse{
		FFmpegAvailable: ffmpegResult.Available,
		FFmpegError:     ffmpegResult.Error,
		MaxTotalSizeMB:  (3 << 30) / 1024 / 1024,
		SourceFormat:    recordingSourceFormat,
		DefaultFormat:   "m4a",
	}))
}

// GetFFmpegHealth godoc
// @Summary 检查 FFmpeg 健康状态
// @Description 检查 FFmpeg 是否安装及其编解码器支持情况，用于运维监控（无需登录）
// @Tags 录音
// @Produce json
// @Success 200 {object} model.CommonResponse{data=controller.FFmpegHealthResponse}
// @Router /api/recordings/ffmpeg-health [get]
func GetFFmpegHealth(c *gin.Context) {
	c.JSON(http.StatusOK, model.Success.ToResponse(toFFmpegHealthResponse(checkFFmpegCapabilities())))
}

func toFFmpegHealthResponse(result service.FFmpegCheckResult) FFmpegHealthResponse {
	logger.Infof(nil, "【FFmpeg 健康检查】路径: %s, 版本: %s, 可用: %v, AAC: %v, Opus: %v, WebM: %v",
		result.Path, result.Version, result.Available, result.HasAAC, result.HasLibOpus, result.HasWebMDemux)
	if result.Error != "" {
		logger.Errorf(nil, "【FFmpeg 健康检查】错误: %s", result.Error)
	}
	return FFmpegHealthResponse{
		Available: result.Available,
		Error:     result.Error,
	}
}

// GetRecordingConfigForUser godoc
// @Summary 获取录音配置（前台）
// @Description 获取录音功能开关和解析平台选择，供前台判断录音功能是否可用
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=service.RecordingConfigResult}
// @Router /api/recordings/config [get]
func GetRecordingConfigForUser(c *gin.Context) {
	eid := config.GetEID(c)
	svc := service.NewRecordingAdminService(eid)

	result, err := svc.GetRecordingConfig(c)
	if err != nil {
		logger.SysErrorf("【录音配置】前台获取失败: eid=%d err=%v", eid, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(result))
}

type CreateRecordingJobRequest struct {
	LibraryID               int64  `json:"library_id" binding:"required"`
	DestinationFolderFileID int64  `json:"destination_folder_file_id"`
	Title                   string `json:"title"`
	TargetFormat            string `json:"target_format"`
	SourceMimeType          string `json:"source_mime_type"`
	UploadIntervalMs        int64  `json:"upload_interval_ms"`
	MaxDurationMs           int64  `json:"max_duration_ms"`
}

type UpdateRecordingJobStateRequest struct {
	Action string `json:"action" binding:"required"`
}

type UploadRecordingSegmentRequest struct {
	SegmentIndex   *int64 `form:"segment_index" binding:"required"`
	DurationMs     int64  `form:"duration_ms"`
	StartOffsetMs  int64  `form:"start_offset_ms"`
	EndOffsetMs    int64  `form:"end_offset_ms"`
	ClientTime     int64  `form:"client_time"`
	IsFinalSegment bool   `form:"is_final_segment"`
}

type RecordingJobResponse struct {
	Job *model.RecordingJobPublicView `json:"job"`
}

type RecordingSegmentResponse struct {
	Segment *model.RecordingJobSegmentPublicView `json:"segment"`
}

type RecordingSegmentManifestResponse struct {
	Job             *model.RecordingJobPublicView          `json:"job"`
	Segments        []*model.RecordingJobSegmentPublicView `json:"segments"`
	MissingSegments []int64                                `json:"missing_segments"`
	SegmentCount    int                                    `json:"segment_count"`
	MissingCount    int                                    `json:"missing_count"`
}

// CreateRecordingJob godoc
// @Summary 创建录音任务
// @Description 为当前用户创建一个可恢复的录音任务，后续分段上传与 finalize 都围绕该任务进行
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body controller.CreateRecordingJobRequest true "创建录音任务请求"
// @Success 200 {object} model.CommonResponse{data=controller.RecordingJobResponse}
// @Failure 400 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/recordings [post]
func CreateRecordingJob(c *gin.Context) {
	eid := config.GetEID(c)

	recordingConfig, err := model.ValidateOrCreateRecordingConfig(eid)
	if err != nil {
		logger.SysErrorf("【录音】检查配置失败: eid=%d err=%v", eid, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}

	if !recordingConfig.Enabled {
		logger.Infof(c, "【录音】功能已禁用: eid=%d", eid)
		c.JSON(http.StatusForbidden, model.ForbiddenError.ToNewErrorResponse("recording feature is disabled"))
		return
	}

	var req CreateRecordingJobRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	userID := config.GetUserId(c)
	svc := service.NewRecordingService(eid)
	job, err := svc.CreateJob(c.Request.Context(), userID, &service.CreateRecordingJobRequest{
		LibraryID:               req.LibraryID,
		DestinationFolderFileID: req.DestinationFolderFileID,
		Title:                   req.Title,
		TargetFormat:            req.TargetFormat,
		SourceMimeType:          req.SourceMimeType,
		UploadIntervalMs:        req.UploadIntervalMs,
		MaxDurationMs:           req.MaxDurationMs,
	})
	if err != nil {
		logger.SysErrorf("【录音】创建录音任务失败: eid=%d user_id=%d library_id=%d err=%v", eid, userID, req.LibraryID, err)
		respondRecordingError(c, err)
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(RecordingJobResponse{Job: job.PublicView()}))
}

// GetActiveRecordingJob godoc
// @Summary 获取当前活跃录音任务
// @Description 获取当前用户最近的活跃录音任务，用于页面恢复与任务接管
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=controller.RecordingJobResponse}
// @Failure 500 {object} model.CommonResponse
// @Router /api/recordings/active [get]
func GetActiveRecordingJob(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	svc := service.NewRecordingService(eid)
	job, err := svc.GetActiveJob(c.Request.Context(), userID)
	if err != nil {
		logger.SysErrorf("【录音】获取活跃录音任务失败: eid=%d user_id=%d err=%v", eid, userID, err)
		respondRecordingError(c, err)
		return
	}
	if job == nil {
		c.JSON(http.StatusOK, model.Success.ToResponse(RecordingJobResponse{Job: nil}))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(RecordingJobResponse{Job: job.PublicView()}))
}

// GetRecordingJob godoc
// @Summary 获取录音任务详情
// @Description 根据任务ID获取录音任务详情
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param job_id path int true "录音任务ID"
// @Success 200 {object} model.CommonResponse{data=controller.RecordingJobResponse}
// @Failure 404 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/recordings/{job_id} [get]
func GetRecordingJob(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	jobID, ok := parseInt64Param(c, "job_id")
	if !ok {
		return
	}
	svc := service.NewRecordingService(eid)
	job, err := svc.GetJob(c.Request.Context(), userID, jobID)
	if err != nil {
		logger.SysErrorf("【录音】获取录音任务失败: eid=%d user_id=%d job_id=%d err=%v", eid, userID, jobID, err)
		respondRecordingError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(RecordingJobResponse{Job: job.PublicView()}))
}

// UpdateRecordingJobState godoc
// @Summary 更新录音任务状态
// @Description 支持暂停、继续、中断和停止等状态切换
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param job_id path int true "录音任务ID"
// @Param request body controller.UpdateRecordingJobStateRequest true "状态更新请求"
// @Success 200 {object} model.CommonResponse{data=controller.RecordingJobResponse}
// @Failure 400 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/recordings/{job_id}/state [patch]
func UpdateRecordingJobState(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	jobID, ok := parseInt64Param(c, "job_id")
	if !ok {
		return
	}

	var req UpdateRecordingJobStateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	svc := service.NewRecordingService(eid)
	job, err := svc.UpdateJobState(c.Request.Context(), userID, jobID, req.Action)
	if err != nil {
		logger.SysErrorf("【录音】更新录音任务状态失败: eid=%d user_id=%d job_id=%d action=%s err=%v", eid, userID, jobID, req.Action, err)
		respondRecordingError(c, err)
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(RecordingJobResponse{Job: job.PublicView()}))
}

// HeartbeatRecordingJob godoc
// @Summary 更新录音任务心跳
// @Description 用于刷新录音任务的活跃时间，避免长录音状态失联
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param job_id path int true "录音任务ID"
// @Success 200 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/recordings/{job_id}/heartbeat [post]
func HeartbeatRecordingJob(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	jobID, ok := parseInt64Param(c, "job_id")
	if !ok {
		return
	}
	svc := service.NewRecordingService(eid)
	if err := svc.Heartbeat(c.Request.Context(), userID, jobID); err != nil {
		logger.SysErrorf("【录音】录音任务心跳失败: eid=%d user_id=%d job_id=%d err=%v", eid, userID, jobID, err)
		respondRecordingError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{"ok": true}))
}

// UploadRecordingSegment godoc
// @Summary 上传录音分段
// @Description 将前端采集到的音频分段写入对象存储并登记到录音任务中
// @Tags 录音
// @Accept multipart/form-data
// @Produce json
// @Security BearerAuth
// @Param job_id path int true "录音任务ID"
// @Param segment formData file true "录音分段文件"
// @Param segment_index formData int true "分段序号"
// @Param duration_ms formData int false "分段时长"
// @Param start_offset_ms formData int false "起始偏移毫秒"
// @Param end_offset_ms formData int false "结束偏移毫秒"
// @Param client_time formData int false "前端时间戳"
// @Success 200 {object} model.CommonResponse{data=controller.RecordingSegmentResponse}
// @Failure 400 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/recordings/{job_id}/segments [post]
func UploadRecordingSegment(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	jobID, ok := parseInt64Param(c, "job_id")
	if !ok {
		return
	}

	var req UploadRecordingSegmentRequest
	if err := c.ShouldBind(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	if req.SegmentIndex == nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse("segment_index is required"))
		return
	}
	fileHeader, err := c.FormFile("segment")
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	svc := service.NewRecordingService(eid)
	segment, err := svc.UploadSegment(c.Request.Context(), userID, jobID, &service.UploadRecordingSegmentRequest{
		SegmentIndex:   *req.SegmentIndex,
		DurationMs:     req.DurationMs,
		StartOffsetMs:  req.StartOffsetMs,
		EndOffsetMs:    req.EndOffsetMs,
		MimeType:       fileHeader.Header.Get("Content-Type"),
		ClientTime:     req.ClientTime,
		IsFinalSegment: req.IsFinalSegment,
		FileHeader:     fileHeader,
	})
	if err != nil {
		logger.SysErrorf("【录音】上传录音分段失败: eid=%d user_id=%d job_id=%d segment_index=%d err=%v", eid, userID, jobID, *req.SegmentIndex, err)
		if errors.Is(err, service.ErrRecordingAssemblyDuplicateSegmentConflict) {
			c.JSON(http.StatusConflict, model.OperateTooFast.ToResponse(err))
			return
		}
		respondRecordingError(c, err)
		return
	}

	var responseSegment *model.RecordingJobSegmentPublicView
	if segment != nil {
		responseSegment = segment.PublicView()
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(RecordingSegmentResponse{Segment: responseSegment}))
}

// GetRecordingSegmentManifest godoc
// @Summary 获取录音分片清单
// @Description 查询录音任务已接收的分片清单及缺失片段信息，用于排查录音异常和恢复任务
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param job_id path int true "录音任务ID"
// @Success 200 {object} model.CommonResponse{data=controller.RecordingSegmentManifestResponse}
// @Failure 400 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/recordings/{job_id}/segments [get]
func GetRecordingSegmentManifest(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	jobID, ok := parseInt64Param(c, "job_id")
	if !ok {
		return
	}

	svc := service.NewRecordingService(eid)
	manifest, err := svc.GetSegmentManifest(c.Request.Context(), userID, jobID)
	if err != nil {
		logger.SysErrorf("【录音】获取录音分片清单失败: eid=%d user_id=%d job_id=%d err=%v", eid, userID, jobID, err)
		respondRecordingError(c, err)
		return
	}
	segmentViews := make([]*model.RecordingJobSegmentPublicView, 0, len(manifest.Segments))
	for i := range manifest.Segments {
		segmentViews = append(segmentViews, manifest.Segments[i].PublicView())
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(RecordingSegmentManifestResponse{
		Job:             manifest.Job.PublicView(),
		Segments:        segmentViews,
		MissingSegments: manifest.MissingSegments,
		SegmentCount:    len(segmentViews),
		MissingCount:    len(manifest.MissingSegments),
	}))
}

// GetRecordingMissingSegments godoc
// @Summary 获取录音任务缺失分段
// @Description 查询当前录音任务缺失的分段索引，用于恢复与 finalize 前校验
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param job_id path int true "录音任务ID"
// @Success 200 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/recordings/{job_id}/segments/missing [get]
func GetRecordingMissingSegments(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	jobID, ok := parseInt64Param(c, "job_id")
	if !ok {
		return
	}
	svc := service.NewRecordingService(eid)
	missing, err := svc.GetMissingSegmentIndices(c.Request.Context(), userID, jobID)
	if err != nil {
		logger.SysErrorf("【录音】获取缺失分段失败: eid=%d user_id=%d job_id=%d err=%v", eid, userID, jobID, err)
		respondRecordingError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{
		"job_id":           jobID,
		"missing_segments": missing,
		"missing_count":    len(missing),
	}))
}

// FinalizeRecordingJob godoc
// @Summary 提交录音结束生成任务
// @Description 提交录音结束生成任务，服务端后台完成分段合成、校验和落库
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param job_id path int true "录音任务ID"
// @Success 200 {object} model.CommonResponse{data=controller.RecordingJobResponse}
// @Failure 400 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/recordings/{job_id}/finalize [post]
func FinalizeRecordingJob(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	jobID, ok := parseInt64Param(c, "job_id")
	if !ok {
		return
	}
	svc := service.NewRecordingService(eid)
	job, err := svc.RequestFinalize(c.Request.Context(), userID, jobID)
	if err != nil {
		logger.SysErrorf("【录音】结束录音任务失败: eid=%d user_id=%d job_id=%d err=%v", eid, userID, jobID, err)
		if errors.Is(err, service.ErrFFmpegNotAvailable) {
			c.JSON(http.StatusServiceUnavailable, model.SystemError.ToErrorResponse(err))
			return
		}
		respondRecordingError(c, err)
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(RecordingJobResponse{Job: job.PublicView()}))
}

func parseInt64Param(c *gin.Context, key string) (int64, bool) {
	if decoded, ok := middleware.GetDecodedID(c, key); ok {
		return decoded, true
	}

	value, err := hashids.TryParseID(c.Param(key))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return 0, false
	}
	return value, true
}

func respondRecordingError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound), errors.Is(err, service.ErrRecordingJobNotFound):
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
	case errors.Is(err, service.ErrRecordingJobForbidden):
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(err))
	case errors.Is(err, service.ErrRecordingJobInvalidAction):
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
	case errors.Is(err, service.ErrRecordingJobAlreadyActive),
		errors.Is(err, service.ErrRecordingJobFinalizeInProgress),
		errors.Is(err, service.ErrRecordingSegmentMissing),
		errors.Is(err, service.ErrRecordingJobStateNotSupported):
		c.JSON(http.StatusConflict, model.OperateTooFast.ToResponse(err))
	default:
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
	}
}
