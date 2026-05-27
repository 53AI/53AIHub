package document

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"

	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/model"
)

// FileProcessor 定义文件处理接口
type FileProcessor interface {
	Process(file *multipart.FileHeader, libraryID, userID string) (*model.File, error)
	GetSupportedTypes() []string
	GetSupportedExtensions() []string
}

// ProcessRequest 文档处理请求
type ProcessRequest struct {
	Content   string
	LibraryID int64
	FileName  string
	UserID    int64
}

// StorageService 定义存储服务接口
type StorageService interface {
	SaveFile(file io.Reader, filename string, size int64) (string, error)
	GetFile(key string) (io.ReadCloser, error)
	DeleteFile(key string) error
}

// ProcessingStats 处理统计信息
type ProcessingStats struct {
	TotalFiles     int   `json:"total_files"`
	SuccessFiles   int   `json:"success_files"`
	FailedFiles    int   `json:"failed_files"`
	ConvertedFiles int   `json:"converted_files"`
	TotalSize      int64 `json:"total_size"`
}

// EnhancedDocumentProcessor 增强的文档处理器
type EnhancedDocumentProcessor struct {
	strategyFactory *DocumentStrategyFactory
	reader          DocumentReader
}

// NewEnhancedDocumentProcessor 创建增强的文档处理器
func NewEnhancedDocumentProcessor() *EnhancedDocumentProcessor {
	converter := NewConverterService()
	storageService := storage.StorageInstance

	return &EnhancedDocumentProcessor{
		strategyFactory: NewDocumentStrategyFactory(converter, storageService),
		reader:          NewDocumentReader(),
	}
}

// ProcessDocumentFile 处理文档文件（流式处理版本）
// func (p *EnhancedDocumentProcessor) ProcessDocumentFile(fileHeader *multipart.FileHeader, uploadFile *model.UploadFile, eid, userID int64, libraryID int64) (*DocumentProcessResult, error) {
// 	if fileHeader == nil {
// 		return nil, fmt.Errorf("文件不能为空")
// 	}

// 	// 验证文件类型
// 	if err := p.validateFileType(fileHeader.Filename); err != nil {
// 		return nil, fmt.Errorf("文件类型验证失败: %v", err)
// 	}

// 	// 打开文件
// 	file, err := fileHeader.Open()
// 	if err != nil {
// 		return nil, fmt.Errorf("打开文件失败: %v", err)
// 	}
// 	defer file.Close()

// 	// 创建临时文件用于流式处理大文件
// 	tempFile, err := p.createTempFileFromStream(file, fileHeader.Filename)
// 	if err != nil {
// 		return nil, fmt.Errorf("创建临时文件失败: %v", err)
// 	}
// 	defer func() {
// 		tempFile.Close()
// 		os.Remove(tempFile.Name())
// 	}()

// 	// 从临时文件读取内容
// 	content, err := p.reader.Read(tempFile)
// 	if err != nil {
// 		return nil, fmt.Errorf("读取文件失败: %v", err)
// 	}

// 	// 获取适合的策略
// 	strategy := p.strategyFactory.GetStrategy(fileHeader.Filename, libraryID)

// 	// 使用策略处理文档，优先使用 ProcessWithUploadFile
// 	var result *DocumentProcessResult

// 	// 检查策略是否为 DocconvDocumentStrategy，如果是则使用 ProcessWithUploadFile
// 	if strategy.GetStrategyName() == "docconv" {
// 		result, err = strategy.ProcessWithUploadFile(content, fileHeader.Filename, fileHeader.Size, eid, userID, uploadFile, "")
// 	} else {
// 		result, err = strategy.Process(content, fileHeader.Filename, fileHeader.Size, eid, userID)
// 	}

// 	if err != nil {
// 		return nil, fmt.Errorf("处理文档失败: %v", err)
// 	}

// 	return result, nil
// }

// ProcessDocumentFileWithReader 使用io.Reader处理文档文件
// func (p *EnhancedDocumentProcessor) ProcessDocumentFileWithReader(fileHeader *multipart.FileHeader, uploadFile *model.UploadFile, eid, userID, fileId, libraryId int64, reader io.Reader, parseType string) (*DocumentProcessResult, error) {
// 	if fileHeader == nil {
// 		return nil, fmt.Errorf("文件不能为空")
// 	}

// 	// 验证文件类型
// 	if err := p.validateFileType(fileHeader.Filename); err != nil {
// 		return nil, fmt.Errorf("文件类型验证失败: %v", err)
// 	}

// 	// 将文件转换状态设置为"converting"
// 	if err := model.UpdateFileConversionStatus(fileId, model.FileConversionStatusConverting); err != nil {
// 		// 记录错误但不中断处理流程
// 		fmt.Printf("警告: 更新文件转换状态为converting失败: %v\n", err)
// 	}

// 	// 打开文件
// 	file, err := fileHeader.Open()
// 	if err != nil {
// 		return nil, fmt.Errorf("打开文件失败: %v", err)
// 	}
// 	defer file.Close()

// 	// 创建临时文件用于流式处理大文件
// 	tempFile, err := p.createTempFileFromStream(reader, fileHeader.Filename)
// 	if err != nil {
// 		// 将文件转换状态设置为"failed"
// 		if err := model.UpdateFileConversionStatus(fileId, model.FileConversionStatusFail); err != nil {
// 			fmt.Printf("警告: 更新文件转换状态为failed失败: %v\n", err)
// 		}
// 		return nil, fmt.Errorf("创建临时文件失败: %v", err)
// 	}
// 	defer func() {
// 		tempFile.Close()
// 		os.Remove(tempFile.Name())
// 	}()

// 	// 从临时文件读取内容
// 	content, err := p.reader.Read(tempFile)
// 	if err != nil {
// 		// 将文件转换状态设置为"failed"
// 		if err := model.UpdateFileConversionStatus(fileId, model.FileConversionStatusFail); err != nil {
// 			fmt.Printf("警告: 更新文件转换状态为failed失败: %v\n", err)
// 		}
// 		return nil, fmt.Errorf("读取文件失败: %v", err)
// 	}

// 	// 获取适合的策略
// 	strategy := p.strategyFactory.GetStrategy(fileHeader.Filename, libraryId)

// 	// 使用策略处理文档，优先使用 ProcessWithUploadFile
// 	var result *DocumentProcessResult

// 	// 检查策略是否为 DocconvDocumentStrategy，如果是则使用 ProcessWithUploadFile
// 	if strategy.GetStrategyName() == "docconv" {
// 		result, err = strategy.ProcessWithUploadFile(content, fileHeader.Filename, fileHeader.Size, eid, userID, uploadFile, parseType)
// 	} else {
// 		result, err = strategy.Process(content, fileHeader.Filename, fileHeader.Size, eid, userID)
// 	}

// 	// 根据处理结果更新文件转换状态
// 	if err != nil {
// 		// 处理失败，将文件转换状态设置为"failed"
// 		if updateErr := model.UpdateFileConversionStatus(fileId, model.FileConversionStatusFail); updateErr != nil {
// 			fmt.Printf("警告: 更新文件转换状态为failed失败: %v\n", updateErr)
// 		}
// 	} else {
// 		// 处理成功，将文件转换状态设置为"normal"
// 		if updateErr := model.UpdateFileConversionStatus(fileId, model.FileConversionStatusNormal); updateErr != nil {
// 			fmt.Printf("警告: 更新文件转换状态为normal失败: %v\n", updateErr)
// 		}
// 	}

// 	if err != nil {
// 		return nil, fmt.Errorf("处理文档失败: %v", err)
// 	}

// 	return result, nil
// }

// createTempFileFromStream 从流创建临时文件，避免大文件占用内存
func (p *EnhancedDocumentProcessor) createTempFileFromStream(src io.Reader, filename string) (*os.File, error) {
	// 创建临时文件
	tempFile, err := os.CreateTemp("", fmt.Sprintf("doc_process_%s_*.tmp", filepath.Base(filename)))
	if err != nil {
		return nil, fmt.Errorf("创建临时文件失败: %v", err)
	}

	// 流式复制，避免将整个文件加载到内存
	_, err = io.Copy(tempFile, src)
	if err != nil {
		tempFile.Close()
		os.Remove(tempFile.Name())
		return nil, fmt.Errorf("复制文件内容失败: %v", err)
	}

	// 重置文件指针到开头
	if _, err := tempFile.Seek(0, 0); err != nil {
		tempFile.Close()
		os.Remove(tempFile.Name())
		return nil, fmt.Errorf("重置文件指针失败: %v", err)
	}

	return tempFile, nil
}

// validateFileType 验证文件类型
func (p *EnhancedDocumentProcessor) validateFileType(filename string) error {
	ext := strings.ToLower(filepath.Ext(filename))
	supportedExts := map[string]bool{
		".md":   true,
		".txt":  true,
		".html": true,
		".htm":  true,
		".pdf":  true,
		".ppt":  true,
		".pptx": true,
		".doc":  true,
		".docx": true,
		".xls":  true,
		".xlsx": true,
		".csv":  true,
		".json": true,
		".xml":  true,
		".epub": true,
	}

	if !supportedExts[ext] {
		return fmt.Errorf("不支持的文件扩展名: %s", ext)
	}

	return nil
}

// GetSupportedExtensions 获取支持的文件扩展名
func (p *EnhancedDocumentProcessor) GetSupportedExtensions() []string {
	return []string{
		".md", ".txt", ".html", ".htm",
		".pdf", ".ppt", ".pptx", ".doc", ".docx",
		".xls", ".xlsx", ".csv", ".json", ".xml", ".epub",
	}
}

// GetSupportedMimeTypes 获取支持的MIME类型
func (p *EnhancedDocumentProcessor) GetSupportedMimeTypes() []string {
	return []string{
		"text/markdown",
		"text/plain",
		"text/html",
		"application/octet-stream", // 允许未知类型，通过扩展名判断
	}
}

// cleanupIncompleteFileRecord 清理不完整的文件记录
func (p *EnhancedDocumentProcessor) cleanupIncompleteFileRecord(fileID, eid int64) {
	// 使用级联删除清理相关数据
	if err := model.DeleteFile(eid, fileID); err != nil {
		// Log the error if necessary, but avoid fmt.Printf here
	}
}

// GetProcessingStats 获取处理统计信息
func (p *EnhancedDocumentProcessor) GetProcessingStats() *ProcessingStats {
	// 这里可以实现统计逻辑
	return &ProcessingStats{
		TotalFiles:     0,
		SuccessFiles:   0,
		FailedFiles:    0,
		ConvertedFiles: 0,
		TotalSize:      0,
	}
}

// 从字节数组计算SHA256哈希值
func getFileHashFromBytes(data []byte) (string, error) {
	hash := sha256.New()
	if _, err := hash.Write(data); err != nil {
		return "", err
	}
	hashInBytes := hash.Sum(nil)
	return hex.EncodeToString(hashInBytes), nil
}

// =================== 存储服务实现 ===================

// LocalStorage 本地存储实现
type LocalStorage struct{}

func (ls *LocalStorage) SaveFile(file io.Reader, filename string, size int64) (string, error) {
	// 读取文件内容
	fileContent, err := io.ReadAll(file)
	if err != nil && err != io.EOF {
		return "", fmt.Errorf("读取文件内容失败: %v", err)
	}

	// 计算文件哈希
	hashStr, err := getFileHashFromBytes(fileContent)
	if err != nil {
		return "", fmt.Errorf("计算文件哈希失败: %v", err)
	}

	// 生成预览键
	extension := filepath.Ext(filename)
	previewKey := hashStr + extension

	// 使用全局存储实例保存文件
	key := fmt.Sprintf("documents/%s", previewKey)
	err = storage.StorageInstance.Save(fileContent, key)
	if err != nil {
		return "", fmt.Errorf("保存文件失败: %v", err)
	}

	return key, nil
}

func (ls *LocalStorage) GetFile(key string) (io.ReadCloser, error) {
	// 使用全局存储实例加载文件
	fileContent, err := storage.StorageInstance.Load(key)
	if err != nil {
		return nil, fmt.Errorf("加载文件失败: %v", err)
	}

	// 将字节数组转换为ReadCloser
	return io.NopCloser(bytes.NewReader(fileContent)), nil
}

func (ls *LocalStorage) DeleteFile(key string) error {
	// 使用全局存储实例删除文件
	err := storage.StorageInstance.Delete(key)
	if err != nil {
		return fmt.Errorf("删除文件失败: %v", err)
	}
	return nil
}

// OSSStorage OSS存储实现
type OSSStorage struct{}

func (os *OSSStorage) SaveFile(file io.Reader, filename string, size int64) (string, error) {
	// 读取文件内容
	fileContent, err := io.ReadAll(file)
	if err != nil && err != io.EOF {
		return "", fmt.Errorf("读取文件内容失败: %v", err)
	}

	// 计算文件哈希
	hashStr, err := getFileHashFromBytes(fileContent)
	if err != nil {
		return "", fmt.Errorf("计算文件哈希失败: %v", err)
	}

	// 生成预览键
	extension := filepath.Ext(filename)
	previewKey := hashStr + extension

	// 使用全局存储实例保存文件（OSS路径前缀不同）
	key := fmt.Sprintf("html-documents/%s", previewKey)
	err = storage.StorageInstance.Save(fileContent, key)
	if err != nil {
		return "", fmt.Errorf("保存文件到OSS失败: %v", err)
	}

	return key, nil
}

func (os *OSSStorage) GetFile(key string) (io.ReadCloser, error) {
	// 使用全局存储实例加载文件
	fileContent, err := storage.StorageInstance.Load(key)
	if err != nil {
		return nil, fmt.Errorf("从OSS加载文件失败: %v", err)
	}

	// 将字节数组转换为ReadCloser
	return io.NopCloser(bytes.NewReader(fileContent)), nil
}

func (os *OSSStorage) DeleteFile(key string) error {
	// 使用全局存储实例删除文件
	err := storage.StorageInstance.Delete(key)
	if err != nil {
		return fmt.Errorf("从OSS删除文件失败: %v", err)
	}
	return nil
}
