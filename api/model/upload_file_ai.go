package model

import (
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/common/utils/sandboxdl"
	"github.com/53AI/53AIHub/config"
	"gorm.io/gorm"
)

const (
	UploadFileSourceUserUpload  = "user_upload"
	UploadFileSourceAIGenerated = "ai_generated"
)

// GetAIGeneratedUploadFileKey 生成 AI 生成文件的存储路径。
// 格式: {basePath}/ai_generated/{eid}/{userId}/{messageId}/{fileName}
func GetAIGeneratedUploadFileKey(fileName string, eid, userID, messageID int64) string {
	return storage.StorageInstance.GetBasePath() + "/" + path.Join(
		"ai_generated",
		strconv.FormatInt(eid, 10),
		strconv.FormatInt(userID, 10),
		strconv.FormatInt(messageID, 10),
		fileName,
	)
}

// CreateAIUploadFile 创建 AI 生成文件的上传记录。
func CreateAIUploadFile(uploadFile *UploadFile) error {
	if uploadFile == nil {
		return nil
	}
	if strings.TrimSpace(uploadFile.SourceType) == "" {
		uploadFile.SourceType = UploadFileSourceAIGenerated
	}
	if uploadFile.Status == "" {
		uploadFile.Status = UploadStatusCompleted
	}
	if uploadFile.ProcessedTime == 0 {
		uploadFile.ProcessedTime = time.Now().UTC().UnixMilli()
	}
	return DB.Create(uploadFile).Error
}

// Compatibility wrappers for the former sandbox output file naming.
func CreateSandboxOutputFile(uploadFile *UploadFile) error {
	return CreateAIUploadFile(uploadFile)
}

func (uploadFile *UploadFile) GetAIDownloadURL() string {
	return config.GetApiHost() + "api/upload-files/" + strconv.FormatInt(uploadFile.ID, 10) + "/download"
}

func (uploadFile *UploadFile) GetAISignedDownloadURL(ttl time.Duration) string {
	fileName := path.Base(strings.TrimSpace(uploadFile.FileName))
	if fileName == "" || fileName == "." || fileName == "/" {
		fileName = "file"
	}
	token, err := sandboxdl.GenerateDownloadToken(uploadFile.ID, fileName, ttl)
	if err != nil {
		return uploadFile.GetAIDownloadURL()
	}
	return config.GetApiHost() +
		"api/upload-files/" + strconv.FormatInt(uploadFile.ID, 10) +
		"/download/" + url.PathEscape(fileName) +
		"?token=" + url.QueryEscape(token)
}

func GetAIUploadFilesByMessageID(messageID int64) ([]*UploadFile, error) {
	return GetUploadFilesByMessageIDAndSourceType(messageID, UploadFileSourceAIGenerated)
}

func GetSandboxOutputFilesByMessageID(messageID int64) ([]*UploadFile, error) {
	return GetAIUploadFilesByMessageID(messageID)
}

func GetAIUploadFilesCleanupBatch(afterID int64, limit int, maxRetryCount int64) ([]*UploadFile, error) {
	var files []*UploadFile
	query := DB.Where("status = ?", "cleanup_failed").
		Where("source_type = ?", UploadFileSourceAIGenerated).
		Where("cleanup_retry_count < ?", maxRetryCount).
		Where("id > ?", afterID).
		Order("id asc")
	if limit > 0 {
		query = query.Limit(limit)
	}
	if err := query.Find(&files).Error; err != nil {
		return nil, err
	}
	return files, nil
}

func MarkAIUploadFileCleanupFailed(id int64) error {
	return DB.Model(&UploadFile{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"status":              "cleanup_failed",
			"cleanup_retry_count": gorm.Expr("cleanup_retry_count + 1"),
		}).Error
}

func DeleteAIUploadFileByID(id int64) error {
	return DB.Where("id = ?", id).Delete(&UploadFile{}).Error
}

func DeleteSandboxOutputFileByID(id int64) error {
	return DeleteAIUploadFileByID(id)
}

func GetAIUploadFileByID(id int64) (*UploadFile, error) {
	var file UploadFile
	err := DB.Where("id = ? AND source_type = ?", id, UploadFileSourceAIGenerated).First(&file).Error
	if err != nil {
		return nil, err
	}
	return &file, nil
}

func GetAIUploadFileByEidAndID(eid, id int64) (*UploadFile, error) {
	var file UploadFile
	err := DB.Where("id = ? AND eid = ? AND source_type = ?", id, eid, UploadFileSourceAIGenerated).First(&file).Error
	if err != nil {
		return nil, err
	}
	return &file, nil
}
