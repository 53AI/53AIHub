package controller

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/utils/hashids"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/middleware"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/rag"
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
	GroupID                 *int64 `json:"group_id"`
	InsightPerspective      string `json:"insight_perspective"`
}

type UpdateRecordingJobStateRequest struct {
	Action string `json:"action" binding:"required"`
}

type UpdateFileInsightPerspectiveRequest struct {
	Perspective string `json:"perspective" binding:"required"`
}

type UploadRecordingSegmentRequest struct {
	SegmentIndex   *int64 `form:"segment_index" binding:"required"`
	DurationMs     int64  `form:"duration_ms"`
	StartOffsetMs  int64  `form:"start_offset_ms"`
	EndOffsetMs    int64  `form:"end_offset_ms"`
	ClientTime     int64  `form:"client_time"`
	IsFinalSegment bool   `form:"is_final_segment"`
}

type UserAddFileTemplateRequest struct {
	TemplateID string `json:"template_id" binding:"required"`
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

// GetInsightPerspectives godoc
// @Summary 获取内置洞察视角
// @Description 返回录音/材料生成决策洞察时可选择的内置视角
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=[]model.InsightPerspectiveOption}
// @Router /api/recordings/insight-perspectives [get]
func GetInsightPerspectives(c *gin.Context) {
	c.JSON(http.StatusOK, model.Success.ToResponse(model.InsightPerspectiveOptions()))
}

// UpdateFileInsightPerspective godoc
// @Summary 修改文件洞察视角
// @Description 修改文件后续生成决策洞察时采用的视角，不会自动触发重新生成
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path string true "文件ID（HashID）"
// @Param request body controller.UpdateFileInsightPerspectiveRequest true "洞察视角"
// @Success 200 {object} model.CommonResponse{data=object}
// @Router /api/recordings/files/{file_id}/insight-perspective [patch]
func UpdateFileInsightPerspective(c *gin.Context) {
	fileID, err := hashids.TryParseID(c.Param("file_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	var req UpdateFileInsightPerspectiveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	perspective, err := service.SetFileInsightPerspective(
		c.Request.Context(), config.GetEID(c), config.GetUserId(c), fileID, req.Perspective,
	)
	if err != nil {
		if errors.Is(err, service.ErrInsightPerspectiveForbidden) {
			c.JSON(http.StatusForbidden, model.ForbiddenError.ToNewErrorResponse(err.Error()))
			return
		}
		if errors.Is(err, service.ErrInvalidInsightPerspective) {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("不支持的洞察视角"))
			return
		}
		logger.SysErrorf("【洞察】修改视角失败: file_id=%d err=%v", fileID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToNewErrorResponse("修改洞察视角失败"))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{
		"file_id":             fileID,
		"insight_perspective": perspective,
	}))
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

	groupID := int64(0)
	if req.GroupID != nil {
		groupID = *req.GroupID
		if err := validateRecordingGroupID(c, eid, userID, groupID); err != nil {
			c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
			return
		}
	}

	job, err := svc.CreateJob(c.Request.Context(), userID, &service.CreateRecordingJobRequest{
		LibraryID:               req.LibraryID,
		DestinationFolderFileID: req.DestinationFolderFileID,
		Title:                   req.Title,
		TargetFormat:            req.TargetFormat,
		SourceMimeType:          req.SourceMimeType,
		UploadIntervalMs:        req.UploadIntervalMs,
		MaxDurationMs:           req.MaxDurationMs,
		GroupID:                 groupID,
		InsightPerspective:      req.InsightPerspective,
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

// validateRecordingGroupID 校验录音分组归属（CreateRecordingJob 与移动分组共用）。
// 分组必须属于当前企业、类型为录音文件分组（type=8）且为当前用户创建；
// groupID=0 表示未分组，合法。返回 nil 表示通过。
func validateRecordingGroupID(c *gin.Context, eid, userID, groupID int64) error {
	if groupID < 0 {
		logger.SysErrorf("【录音】分组ID无效: eid=%d group_id=%d", eid, groupID)
		return fmt.Errorf("分组不存在")
	}
	if groupID == 0 {
		return nil
	}
	g, err := model.GetGroupByID(groupID)
	if err != nil {
		logger.SysErrorf("【录音】分组不存在: eid=%d group_id=%d err=%v", eid, groupID, err)
		return fmt.Errorf("分组不存在")
	}
	if g.Eid != eid {
		logger.SysErrorf("【录音】分组不属于当前企业: eid=%d group_id=%d group_eid=%d", eid, groupID, g.Eid)
		return fmt.Errorf("分组不存在")
	}
	if g.GroupType != model.RECORDING_FILE_GROUP_TYPE {
		logger.SysErrorf("【录音】分组类型不匹配: eid=%d group_id=%d group_type=%d want=%d", eid, groupID, g.GroupType, model.RECORDING_FILE_GROUP_TYPE)
		return fmt.Errorf("分组类型不匹配")
	}
	if g.CreatedBy != userID {
		logger.SysErrorf("【录音】分组不属于当前用户: eid=%d user_id=%d group_created_by=%d", eid, userID, g.CreatedBy)
		return fmt.Errorf("分组不存在")
	}
	return nil
}

// GetAvailableTemplates godoc
// @Summary 获取可用总结模板列表
// @Description 获取当前企业可用于录音总结的模板列表
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=[]model.RecordingSummaryTemplate}
// @Router /api/recordings/templates [get]
func GetAvailableTemplates(c *gin.Context) {
	eid := config.GetEID(c)
	svc := service.NewRecordingAdminService(eid)
	templates, err := svc.ListAvailableSummaryTemplates(c)
	if err != nil {
		logger.SysErrorf("【录音】获取可用模板列表失败: eid=%d err=%v", eid, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(templates))
}

// UserFileSummarize godoc
// @Summary 对已解析文件创建总结
// @Description 前台用户对已解析文件创建总结
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Param template_id query int true "模板ID"
// @Success 200 {object} model.CommonResponse{data=model.RecordingFileSummary}
// @Router /api/recordings/files/{file_id}/summarize [post]
func UserFileSummarize(c *gin.Context) {
	eid := config.GetEID(c)
	fileID, err := hashids.TryParseID(c.Param("file_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	templateID, err := hashids.TryParseID(c.Query("template_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(fmt.Errorf("缺少 template_id 参数")))
		return
	}

	svc := service.NewRecordingAdminService(eid)
	summary, err := svc.CreateFileSummary(c, fileID, templateID)
	if err != nil {
		logger.SysErrorf("【录音】创建总结失败: eid=%d file_id=%d err=%v", eid, fileID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(summary))
}

// UserGetFileSummaries godoc
// @Summary 获取文件的所有总结
// @Description 获取文件的所有总结
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Success 200 {object} model.CommonResponse{data=[]model.RecordingFileSummary}
// @Router /api/recordings/files/{file_id}/summaries [get]
func UserGetFileSummaries(c *gin.Context) {
	eid := config.GetEID(c)
	fileID, err := hashids.TryParseID(c.Param("file_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	svc := service.NewRecordingAdminService(eid)
	summaries, err := svc.ListFileSummaries(c, fileID)
	if err != nil {
		logger.SysErrorf("【录音】获取总结列表失败: eid=%d file_id=%d err=%v", eid, fileID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(summaries))
}

// UserGetFileSummaryDetail godoc
// @Summary 获取单条总结详情
// @Description 获取单条总结详情
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param summary_id path int true "总结ID"
// @Success 200 {object} model.CommonResponse{data=model.RecordingFileSummary}
// @Router /api/recordings/summaries/{summary_id} [get]
func UserGetFileSummaryDetail(c *gin.Context) {
	eid := config.GetEID(c)
	summaryID, err := hashids.TryParseID(c.Param("summary_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	summary, err := model.GetRecordingFileSummaryByID(summaryID)
	if err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	if _, err := model.GetFileByID(eid, summary.FileID); err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}

	// 纪要（template_id=0）渲染为 Markdown，兼容旧数据
	if summary.TemplateID == 0 {
		summary.SummaryContent = model.LongText(service.BuildMinutesMarkdown(string(summary.SummaryContent)))
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(summary))
}

// UserDeleteFileSummary godoc
// @Summary 删除总结
// @Description 删除总结
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param summary_id path int true "总结ID"
// @Success 200 {object} model.CommonResponse
// @Router /api/recordings/summaries/{summary_id} [delete]
func UserDeleteFileSummary(c *gin.Context) {
	eid := config.GetEID(c)
	summaryID, err := hashids.TryParseID(c.Param("summary_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	svc := service.NewRecordingAdminService(eid)
	if err := svc.DeleteFileSummary(c, summaryID); err != nil {
		logger.SysErrorf("【录音】删除总结失败: eid=%d summary_id=%d err=%v", eid, summaryID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(gin.H{"ok": true}))
}

// UserAddFileTemplate godoc
// @Summary 为用户录音详情页添加模板
// @Description 为用户录音详情页添加总结模板
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Param request body controller.UserAddFileTemplateRequest true "模板添加请求"
// @Success 200 {object} model.CommonResponse{data=model.RecordingFileSummary}
// @Router /api/recordings/files/{file_id}/templates [post]
func UserAddFileTemplate(c *gin.Context) {
	eid := config.GetEID(c)
	fileID, err := hashids.TryParseID(c.Param("file_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	var req struct {
		TemplateID string `json:"template_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	templateID, err := hashids.TryParseID(req.TemplateID)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	svc := service.NewRecordingAdminService(eid)
	summary, err := svc.CreateFileSummary(c, fileID, templateID)
	if err != nil {
		logger.SysErrorf("【录音】添加模板失败: eid=%d file_id=%d err=%v", eid, fileID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(summary))
}

// UserGetFileTemplates godoc
// @Summary 获取用户录音详情页已添加的模板列表
// @Description 获取用户录音详情页已添加的模板列表
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param file_id path int true "文件ID"
// @Success 200 {object} model.CommonResponse{data=[]model.RecordingFileSummary}
// @Router /api/recordings/files/{file_id}/templates [get]
func UserGetFileTemplates(c *gin.Context) {
	eid := config.GetEID(c)
	fileID, err := hashids.TryParseID(c.Param("file_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	if _, err := service.GetViewableRecordingFile(c.Request.Context(), eid, config.GetUserId(c), fileID); err != nil {
		if errors.Is(err, service.ErrRecordingFileForbidden) {
			c.JSON(http.StatusForbidden, model.ForbiddenError.ToNewErrorResponse("无权查看该录音文件"))
			return
		}
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	svc := service.NewRecordingAdminService(eid)
	summaries, err := svc.ListFileSummaries(c, fileID)
	if err != nil {
		logger.SysErrorf("【录音】获取文件模板列表失败: eid=%d file_id=%d err=%v", eid, fileID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(summaries))
}

// GetFileParseStatus godoc
// @Summary 获取文件解析状态（转写/纪要/洞察）
// @Description 返回文件的三阶段解析状态：转写、纪要、洞察
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path string true "文件ID（HashID）"
// @Success 200 {object} model.CommonResponse{data=object} "解析状态"
// @Router /api/recordings/files/{file_id}/parse-status [get]
func GetFileParseStatus(c *gin.Context) {
	fileID, err := hashids.TryParseID(c.Param("file_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	eid := config.GetEID(c)
	// 权限放开：parse-status 供其他知识库（团队/共享库）使用，只要求用户对文件所在知识库有查看权限，
	// 不再要求文件创建者是当前用户（GetViewableRecordingFile vs GetAccessibleRecordingFile）。
	if _, err := service.GetViewableRecordingFile(c.Request.Context(), eid, config.GetUserId(c), fileID); err != nil {
		if errors.Is(err, service.ErrRecordingFileForbidden) {
			c.JSON(http.StatusForbidden, model.ForbiddenError.ToNewErrorResponse("无权查看该录音文件"))
			return
		}
		c.JSON(http.StatusOK, model.Success.ToResponse(nil))
		return
	}

	result := service.GetFileParseStatus(eid, fileID)
	c.JSON(http.StatusOK, model.Success.ToResponse(result))
}

// RetranscribeRecordingFile godoc
// @Summary 补触发转写
// @Description 对指定录音文件重新触发转写任务（document_parsing），用于同步时引擎未就绪导致"有录音无转写"的存量文件
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path string true "文件ID（HashID）"
// @Success 200 {object} model.CommonResponse{data=object} "补触发结果"
// @Router /api/recordings/files/{file_id}/retranscribe [post]
func RetranscribeRecordingFile(c *gin.Context) {
	fileID, err := hashids.TryParseID(c.Param("file_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	eid := config.GetEID(c)
	if _, err := service.GetViewableRecordingFile(c.Request.Context(), eid, config.GetUserId(c), fileID); err != nil {
		if errors.Is(err, service.ErrRecordingFileForbidden) {
			c.JSON(http.StatusForbidden, model.ForbiddenError.ToNewErrorResponse("无权操作该录音文件"))
			return
		}
		c.JSON(http.StatusOK, model.Success.ToResponse(nil))
		return
	}

	if err := service.RetranscribeRecordingFile(c.Request.Context(), eid, fileID); err != nil {
		if errors.Is(err, service.ErrRetranscribeAlreadyProcessing) {
			c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{"status": "processing", "message": err.Error()}))
			return
		}
		c.JSON(http.StatusInternalServerError, model.SystemError.ToNewErrorResponse(err.Error()))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{"status": "pending"}))
}

// GetFileInsightPage godoc
// @Summary 获取录音文件的决策页面编排结果
// @Description 返回 Prompt 5 编排后的页面 JSON，没有则返回 404
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path string true "文件ID（HashID）"
// @Success 200 {object} model.CommonResponse{data=object} "页面数据"
// @Router /api/recordings/files/{file_id}/insight-page [get]
func GetFileInsightPage(c *gin.Context) {
	fileID, err := hashids.TryParseID(c.Param("file_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	eid := config.GetEID(c)

	if _, err := service.GetViewableRecordingFile(c.Request.Context(), eid, config.GetUserId(c), fileID); err != nil {
		if errors.Is(err, service.ErrRecordingFileForbidden) {
			c.JSON(http.StatusForbidden, model.ForbiddenError.ToNewErrorResponse("无权查看该录音文件"))
			return
		}
		c.JSON(http.StatusOK, model.Success.ToResponse(nil))
		return
	}

	page, err := model.GetRecordingFileInsightPageByFileID(fileID)
	if err != nil {
		c.JSON(http.StatusOK, model.Success.ToResponse(nil))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(page))
}

// GetFileInsightBackground godoc
// @Summary 获取洞察协同研讨背景
// @Description 返回本次洞察生成使用的个人、企业、历史和纪要背景快照
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param file_id path string true "文件ID（HashID）"
// @Success 200 {object} model.CommonResponse{data=service.InsightBackground}
// @Router /api/recordings/files/{file_id}/insight-context [get]
func GetFileInsightBackground(c *gin.Context) {
	fileID, err := hashids.TryParseID(c.Param("file_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	background, err := service.GetInsightBackground(c.Request.Context(), config.GetEID(c), config.GetUserId(c), fileID)
	if err != nil {
		if errors.Is(err, service.ErrInsightContextForbidden) {
			c.JSON(http.StatusForbidden, model.ForbiddenError.ToNewErrorResponse("无权查看该洞察背景"))
			return
		}
		logger.SysErrorf("【洞察】读取协同背景失败 fileID=%d err=%v", fileID, err)
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("读取洞察背景失败"))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(background))
}

// ChatFileInsightWorkshop godoc
// @Summary 洞察背景协同对话
// @Description 基于当前背景与纪要进行补充说明对话，不直接覆盖洞察结果
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path string true "文件ID（HashID）"
// @Param request body service.InsightWorkshopChatRequest true "协同对话请求"
// @Success 200 {object} model.CommonResponse{data=service.InsightWorkshopChatResponse}
// @Router /api/recordings/files/{file_id}/insight-context/chat [post]
func ChatFileInsightWorkshop(c *gin.Context) {
	fileID, err := hashids.TryParseID(c.Param("file_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	var req service.InsightWorkshopChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	response, err := service.ChatInsightWorkshop(c.Request.Context(), config.GetEID(c), config.GetUserId(c), fileID, req)
	if err != nil {
		if errors.Is(err, service.ErrInsightContextForbidden) {
			c.JSON(http.StatusForbidden, model.ForbiddenError.ToNewErrorResponse("无权使用该洞察协同对话"))
			return
		}
		if errors.Is(err, service.ErrInsightContextEmpty) {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("补充说明不能为空"))
			return
		}
		logger.SysErrorf("【洞察】协同对话失败 fileID=%d err=%v", fileID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToNewErrorResponse("洞察协同对话失败"))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(response))
}

// GetMyQueuedCount godoc
// @Summary 获取当前用户排队中的录音文件数
// @Description 返回当前用户排队等待解析的录音文件数量（parsing_status=pending）
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 200 {object} model.CommonResponse{data=object} "排队数量"
// @Router /api/recordings/my-queued-count [get]
func GetMyQueuedCount(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	count := service.CountMyQueuedFiles(eid, userID)
	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]int64{
		"queued_count": count,
	}))
}

// GetFileTranscription godoc
// @Summary 获取录音文件的转写原文
// @Description 双模式返回转写：已反转读 Summary(-1)，未反转读 FileBody
// @Tags 录音
// @Produce json
// @Security BearerAuth
// @Param file_id path string true "文件ID（HashID）"
// @Success 200 {object} model.CommonResponse{data=object}
// @Router /api/recordings/files/{file_id}/transcription [get]
func GetFileTranscription(c *gin.Context) {
	fileID, err := hashids.TryParseID(c.Param("file_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	eid := config.GetEID(c)

	if _, err := service.GetViewableRecordingFile(c.Request.Context(), eid, config.GetUserId(c), fileID); err != nil {
		if errors.Is(err, service.ErrRecordingFileForbidden) {
			c.JSON(http.StatusForbidden, model.ForbiddenError.ToNewErrorResponse("无权查看该录音文件"))
			return
		}
		c.JSON(http.StatusOK, model.Success.ToResponse(nil))
		return
	}

	text, err := service.LoadTranscriptText(eid, fileID)
	if err != nil {
		c.JSON(http.StatusOK, model.Success.ToResponse(nil))
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{
		"file_id": fileID,
		"content": text,
	}))
}

// ExportTranscript godoc
// @Summary 获取转写 Markdown
// @Description 将转写 JSON 转换为带说话人/时间/内容的 Markdown 返回（非文件下载）
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path string true "文件ID（HashID）"
// @Success 200 {object} model.CommonResponse{data=object}
// @Router /api/recordings/files/{file_id}/transcription/export [get]
func ExportTranscript(c *gin.Context) {
	fileID, err := hashids.TryParseID(c.Param("file_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	eid := config.GetEID(c)
	if _, err := service.GetViewableRecordingFile(c.Request.Context(), eid, config.GetUserId(c), fileID); err != nil {
		if errors.Is(err, service.ErrRecordingFileForbidden) {
			c.JSON(http.StatusForbidden, model.ForbiddenError.ToNewErrorResponse("无权查看该录音文件"))
			return
		}
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		return
	}

	md, fileName, err := service.ExportTranscriptMarkdown(c.Request.Context(), eid, fileID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, model.NotFound.ToResponse(err))
		} else {
			logger.SysErrorf("【录音】导出转写失败: eid=%d file_id=%d err=%v", eid, fileID, err)
			c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		}
		return
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{
		"file_id":   fileID,
		"markdown":  md,
		"file_name": fileName,
	}))
}

// RunRecordingPipeline godoc
// @Summary 继续生成录音管线
// @Description 检查纪要/洞察/页面状态，缺什么补什么。不重新转写，只填补缺失步骤。异步执行，前端轮询 parse-status 获取进度。
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path string true "文件ID（HashID）"
// @Success 200 {object} model.CommonResponse "所有步骤已完成，无需处理"
// @Success 202 {object} model.CommonResponse "已触发继续生成"
// @Failure 400 {object} model.CommonResponse "参数错误或文件不存在"
// @Router /api/recordings/files/{file_id}/pipeline [post]
func RunRecordingPipeline(c *gin.Context) {
	fileID, err := hashids.TryParseID(c.Param("file_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	result, err := service.RunRecordingPipeline(c.Request.Context(), eid, fileID, userID)
	if err != nil {
		if errors.Is(err, service.ErrRecordingFileForbidden) {
			c.JSON(http.StatusForbidden, model.ForbiddenError.ToNewErrorResponse("无权操作该录音文件"))
			return
		}
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse(err.Error()))
		return
	}

	if result.MeetingMinutes == service.PipelineStepSkipped &&
		result.Insights == service.PipelineStepSkipped &&
		result.InsightPage == service.PipelineStepSkipped {
		c.JSON(http.StatusOK, model.Success.ToResponse(result))
	} else {
		c.JSON(http.StatusAccepted, model.Success.ToResponse(result))
	}
}

// RegenerateInsights godoc
// @Summary 重新生成洞察
// @Description 清除现有洞察数据，重新调用 LLM 生成洞察。不重新转写和纪要，异步执行，前端轮询 parse-status 获取进度。
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path string true "文件ID（HashID）"
// @Success 202 {object} model.CommonResponse "已触发洞察重新生成"
// @Failure 400 {object} model.CommonResponse "参数错误或文件不存在"
// @Router /api/recordings/files/{file_id}/insights/regenerate [post]
func RegenerateInsights(c *gin.Context) {
	fileID, err := hashids.TryParseID(c.Param("file_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	var req service.InsightRegenerationRequest
	var request *service.InsightRegenerationRequest
	if err := c.ShouldBindJSON(&req); err == nil {
		request = &req
	} else if !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	if err := service.RegenerateInsightsWithContext(c.Request.Context(), eid, userID, fileID, request); err != nil {
		if errors.Is(err, service.ErrInsightContextForbidden) {
			c.JSON(http.StatusForbidden, model.ForbiddenError.ToNewErrorResponse("无权操作该文件"))
			return
		}
		if errors.Is(err, service.ErrInsightContextEmpty) {
			c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("洞察背景不能为空"))
			return
		}
		logger.SysErrorf("【洞察】触发重新生成失败 fileID=%d err=%v", fileID, err)
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("重新生成洞察失败"))
		return
	}

	logger.Infof(c, "【洞察】触发重新生成: fileID=%d eid=%d userID=%d", fileID, eid, userID)
	c.JSON(http.StatusAccepted, model.Success.ToResponse(gin.H{"ok": true}))
}

// ReExtractEntities godoc
// @Summary 重新抽取实体
// @Description 根据录音配置中的历史记忆设置，重新抽取文件的实体。不重新转写和纪要，依赖文件已有内容。
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path string true "文件ID（HashID）"
// @Success 202 {object} model.CommonResponse "已触发实体抽取"
// @Failure 400 {object} model.CommonResponse "参数错误或文件不存在"
// @Router /api/recordings/files/{file_id}/entities/extract [post]
func ReExtractEntities(c *gin.Context) {
	fileID, err := hashids.TryParseID(c.Param("file_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	eid := config.GetEID(c)

	// 重新抽取会写入通用实体与会议记忆，必须由该个人录音创建者发起。
	if _, err := service.GetAccessibleRecordingFile(c.Request.Context(), eid, config.GetUserId(c), fileID, true); err != nil {
		if errors.Is(err, service.ErrRecordingFileForbidden) {
			c.JSON(http.StatusForbidden, model.ForbiddenError.ToNewErrorResponse("无权操作该录音文件"))
			return
		}
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("文件不存在"))
		return
	}

	// 读取录音配置获取历史记忆设置
	cfg, err := model.ValidateOrCreateRecordingConfig(eid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToErrorResponse(err))
		return
	}

	memCfg := cfg.MemoryExtraction
	if memCfg == nil {
		memCfg = &model.MemoryExtractionConfig{Enabled: true, Types: []string{model.EntityTypePerson, model.EntityTypeMatter, model.EntityTypeCommitment}}
	}

	// 异步执行实体抽取
	go func() {
		ctx := context.Background()
		extractor := rag.NewEntityExtractionService(model.DB)

		if memCfg.IsEffectivelyEnabled() {
			var file model.File
			if err := model.DB.Where("id = ?", fileID).First(&file).Error; err != nil {
				logger.SysErrorf("【实体抽取】查询文件失败: fileID=%d err=%v", fileID, err)
				return
			}
			body, err := model.GetLastFileBodyByFileID(eid, fileID)
			if err != nil {
				logger.SysErrorf("【实体抽取】读取文件内容失败: fileID=%d err=%v", fileID, err)
				return
			}
			content, err := body.GetContent()
			if err != nil {
				logger.SysErrorf("【实体抽取】解析文件内容失败: fileID=%d err=%v", fileID, err)
				return
			}

			if err := extractor.ExtractAndStoreForFileContentWithTypes(ctx, eid, fileID, content, memCfg.Types); err != nil {
				logger.SysErrorf("【实体抽取】按配置类型抽取失败: fileID=%d err=%v", fileID, err)
			} else {
				logger.Infof(ctx, "【实体抽取】按配置类型完成: fileID=%d types=%v", fileID, memCfg.Types)
			}

			// 元信息实体抽取（文件名、知识库名、空间名），仅当配置类型包含 Document 时执行
			if model.ContainsString(memCfg.Types, model.EntityTypeDocument) {
				if err := extractor.ExtractAndStoreForFileMeta(ctx, eid, fileID); err != nil {
					logger.SysErrorf("【实体抽取】元信息抽取失败: fileID=%d err=%v", fileID, err)
				}
			}

			// 安心录专属实体属性记忆从已有纪要的 memory_entities 编译，
			// 不修改通用 RAG 实体模型；旧纪要没有该字段时安全返回空结果。
			if _, err := service.CompileRecordingEntityMemory(ctx, eid, fileID, file.UserID); err != nil {
				logger.SysErrorf("【实体记忆】重新编译失败: fileID=%d err=%v", fileID, err)
			}
		}
	}()

	logger.Infof(c, "【实体抽取】触发重新抽取: fileID=%d eid=%d", fileID, eid)
	c.JSON(http.StatusAccepted, model.Success.ToResponse(gin.H{"ok": true}))
}

// MoveRecordingFileToGroup godoc
// @Summary 移动录音文件至分组
// @Description 修改录音文件的 group_id；group_id=0 表示移出分组（未分组）。分组必须为当前用户创建的录音文件分组（type=8）
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path string true "文件ID（HashID）"
// @Param request body object true "请求体" {"group_id":0}
// @Success 200 {object} model.CommonResponse{data=object}
// @Failure 400 {object} model.CommonResponse
// @Failure 403 {object} model.CommonResponse
// @Failure 404 {object} model.CommonResponse
// @Failure 500 {object} model.CommonResponse
// @Router /api/recordings/files/{file_id}/group [put]
func MoveRecordingFileToGroup(c *gin.Context) {
	eid := config.GetEID(c)
	userID := config.GetUserId(c)
	fileID, err := hashids.TryParseID(c.Param("file_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// group_id 用指针区分"缺参"与 0（0 = 移出分组，合法值，不能用 binding:"required"）
	var req struct {
		GroupID *int64 `json:"group_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	if req.GroupID == nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("缺少 group_id 参数"))
		return
	}
	if err := validateRecordingGroupID(c, eid, userID, *req.GroupID); err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}

	// 文件归属校验：存在、未删除、属于当前用户、是录音文件（与"我的录音"列表过滤一致）
	var file model.File
	if err := model.DB.Where("eid = ? AND id = ? AND is_deleted = ?", eid, fileID, false).First(&file).Error; err != nil {
		c.JSON(http.StatusNotFound, model.NotFound.ToResponse(nil))
		return
	}
	if file.UserID != userID {
		c.JSON(http.StatusForbidden, model.AuthFailed.ToResponse(nil))
		return
	}
	if !file.IsRecordingOriginType() {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("仅支持移动录音文件"))
		return
	}

	if err := model.DB.Model(&model.File{}).Where("id = ?", fileID).Update("group_id", *req.GroupID).Error; err != nil {
		logger.SysErrorf("【录音】移动文件分组失败: eid=%d file_id=%d err=%v", eid, fileID, err)
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{
		"file_id":  fileID,
		"group_id": *req.GroupID,
	}))
}

// CreateRecordingShare godoc
// @Summary 创建录音分享链接
// @Description 生成分享链接（share_id），无有效期，参考 /api/shares 智能体分享模式
// @Tags 录音
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param file_id path string true "文件ID（HashID）"
// @Success 200 {object} model.CommonResponse{data=object}
// @Router /api/recordings/files/{file_id}/share [post]
func CreateRecordingShareHandler(c *gin.Context) {
	fileID, err := hashids.TryParseID(c.Param("file_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	eid := config.GetEID(c)
	userID := config.GetUserId(c)

	shareID, err := service.CreateRecordingShare(c.Request.Context(), eid, fileID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.SystemError.ToResponse(err))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(map[string]interface{}{"share_id": shareID}))
}

// GetSharedRecording godoc
// @Summary 匿名访问分享的录音内容
// @Description 通过 share_id 匿名访问录音的转写、纪要、洞察、总结内容（无需登录）
// @Tags 录音
// @Produce json
// @Param share_id path string true "分享ID"
// @Success 200 {object} model.CommonResponse{data=object}
// @Router /api/recordings/shared/{share_id} [get]
func GetSharedRecording(c *gin.Context) {
	shareID := strings.TrimSpace(c.Param("share_id"))
	if shareID == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("empty share_id"))
		return
	}

	data, err := service.GetSharedRecordingContent(c.Request.Context(), shareID)
	if err != nil {
		c.JSON(http.StatusOK, model.NotFound.ToNewErrorResponse("分享不存在"))
		return
	}
	c.JSON(http.StatusOK, model.Success.ToResponse(data))
}
