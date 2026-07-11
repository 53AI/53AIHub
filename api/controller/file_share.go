package controller

import (
	"net/http"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/53AI/53AIHub/service/sharefiles"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type FileShareController struct {
	db      *gorm.DB
	service *sharefiles.Service
}

func NewFileShareController(db *gorm.DB) *FileShareController {
	return &FileShareController{
		db:      db,
		service: sharefiles.NewService(db),
	}
}

type CreateFileShareReq struct {
	FileID     int64 `json:"file_id" binding:"required"`
	ExpireTime int64 `json:"expire_time"` // unix milliseconds, 0 means never expire
}

type CreateFileShareResp struct {
	ShareID    string `json:"share_id"`
	ExpireTime int64  `json:"expire_time"` // unix milliseconds
}

// @Summary      Create a file share
// @Description  Create a share link for a file. ExpireTime is unix milliseconds; 0 means never expire.
// @Tags         FileShare
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        body  body      CreateFileShareReq  true  "Create file share request"
// @Success      200   {object}  model.CommonResponse{data=CreateFileShareResp} "success"
// @Router       /api/file-shares [post]
func (c *FileShareController) CreateFileShare(ctx *gin.Context) {
	var req CreateFileShareReq
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	eid := config.GetEID(ctx)
	userID := config.GetUserId(ctx)

	// 校验文件存在
	var file model.File
	if err := c.db.WithContext(ctx).First(&file, req.FileID).Error; err != nil {
		ctx.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		return
	}

	var expireAtMs int64
	if req.ExpireTime > 0 {
		// 入参为毫秒，直接传递毫秒给服务层；0 代表永不过期
		expireAtMs = req.ExpireTime
	}
	shareID, err := c.service.CreateShare(ctx, eid, req.FileID, userID, expireAtMs)
	if err != nil {
		logger.Errorf(ctx, "CreateFileShare error: %v", err)
		ctx.JSON(http.StatusInternalServerError, model.DBError.ToNewErrorResponse("create share failed"))
		return
	}
	ctx.JSON(http.StatusOK, model.Success.ToResponse(CreateFileShareResp{
		ShareID:    shareID,
		ExpireTime: req.ExpireTime,
	}))
}

// @Summary      Get a file share record
// @Description  Get share record by share_id and verify permission before proxying to file content.
// @Tags         FileShare
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        share_id  path     string  true  "Share ID"
// @Success      200       {object} model.CommonResponse{data=model.File}
// @Router       /api/file-shares/{share_id} [get]
func (c *FileShareController) GetFileShare(ctx *gin.Context) {
	shareID := ctx.Param("share_id")
	if shareID == "" {
		ctx.JSON(http.StatusBadRequest, model.ParamError.ToNewErrorResponse("missing share_id"))
		return
	}
	eid := config.GetEID(ctx)
	userID := config.GetUserId(ctx)

	rec, err := c.service.GetShareRecord(ctx, shareID)
	if err != nil {
		switch err {
		case sharefiles.ErrNotFound:
			ctx.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		case sharefiles.ErrExpired:
			ctx.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		default:
			logger.Errorf(ctx, "GetFileShare query error: %v", err)
			ctx.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
		}
		return
	}
	// 参数类型适配：controller 层为 int64，sharefiles 需要 uint64
	// 负值保护，避免无效调用
	if eid < 0 || userID < 0 || rec.FileID < 0 {
		ctx.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}
	// 复用 GetFile 的响应：设置 :id 参数后调用
	ctx.Params = append(ctx.Params, gin.Param{Key: "file_id", Value: itoaFS(rec.FileID)})
	// 获取当前权限
	maxPermission, err := service.GetUserPermission(eid, model.RESOURCE_TYPE_FILE, rec.FileID, userID)
	if err != nil {
		maxPermission = model.PERMISSION_NONE
	}
	if maxPermission < model.PERMISSION_VIEW_ONLY {
		// 如果权限小于仅查看,才需要增加查看权限
		_ = service.UpsertPermission(eid, model.RESOURCE_TYPE_FILE, rec.FileID, model.SUBJECT_TYPE_USER, userID, model.PERMISSION_VIEW_ONLY)
	}
	GetFile(ctx)
}

// itoa 复用 controller/share.go 的实现
func itoaFS(v int64) string {
	if v == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	return string(buf[i:])
}
