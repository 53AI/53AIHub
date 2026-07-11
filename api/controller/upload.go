package controller

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"

	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Upload
// @Summary      Upload a file
// @Description  Upload a file
// @Tags         Upload
// @Accept       mpfd
// @Produce      json
// @Param        file  formData  file  true  "file"
// @Param        upload_target formData string false "上传目标，attachment=附件上传，my_uploads=同步到我的上传"
// @Security BearerAuth
// @Success      200  {object}  model.CommonResponse{data=model.UploadFile}  "success"
// @Router       /api/upload [post]
func Upload(c *gin.Context) {
	// upload file
	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(err))
		return
	}
	if fileHeader.Size > config.MAX_UPLOAD_FILE_SIZE {
		c.JSON(http.StatusBadRequest, model.FileError.ToResponse(errors.New("The maximum allowed size for file uploads is "+config.MAX_UPLOAD_FILE_SIZE_STRING+".")))
		return
	}

	uploadTarget := strings.ToLower(strings.TrimSpace(c.PostForm("upload_target")))
	if uploadTarget == "" {
		uploadTarget = "attachment"
	}

	eid := config.GetEID(c)
	user_id := config.GetUserId(c)
	if eid == 0 || user_id == 0 {
		c.JSON(http.StatusBadRequest, model.AuthFailed.ToResponse(nil))
		return
	}
	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, model.FileError.ToResponse(err))
		return
	}
	defer file.Close()

	// 先读取文件内容
	fileContent, err := io.ReadAll(file)
	if err != nil && err != io.EOF {
		c.JSON(http.StatusBadRequest, model.FileError.ToResponse(err))
		return
	}

	// 计算哈希前重置文件指针
	if _, err := file.Seek(0, 0); err != nil {
		c.JSON(http.StatusBadRequest, model.FileError.ToResponse(err))
		return
	}
	hashStr, err := storage.GetFileHash(file)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.FileError.ToResponse(err))
		return
	}

	extension := path.Ext(fileHeader.Filename)
	PreviewKey, err := model.GetPreviewKey(hashStr, extension, eid)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.FileError.ToResponse(err))
		return
	}

	key := model.GetFileKey(PreviewKey, eid, user_id)
	err = storage.StorageInstance.Save(fileContent, key)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.FileError.ToResponse(err))
		return
	}

	uploadFileExists := false
	if _, err := model.GetUploadFileByEidUserHashAndSourceType(eid, user_id, hashStr, model.UploadFileSourceUserUpload); err == nil {
		uploadFileExists = true
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusBadRequest, model.FileError.ToResponse(err))
		return
	}

	uploadFile := &model.UploadFile{
		FileName:   fileHeader.Filename,
		Key:        key,
		Eid:        eid,
		UserID:     user_id,
		Size:       fileHeader.Size,
		Extension:  extension,
		MimeType:   fileHeader.Header.Get("Content-Type"),
		Hash:       hashStr,
		PreviewKey: PreviewKey,
	}

	err = uploadFile.Save()
	if err != nil {
		c.JSON(http.StatusBadRequest, model.FileError.ToResponse(err))
		return
	}

	if uploadTarget == "my_uploads" {
		syncSvc := service.NewPersonalUploadSyncService(eid)
		_, err = syncSvc.SyncUploadedFile(c.Request.Context(), user_id, uploadFile)
		if err != nil {
			if !uploadFileExists {
				_ = storage.StorageInstance.Delete(key)
				_ = model.DB.Delete(&model.UploadFile{}, uploadFile.ID).Error
			}
			if errors.Is(err, service.ErrPersonalWorkspaceInitializing) {
				c.JSON(http.StatusTooManyRequests, model.OperateTooFast.ToResponse(err))
				return
			}
			c.JSON(http.StatusInternalServerError, model.FileError.ToResponse(err))
			return
		}
	}

	c.JSON(http.StatusOK, model.Success.ToResponse(uploadFile))
}

// PreviewFile
// @Summary      Preview a file
// @Description  Preview a file
// @Tags         Upload
// @Accept       json
// @Produce      octet-stream
// @Param        key  path  string  true  "file key"
// @Success      200  {object}  []byte  "file content"
// 修改路由定义，使用路径参数
// @Router       /api/preview/{key} [get]
func PreviewFile(c *gin.Context) {
	// 从路径参数中获取 key
	key := c.Param("key")
	if key == "" {
		c.JSON(http.StatusBadRequest, model.ParamError.ToResponse(nil))
		return
	}

	// uploadFile, err := model.GetUploadFileByEidAndPreviewKey(config.GetEID(c), key)
	// if err != nil {
	// 	c.JSON(http.StatusBadRequest, model.NotFound.ToResponse(err))
	// 	return
	// }
	uploadFile, err := model.GetNoAuthUploadFileByEidAndPreviewKey(key)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.NotFound.ToResponse(err))
		return
	}

	filename := uploadFile.FileName
	encodedFilename := url.QueryEscape(filename)

	c.Header("Content-Disposition", `inline; filename="`+filename+`"; filename*=UTF-8''`+encodedFilename)
	c.Header("Content-Type", uploadFile.MimeType)
	c.Header("Content-Length", fmt.Sprintf("%d", uploadFile.Size))

	if _, ok := storage.StorageInstance.(*storage.LocalStorage); ok {
		file, err := os.Open(uploadFile.Key)
		if err != nil {
			c.JSON(http.StatusBadRequest, model.FileError.ToResponse(err))
			return
		}
		defer file.Close()
		c.Status(http.StatusOK)
		_, _ = io.Copy(c.Writer, file)
		return
	}

	fileContent, err := storage.StorageInstance.Load(uploadFile.Key)
	if err != nil {
		c.JSON(http.StatusBadRequest, model.FileError.ToResponse(err))
		return
	}
	c.Data(http.StatusOK, uploadFile.MimeType, fileContent)
}
