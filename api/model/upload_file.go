package model

import (
	"crypto/md5"
	"fmt"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/config"
)

type UploadFile struct {
	ID                int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	MessageID         int64  `json:"message_id" gorm:"not null;default:0;index"`
	SourceType        string `json:"source_type" gorm:"size:32;not null;default:'user_upload';index"`
	FileName          string `json:"file_name" gorm:"not null;size:512;default:''"`
	Key               string `json:"key" gorm:"not null;size:512"`
	Eid               int64  `json:"eid" gorm:"not null;index" example:"1"`
	UserID            int64  `json:"user_id" gorm:"not null;index" example:"1"`
	Size              int64  `json:"size" gorm:"not null;default:0" example:"0"`
	Extension         string `json:"extension" gorm:"not null;size:100;default:''" example:""`
	MimeType          string `json:"mime_type" gorm:"not null;size:512;default:''" example:""`
	Hash              string `json:"hash" gorm:"not null;size:512;default:''" example:""`
	PreviewKey        string `json:"preview_key" gorm:"not null;size:100;index;default:''" example:""`
	CleanupRetryCount int64  `json:"cleanup_retry_count" gorm:"not null;default:0;index"`
	Status            string `json:"status" gorm:"size:20;default:'none'"`
	Error             string `json:"error" gorm:"type:text"`
	ProcessedTime     int64  `json:"processed_time"`
	DownloadURL       string `json:"download_url" gorm:"-"`
	SignedDownloadURL string `json:"signed_download_url" gorm:"-"`
	File              *File  `json:"file,omitempty" gorm:"-"`
	BaseModel
}

func GetFileKey(fileName string, Eid int64, UserId int64) string {
	eidStr := strconv.FormatInt(Eid, 10)
	userIdStr := strconv.FormatInt(UserId, 10)

	return storage.StorageInstance.GetBasePath() + "/" + path.Join(eidStr, userIdStr, fileName)
}

func (uploadFile *UploadFile) Save() error {
	if strings.TrimSpace(uploadFile.SourceType) == "" {
		uploadFile.SourceType = UploadFileSourceUserUpload
	}
	var oldUploadFile UploadFile
	query := DB.Where("eid = ? AND user_id = ? AND hash = ?", uploadFile.Eid, uploadFile.UserID, uploadFile.Hash)
	if uploadFile.SourceType == UploadFileSourceUserUpload {
		query = query.Where("(source_type = ? OR source_type = '' OR source_type IS NULL)", UploadFileSourceUserUpload)
	} else {
		query = query.Where("source_type = ?", uploadFile.SourceType)
	}
	if err := query.First(&oldUploadFile).Error; err != nil {
		if err.Error() == "record not found" {
			result := DB.Create(uploadFile)
			if result.Error != nil {
				return result.Error
			}

			return nil
		}
		return err
	}
	result := DB.Model(&oldUploadFile).Updates(uploadFile)
	if result.Error != nil {
		return result.Error
	}
	*uploadFile = oldUploadFile
	return nil
}

func GetPreviewKey(hashStr string, extension string, eid ...int64) (string, error) {
	// md5 hash str + extension
	combined := hashStr
	if len(eid) > 0 {
		combined += strconv.FormatInt(eid[0], 10)
	}
	hash := md5.Sum([]byte(combined))
	return fmt.Sprintf("%x", hash) + extension, nil
}

func GetUploadFileByEidAndPreviewKey(Eid int64, PreviewKey string) (uploadFile UploadFile, err error) {
	if len(PreviewKey) > 0 && PreviewKey[0] == '/' {
		PreviewKey = PreviewKey[1:]
	}
	err = DB.Model(&UploadFile{}).Where("eid =? AND `preview_key` =?", Eid, PreviewKey).First(&uploadFile).Error
	return uploadFile, err
}

func GetNoAuthUploadFileByEidAndPreviewKey(PreviewKey string) (uploadFile UploadFile, err error) {
	if len(PreviewKey) > 0 && PreviewKey[0] == '/' {
		PreviewKey = PreviewKey[1:]
	}
	err = DB.Model(&UploadFile{}).Where("`preview_key` =?", PreviewKey).First(&uploadFile).Error
	return uploadFile, err
}

func GetUploadFileByID(id int64) (uploadFile *UploadFile, err error) {
	err = DB.Model(&UploadFile{}).Where("id =?", id).First(&uploadFile).Error
	return uploadFile, err
}

const (
	UploadStatusNone          = "none"
	UploadStatusPending       = "pending"
	UploadStatusUploading     = "uploading"
	UploadStatusUploaded      = "uploaded"
	UploadStatusConverting    = "converting"
	UploadStatusConvertFailed = "convert_failed"
	UploadStatusCompleted     = "completed"
	UploadStatusFailed        = "failed"
)

func GetUploadFilesByMessageID(messageID int64) ([]*UploadFile, error) {
	var files []*UploadFile
	err := DB.Where("message_id = ?", messageID).Order("id asc").Find(&files).Error
	return files, err
}

func GetUploadFilesByMessageIDAndSourceType(messageID int64, sourceType string) ([]*UploadFile, error) {
	var files []*UploadFile
	err := DB.Where("message_id = ? AND source_type = ?", messageID, sourceType).Order("id asc").Find(&files).Error
	return files, err
}

func GetUploadFileByEidHashAndSourceType(eid int64, hash, sourceType string) (*UploadFile, error) {
	var file UploadFile
	err := DB.Where("eid = ? AND hash = ? AND source_type = ?", eid, hash, sourceType).First(&file).Error
	return &file, err
}

func GetUploadFileByIDAndEid(id, eid int64) (*UploadFile, error) {
	var file UploadFile
	err := DB.Where("id = ? AND eid = ?", id, eid).First(&file).Error
	return &file, err
}

func GetUploadFileByEidUserHashAndSourceType(eid, userID int64, hash, sourceType string) (*UploadFile, error) {
	var file UploadFile
	err := DB.Where("eid = ? AND user_id = ? AND hash = ? AND source_type = ?", eid, userID, hash, sourceType).First(&file).Error
	return &file, err
}

func GetUploadFilesByStatus(status string) ([]*UploadFile, error) {
	var files []*UploadFile
	err := DB.Where("status = ?", status).Find(&files).Error
	return files, err
}

func DeleteUploadFileByID(id int64) error {
	return DB.Where("id = ?", id).Delete(&UploadFile{}).Error
}

func (uf *UploadFile) MarkAsCompleted() error {
	uf.Status = UploadStatusCompleted
	uf.ProcessedTime = time.Now().UTC().UnixMilli()
	return DB.Model(uf).Updates(map[string]interface{}{"status": uf.Status, "processed_time": uf.ProcessedTime}).Error
}

func (uf *UploadFile) MarkAsUploaded() error {
	uf.Status = UploadStatusUploaded
	return DB.Model(uf).Updates(map[string]interface{}{"status": uf.Status}).Error
}

func (uf *UploadFile) MarkAsFailed(errorMsg string) error {
	now := time.Now().UTC().UnixMilli()
	uf.Status = UploadStatusFailed
	uf.Error = errorMsg
	uf.ProcessedTime = now
	return DB.Model(uf).Updates(map[string]interface{}{
		"status":         uf.Status,
		"error":          uf.Error,
		"processed_time": uf.ProcessedTime,
	}).Error
}

func (uf *UploadFile) UpdateSizeAndMimeType(size int64, contentType string) error {
	uf.Size = size
	updates := map[string]interface{}{"size": uf.Size}
	if contentType != "" {
		uf.MimeType = contentType
		updates["mime_type"] = uf.MimeType
	}
	return DB.Model(uf).Updates(updates).Error
}

func (uploadFile *UploadFile) GetChannelFileMapping(channelId int, model string) *ChannelFileMapping {
	var channelFileMapping ChannelFileMapping
	err := DB.Model(&ChannelFileMapping{}).Where("channel_id =? AND file_id =? AND model =?", channelId, uploadFile.ID, model).First(&channelFileMapping).Error
	if err != nil {
		return nil
	}
	return &channelFileMapping
}

func (uploadFile *UploadFile) GetPreviewFullUrl() string {
	if uploadFile.PreviewKey == "" {
		return ""
	}

	return config.GetApiHost() + "api/preview/" + uploadFile.PreviewKey
}

func (uploadFile *UploadFile) GetOssDownloadUrl() string {
	return "https://" + config.AliyunOssEndpoint + "/" + config.AliyunOssBucketName + "/" + uploadFile.Key
}

func (uploadFile *UploadFile) GetPreviewOrOssDownloadUrl() string {
	var url string
	if config.StorageType == "aliyun_oss" {
		url = uploadFile.GetOssDownloadUrl()
	} else {
		url = uploadFile.GetPreviewFullUrl()
	}
	logger.SysLogf("GetPreviewOrOssDownloadUrl: %s", url)
	return url
}
