package tools

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
)

// FileStorageService 定义文件存储服务接口
type FileStorageService interface {
	// Upload 上传文件内容，返回访问 URL
	Upload(ctx context.Context, fileName string, content []byte) (string, error)
	// GetURL 获取文件的访问 URL
	GetURL(ctx context.Context, storageKey string) (string, error)
}

// FileStorageManager 管理文件存储
type FileStorageManager struct {
	storage FileStorageService
}

type GeneratedFile struct {
	FileName string
	Content  []byte
	MimeType string
}

var fileStorageManager *FileStorageManager

func isAllowedSandboxOutputPath(fileName string) bool {
	trimmed := strings.TrimSpace(fileName)
	if trimmed == "" {
		return false
	}

	normalized := filepath.ToSlash(filepath.Clean(trimmed))
	if normalized == "." || normalized == ".." {
		return false
	}
	if strings.HasPrefix(normalized, "/") || strings.HasPrefix(normalized, "../") {
		return false
	}

	if strings.HasPrefix(normalized, "output/") || strings.HasPrefix(normalized, "outputs/") || strings.HasPrefix(normalized, "output_file/") || strings.HasPrefix(normalized, "output_files/") {
		return true
	}

	// Compatibility: allow user-facing deliverables written to workspace root.
	// Keep this conservative so temp scripts/configs are not exposed.
	if strings.Contains(normalized, "/") {
		return false
	}
	switch strings.ToLower(filepath.Ext(normalized)) {
	case ".docx", ".doc", ".pdf", ".xlsx", ".xls", ".csv", ".pptx", ".ppt",
		".zip", ".png", ".jpg", ".jpeg",
		".gif", ".webp", ".mp3", ".wav", ".m4a", ".mp4", ".mov":
		return true
	default:
		return false
	}
}

func normalizeSandboxOutputFileName(fileName string) string {
	trimmed := strings.TrimSpace(fileName)
	if trimmed == "" {
		return ""
	}

	normalized := filepath.ToSlash(filepath.Clean(strings.ReplaceAll(trimmed, "\\", "/")))
	if normalized == "." || normalized == "/" {
		return ""
	}
	if strings.HasPrefix(normalized, "/") || strings.HasPrefix(normalized, "../") || normalized == ".." {
		return ""
	}
	return normalized
}

func buildSandboxOutputFileFingerprint(fileName string, content []byte) string {
	normalizedFileName := normalizeSandboxOutputFileName(fileName)
	if normalizedFileName == "" {
		return ""
	}
	sum := sha256.Sum256(content)
	return fmt.Sprintf("%s|%d|%x", normalizedFileName, len(content), sum[:])
}

func collectMatchingAIUploadFiles(ctx context.Context, existingFiles []*model.UploadFile, normalizedFileName string) ([]*model.UploadFile, string, []byte) {
	if len(existingFiles) == 0 || normalizedFileName == "" {
		return nil, "", nil
	}

	var matchedFiles []*model.UploadFile
	var primaryExisting *model.UploadFile

	for _, existing := range existingFiles {
		if existing == nil || existing.ID <= 0 {
			continue
		}
		if normalizeSandboxOutputFileName(existing.FileName) != normalizedFileName {
			continue
		}

		matchedFiles = append(matchedFiles, existing)
		if primaryExisting == nil || existing.ID > primaryExisting.ID {
			primaryExisting = existing
		}
	}

	var restoreKey string
	var restoreContent []byte
	if primaryExisting != nil {
		restoreKey = strings.TrimSpace(primaryExisting.Key)
		if restoreKey != "" {
			content, loadErr := storage.StorageInstance.Load(restoreKey)
			if loadErr != nil {
				logger.Warnf(ctx, "【沙盒】读取旧 AI 上传文件内容失败: file_name=%s key=%s err=%v", primaryExisting.FileName, restoreKey, loadErr)
				restoreKey = ""
			} else {
				restoreContent = content
			}
		}
	}

	return matchedFiles, restoreKey, restoreContent
}

func rollbackAIUploadFileWrite(ctx context.Context, fileName, fileKey, restoreKey string, restoreContent []byte) {
	if restoreContent != nil && restoreKey != "" {
		if restoreErr := storage.StorageInstance.Save(restoreContent, restoreKey); restoreErr != nil {
			logger.Warnf(ctx, "【沙盒】恢复旧 AI 上传文件内容失败: file_name=%s key=%s err=%v", fileName, restoreKey, restoreErr)
		}
	}
	if restoreKey == "" || restoreKey != fileKey {
		_ = storage.StorageInstance.Delete(fileKey)
	}
}

func computeAIUploadFileHash(content []byte, fileName string, messageID, eid, userID int64) string {
	sum := sha256.Sum256(append(append([]byte(fileName), content...), []byte(fmt.Sprintf(":%d:%d:%d", messageID, eid, userID))...))
	return hex.EncodeToString(sum[:])
}

// InitFileStorageManager 初始化文件存储管理器
func InitFileStorageManager() {
	fileStorageManager = &FileStorageManager{
		storage: &UnifiedStorage{},
	}
}

// GetFileStorageManager 获取文件存储管理器实例
func GetFileStorageManager() *FileStorageManager {
	if fileStorageManager == nil {
		InitFileStorageManager()
	}
	return fileStorageManager
}

// SaveAIUploadFiles 保存 AI 上传文件
func (m *FileStorageManager) SaveAIUploadFiles(ctx context.Context, messageID, eid, userID int64, outputFiles []OutputFile) ([]*model.UploadFile, error) {
	if len(outputFiles) == 0 {
		return nil, nil
	}

	existingFiles, err := model.GetUploadFilesByMessageIDAndSourceType(messageID, model.UploadFileSourceAIGenerated)
	if err != nil {
		logger.Warnf(ctx, "【沙盒】查询历史 AI 上传文件失败: message_id=%d err=%v", messageID, err)
	}

	var savedFiles []*model.UploadFile

	for _, file := range outputFiles {
		if !isAllowedSandboxOutputPath(file.FileName) {
			logger.Warnf(ctx, "【沙盒】AI 上传文件路径不在允许目录，跳过: file_name=%s (allowed: output/ or outputs/)", file.FileName)
			continue
		}

		normalizedFileName := normalizeSandboxOutputFileName(file.FileName)
		if normalizedFileName == "" {
			logger.Warnf(ctx, "【沙盒】AI 上传文件路径无效，跳过: file_name=%s", file.FileName)
			continue
		}

		matchedExistingFiles, restoreKey, restoreContent := collectMatchingAIUploadFiles(ctx, existingFiles, normalizedFileName)
		if len(matchedExistingFiles) > 0 {
			logger.Infof(ctx, "【沙盒】发现同名历史 AI 上传文件，准备覆盖: message_id=%d file_name=%s existing_count=%d",
				messageID, normalizedFileName, len(matchedExistingFiles))
		}

		logger.Infof(ctx, "Processing output file: %s, content length: %d, mime_type: %s", normalizedFileName, len(file.Content), file.MimeType)

		// 优先按 Base64 处理；若不是合法 Base64，则按原始文本内容兜底。
		content, err := base64.StdEncoding.DecodeString(strings.TrimSpace(file.Content))
		if err != nil || base64.StdEncoding.EncodeToString(content) != strings.TrimSpace(file.Content) {
			content = []byte(file.Content)
			logger.Warnf(ctx, "【沙盒】AI 上传文件内容不是合法 Base64，按原始文本兜底保存: file_name=%s, raw_chars=%d", file.FileName, len(file.Content))
		} else {
			logger.Infof(ctx, "Decoded file %s: %d bytes", file.FileName, len(content))
		}

		// 检查文件大小 (10MB 限制)
		const maxFileSize = 10 * 1024 * 1024
		if len(content) > maxFileSize {
			logger.Warnf(ctx, "File %s exceeds max size limit (%d > %d), skipping",
				file.FileName, len(content), maxFileSize)
			continue
		}

		currentFingerprint := buildSandboxOutputFileFingerprint(normalizedFileName, content)
		if currentFingerprint == "" {
			logger.Warnf(ctx, "【沙盒】输出文件指纹无效，跳过: file_name=%s", file.FileName)
			continue
		}

		if restoreContent != nil {
			if existingFingerprint := buildSandboxOutputFileFingerprint(normalizedFileName, restoreContent); existingFingerprint == currentFingerprint {
				logger.Infof(ctx, "【沙盒】输出文件内容未变化，跳过保存: message_id=%d file_name=%s",
					messageID, normalizedFileName)
				continue
			}
		}

		aiUploadFile := &model.UploadFile{
			MessageID:     messageID,
			SourceType:    model.UploadFileSourceAIGenerated,
			FileName:      normalizedFileName,
			Eid:           eid,
			UserID:        userID,
			Size:          int64(len(content)),
			Extension:     filepath.Ext(normalizedFileName),
			MimeType:      file.MimeType,
			Hash:          computeAIUploadFileHash(content, normalizedFileName, messageID, eid, userID),
			Status:        model.UploadStatusCompleted,
			ProcessedTime: time.Now().UTC().UnixMilli(),
		}

		// 生成存储路径
		fileKey := model.GetAIGeneratedUploadFileKey(normalizedFileName, eid, userID, messageID)
		aiUploadFile.Key = fileKey

		// 使用统一存储接口保存文件
		if err := storage.StorageInstance.Save(content, fileKey); err != nil {
			logger.Errorf(ctx, "Failed to save file %s to storage: %v", file.FileName, err)
			rollbackAIUploadFileWrite(ctx, file.FileName, fileKey, restoreKey, restoreContent)
			continue
		}
		logger.Infof(ctx, "Saved file %s to storage: %s", file.FileName, fileKey)

		// 保存数据库记录
		if err := model.CreateAIUploadFile(aiUploadFile); err != nil {
			logger.Errorf(ctx, "Failed to save file metadata to DB: %v", err)
			// 尝试恢复旧内容，避免新版本写入失败导致旧文件丢失
			rollbackAIUploadFileWrite(ctx, file.FileName, fileKey, restoreKey, restoreContent)
			continue
		}

		if len(matchedExistingFiles) > 0 {
			for _, existing := range matchedExistingFiles {
				if existing == nil || existing.ID <= 0 {
					continue
				}
				if key := strings.TrimSpace(existing.Key); key != "" && key != fileKey {
					if delErr := storage.StorageInstance.Delete(key); delErr != nil {
						logger.Warnf(ctx, "【沙盒】删除旧 AI 上传文件存储失败: file_name=%s key=%s err=%v", normalizedFileName, key, delErr)
					}
				}
				if delErr := model.DeleteUploadFileByID(existing.ID); delErr != nil {
					logger.Warnf(ctx, "【沙盒】删除旧 AI 上传文件记录失败: file_name=%s file_id=%d err=%v", normalizedFileName, existing.ID, delErr)
				}
			}
		}

		savedFiles = append(savedFiles, aiUploadFile)
		existingFiles = append(existingFiles, aiUploadFile)
		logger.Infof(ctx, "Saved AI upload file: %s (id: %d, key: %s)", file.FileName, aiUploadFile.ID, aiUploadFile.Key)
	}

	logger.Infof(ctx, "SaveAIUploadFiles completed: input=%d, saved=%d", len(outputFiles), len(savedFiles))
	return savedFiles, nil
}

// SaveSandboxOutputFiles 保持旧接口兼容，内部统一走 AI 上传文件存储链路。
func (m *FileStorageManager) SaveSandboxOutputFiles(ctx context.Context, messageID, eid, userID int64, outputFiles []OutputFile) ([]*model.UploadFile, error) {
	return m.SaveAIUploadFiles(ctx, messageID, eid, userID, outputFiles)
}

// GetFilesByMessageID 获取消息关联的所有文件
func (m *FileStorageManager) GetFilesByMessageID(ctx context.Context, messageID int64) ([]*model.UploadFile, error) {
	return model.GetAIUploadFilesByMessageID(messageID)
}

func (m *FileStorageManager) SaveGeneratedFiles(ctx context.Context, messageID, eid, userID int64, files []GeneratedFile) ([]*model.UploadFile, error) {
	if len(files) == 0 {
		return nil, nil
	}

	var outputFiles []OutputFile
	for _, file := range files {
		outputFiles = append(outputFiles, OutputFile{FileName: file.FileName, Content: base64.StdEncoding.EncodeToString(file.Content), MimeType: file.MimeType})
	}
	return m.SaveAIUploadFiles(ctx, messageID, eid, userID, outputFiles)
}

// UnifiedStorage 统一存储实现（复用 storage.StorageInstance）
type UnifiedStorage struct{}

// Upload 上传文件到统一存储
func (u *UnifiedStorage) Upload(ctx context.Context, fileName string, content []byte) (string, error) {
	// 生成安全的文件名
	safeFileName := generateSafeFileName(fileName)

	// 构建存储路径（按日期分目录）
	dateDir := time.Now().Format("20060102")
	storageKey := filepath.Join(dateDir, safeFileName)

	// 使用统一存储接口保存
	if err := storage.StorageInstance.Save(content, storageKey); err != nil {
		return "", fmt.Errorf("failed to save file: %v", err)
	}

	// 返回访问 URL
	return fmt.Sprintf("%s/%s", config.FileStorageURL, storageKey), nil
}

// GetURL 获取文件访问 URL
func (u *UnifiedStorage) GetURL(ctx context.Context, storageKey string) (string, error) {
	return fmt.Sprintf("%s/%s", config.FileStorageURL, storageKey), nil
}

// generateSafeFileName 生成安全的文件名
func generateSafeFileName(fileName string) string {
	// 移除路径遍历字符
	fileName = filepath.Base(fileName)

	// 添加时间戳前缀避免冲突
	timestamp := time.Now().UnixNano()
	ext := filepath.Ext(fileName)
	name := strings.TrimSuffix(fileName, ext)

	return fmt.Sprintf("%s_%d%s", name, timestamp, ext)
}

// ensureDir 确保目录存在
func ensureDir(dir string) error {
	return os.MkdirAll(dir, 0755)
}

// writeFile 写入文件
func writeFile(path string, content []byte) error {
	return os.WriteFile(path, content, 0644)
}
