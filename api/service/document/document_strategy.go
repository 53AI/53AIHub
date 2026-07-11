package document

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/docconv"
)

// DocumentProcessResult 文档处理结果
type DocumentProcessResult struct {
	OriginalContent  string `json:"original_content"`  // 原始内容
	ProcessedContent string `json:"processed_content"` // 处理后内容（转换后的Markdown）
	StorageKey       string `json:"storage_key"`       // 存储键
	StorageType      string `json:"storage_type"`      // 存储类型（local/oss）
	FileType         string `json:"file_type"`         // 文件类型
	FileName         string `json:"file_name"`         // 文件名
	FileSize         int64  `json:"file_size"`         // 文件大小
	DurationMs       int64  `json:"duration_ms"`       // 媒体时长（毫秒）
	NeedsConversion  bool   `json:"needs_conversion"`  // 是否需要转换
	DeleteOriginal   bool   `json:"delete_original"`   // 是否删除原始文件
	ConfigId         int64  `json:"config_id"`
}

// DocumentProcessStrategy 文档处理策略接口
type DocumentProcessStrategy interface {
	// Process 处理文档内容
	Process(content []byte, filename string, fileSize int64, eid, userID int64) (*DocumentProcessResult, error)
	// ProcessWithUploadFile 使用 UploadFile 处理文档内容（用于需要 PreviewKey 的策略）
	ProcessWithUploadFile(fileID int64, content []byte, filename string, fileSize int64, eid, userID int64, uploadFile *model.UploadFile, parseType string) (*DocumentProcessResult, error)
	// GetStrategyName 获取策略名称
	GetStrategyName() string
}

// MarkdownDocumentStrategy Markdown文档处理策略
type MarkdownDocumentStrategy struct {
	converter      *ConverterService
	storageService storage.Storage
}

// NewMarkdownDocumentStrategy 创建Markdown文档处理策略
func NewMarkdownDocumentStrategy(converter *ConverterService, storageService storage.Storage) *MarkdownDocumentStrategy {
	return &MarkdownDocumentStrategy{
		converter:      converter,
		storageService: storageService,
	}
}

// Process 处理Markdown文档
func (s *MarkdownDocumentStrategy) Process(content []byte, filename string, fileSize int64, eid, userID int64) (*DocumentProcessResult, error) {
	// 防御性检查：确保依赖项不为nil
	if s.converter == nil {
		return nil, fmt.Errorf("MarkdownDocumentStrategy: converter 未初始化")
	}
	if s.storageService == nil {
		return nil, fmt.Errorf("MarkdownDocumentStrategy: storageService 未初始化")
	}

	// Markdown文件直接存储，不需要转换
	key := fmt.Sprintf("documents/%d/%d/%s", eid, userID, filename)

	// 存储文件
	// err := s.storageService.Save(content, key)
	// if err != nil {
	// 	return nil, fmt.Errorf("存储Markdown文件失败: %v", err)
	// }

	// 构建处理结果
	result := &DocumentProcessResult{
		OriginalContent:  string(content),
		ProcessedContent: string(content), // Markdown不需要转换
		StorageKey:       key,
		StorageType:      "local",
		FileType:         "markdown",
		FileName:         filename,
		FileSize:         fileSize,
		NeedsConversion:  false,
		DeleteOriginal:   false, // 不删除原始文件
	}

	return result, nil
}

// ProcessWithUploadFile 处理Markdown文档（兼容新接口）
func (s *MarkdownDocumentStrategy) ProcessWithUploadFile(fileID int64, content []byte, filename string, fileSize int64, eid, userID int64, uploadFile *model.UploadFile, parseType string) (*DocumentProcessResult, error) {
	return s.Process(content, filename, fileSize, eid, userID)
}

// GetStrategyName 获取策略名称
func (s *MarkdownDocumentStrategy) GetStrategyName() string {
	return "markdown_strategy"
}

// TextDocumentStrategy 文本文档处理策略
type TextDocumentStrategy struct {
	converter      *ConverterService
	storageService storage.Storage
}

// NewTextDocumentStrategy 创建文本文档处理策略
func NewTextDocumentStrategy(converter *ConverterService, storageService storage.Storage) *TextDocumentStrategy {
	return &TextDocumentStrategy{
		converter:      converter,
		storageService: storageService,
	}
}

// Process 处理文本文档
func (s *TextDocumentStrategy) Process(content []byte, filename string, fileSize int64, eid, userID int64) (*DocumentProcessResult, error) {
	// 防御性检查：确保依赖项不为nil
	if s.converter == nil {
		return nil, fmt.Errorf("TextDocumentStrategy: converter 未初始化")
	}
	if s.storageService == nil {
		return nil, fmt.Errorf("TextDocumentStrategy: storageService 未初始化")
	}

	// 将文本转换为Markdown格式
	markdownContent, err := s.converter.ConvertTextToMarkdown(string(content))
	if err != nil {
		return nil, fmt.Errorf("文本转Markdown失败: %v", err)
	}

	// 生成新的文件名（替换扩展名为.md）
	mdFilename := strings.TrimSuffix(filename, filepath.Ext(filename)) + ".md"
	key := fmt.Sprintf("documents/%d/%d/%s", eid, userID, mdFilename)

	// 存储转换后的Markdown文件
	// err = s.storageService.Save([]byte(markdownContent), key)
	// if err != nil {
	// 	return nil, fmt.Errorf("存储转换后的Markdown文件失败: %v", err)
	// }

	// 构建处理结果
	result := &DocumentProcessResult{
		OriginalContent:  string(content),
		ProcessedContent: markdownContent,
		StorageKey:       key,
		StorageType:      "local",
		FileType:         "markdown",
		FileName:         mdFilename,
		FileSize:         int64(len(markdownContent)),
		NeedsConversion:  true,
		DeleteOriginal:   true, // 删除原始文件
	}

	return result, nil
}

// ProcessWithUploadFile 处理文本文档（兼容新接口）
func (s *TextDocumentStrategy) ProcessWithUploadFile(fileID int64, content []byte, filename string, fileSize int64, eid, userID int64, uploadFile *model.UploadFile, parseType string) (*DocumentProcessResult, error) {
	return s.Process(content, filename, fileSize, eid, userID)
}

// GetStrategyName 获取策略名称
func (s *TextDocumentStrategy) GetStrategyName() string {
	return "text_strategy"
}

// HtmlDocumentStrategy HTML文档处理策略
type HtmlDocumentStrategy struct {
	converter      *ConverterService
	storageService storage.Storage
}

// NewHtmlDocumentStrategy 创建HTML文档处理策略
func NewHtmlDocumentStrategy(converter *ConverterService, storageService storage.Storage) *HtmlDocumentStrategy {
	return &HtmlDocumentStrategy{
		converter:      converter,
		storageService: storageService,
	}
}

// Process 处理HTML文档
func (s *HtmlDocumentStrategy) Process(content []byte, filename string, fileSize int64, eid, userID int64) (*DocumentProcessResult, error) {
	// 防御性检查：确保依赖项不为nil
	if s.converter == nil {
		return nil, fmt.Errorf("HtmlDocumentStrategy: converter 未初始化")
	}
	if s.storageService == nil {
		return nil, fmt.Errorf("HtmlDocumentStrategy: storageService 未初始化")
	}

	// 验证HTML内容
	if err := s.converter.ValidateHTML(string(content)); err != nil {
		return nil, fmt.Errorf("HTML验证失败: %v", err)
	}

	// 将HTML转换为Markdown
	markdownContent, err := s.converter.ConvertHTMLToMarkdown(string(content))
	if err != nil {
		return nil, fmt.Errorf("HTML转Markdown失败: %v", err)
	}

	// 上传原始HTML文件到OSS
	ossKey := fmt.Sprintf("html-documents/%d/%d/%s", eid, userID, filename)
	err = s.storageService.Save(content, ossKey)
	if err != nil {
		return nil, fmt.Errorf("上传HTML文件到OSS失败: %v", err)
	}

	// 生成新的文件名（替换扩展名为.md）
	// mdFilename := strings.TrimSuffix(filename, filepath.Ext(filename)) + ".md"
	// mdKey := fmt.Sprintf("documents/%d/%d/%s", eid, userID, mdFilename)

	// 存储转换后的Markdown文件
	// err = s.storageService.Save([]byte(markdownContent), mdKey)
	// if err != nil {
	// 	return nil, fmt.Errorf("存储转换后的Markdown文件失败: %v", err)
	// }

	// 构建处理结果
	result := &DocumentProcessResult{
		OriginalContent:  string(content),
		ProcessedContent: markdownContent,
		StorageKey:       ossKey,
		StorageType:      "oss",
		FileType:         "markdown",
		FileName:         filename,
		FileSize:         fileSize,
		NeedsConversion:  true,
		DeleteOriginal:   false, // 不删除原始文件
	}

	return result, nil
}

// ProcessWithUploadFile 处理HTML文档（兼容新接口）
func (s *HtmlDocumentStrategy) ProcessWithUploadFile(fileID int64, content []byte, filename string, fileSize int64, eid, userID int64, uploadFile *model.UploadFile, parseType string) (*DocumentProcessResult, error) {
	return s.Process(content, filename, fileSize, eid, userID)
}

// GetStrategyName 获取策略名称
func (s *HtmlDocumentStrategy) GetStrategyName() string {
	return "html_strategy"
}

// DocumentStrategyFactory 文档策略工厂
type DocumentStrategyFactory struct {
	converter      *ConverterService
	storageService storage.Storage
}

// NewDocumentStrategyFactory 创建文档策略工厂
func NewDocumentStrategyFactory(converter *ConverterService, storageService storage.Storage) *DocumentStrategyFactory {
	return &DocumentStrategyFactory{
		converter:      converter,
		storageService: storageService,
	}
}

// GetStrategy 根据文件类型获取处理策略
func (f *DocumentStrategyFactory) GetStrategy(filename string, libraryId int64) DocumentProcessStrategy {
	ext := strings.ToLower(filepath.Ext(filename))

	switch ext {
	case ".md":
		return NewMarkdownDocumentStrategy(f.converter, f.storageService)
	case ".txt":
		return NewTextDocumentStrategy(f.converter, f.storageService)
	case ".html", ".htm":
		return NewHtmlDocumentStrategy(f.converter, f.storageService)
	default:
		// 统一使用 docconv 处理策略
		return NewDocconvDocumentStrategy(libraryId)
	}
}

// DocconvDocumentStrategy docconv 文档处理策略
type DocconvDocumentStrategy struct {
	docconvService *docconv.Service
}

// NewDocconvDocumentStrategy 创建 docconv 文档处理策略
func NewDocconvDocumentStrategy(libraryId int64) *DocconvDocumentStrategy {
	return &DocconvDocumentStrategy{
		docconvService: docconv.NewService(libraryId),
	}
}

// Process 使用 docconv 处理文档（兼容旧接口）
func (s *DocconvDocumentStrategy) Process(content []byte, filename string, fileSize int64, eid, userID int64) (*DocumentProcessResult, error) {
	return nil, fmt.Errorf("DocconvDocumentStrategy requires UploadFile, use ProcessWithUploadFile instead")
}

// ProcessWithUploadFile 使用 docconv 处理文档
func (s *DocconvDocumentStrategy) ProcessWithUploadFile(fileID int64, content []byte, filename string, fileSize int64, eid, userID int64, uploadFile *model.UploadFile, parseType string) (*DocumentProcessResult, error) {
	// 构造 sourceURL，使用 PreviewKey
	sourceURL := uploadFile.GetPreviewOrOssDownloadUrl()

	logger.Infof(nil, "📁 [DOC_STRATEGY] DocconvDocumentStrategy 开始处理文件 - filename: %s, eid: %d, userID: %d, size: %d bytes",
		filename, eid, userID, fileSize)
	logger.Infof(nil, "🔗 [DOC_STRATEGY] 文件预览链接 - sourceURL: %s", sourceURL)

	// 使用传入的 fileID 获取文件信息
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		logger.Errorf(nil, "❌ [DOC_STRATEGY] 获取文件信息失败 - fileID: %d, error: %v", fileID, err)
		return nil, fmt.Errorf("failed to get file info: %w", err)
	}

	// 调用 docconv 同步转换（使用配置）
	ctx := context.Background()
	markdownContent, err := s.docconvService.ConvertSyncWithConfig(ctx, sourceURL, eid, filename, parseType, file.LibraryID, file.ID)
	if err != nil {
		logger.Errorf(nil, "❌ [DOC_STRATEGY] docconv 转换失败 - filename: %s, error: %v", filename, err)
		return nil, fmt.Errorf("docconv conversion failed: %w", err)
	}

	// 构建处理结果
	mdFilename := strings.TrimSuffix(filename, filepath.Ext(filename)) + ".md"
	result := &DocumentProcessResult{
		OriginalContent:  string(content),
		ProcessedContent: markdownContent,
		StorageKey:       "", // docconv 不需要额外存储
		StorageType:      "none",
		FileType:         "markdown",
		FileName:         mdFilename,
		FileSize:         int64(len(markdownContent)),
		NeedsConversion:  true,
		DeleteOriginal:   false,
		ConfigId:         s.docconvService.ConfigId,
	}

	logger.Infof(nil, "✅ [DOC_STRATEGY] docconv 转换成功 - original: %s, converted: %s, output_size: %d bytes",
		filename, mdFilename, len(markdownContent))

	return result, nil
}

// GetStrategyName 获取策略名称
func (s *DocconvDocumentStrategy) GetStrategyName() string {
	return "docconv"
}
