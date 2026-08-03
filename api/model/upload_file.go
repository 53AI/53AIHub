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
	SourceType        string `json:"source_type" gorm:"size:32;not null;default:user_upload;index"`
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

	// 处理状态相关字段
	Status        string `json:"status" gorm:"size:20;default:'none'"`
	Error         string `json:"error" gorm:"type:text"`
	ProcessedTime int64  `json:"processed_time"`

	BaseModel
	File              *File  `json:"file,omitempty" gorm:"-"`
	DownloadURL       string `json:"download_url,omitempty" gorm:"-"`
	SignedDownloadURL string `json:"signed_download_url,omitempty" gorm:"-"`
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

// GetUploadFileByEidUserHashAndSourceType 根据 EID、用户、Hash 和来源类型获取上传文件。
func GetUploadFileByEidUserHashAndSourceType(eid, userID int64, hash, sourceType string) (*UploadFile, error) {
	var file UploadFile
	query := DB.Where("eid = ? AND user_id = ? AND hash = ?", eid, userID, hash)
	if strings.TrimSpace(sourceType) == UploadFileSourceUserUpload {
		query = query.Where("(source_type = ? OR source_type = '' OR source_type IS NULL)", UploadFileSourceUserUpload)
	} else {
		query = query.Where("source_type = ?", sourceType)
	}
	if err := query.First(&file).Error; err != nil {
		return nil, err
	}
	return &file, nil
}

// GetUploadFileByEidHashAndSourceType 根据 EID、Hash 和来源类型获取上传文件（跨用户）。
// 用于秒传场景：同企业内任意用户上传过相同文件即可命中。
func GetUploadFileByEidHashAndSourceType(eid int64, hash, sourceType string) (*UploadFile, error) {
	var file UploadFile
	query := DB.Where("eid = ? AND hash = ?", eid, hash)
	if strings.TrimSpace(sourceType) == UploadFileSourceUserUpload {
		query = query.Where("(source_type = ? OR source_type = '' OR source_type IS NULL)", UploadFileSourceUserUpload)
	} else {
		query = query.Where("source_type = ?", sourceType)
	}
	if err := query.First(&file).Error; err != nil {
		return nil, err
	}
	return &file, nil
}

// GetUploadFilesByMessageID 根据消息 ID 获取上传文件
func GetUploadFilesByMessageID(messageID int64) ([]*UploadFile, error) {
	var files []*UploadFile
	if err := DB.Where("message_id = ?", messageID).Order("id asc").Find(&files).Error; err != nil {
		return nil, err
	}
	return files, nil
}

// GetUploadFilesByMessageIDAndSourceType 根据消息 ID 和来源类型获取上传文件
func GetUploadFilesByMessageIDAndSourceType(messageID int64, sourceType string) ([]*UploadFile, error) {
	var files []*UploadFile
	if err := DB.Where("message_id = ? AND source_type = ?", messageID, sourceType).Order("id asc").Find(&files).Error; err != nil {
		return nil, err
	}
	return files, nil
}

// GetUploadFilesByIDs 根据 ID 列表获取上传文件
func GetUploadFilesByIDs(ids []int64) ([]UploadFile, error) {
	var files []UploadFile
	if len(ids) == 0 {
		return files, nil
	}
	if err := DB.Where("id IN ?", ids).Find(&files).Error; err != nil {
		return nil, err
	}
	return files, nil
}

// DeleteUploadFileByID 删除上传文件记录
func DeleteUploadFileByID(id int64) error {
	return DB.Where("id = ?", id).Delete(&UploadFile{}).Error
}

func GetPreviewKey(hashStr string, extension string, eid int64) (string, error) {
	// md5 hash str + eid + extension
	combined := hashStr + strconv.FormatInt(eid, 10)
	hash := md5.Sum([]byte(combined))
	return fmt.Sprintf("%x", hash) + extension, nil
}

func GetUploadFileByEidAndPreviewKey(Eid int64, PreviewKey string) (uploadFile UploadFile, err error) {
	if len(PreviewKey) > 0 && PreviewKey[0] == '/' {
		PreviewKey = PreviewKey[1:]
	}
	err = DB.Model(&UploadFile{}).Where("eid =? AND preview_key =?", Eid, PreviewKey).First(&uploadFile).Error
	return uploadFile, err
}

func GetNoAuthUploadFileByEidAndPreviewKey(PreviewKey string) (uploadFile UploadFile, err error) {
	if len(PreviewKey) > 0 && PreviewKey[0] == '/' {
		PreviewKey = PreviewKey[1:]
	}
	err = DB.Model(&UploadFile{}).Where("preview_key =?", PreviewKey).First(&uploadFile).Error
	return uploadFile, err
}

func GetUploadFileByID(id int64) (uploadFile *UploadFile, err error) {
	err = DB.Model(&UploadFile{}).Where("id =?", id).First(&uploadFile).Error
	return uploadFile, err
}

func GetUploadFileByIDAndEid(id, eid int64) (uploadFile *UploadFile, err error) {
	err = DB.Model(&UploadFile{}).Where("id = ? AND eid = ?", id, eid).First(&uploadFile).Error
	return uploadFile, err
}

// Status constants for UploadFile
const (
	// 不用处理
	UploadStatusNone          = "none"
	UploadStatusPending       = "pending"
	UploadStatusUploading     = "uploading"
	UploadStatusUploaded      = "uploaded"
	UploadStatusConverting    = "converting"
	UploadStatusConvertFailed = "convert_failed"
	UploadStatusCompleted     = "completed"
	UploadStatusFailed        = "failed"
)

// MarkAsUploading 标记为上传中
func (uf *UploadFile) MarkAsUploading() error {
	uf.Status = UploadStatusUploading
	return DB.Model(uf).Updates(map[string]interface{}{
		"status": uf.Status,
	}).Error
}

// MarkAsUploaded 标记为已上传
func (uf *UploadFile) MarkAsUploaded() error {
	uf.Status = UploadStatusUploaded
	return DB.Model(uf).Updates(map[string]interface{}{
		"status": uf.Status,
	}).Error
}

// UpdateSizeAndMimeType 持久化文件大小与MimeType
func (uf *UploadFile) UpdateSizeAndMimeType(size int64, contentType string) error {
	uf.Size = size
	updates := map[string]interface{}{"size": uf.Size}
	if contentType != "" {
		uf.MimeType = contentType
		updates["mime_type"] = uf.MimeType
	}
	return DB.Model(uf).Updates(updates).Error
}

// MarkAsCompleted 标记为已完成
func (uf *UploadFile) MarkAsCompleted() error {
	uf.Status = UploadStatusCompleted
	uf.ProcessedTime = time.Now().UTC().UnixMilli()
	return DB.Model(uf).Updates(map[string]interface{}{
		"status":         uf.Status,
		"processed_time": uf.ProcessedTime,
	}).Error
}

// MarkAsFailed 标记为失败
func (uf *UploadFile) MarkAsFailed(errorMsg string) error {
	now := time.Now().UTC().UnixMilli()
	uf.Status = UploadStatusFailed
	uf.Error = errorMsg
	return DB.Model(uf).Updates(map[string]interface{}{
		"status":         uf.Status,
		"error":          uf.Error,
		"processed_time": &now,
	}).Error
}

// GetUploadFilesByStatus 根据状态获取上传文件
func GetUploadFilesByStatus(status string) ([]*UploadFile, error) {
	var files []*UploadFile
	err := DB.Where("status = ?", status).Find(&files).Error
	return files, err
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
	logger.SysLogf("GetPreviewOrOssDownloadUrl: file_id=%d file_name=%s storage_type=%s url=%s", uploadFile.ID, uploadFile.FileName, config.StorageType, url)
	return url
}
