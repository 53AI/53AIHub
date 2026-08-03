package model

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/storage"
	"github.com/53AI/53AIHub/service/vectorstore"
	"gorm.io/gorm"
)

type File struct {
	ID        int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	Sort      int64  `json:"sort" gorm:"not null;default:0" example:"0"`
	Path      string `json:"path" gorm:"not null;type:varchar(512);default:''"`
	Type      int    `json:"type" gorm:"not null;default:0;index:idx_files_eid_library_deleted_type,priority:3" example:"0"`
	LibraryID int64  `json:"library_id" gorm:"not null;index:idx_files_library_id;index:idx_files_eid_library_deleted_type,priority:4"`
	Eid       int64  `json:"eid" gorm:"not null;index;index:idx_files_eid_library_deleted_type,priority:1"`
	// 新增：文档级配置ID
	ConfigID     *int64 `json:"config_id" gorm:"index" comment:"文档专用分块配置ID"`
	UploadFileID int64  `json:"upload_file_id" gorm:"not null"`
	OriginType   string `json:"origin_type" gorm:"size:32;not null;default:manual_create;index"`
	OriginRefID  int64  `json:"origin_ref_id" gorm:"not null;default:0;index"`
	OriginSource string `json:"origin_source" gorm:"size:64;not null;default:'';index"`
	GroupID      int64  `json:"group_id" gorm:"not null;default:0;index"`
	// 解析类型: default, textin, mineru.net
	ParseType string `json:"parse_type" gorm:"type:varchar(50);not null;default:''"`

	// 软删除标记与信息
	IsDeleted       bool  `json:"is_deleted" gorm:"not null;default:false;index:idx_files_library_id;index:idx_files_eid_library_deleted_type,priority:2"`
	IsActiveDeleted bool  `json:"is_active_deleted" gorm:"not null;default:false;index:idx_files_library_id"`
	DeletedBy       int64 `json:"deleted_by" gorm:"not null;default:0"`
	DeletedAt       int64 `json:"deleted_at" gorm:"not null;default:0"`
	UserID          int64 `json:"user_id" gorm:"not null;default:0;index:idx_files_library_id" comment:"文件创建人ID"`

	// 文件处理状态字段
	// 转换状态: 可取值 "normal","pending","converting","failed"
	ConversionStatus string `json:"conversion_status" gorm:"type:varchar(20);default:'inactive'"`
	// 解析状态: 可取值 "normal","pending","parsing","failed","disabled"
	ParsingStatus         string `json:"parsing_status" gorm:"type:varchar(20);default:'inactive';comment:'解析状态:normal,pending,parsing,failed,disabled'"`
	AIGenerateChunkStatus string `json:"ai_generate_chunk_status" gorm:"type:varchar(20);default:'inactive';comment:'AI 索引增强状态:inactive,pending,normal,parsing,failed'"`
	AIGenerateSQStatus    string `json:"ai_generate_sq_status" gorm:"type:varchar(20);default:'inactive';comment:'AI 问题和简介生成状态:inactive,pending,normal,parsing,failed'"`

	// AI生成内容
	Summary        string   `json:"summary" gorm:"type:text;comment:'AI生成的简介内容'"`
	Questions      string   `json:"questions" gorm:"type:text;comment:'AI生成的问题JSON数组字符串'"`
	KnowledgeMap   string   `json:"knowledge_map" gorm:"type:text;comment:'知识地图(Mermaid mindmap)'"`
	InsightSummary LongText `json:"insight_summary" gorm:"comment:'洞察和总结(Markdown格式,用于页面展示)'"`

	// 索引禁用相关字段
	DisabledReason string `json:"disabled_reason,omitempty" gorm:"type:varchar(255);comment:'禁用原因'"`
	DisabledBy     int64  `json:"disabled_by,omitempty" gorm:"comment:'禁用操作人ID'"`
	DisabledAt     int64  `json:"disabled_at,omitempty" gorm:"comment:'禁用时间戳'"`

	// 媒体时长（毫秒），由听悟 AudioInfo.Duration 或 FFprobe 探测写入
	DurationMs int64 `json:"duration_ms" gorm:"not null;default:0;comment:'媒体时长(毫秒)'"`

	// 字符统计字段
	CharacterCount int `json:"character_count" gorm:"not null;default:0;comment:'字符数'"`

	CleaningRuleInfo string `json:"cleaning_rule_info" gorm:"type:text;comment:'清洗规则与任务状态冗余信息'"`
	RunStatus        string `json:"run_status" gorm:"size:20;default:'not_started';index"`

	// 最后内容更新时间
	LastBodyTime int64 `json:"last_body_time,omitempty" gorm:"-"`

	BaseModel
	UploadFile   *UploadFile `json:"upload_file" gorm:"-"`
	IsFavorite   bool        `json:"is_favorite" gorm:"-"`
	UploadSource string      `json:"upload_source" gorm:"-"`
}

func (f *File) AfterFind(tx *gorm.DB) (err error) {
	if f.OriginType == "" {
		if f.UploadFileID > 0 {
			f.OriginType = FileOriginTypePersonalUpload
			f.OriginRefID = f.UploadFileID
			if f.OriginSource == "" {
				f.OriginSource = FileOriginSourceLocal
			}
		} else {
			f.OriginType = FileOriginTypeManualCreate
			if f.OriginSource == "" {
				f.OriginSource = FileOriginSourceDirect
			}
		}
	}
	switch f.OriginType {
	case FileOriginTypePersonalUpload:
		f.UploadSource = FileOriginSourceLocal
		if f.OriginSource == "" {
			f.OriginSource = FileOriginSourceLocal
		}
	case FileOriginTypeAIGenerated:
		f.UploadSource = FileOriginSourceAI
		if f.OriginSource == "" {
			f.OriginSource = FileOriginSourceAI
		}
	case FileOriginTypeRecordingAudio, FileOriginTypeRecordingFolder:
		f.UploadSource = FileOriginSourceRecording
		if f.OriginSource == "" {
			f.OriginSource = FileOriginSourceRecording
		}
	case FileOriginTypeRecordingImported:
		f.UploadSource = FileOriginSourceRecordingImport
		if f.OriginSource == "" {
			f.OriginSource = FileOriginSourceRecordingImport
		}
	default:
		f.UploadSource = FileOriginSourceDirect
		if f.OriginSource == "" {
			f.OriginSource = FileOriginSourceDirect
		}
	}
	return
}

func (f *File) SetPersonalUploadOrigin(uploadFileID int64) {
	f.OriginType = FileOriginTypePersonalUpload
	f.OriginRefID = uploadFileID
	f.OriginSource = FileOriginSourceLocal
}

func (f *File) SetManualCreateOrigin() {
	f.OriginType = FileOriginTypeManualCreate
	f.OriginRefID = 0
	f.OriginSource = FileOriginSourceDirect
}

func (f *File) SetAIGeneratedOrigin(refID int64, source string) {
	f.OriginType = FileOriginTypeAIGenerated
	f.OriginRefID = refID
	f.OriginSource = source
}

func (f *File) SetRecordingOrigin(originType string, recordingJobID int64, source string) {
	f.OriginType = originType
	f.OriginRefID = recordingJobID
	f.OriginSource = source
}

func (f *File) SetRecordingAudioOrigin(recordingJobID int64) {
	f.SetRecordingOrigin(FileOriginTypeRecordingAudio, recordingJobID, FileOriginSourceRecording)
}

func (f *File) SetRecordingFolderOrigin(recordingJobID int64) {
	f.SetRecordingOrigin(FileOriginTypeRecordingFolder, recordingJobID, FileOriginSourceRecording)
}

func (f *File) SetRecordingImportedOrigin(recordingJobID int64) {
	f.SetRecordingOrigin(FileOriginTypeRecordingImported, recordingJobID, FileOriginSourceRecordingImport)
}

func (f *File) IsRecordingOriginType() bool {
	if f == nil {
		return false
	}
	switch f.OriginType {
	case FileOriginTypeRecordingAudio, FileOriginTypeRecordingFolder, FileOriginTypeRecordingImported:
		return true
	default:
		return false
	}
}

func (f *File) IsMyRecordingResource() bool {
	return f.IsRecordingOriginType()
}

// FileCleaningRuleInfo 存储在 CleaningRuleInfo 中的 JSON 结构
type FileCleaningRuleInfo struct {
	StrategyID   string `json:"strategy_id"`
	StrategyName string `json:"strategy_name"`
	StrategyIcon string `json:"strategy_icon"`

	PipelineID   string `json:"pipeline_id"`
	PipelineName string `json:"pipeline_name"`
	PipelineIcon string `json:"pipeline_icon"`

	// 任务运行冗余信息
	RunID          string `json:"run_id"`
	Status         string `json:"status"`           // 整体状态: pending, processing, success, failed
	Progress       int    `json:"progress"`         // 0-100
	SuccessCount   int    `json:"success_count"`    // 成功步骤数
	FailureCount   int    `json:"failure_count"`    // 失败步骤数
	TotalSteps     int    `json:"total_steps"`      // 总步骤数
	StartTime      int64  `json:"start_time"`       // 开始时间戳(ms)
	EndTime        int64  `json:"end_time"`         // 结束时间戳(ms)
	CurrentJobType string `json:"current_job_type"` // 当前运行的任务类型

	StepKey      string `json:"step_key"`
	StepName     string `json:"step_name"`
	StepMode     string `json:"step_mode"`
	NextStepKey  string `json:"next_step_key"`
	NextStepName string `json:"next_step_name"`
	NextStepMode string `json:"next_step_mode"`

	// 纪要/洞察/转写状态，由 GenerateMeetingMinutes/GenerateInsights/转录策略 写入
	// 独立于管线状态，避免被 pipeline 的 UpdateFileCleaningRuleInfoHelper 覆盖
	MeetingMinutesStatus string `json:"meeting_minutes"`
	InsightsStatus       string `json:"insights"`
	InsightPageStatus    string `json:"insight_page"`
	TranscriptionStatus  string `json:"transcription"`
}

func ResolveFileRunStatus(cleaningRuleInfo string) string {
	if strings.TrimSpace(cleaningRuleInfo) == "" {
		return "not_started"
	}
	var info FileCleaningRuleInfo
	if err := json.Unmarshal([]byte(cleaningRuleInfo), &info); err != nil {
		return "unknown"
	}
	status := strings.ToLower(strings.TrimSpace(info.Status))
	if status == "" {
		if strings.TrimSpace(info.RunID) == "" {
			return "not_started"
		}
		return "pending"
	}
	return status
}

func FilterFilesByRunStatus(files []File, runStatusValues []string) []File {
	normalized := NormalizeRunStatusValues(runStatusValues)
	if len(normalized) == 0 {
		return files
	}
	allowed := make(map[string]struct{}, len(normalized))
	for _, value := range normalized {
		allowed[value] = struct{}{}
	}
	filtered := make([]File, 0, len(files))
	for _, file := range files {
		status := ResolveFileRunStatus(file.CleaningRuleInfo)
		if _, ok := allowed[status]; ok {
			filtered = append(filtered, file)
		}
	}
	return filtered
}

func NormalizeRunStatusValues(runStatusValues []string) []string {
	if len(runStatusValues) == 0 {
		return nil
	}
	allowed := make(map[string]struct{})
	for _, value := range runStatusValues {
		normalized := strings.ToLower(strings.TrimSpace(value))
		if normalized == "" {
			continue
		}
		switch normalized {
		case "running":
			allowed["pending"] = struct{}{}
			allowed["processing"] = struct{}{}
			allowed["waiting"] = struct{}{}
		case "completed":
			allowed["success"] = struct{}{}
			allowed["failed"] = struct{}{}
		case "not_started":
			allowed["not_started"] = struct{}{}
		default:
			allowed[normalized] = struct{}{}
		}
	}
	if len(allowed) == 0 {
		return nil
	}
	ordered := []string{"pending", "processing", "waiting", "success", "failed", "not_started", "unknown"}
	result := make([]string, 0, len(allowed))
	for _, value := range ordered {
		if _, ok := allowed[value]; ok {
			result = append(result, value)
			delete(allowed, value)
		}
	}
	for value := range allowed {
		result = append(result, value)
	}
	return result
}

// 文件状态常量定义
const (
	FILE_TYPE_DIR = iota
	FILE_TYPE_FILE
)

// 文件转换状态常量
const (
	FileConversiontatusInactive    = "inactive" // 未激活
	FileConversionStatusNormal     = "normal"
	FileConversionStatusPending    = "pending"
	FileConversionStatusConverting = "converting"
	FileConversionStatusFail       = "failed"
)

// 文件解析状态常量
const (
	FileParsingStatusInactive = "inactive" // 未激活
	FileParsingStatusNormal   = "normal"
	FileParsingStatusPending  = "pending"
	FileParsingStatusParsing  = "parsing"
	FileParsingStatusFail     = "failed"
	FileParsingStatusDisabled = "disabled"
)

const (
	AIGenerateChunkStatusInactive = "inactive" // 未激活
	AIGenerateChunkStatusPending  = "pending"  // 排队中
	AIGenerateChunkStatusNormal   = "normal"   // 成功
	AIGenerateChunkStatusParsing  = "parsing"  // 正在解析
	AIGenerateChunkStatusFail     = "failed"   // 失败
)

// AI问题和简介生成状态常量
const (
	AIGenerateSQStatusInactive = "inactive" // 未激活
	AIGenerateSQStatusPending  = "pending"  // 排队中
	AIGenerateSQStatusNormal   = "normal"   // 成功
	AIGenerateSQStatusParsing  = "parsing"  // 正在生成
	AIGenerateSQStatusFail     = "failed"   // 失败
)

// 解析状态相关的禁用状态常量（复用解析状态）
const (
// 已在上面定义 FileParsingStatusDisabled = "disabled"
)

// 状态校验集合与迁移约束（最小改动实现）
var (
	allowedConversionStates = map[string]struct{}{
		FileConversiontatusInactive:    {},
		FileConversionStatusNormal:     {},
		FileConversionStatusPending:    {},
		FileConversionStatusConverting: {},
		FileConversionStatusFail:       {},
	}
	allowedParsingStates = map[string]struct{}{
		FileParsingStatusInactive: {},
		FileParsingStatusNormal:   {},
		FileParsingStatusPending:  {},
		FileParsingStatusParsing:  {},
		FileParsingStatusFail:     {},
		FileParsingStatusDisabled: {},
	}
	allowedAIGenerateChunkStates = map[string]struct{}{
		AIGenerateChunkStatusInactive: {},
		AIGenerateChunkStatusPending:  {},
		AIGenerateChunkStatusNormal:   {},
		AIGenerateChunkStatusParsing:  {},
		AIGenerateChunkStatusFail:     {},
	}
	allowedAIGenerateSQStates = map[string]struct{}{
		AIGenerateSQStatusInactive: {},
		AIGenerateSQStatusPending:  {},
		AIGenerateSQStatusNormal:   {},
		AIGenerateSQStatusParsing:  {},
		AIGenerateSQStatusFail:     {},
	}
	// 索引状态使用解析状态相同的值（复用）
	allowedIndexingStates = allowedParsingStates

	// 错误类型
	ErrInvalidStatusValue      = errors.New("invalid status value")
	ErrInvalidStatusTransition = errors.New("invalid status transition")
)

func IsAllowedConversionStatus(status string) bool {
	_, ok := allowedConversionStates[status]
	return ok
}

func IsAllowedParsingStatus(status string) bool {
	_, ok := allowedParsingStates[status]
	return ok
}

func IsAllowedIndexingStatus(status string) bool {
	_, ok := allowedIndexingStates[status]
	return ok
}

func ValidateConversionTransition(oldStatus, newStatus string) error {
	if !IsAllowedConversionStatus(newStatus) {
		return fmt.Errorf("%w: conversion_status new=%s", ErrInvalidStatusValue, newStatus)
	}
	if oldStatus == "" {
		oldStatus = FileConversionStatusNormal
	}
	if oldStatus == newStatus {
		return fmt.Errorf("%w: conversion_status %s -> %s", ErrInvalidStatusTransition, oldStatus, newStatus)
	}
	switch oldStatus {
	case FileConversionStatusNormal:
		if newStatus == FileConversionStatusConverting {
			return nil
		}
	case FileConversionStatusConverting:
		if newStatus == FileConversionStatusNormal || newStatus == FileConversionStatusFail {
			return nil
		}
	case FileConversionStatusFail:
		if newStatus == FileConversionStatusConverting {
			return nil
		}
	}
	return fmt.Errorf("%w: conversion_status %s -> %s", ErrInvalidStatusTransition, oldStatus, newStatus)
}

func ValidateParsingTransition(oldStatus, newStatus string) error {
	if !IsAllowedParsingStatus(newStatus) {
		return fmt.Errorf("%w: parsing_status new=%s", ErrInvalidStatusValue, newStatus)
	}
	if oldStatus == "" {
		oldStatus = FileParsingStatusNormal
	}
	if oldStatus == newStatus {
		return fmt.Errorf("%w: parsing_status %s -> %s", ErrInvalidStatusTransition, oldStatus, newStatus)
	}
	switch oldStatus {
	case FileParsingStatusNormal:
		// 可以转换到任何状态
		return nil
	case FileParsingStatusParsing:
		if newStatus == FileParsingStatusNormal || newStatus == FileParsingStatusFail || newStatus == FileParsingStatusDisabled {
			return nil
		}
	case FileParsingStatusFail:
		// 失败状态可以重新解析、禁用或回到正常
		if newStatus == FileParsingStatusNormal || newStatus == FileParsingStatusParsing || newStatus == FileParsingStatusDisabled {
			return nil
		}
	case FileParsingStatusDisabled:
		// 禁用状态只能重新启用
		if newStatus == FileParsingStatusNormal || newStatus == FileParsingStatusParsing {
			return nil
		}
	}
	return fmt.Errorf("%w: parsing_status %s -> %s", ErrInvalidStatusTransition, oldStatus, newStatus)
}

// ValidateIndexingTransition 索引状态转换验证（复用解析状态的逻辑）
func ValidateIndexingTransition(oldStatus, newStatus string) error {
	// 复用解析状态转换的验证逻辑
	return ValidateParsingTransition(oldStatus, newStatus)
}

func (file *File) Save() error {
	pathStr := file.GetPath()
	if pathStr == "" {
		return errors.New("file path is empty")
	}
	if file.Type == FILE_TYPE_FILE {
		if path.Ext(pathStr) == "" {
			return errors.New("file path must contain filename and extension")
		}
	}
	if file.Type == FILE_TYPE_DIR {
		cleanPath := path.Clean(pathStr)
		isDirBool := isDir(cleanPath)
		if !isDirBool {
			return errors.New("file path is not a directory")
		}
	}

	// 检查路径是否已存在（在同一知识库内）- 不再检查，直接创建
	// existingFile, err := GetFileByPathAndLibrary(file.Eid, file.LibraryID, pathStr)
	// if err == nil && existingFile != nil {
	// 	return errors.New("file path already exists in this library")
	// }

	file.Path = pathStr
	if strings.TrimSpace(file.OriginType) == "" {
		if file.UploadFileID > 0 {
			file.SetPersonalUploadOrigin(file.UploadFileID)
		} else {
			file.SetManualCreateOrigin()
			if library, err := GetLibraryByID(file.Eid, file.LibraryID); err == nil && library != nil && library.IsPersonalLibrary() {
				file.OriginSource = FileOriginSourceLocal
			}
		}
	} else if file.OriginType == FileOriginTypeManualCreate {
		file.OriginRefID = 0
		if library, err := GetLibraryByID(file.Eid, file.LibraryID); err == nil && library != nil && library.IsPersonalLibrary() {
			file.OriginSource = FileOriginSourceLocal
		} else if strings.TrimSpace(file.OriginSource) == "" {
			file.OriginSource = FileOriginSourceDirect
		}
	} else if file.OriginType == FileOriginTypePersonalUpload && strings.TrimSpace(file.OriginSource) == "" {
		file.OriginSource = FileOriginSourceLocal
	} else if file.IsRecordingOriginType() && strings.TrimSpace(file.OriginSource) == "" {
		if file.OriginType == FileOriginTypeRecordingImported {
			file.OriginSource = FileOriginSourceRecordingImport
		} else {
			file.OriginSource = FileOriginSourceRecording
		}
	}
	// 统一默认状态：若为空则填充为 normal（应用层规范化，避免依赖DB默认）
	if strings.TrimSpace(file.ConversionStatus) == "" {
		file.ConversionStatus = FileConversionStatusNormal
	}
	if strings.TrimSpace(file.ParsingStatus) == "" {
		file.ParsingStatus = FileParsingStatusNormal
	}
	result := DB.Create(file)
	if result.Error != nil {
		return result.Error
	}
	if file.Type == FILE_TYPE_FILE && !file.IsDeleted {
		invalidateLibraryFileCountCache(file.Eid, file.LibraryID)
	}
	return nil
}

func (file *File) GetPath() string {
	// 统一添加路径前缀
	if file.Path != "" && !strings.HasPrefix(file.Path, "/") {
		return "/" + file.Path
	}
	return file.Path
}

// NormalizePath 将文件路径规范化为带前导斜杠的形式。
func (file *File) NormalizePath() {
	if file == nil || file.Path == "" {
		return
	}
	if !strings.HasPrefix(file.Path, "/") {
		file.Path = "/" + file.Path
	}
}

func GetFileByID(eid int64, id int64) (*File, error) {
	var file File
	if err := DB.Where("eid = ? AND id =?", eid, id).First(&file).Error; err != nil {
		return nil, err
	}
	return &file, nil
}

func GetFileByIDOlny(id int64) (*File, error) {
	var file File
	if err := DB.Where("id =?", id).First(&file).Error; err != nil {
		return nil, err
	}
	return &file, nil
}

func GetFileByPath(eid, libraryID int64, filePath string) (*File, error) {
	var file File
	if err := DB.Where("eid = ? AND library_id = ? AND path =?", eid, libraryID, filePath).First(&file).Error; err != nil {
		return nil, err
	}
	return &file, nil
}

// GetFileByPathAndLibrary 根据路径和知识库ID获取文件
func GetFileByPathAndLibrary(eid int64, libraryID int64, filePath string) (*File, error) {
	var file File
	if err := DB.Where("eid = ? AND library_id = ? AND path = ?", eid, libraryID, filePath).First(&file).Error; err != nil {
		return nil, err
	}
	return &file, nil
}

// GetFilesByPathsAndLibrary 根据多个路径和知识库ID批量获取文件
func GetFilesByPathsAndLibrary(eid int64, libraryID int64, filePaths []string) ([]File, error) {
	var files []File
	if len(filePaths) == 0 {
		return files, nil
	}
	if err := DB.Where("eid = ? AND library_id = ? AND path IN ?", eid, libraryID, filePaths).Find(&files).Error; err != nil {
		return nil, err
	}
	return files, nil
}

func GetFileByPathAndLibraryNotDeleted(eid int64, libraryID int64, filePath string) (*File, error) {
	var file File
	if err := DB.Where("eid = ? AND library_id = ? AND path = ? AND is_deleted = ?", eid, libraryID, filePath, false).First(&file).Error; err != nil {
		return nil, err
	}
	return &file, nil
}

// GetFileByPathAndLibraryWithDeleted 根据路径和知识库ID获取文件（包括已删除的）
func GetFileByPathAndLibraryWithDeleted(eid int64, libraryID int64, filePath string) (*File, error) {
	var file File
	if err := DB.Where("eid = ? AND library_id = ? AND path = ?", eid, libraryID, filePath).First(&file).Error; err != nil {
		return nil, err
	}
	return &file, nil
}

// RestoreFile 恢复已删除的文件
func RestoreFile(eid int64, fileID int64) error {
	file, err := GetFileByID(eid, fileID)
	if err != nil {
		return err
	}
	if err := DB.Model(&File{}).Where("eid = ? AND id = ?", eid, fileID).Updates(map[string]interface{}{
		"is_deleted":        false,
		"is_active_deleted": false,
		"deleted_by":        0,
		"deleted_at":        0,
	}).Error; err != nil {
		return err
	}
	invalidateLibraryFileCountCache(eid, file.LibraryID)
	return nil
}

// GetFilesByLibraryID 获取知识库下的所有文件
func GetFilesByLibraryID(eid int64, libraryID int64) ([]File, error) {
	var files []File
	if err := DB.Where("eid = ? AND library_id = ?", eid, libraryID).Find(&files).Error; err != nil {
		return nil, err
	}

	return files, nil
}

type libraryFileCountRow struct {
	LibraryID int64 `gorm:"column:library_id"`
	Count     int64 `gorm:"column:count"`
}

var fileCountCacheInvalidator func(eid int64, libraryID int64)

func SetFileCountCacheInvalidator(invalidator func(eid int64, libraryID int64)) {
	fileCountCacheInvalidator = invalidator
}

func invalidateLibraryFileCountCache(eid int64, libraryID int64) {
	if libraryID > 0 && fileCountCacheInvalidator != nil {
		fileCountCacheInvalidator(eid, libraryID)
	}
}

type spaceFileCountRow struct {
	Total    int64
	MonthNew int64
}

func CountFilesInLibraries(eid int64, libraryIDs []int64, monthStartMs int64) (total int64, monthNew int64, err error) {
	if len(libraryIDs) == 0 {
		return 0, 0, nil
	}
	var row spaceFileCountRow
	err = DB.Model(&File{}).
		Select("COUNT(*) AS total, SUM(CASE WHEN created_time >= ? THEN 1 ELSE 0 END) AS month_new", monthStartMs).
		Where("eid = ? AND library_id IN ? AND is_deleted = ? AND type = ?", eid, libraryIDs, false, FILE_TYPE_FILE).
		Scan(&row).Error
	if err != nil {
		return 0, 0, err
	}
	return row.Total, row.MonthNew, nil
}

// CountNotDeletedFilesByLibraryIDs 按知识库批量统计未删除文件数（仅统计文档，不含目录）
func CountNotDeletedFilesByLibraryIDs(eid int64, libraryIDs []int64) (map[int64]int64, error) {
	result := make(map[int64]int64, len(libraryIDs))
	if len(libraryIDs) == 0 {
		return result, nil
	}

	dbQueryLibraryIDs := make([]int64, 0, len(libraryIDs))
	for _, libraryID := range libraryIDs {
		if libraryID > 0 {
			dbQueryLibraryIDs = append(dbQueryLibraryIDs, libraryID)
		}
	}
	if len(dbQueryLibraryIDs) == 0 {
		return result, nil
	}

	var rows []libraryFileCountRow
	if err := DB.Model(&File{}).
		Select("library_id, COUNT(*) AS count").
		Where("eid = ? AND library_id IN ? AND is_deleted = ? AND type = ?", eid, dbQueryLibraryIDs, false, FILE_TYPE_FILE).
		Group("library_id").
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	for _, row := range rows {
		result[row.LibraryID] = row.Count
	}
	for _, libraryID := range dbQueryLibraryIDs {
		if _, exists := result[libraryID]; !exists {
			result[libraryID] = 0
		}
	}
	return result, nil
}

// GetAllFilesByLibrary 获取知识库下的所有文件和文件夹（递归获取所有层级）
func GetAllFilesByLibrary(eid int64, libraryID int64, parentPath string, sort string, fileType *int, runStatusValues []string) ([]File, error) {
	var files []File
	query := DB.Where("eid = ? AND library_id = ? AND is_deleted = ?", eid, libraryID, false)

	if parentPath != "" {
		if parentPath == "/" {
			query = query.Where("path LIKE ? AND path NOT LIKE ?", "/%", "/%/%")
		} else {
			query = query.Where("path LIKE ? AND path NOT LIKE ?", parentPath+"/%", parentPath+"/%/%")
		}
	}

	if fileType != nil {
		query = query.Where(map[string]interface{}{"type": *fileType})
	}
	normalizedRunStatus := NormalizeRunStatusValues(runStatusValues)
	if len(normalizedRunStatus) > 0 {
		if fileType != nil {
			if *fileType == FILE_TYPE_FILE {
				query = query.Where("run_status IN ?", normalizedRunStatus)
			}
		} else {
			query = query.Where(DB.Where(map[string]interface{}{"type": FILE_TYPE_DIR}).Or(
				DB.Where(map[string]interface{}{"type": FILE_TYPE_FILE}).Where("run_status IN ?", normalizedRunStatus),
			))
		}
	}

	if sort == "desc" {
		query = query.Order("sort desc, path asc")
	} else {
		query = query.Order("sort asc, path asc")
	}

	if err := query.Find(&files).Error; err != nil {
		return nil, err
	}

	// 手动填充 UploadFile
	if len(files) > 0 {
		var uploadFileIDs []int64
		for _, f := range files {
			if f.UploadFileID > 0 {
				uploadFileIDs = append(uploadFileIDs, f.UploadFileID)
			}
		}

		if len(uploadFileIDs) > 0 {
			var uploadFiles []UploadFile
			if err := DB.Where("id IN ?", uploadFileIDs).Find(&uploadFiles).Error; err == nil {
				uploadFileMap := make(map[int64]*UploadFile)
				for i := range uploadFiles {
					uploadFileMap[uploadFiles[i].ID] = &uploadFiles[i]
				}

				for i := range files {
					if files[i].UploadFileID > 0 {
						if uf, ok := uploadFileMap[files[i].UploadFileID]; ok {
							files[i].UploadFile = uf
						}
					}
				}
			}
		}
	}

	for i := range files {
		if files[i].CleaningRuleInfo != "" {
			// Deprecated logic removed
		}
	}

	return files, nil
}

// SearchFilesByLibraryKeyword 根据知识库、关键词和来源类型筛选文件。
// originTypes 为空时表示不过滤来源类型；传多个值时表示只保留这些来源类型。
func SearchFilesByLibraryKeyword(eid int64, libraryID int64, keyword string, fileType *int, originTypes []string, offset, limit int) ([]File, int64, error) {
	var files []File
	query := DB.Model(&File{}).Where("eid = ? AND library_id = ? AND is_deleted = ?", eid, libraryID, false)
	if fileType != nil {
		query = query.Where(map[string]interface{}{"type": *fileType})
	}

	normalizedOriginTypes := normalizeOriginTypes(originTypes)
	if len(normalizedOriginTypes) > 0 {
		query = query.Where("origin_type IN ?", normalizedOriginTypes)
	}

	keyword = strings.TrimSpace(keyword)
	if keyword != "" {
		query = query.Where("path LIKE ?", "%"+keyword+"%")
	}

	if isAIOnlyOriginTypes(normalizedOriginTypes) {
		query = query.Order("created_time desc, id desc")
	} else {
		query = query.Order("sort asc, path asc")
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := query.Offset(offset).Limit(limit).Find(&files).Error; err != nil {
		return nil, 0, err
	}

	if err := attachUploadFiles(files); err != nil {
		return nil, 0, err
	}

	return files, total, nil
}

// SearchFilesByLibraryOriginTypesKeyword 根据知识库、来源类型列表和关键词查询文件
func SearchFilesByLibraryOriginTypesKeyword(eid int64, libraryID int64, originTypes []string, keyword string, fileType *int, offset, limit int) ([]File, int64, error) {
	return SearchFilesByLibraryKeyword(eid, libraryID, keyword, fileType, originTypes, offset, limit)
}

func normalizeOriginTypes(originTypes []string) []string {
	if len(originTypes) == 0 {
		return nil
	}

	normalized := make([]string, 0, len(originTypes))
	seen := make(map[string]struct{}, len(originTypes))
	for _, originType := range originTypes {
		trimmed := strings.TrimSpace(originType)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		normalized = append(normalized, trimmed)
	}
	if len(normalized) == 0 {
		return nil
	}
	return normalized
}

func isAIOnlyOriginTypes(originTypes []string) bool {
	return len(originTypes) == 1 && originTypes[0] == FileOriginTypeAIGenerated
}

// SearchFilesByLibraryExcludeOriginTypesKeyword 根据知识库、排除的来源类型和关键词查询文件
// 这里与“我的上传”口径保持一致，变更时先同步 docs/对接文档/知识库文件列表优化.md 的合并规则。
func SearchFilesByLibraryExcludeOriginTypesKeyword(eid int64, libraryID int64, excludedOriginTypes []string, keyword string, fileType *int, offset, limit int) ([]File, int64, error) {
	var files []File
	query := DB.Model(&File{}).Where("eid = ? AND library_id = ? AND is_deleted = ?", eid, libraryID, false)
	if len(excludedOriginTypes) > 0 {
		query = query.Where(DB.Where("origin_type = ''").Or("origin_type IS NULL").Or("origin_type NOT IN ?", excludedOriginTypes))
	}
	if fileType != nil {
		query = query.Where(map[string]interface{}{"type": *fileType})
	}

	keyword = strings.TrimSpace(keyword)
	if keyword != "" {
		query = query.Where("path LIKE ?", "%"+keyword+"%")
	}

	query = query.Order("sort asc, path asc")

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := query.Offset(offset).Limit(limit).Find(&files).Error; err != nil {
		return nil, 0, err
	}

	if err := attachUploadFiles(files); err != nil {
		return nil, 0, err
	}

	return files, total, nil
}

// SearchFilesByLibraryOriginTypeKeyword 根据知识库、来源类型和关键词查询文件
func SearchFilesByLibraryOriginTypeKeyword(eid int64, libraryID int64, originType string, keyword string, fileType *int, offset, limit int) ([]File, int64, error) {
	return SearchFilesByLibraryOriginTypesKeyword(eid, libraryID, []string{originType}, keyword, fileType, offset, limit)
}

func attachUploadFiles(files []File) error {
	if len(files) == 0 {
		return nil
	}

	uploadFileIDs := make([]int64, 0, len(files))
	for _, f := range files {
		if f.UploadFileID > 0 {
			uploadFileIDs = append(uploadFileIDs, f.UploadFileID)
		}
	}
	if len(uploadFileIDs) == 0 {
		return nil
	}

	var uploadFiles []UploadFile
	if err := DB.Where("id IN ?", uploadFileIDs).Find(&uploadFiles).Error; err != nil {
		return err
	}

	uploadFileMap := make(map[int64]*UploadFile, len(uploadFiles))
	for i := range uploadFiles {
		uploadFileMap[uploadFiles[i].ID] = &uploadFiles[i]
	}

	for i := range files {
		if files[i].UploadFileID > 0 {
			if uf, ok := uploadFileMap[files[i].UploadFileID]; ok {
				files[i].UploadFile = uf
			}
		}
	}

	return nil
}

// AttachUploadFiles 暴露给 service/controller 使用，用于批量回填 UploadFile。
func AttachUploadFiles(files []File) error {
	return attachUploadFiles(files)
}

func (file *File) Update() error {
	result := DB.Model(file).Updates(file)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// CleaningRuleInfo 表示清洗规则的完整信息
type CleaningRuleInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Icon string `json:"icon,omitempty"`
}

// GetFilesByUploadFileID 根据上传文件ID获取文件
func GetFilesByUploadFileID(uploadFileID int64) ([]File, error) {
	var files []File
	err := DB.Where("upload_file_id = ?", uploadFileID).Find(&files).Error
	return files, err
}

// GetFilesByUploadFileIDs 根据多个上传文件ID批量获取文件，返回 uploadFileID → []File 的映射
func GetFilesByUploadFileIDs(uploadFileIDs []int64) (map[int64][]File, error) {
	result := make(map[int64][]File)
	if len(uploadFileIDs) == 0 {
		return result, nil
	}
	var files []File
	if err := DB.Where("upload_file_id IN ?", uploadFileIDs).Find(&files).Error; err != nil {
		return nil, err
	}
	for _, f := range files {
		result[f.UploadFileID] = append(result[f.UploadFileID], f)
	}
	return result, nil
}

// GetFileByUploadFileID 根据上传文件ID获取单个文件
func GetFileByUploadFileID(uploadFileID int64) (*File, error) {
	var file File
	err := DB.Where("upload_file_id = ?", uploadFileID).First(&file).Error
	if err != nil {
		return nil, err
	}
	return &file, nil
}

func CheckHasChildren(eid int64, id int64) (bool, error) {
	file, err := GetFileByID(eid, id)
	if err != nil {
		return false, err
	}
	if file.Type != FILE_TYPE_DIR {
		return false, nil
	}
	files, err := GetDeleteFilesByParentPathAndLibrary(eid, file.LibraryID, file.Path)
	if err != nil {
		return false, err
	}
	return len(files) > 0, nil
}

func DeleteFile(eid int64, id int64) error {
	file, err := GetFileByID(eid, id)
	if err != nil {
		return err
	}

	hasChildren, err := CheckHasChildren(eid, id)
	if err != nil {
		return err
	}
	if hasChildren {
		// 如果是包含子项的目录，递归删除所有子项
		if err := deleteDirectoryWithChildren(eid, id); err != nil {
			return err
		}
		invalidateLibraryFileCountCache(eid, file.LibraryID)
		return nil
	}

	// 使用新的级联删除逻辑
	if err := deleteFileWithCascade(eid, id); err != nil {
		return err
	}
	invalidateLibraryFileCountCache(eid, file.LibraryID)
	return nil
}

// deleteDirectoryWithChildren 递归删除目录及其所有子项
func deleteDirectoryWithChildren(eid int64, id int64) error {
	// 获取目录信息
	dir, err := GetFileByID(eid, id)
	if err != nil {
		return fmt.Errorf("获取目录信息失败: %v", err)
	}

	// 确保这是一个目录
	if dir.Type != FILE_TYPE_DIR {
		return fmt.Errorf("指定的文件不是目录")
	}

	// 获取所有直接子项
	children, err := GetDeleteFilesByParentPathAndLibrary(eid, dir.LibraryID, dir.Path)
	if err != nil {
		return fmt.Errorf("获取子项列表失败: %v", err)
	}

	// 递归删除所有子项（跳过主动软删除的子级，避免彻底删除）
	for _, child := range children {
		// 若子级为主动删除则跳过（is_active_deleted = 1）
		if child.IsActiveDeleted {
			continue
		}
		if child.Type == FILE_TYPE_DIR {
			// 递归删除子目录
			if err := deleteDirectoryWithChildren(eid, child.ID); err != nil {
				return fmt.Errorf("删除子目录失败 %s: %v", child.Path, err)
			}
		} else {
			// 删除文件及其相关数据
			if err := cascadeDeleteFileData(eid, child.ID); err != nil {
				return fmt.Errorf("删除文件失败 %s: %v", child.Path, err)
			}
		}
	}

	// 最后删除目录本身（包含实体关联清理）
	if err := deleteFileWithCascade(eid, id); err != nil {
		return fmt.Errorf("删除目录记录失败: %v", err)
	}

	return nil
}

// deleteFileWithCascade 级联删除文件及其所有相关数据
func deleteFileWithCascade(eid int64, fileID int64) error {
	// 获取文件信息
	file, err := GetFileByID(eid, fileID)
	if err != nil {
		return fmt.Errorf("获取文件信息失败: %v", err)
	}

	// 检查是否为目录类型，目录删除逻辑不变
	if file.Type == FILE_TYPE_DIR {
		tx := DB.Begin()
		defer func() {
			if r := recover(); r != nil {
				tx.Rollback()
			}
		}()

		var entityIDs []int64
		if err := tx.Model(&EntityChunkRelation{}).
			Distinct("entity_id").
			Where("eid = ? AND file_id = ?", eid, fileID).
			Pluck("entity_id", &entityIDs).Error; err != nil {
			tx.Rollback()
			return fmt.Errorf("查询实体关联失败: %v", err)
		}

		if err := tx.Where("eid = ? AND file_id = ?", eid, fileID).Delete(&EntityChunkRelation{}).Error; err != nil {
			tx.Rollback()
			return fmt.Errorf("删除实体关联失败: %v", err)
		}

		if err := tx.Where("eid = ? AND id = ?", eid, fileID).Delete(&File{}).Error; err != nil {
			tx.Rollback()
			return err
		}

		if err := DeleteOrphanEntitiesByIDsWithDB(tx, eid, entityIDs); err != nil {
			tx.Rollback()
			return fmt.Errorf("清理孤儿实体失败: %v", err)
		}

		return tx.Commit().Error
	}

	// 对于文件类型，执行级联删除
	return cascadeDeleteFileData(eid, fileID)
}

// cascadeDeleteFileData 级联删除文件相关数据
func cascadeDeleteFileData(eid int64, fileID int64) error {
	var sandboxOutputKey string
	var sandboxOutputFileID int64
	file, err := GetFileByID(eid, fileID)
	if err == nil && file != nil && file.OriginType == FileOriginTypeAIGenerated && file.OriginRefID > 0 {
		sandboxOutputFileID = file.OriginRefID
		if outputFile, outputErr := GetAIUploadFileByID(file.OriginRefID); outputErr == nil && outputFile != nil {
			sandboxOutputKey = outputFile.Key
		}
	}

	// 在删除数据之前，先收集需要清理的向量ID
	vectorIDs, err := getVectorIDsForFile(eid, fileID)
	if err != nil {
		log.Printf("获取文件向量ID失败，将跳过向量清理 - EID: %d, FileID: %d, Error: %v", eid, fileID, err)
		vectorIDs = []string{} // 设置为空数组，避免后续处理出错
	}

	// 开启数据库事务
	tx := DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 按依赖关系顺序删除：关联关系 -> 检索块 -> 文档分块 -> 其他数据 -> 文件

	var entityIDs []int64
	if err := tx.Model(&EntityChunkRelation{}).
		Distinct("entity_id").
		Where("eid = ? AND file_id = ?", eid, fileID).
		Pluck("entity_id", &entityIDs).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("查询实体关联失败: %v", err)
	}

	if err := tx.Where("eid = ? AND file_id = ?", eid, fileID).Delete(&EntityChunkRelation{}).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("删除实体关联失败: %v", err)
	}

	// 1. 删除分块关联关系
	if err := tx.Where("eid = ? AND file_id = ?", eid, fileID).Delete(&ChunkRelation{}).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("删除分块关联关系失败: %v", err)
	}

	// 2. 删除检索块
	if err := tx.Where("eid = ? AND file_id = ?", eid, fileID).Delete(&RetrievalChunk{}).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("删除检索块失败: %v", err)
	}

	// 3. 删除文档分块
	if err := tx.Where("eid = ? AND file_id = ?", eid, fileID).Delete(&DocumentChunk{}).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("删除文档分块失败: %v", err)
	}

	// 4. 删除操作日志
	if err := tx.Where("eid = ? AND file_id = ?", eid, fileID).Delete(&ChunkOperationLog{}).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("删除操作日志失败: %v", err)
	}

	// 5. 删除文件版本记录
	if err := tx.Where("file_id = ?", fileID).Delete(&FileBodyVersion{}).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("删除文件版本记录失败: %v", err)
	}

	// 6. 删除文件内容
	if err := tx.Where("eid = ? AND file_id = ?", eid, fileID).Delete(&FileBody{}).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("删除文件内容失败: %v", err)
	}

	// 7. 删除文件记录
	if err := tx.Where("eid = ? AND id = ?", eid, fileID).Delete(&File{}).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("删除文件记录失败: %v", err)
	}

	// 清理相关任务
	if err := CleanupRelatedJobs(context.Background(), tx, eid, fileID); err != nil {
		log.Printf("清理相关任务失败 - EID: %d, FileID: %d, Error: %v", eid, fileID, err)
		tx.Rollback()
		return fmt.Errorf("清理相关任务失败: %v", err)
	}

	if err := DeleteOrphanEntitiesByIDsWithDB(tx, eid, entityIDs); err != nil {
		tx.Rollback()
		return fmt.Errorf("清理孤儿实体失败: %v", err)
	}

	// 提交数据库事务
	if err := tx.Commit().Error; err != nil {
		return fmt.Errorf("提交事务失败: %v", err)
	}

	if sandboxOutputKey != "" {
		if err := storage.StorageInstance.Delete(sandboxOutputKey); err != nil {
			log.Printf("删除 AI 上传文件存储对象失败 - EID: %d, FileID: %d, Key: %s, Error: %v", eid, fileID, sandboxOutputKey, err)
			if sandboxOutputFileID > 0 {
				if updateErr := MarkAIUploadFileCleanupFailed(sandboxOutputFileID); updateErr != nil {
					log.Printf("标记 AI 上传文件清理失败状态失败 - EID: %d, FileID: %d, UploadFileID: %d, Error: %v", eid, fileID, sandboxOutputFileID, updateErr)
				}
			}
			return nil
		}

		if sandboxOutputFileID > 0 {
			if err := DeleteUploadFileByID(sandboxOutputFileID); err != nil {
				log.Printf("删除 AI 上传文件失败 - EID: %d, FileID: %d, UploadFileID: %d, Error: %v", eid, fileID, sandboxOutputFileID, err)
				if updateErr := MarkAIUploadFileCleanupFailed(sandboxOutputFileID); updateErr != nil {
					log.Printf("标记 AI 上传文件清理失败状态失败 - EID: %d, FileID: %d, UploadFileID: %d, Error: %v", eid, fileID, sandboxOutputFileID, updateErr)
				}
			}
		}
	}

	// 异步清理向量数据（不阻塞主流程）
	go cleanupVectorDataAsync(eid, fileID, vectorIDs)

	return nil
}

// cleanupVectorDataAsync 异步清理向量数据
func cleanupVectorDataAsync(eid int64, fileID int64, vectorIDs []string) {
	log.Printf("开始异步清理向量数据 - EID: %d, FileID: %d, 向量数量: %d", eid, fileID, len(vectorIDs))

	// 使用defer确保错误也会被记录
	defer func() {
		if r := recover(); r != nil {
			log.Printf("向量数据清理过程中发生panic - EID: %d, FileID: %d, Error: %v", eid, fileID, r)
		}
	}()

	if len(vectorIDs) == 0 {
		log.Printf("文件没有向量数据需要清理 - EID: %d, FileID: %d", eid, fileID)
		return
	}

	log.Printf("开始清理 %d 个向量 - EID: %d, FileID: %d", len(vectorIDs), eid, fileID)

	// 1. 从向量数据库中删除向量
	err := deleteVectorsFromDB(eid, fileID, vectorIDs)
	if err != nil {
		log.Printf("从向量数据库删除向量失败 - EID: %d, FileID: %d, Error: %v", eid, fileID, err)
		// 即使删除失败，也继续执行后续清理步骤
	} else {
		log.Printf("成功从向量数据库删除 %d 个向量 - EID: %d, FileID: %d", len(vectorIDs), eid, fileID)
	}

	// 2. 记录清理操作日志
	err = recordVectorCleanupLog(eid, fileID, len(vectorIDs))
	if err != nil {
		log.Printf("记录向量清理日志失败 - EID: %d, FileID: %d, Error: %v", eid, fileID, err)
	}

	log.Printf("向量数据清理完成 - EID: %d, FileID: %d, 清理向量数: %d", eid, fileID, len(vectorIDs))
}

func GetChildrenByPathPrefix(eid int64, pathPrefix string) ([]File, error) {
	var files []File
	err := DB.Where("eid = ? AND path LIKE ?", eid, pathPrefix+"/%").Find(&files).Error
	return files, err
}

// getVectorIDsForFile 获取文件相关的所有向量ID
func getVectorIDsForFile(eid int64, fileID int64) ([]string, error) {
	var vectorIDs []string

	// 查询文件相关的所有检索块的向量ID
	err := DB.Model(&RetrievalChunk{}).
		Select("vector_id").
		Where("eid = ? AND file_id = ? AND vector_id IS NOT NULL AND vector_id != ''", eid, fileID).
		Pluck("vector_id", &vectorIDs).Error

	if err != nil {
		return nil, fmt.Errorf("查询检索块向量ID失败: %v", err)
	}

	return vectorIDs, nil
}

// deleteVectorsFromDB 从向量数据库中删除向量
func deleteVectorsFromDB(eid int64, fileID int64, vectorIDs []string) error {
	if len(vectorIDs) == 0 {
		return nil
	}

	// 加载向量数据库配置
	config := vectorstore.LoadFromEnv()

	// 创建向量存储实例
	store, err := vectorstore.NewVectorStore(config)
	if err != nil {
		return fmt.Errorf("创建向量存储实例失败: %v", err)
	}

	// 连接到向量数据库
	ctx := context.Background()
	if err := store.Connect(ctx); err != nil {
		return fmt.Errorf("连接向量数据库失败: %v", err)
	}
	defer func() {
		if disconnectErr := store.Disconnect(ctx); disconnectErr != nil {
			log.Printf("断开向量数据库连接失败: %v", disconnectErr)
		}
	}()

	// 获取文件信息以获取 libraryID
	file, err := GetFileByID(eid, fileID)
	if err != nil {
		return fmt.Errorf("获取文件信息失败: %v", err)
	}

	// 获取知识库信息以获取 UUID
	library, err := GetLibraryByID(eid, file.LibraryID)
	if err != nil {
		return fmt.Errorf("获取知识库信息失败: %v", err)
	}

	// 使用统一的集合名称方法
	collection := GetVectorCollectionName(library.UUID)

	// 转换向量ID为interface{}类型
	ids := make([]interface{}, len(vectorIDs))
	for i, id := range vectorIDs {
		ids[i] = id
	}

	// 执行删除操作
	err = store.Delete(ctx, collection, ids)
	if err != nil {
		return fmt.Errorf("删除向量失败: %v", err)
	}

	// enterprise/dual 模式下同时删除企业级集合中的向量
	mode := os.Getenv("RAG_DOCUMENT_VECTOR_COLLECTION_MODE")
	if mode == "enterprise" || mode == "dual" {
		entCollection := GetDocumentVectorCollectionName(eid)
		if delErr := store.Delete(ctx, entCollection, ids); delErr != nil {
			log.Printf("删除企业级集合向量失败: %v", delErr)
		}
	}

	return nil
}

// recordVectorCleanupLog 记录向量清理操作日志
func recordVectorCleanupLog(eid int64, fileID int64, vectorCount int) error {
	// 创建操作日志
	logEntry := &ChunkOperationLog{
		Eid:           eid,
		FileID:        fileID,
		UserID:        0, // 系统操作
		OperationType: "vector_cleanup",
	}

	// 设置操作数据
	operationData := &OperationData{
		Description: "文件删除后的向量数据清理",
		Details: map[string]interface{}{
			"vector_count":   vectorCount,
			"cleanup_reason": "file_deleted",
			"cleanup_time":   time.Now().UTC().UnixMilli(),
		},
	}

	if err := logEntry.SetOperationData(operationData); err != nil {
		return fmt.Errorf("设置操作数据失败: %v", err)
	}

	// 保存日志
	return logEntry.Save()
}

func GetFilesByParentPath(eid int64, parentPath string, sort string) ([]File, error) {
	var files []File
	query := DB.Where("eid = ?", eid)

	// 处理根目录的特殊情况
	if parentPath == "/" {
		query = query.Where("path LIKE ? AND path NOT LIKE ?",
			"/%",
			"/%/%")
	} else {
		query = query.Where("path LIKE ? AND path NOT LIKE ?",
			parentPath+"/%",
			parentPath+"/%/%")
	}

	if sort == "desc" {
		query = query.Order("sort desc")
	} else {
		query = query.Order("sort asc")
	}

	if err := query.Find(&files).Error; err != nil {
		return nil, err
	}
	return files, nil
}

// GetFilesByParentPathAndLibrary 根据父路径和知识库ID获取文件列表
func GetFilesByParentPathAndLibrary(eid int64, libraryID int64, parentPath string, sort string) ([]File, error) {
	var files []File
	query := DB.Where("eid = ? AND library_id = ? AND is_deleted = ?", eid, libraryID, false)

	// 处理根目录的特殊情况
	if parentPath == "/" {
		query = query.Where("path LIKE ? AND path NOT LIKE ?",
			"/%",
			"/%/%")
	} else {
		query = query.Where("path LIKE ? AND path NOT LIKE ?",
			parentPath+"/%",
			parentPath+"/%/%")
	}

	if sort == "desc" {
		query = query.Order("sort desc, path asc")
	} else {
		query = query.Order("sort asc, path asc")
	}

	if err := query.Find(&files).Error; err != nil {
		return nil, err
	}
	return files, nil
}

func GetFilesByParentPathAndLibraryWithFilter(
	eid int64,
	libraryID int64,
	parentPath string,
	sort string,
	offset int,
	limit int,
	fileType *int,
	runStatusValues []string,
) ([]File, int64, error) {
	var files []File
	var count int64

	query := DB.Model(&File{}).Where("eid = ? AND library_id = ? AND is_deleted = ?", eid, libraryID, false)

	// 处理根目录的特殊情况
	if parentPath == "/" {
		query = query.Where("path LIKE ? AND path NOT LIKE ?", "/%", "/%/%")
	} else {
		query = query.Where("path LIKE ? AND path NOT LIKE ?", parentPath+"/%", parentPath+"/%/%")
	}

	// 类型筛选
	if fileType != nil {
		query = query.Where(map[string]interface{}{"type": *fileType})
	}

	// 运行状态筛选（仅对文件类型生效）
	normalizedRunStatus := NormalizeRunStatusValues(runStatusValues)
	if len(normalizedRunStatus) > 0 {
		if fileType != nil {
			if *fileType == FILE_TYPE_FILE {
				query = query.Where("run_status IN ?", normalizedRunStatus)
			}
		} else {
			query = query.Where(DB.Where(map[string]interface{}{"type": FILE_TYPE_DIR}).Or(
				DB.Where(map[string]interface{}{"type": FILE_TYPE_FILE}).Where("run_status IN ?", normalizedRunStatus),
			))
		}
	}

	// 排序
	if sort == "desc" {
		query = query.Order("sort desc, path asc")
	} else {
		query = query.Order("sort asc, path asc")
	}

	// 统计总数
	if err := query.Count(&count).Error; err != nil {
		return nil, 0, err
	}

	// 分页查询
	if err := query.Offset(offset).Limit(limit).Find(&files).Error; err != nil {
		return nil, 0, err
	}

	// 填充 UploadFile
	if len(files) > 0 {
		var uploadFileIDs []int64
		for _, f := range files {
			if f.UploadFileID > 0 {
				uploadFileIDs = append(uploadFileIDs, f.UploadFileID)
			}
		}

		if len(uploadFileIDs) > 0 {
			var uploadFiles []UploadFile
			if err := DB.Where("id IN ?", uploadFileIDs).Find(&uploadFiles).Error; err == nil {
				uploadFileMap := make(map[int64]*UploadFile)
				for i := range uploadFiles {
					uploadFileMap[uploadFiles[i].ID] = &uploadFiles[i]
				}

				for i := range files {
					if files[i].UploadFileID > 0 {
						if uf, ok := uploadFileMap[files[i].UploadFileID]; ok {
							files[i].UploadFile = uf
						}
					}
				}
			}
		}
	}

	return files, count, nil
}

// GetFilesByParentPathAndLibrary 根据父路径和知识库ID获取需要连带删除的文件列表
func GetDeleteFilesByParentPathAndLibrary(eid int64, libraryID int64, parentPath string) ([]File, error) {
	var files []File
	query := DB.Where("eid = ? AND library_id = ? AND is_deleted = ? and is_active_deleted = ?", eid, libraryID, true, false)

	// 处理根目录的特殊情况
	if parentPath == "/" {
		query = query.Where("path LIKE ? AND path NOT LIKE ?",
			"/%",
			"/%/%")
	} else {
		query = query.Where("path LIKE ? AND path NOT LIKE ?",
			parentPath+"/%",
			parentPath+"/%/%")
	}

	if err := query.Find(&files).Error; err != nil {
		return nil, err
	}
	return files, nil
}

func GetRecentlyFiles(eid, libraryId int64, limit int) ([]File, error) {
	var files []File
	query := DB.Where("eid = ? and type = ? and is_deleted = ? ", eid, FILE_TYPE_FILE, false).
		Order("updated_time desc")

	if libraryId != 0 {
		query = query.Where("library_id =?", libraryId)
	}
	if err := query.Find(&files).Error; err != nil {
		return nil, err
	}
	return files, nil
}

func isDir(pathStr string) bool {
	if len(pathStr) == 0 {
		return false
	}

	// 如果路径以 / 结尾，则是目录
	if pathStr[len(pathStr)-1] == '/' {
		return true
	}

	// 获取扩展名
	ext := path.Ext(pathStr)

	// 如果没有扩展名，则是目录
	if ext == "" {
		return true
	}

	// 特殊处理：如果扩展名看起来像是目录名的一部分（比如中文目录名"1.你好"中的".你好"），
	// 则认为它是目录而不是文件
	// 我们检查扩展名是否包含非ASCII字符，如果是，则认为整个名称是目录名
	filenameWithoutExt := strings.TrimSuffix(pathStr, ext)
	baseName := path.Base(filenameWithoutExt)
	extWithoutDot := strings.TrimPrefix(ext, ".")

	// 检查扩展名部分是否包含非ASCII字符（中文、日文等）
	// 或者扩展名部分太长（一般真实文件扩展名不会特别长）
	if containsNonLatinChars(extWithoutDot) || len(extWithoutDot) > 10 {
		return true
	}

	// 如果基本名称部分包含非ASCII字符，但扩展名部分是正常的，仍可能是目录
	if containsNonLatinChars(baseName) && isValidExtension(extWithoutDot) {
		// 对于包含中文的基本名称，检查扩展名是否是常见的文件扩展名
		// 如果不是常见文件扩展名，我们认为它是目录
		return !isValidExtension(extWithoutDot)
	}

	// 默认情况下，如果有有效的文件扩展名则是文件，否则是目录
	return ext == "" || !isValidExtension(extWithoutDot)
}

// containsNonLatinChars 检查字符串是否包含非拉丁字符
func containsNonLatinChars(s string) bool {
	for _, r := range s {
		if r > 127 { // ASCII范围之外的字符
			return true
		}
	}
	return false
}

// isValidExtension 检查是否为有效的文件扩展名
func isValidExtension(ext string) bool {
	// 常见的文件扩展名列表，可以根据需要扩展
	validExtensions := map[string]bool{
		"txt": true, "md": true, "html": true, "htm": true,
		"ppt": true, "pptx": true,
		"doc": true, "docx": true,
		"xls": true, "xlsx": true,
		"csv": true, "json": true, "xml": true,
		"epub": true, "jpg": true, "jpeg": true, "png": true, "gif": true,
		"bmp": true, "svg": true, "webp": true,
		"mp3": true, "wav": true, "mp4": true, "avi": true, "mov": true,
		"zip": true, "rar": true, "tar": true, "gz": true, "7z": true,
		"exe": true, "dll": true, "so": true, "dylib": true,
		"css": true, "js": true, "ts": true, "jsx": true, "tsx": true,
		"go": true, "java": true, "py": true, "rb": true, "php": true,
		"c": true, "cpp": true, "h": true, "hpp": true,
		"sql": true, "sh": true, "bat": true, "ps1": true,
		"yaml": true, "yml": true, "toml": true, "ini": true,
		"pdf": true, "rtf": true, "odt": true, "ods": true, "odp": true,
	}

	return validExtensions[strings.ToLower(ext)]
}

// UpdateFileConversionStatus 更新文件转换状态（含值域与迁移校验）
func UpdateFileConversionStatus(fileID int64, status string) error {
	if !IsAllowedConversionStatus(status) {
		return fmt.Errorf("%w: conversion_status=%s", ErrInvalidStatusValue, status)
	}
	var current string
	if err := DB.Model(&File{}).Where("id = ?", fileID).Select("conversion_status").Scan(&current).Error; err != nil {
		return err
	}
	// if err := ValidateConversionTransition(current, status); err != nil {
	// 	return err
	// }
	return DB.Model(&File{}).Where("id = ?", fileID).Update("conversion_status", status).Error
}

// UpdateFileParsingStatus 更新文件解析状态（含值域与迁移校验）
func UpdateFileParsingStatus(fileID int64, status string) error {
	if !IsAllowedParsingStatus(status) {
		return fmt.Errorf("%w: parsing_status=%s", ErrInvalidStatusValue, status)
	}
	var current string
	if err := DB.Model(&File{}).Where("id = ?", fileID).Select("parsing_status").Scan(&current).Error; err != nil {
		return err
	}
	// if err := ValidateParsingTransition(current, status); err != nil {
	// 	return err
	// }
	return DB.Model(&File{}).Where("id = ?", fileID).Update("parsing_status", status).Error
}

func UpdateFileAIGenerateChunkStatus(fileID int64, status string) error {
	if !IsAllowedAIGenerateChunkStatus(status) {
		return fmt.Errorf("%w: ai_generate_chunk_status=%s", ErrInvalidStatusValue, status)
	}
	return DB.Model(&File{}).Where("id = ?", fileID).Update("ai_generate_chunk_status", status).Error
}

func UpdateFileAIGenerateSQStatus(fileID int64, status string) error {
	if !IsAllowedAIGenerateSQStatus(status) {
		return fmt.Errorf("%w: ai_generate_sq_status=%s", ErrInvalidStatusValue, status)
	}
	return DB.Model(&File{}).Where("id = ?", fileID).Update("ai_generate_sq_status", status).Error
}

// SetFileTranscriptionStatus 更新 FileCleaningRuleInfo 中的转写状态（独立于 parsing_status，避免被 RAG 管线的失败覆盖）。
func SetFileTranscriptionStatus(fileID int64, status string) error {
	var file File
	if err := DB.Where("id = ?", fileID).Select("cleaning_rule_info").First(&file).Error; err != nil {
		return err
	}
	var info FileCleaningRuleInfo
	if file.CleaningRuleInfo != "" {
		json.Unmarshal([]byte(file.CleaningRuleInfo), &info)
	}
	info.TranscriptionStatus = status
	data, _ := json.Marshal(info)
	return DB.Model(&File{}).Where("id = ?", fileID).Update("cleaning_rule_info", string(data)).Error
}

func IsAllowedAIGenerateChunkStatus(status string) bool {
	_, ok := allowedAIGenerateChunkStates[status]
	return ok
}

func IsAllowedAIGenerateSQStatus(status string) bool {
	_, ok := allowedAIGenerateSQStates[status]
	return ok
}

// GetFileIndexingStatus 计算文件的索引状态（复用解析状态）
// 规则：
// - 如果解析状态是 disabled，则返回 disabled
// - 如果存在 embedding_status = 'pending' 的文档分块 => indexing
// - 否则如果存在 embedding_status = 'failed' 的分块 => failed
// - 否则 => normal
func GetFileIndexingStatus(eid int64, fileID int64) (string, error) {
	// 首先检查文件的解析状态
	var file File
	if err := DB.Where("eid = ? AND id = ?", eid, fileID).Select("parsing_status").First(&file).Error; err != nil {
		return "", err
	}

	// 如果解析状态是禁用，直接返回
	if file.ParsingStatus == FileParsingStatusDisabled {
		return FileParsingStatusDisabled, nil
	}

	var pendingChunk RetrievalChunk
	if err := DB.Model(&RetrievalChunk{}).
		Where("eid = ? AND file_id = ? AND embedding_status = ?", eid, fileID, RetrievalChunkEmbeddingStatusPending).
		First(&pendingChunk).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return "", err
		}
	}
	if pendingChunk.ID != 0 {
		return FileParsingStatusParsing, nil // 复用解析状态中的parsing作为indexing
	}

	var failed RetrievalChunk
	if err := DB.Model(&RetrievalChunk{}).
		Where("eid = ? AND file_id = ? AND embedding_status = ?", eid, fileID, "failed").
		First(&failed).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return "", err
		}
	}
	if failed.ID != 0 {
		return FileParsingStatusFail, nil
	}

	return FileParsingStatusNormal, nil
}

func (file *File) LoadUploadFile() error {
	if file.UploadFileID > 0 {
		uploadFile, err := GetUploadFileByID(file.UploadFileID)
		if err != nil {
			return nil
		}
		file.UploadFile = uploadFile
	}
	return nil
}

// GetFileWithParentsByID 根据文件ID查询文件及其所有父级文件
// 返回当前文件对象和按深度倒序排列的文件列表（包含当前文件）
// 示例：对于路径 /1/2/3/file.md，返回顺序为 [/1/2/3/file.md, /1/2/3, /1/2, /1]
func GetFileWithParentsByID(eid int64, fileID int64) (*File, []File, error) {
	// 1. 查询当前文件
	currentFile, err := GetFileByID(eid, fileID)
	if err != nil {
		return nil, nil, err
	}

	// 2. 拆解路径获取所有父级路径
	parentPaths := splitPathLevels(currentFile.Path)

	// 3. 批量查询所有父级文件，避免逐层 N+1 查询
	parentFiles, err := GetFilesByPathsAndLibrary(eid, currentFile.LibraryID, parentPaths)
	if err != nil {
		return nil, nil, err
	}

	parentFileMap := make(map[string]File, len(parentFiles))
	for _, parentFile := range parentFiles {
		parentFileMap[parentFile.Path] = parentFile
	}

	// 4. 构建结果列表（深度倒序：当前文件 -> 最深父级 -> ... -> 根级）
	var result []File
	result = append(result, *currentFile) // 先添加当前文件

	orderedParents := make([]File, 0, len(parentPaths))
	for _, parentPath := range parentPaths {
		if parentFile, ok := parentFileMap[parentPath]; ok {
			orderedParents = append(orderedParents, parentFile)
		}
	}

	// 倒序添加父级文件（从深到浅）
	for i := len(orderedParents) - 1; i >= 0; i-- {
		result = append(result, orderedParents[i])
	}

	return currentFile, result, nil
}

// splitPathLevels 拆解文件路径为所有父级目录路径
// 示例：/1/2/3/file.md -> ["/1", "/1/2", "/1/2/3"]
func splitPathLevels(filePath string) []string {
	if filePath == "" || filePath == "/" {
		return []string{}
	}

	// 移除开头和结尾的斜杠，然后分割
	cleanPath := strings.Trim(filePath, "/")
	parts := strings.Split(cleanPath, "/")

	var levels []string
	// 只处理目录部分，排除文件名
	for i := 1; i < len(parts); i++ {
		level := "/" + strings.Join(parts[:i], "/")
		levels = append(levels, level)
	}

	return levels
}

// CleanupVectorDataForFile 清理文件的向量数据，可以被独立调用
func CleanupVectorDataForFile(eid int64, fileID int64) error {
	file, err := GetFileByID(eid, fileID)
	if err != nil {
		return fmt.Errorf("获取文件信息失败: %v", err)
	}

	// 仅对文件类型执行向量清理
	if file.Type == FILE_TYPE_DIR {
		log.Printf("目录类型无需清理向量数据 - EID: %d, FileID: %d", eid, fileID)
		return nil
	}

	// 收集需要清理的向量ID
	vectorIDs, err := getVectorIDsForFile(eid, fileID)
	if err != nil {
		log.Printf("获取文件向量ID失败，将跳过向量清理 - EID: %d, FileID: %d, Error: %v", eid, fileID, err)
		return nil // 不返回错误，允许主流程继续
	}

	if len(vectorIDs) == 0 {
		log.Printf("文件没有向量数据需要清理 - EID: %d, FileID: %d", eid, fileID)
		return nil
	}

	// 异步清理向量数据
	go cleanupVectorDataAsync(eid, fileID, vectorIDs)
	return nil
}

// SoftDeleteFile 执行软删除：目标标记主动删除，未主动删除的子级批量被动删除
func SoftDeleteFile(eid int64, fileID int64, userID int64) error {
	now := time.Now().UTC().UnixMilli()

	file, err := GetFileByID(eid, fileID)
	if err != nil {
		return err
	}

	tx := DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 标记目标为主动删除
	if err := tx.Model(&File{}).
		Where("eid = ? AND id = ? AND is_deleted = ?", eid, fileID, false).
		Updates(map[string]interface{}{
			"is_deleted":        true,
			"is_active_deleted": true,
			"deleted_by":        userID,
			"deleted_at":        now,
		}).Error; err != nil {
		tx.Rollback()
		return err
	}

	// 标记未主动删除的子级为被动删除（仅当前未删除的）
	if err := tx.Model(&File{}).
		Where("eid = ? AND library_id = ? AND path LIKE ? AND is_deleted = ?", eid, file.LibraryID, file.Path+"/%", false).
		Updates(map[string]interface{}{
			"is_deleted":        true,
			"is_active_deleted": false,
			"deleted_by":        userID,
			"deleted_at":        now,
		}).Error; err != nil {
		tx.Rollback()
		return err
	}

	var affectedFileIDs []int64
	if err := tx.Model(&File{}).
		Select("id").
		Where("eid = ? AND library_id = ? AND is_deleted = ? AND (id = ? OR path LIKE ?)", eid, file.LibraryID, true, fileID, file.Path+"/%").
		Pluck("id", &affectedFileIDs).Error; err != nil {
		tx.Rollback()
		return err
	}
	if len(affectedFileIDs) > 0 {
		if err := tx.Model(&EntityChunkRelation{}).
			Where("eid = ? AND file_id IN ? AND status <> ?", eid, affectedFileIDs, EntityRelationStatusDeleted).
			Update("status", EntityRelationStatusDeleted).Error; err != nil {
			tx.Rollback()
			return err
		}
	}

	if err := tx.Commit().Error; err != nil {
		return err
	}
	invalidateLibraryFileCountCache(eid, file.LibraryID)

	// 使用独立的向量清理方法
	return CleanupVectorDataForFile(eid, fileID)
}

// RestoreDeletedFile 恢复已删除的文件（夹），并恢复其被动删除的子级
// restoreToRoot: 当父级不存在时是否恢复到根目录
func RestoreDeletedFile(eid int64, fileID int64, restoreToRoot bool, userID int64) error {
	file, err := GetFileByID(eid, fileID)
	if err != nil {
		return err
	}
	if !file.IsDeleted {
		return errors.New("目标未被删除，无法恢复")
	}

	// 计算父级路径
	parentPath := "/"
	if file.Path != "/" {
		parentPath = path.Dir(file.Path)
		if parentPath == "." || parentPath == "" {
			parentPath = "/"
		}
	}

	// 检查父级是否存在且未删除
	var parentOK bool = true
	if parentPath != "/" {
		parent, _ := GetFileByPathAndLibrary(eid, file.LibraryID, parentPath)
		if parent == nil || parent.IsDeleted {
			parentOK = false
		}
	} else {
		// 根目录视为始终存在
		parentOK = true
	}

	tx := DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 确定恢复的目标路径
	var targetPath string
	var skipCurrentFolder bool = false

	if !parentOK {
		if !restoreToRoot {
			tx.Rollback()
			return errors.New("父级不存在，且未允许恢复到根目录")
		}

		// 尝试恢复到根目录
		base := path.Base(file.Path)
		targetPath = "/" + base
		existing, _ := GetFileByPathAndLibraryNotDeleted(eid, file.LibraryID, targetPath)

		// 如果是文件夹且已存在，则跳过当前文件夹的恢复，但仍恢复子项
		if existing != nil && existing.Type == FILE_TYPE_DIR && file.Type == FILE_TYPE_DIR {
			skipCurrentFolder = true
		}
		// 其他情况（包括文件与文件夹同名）都允许恢复
	} else {
		// 父级存在，尝试恢复到原路径
		targetPath = file.Path
		existing, _ := GetFileByPathAndLibraryNotDeleted(eid, file.LibraryID, targetPath)

		// 如果是文件夹且已存在，则跳过当前文件夹的恢复，但仍恢复子项
		if existing != nil && existing.Type == FILE_TYPE_DIR && file.Type == FILE_TYPE_DIR {
			skipCurrentFolder = true
		}
		// 其他情况（包括文件与文件夹同名）都允许恢复
	}

	var restoredFileIDs []int64

	// 如果不跳过当前文件夹，则恢复当前文件夹
	if !skipCurrentFolder {
		if err := tx.Model(&File{}).Where("eid = ? AND id = ?", eid, fileID).
			Updates(map[string]interface{}{
				"path":              targetPath,
				"is_deleted":        false,
				"is_active_deleted": false,
				"deleted_by":        int64(0),
				"deleted_at":        int64(0),
			}).Error; err != nil {
			tx.Rollback()
			return err
		}
		restoredFileIDs = append(restoredFileIDs, fileID)
	} else {
		// 如果跳过当前文件夹，则从数据库中彻底删除当前文件夹夹记录
		if err := tx.Where("eid = ? AND id = ?", eid, fileID).Delete(&File{}).Error; err != nil {
			tx.Rollback()
			return fmt.Errorf("彻底删除跳过的文件夹夹记录失败: %v", err)
		}
	}

	// 处理子项恢复
	if err := handleChildRestoration(tx, eid, file, targetPath, skipCurrentFolder, &restoredFileIDs); err != nil {
		tx.Rollback()
		return err
	}

	if len(restoredFileIDs) > 0 {
		if err := tx.Model(&EntityChunkRelation{}).
			Where("eid = ? AND file_id IN ? AND status <> ?", eid, restoredFileIDs, EntityRelationStatusActive).
			Update("status", EntityRelationStatusActive).Error; err != nil {
			tx.Rollback()
			return err
		}
	}

	if err := tx.Commit().Error; err != nil {
		return err
	}
	invalidateLibraryFileCountCache(eid, file.LibraryID)
	return nil
}

// handleChildRestoration 处理子项恢复逻辑
func handleChildRestoration(tx *gorm.DB, eid int64, parentFile *File, targetPath string, skipCurrentFolder bool, restoredFileIDs *[]int64) error {
	children, err := GetChildrenByPathPrefix(eid, parentFile.Path)
	if err != nil {
		return err
	}

	// 按路径长度排序，确保父目录在子目录之前处理
	sort.Slice(children, func(i, j int) bool {
		return strings.Count(children[i].Path, "/") < strings.Count(children[j].Path, "/")
	})

	for _, child := range children {
		// 确保只处理真正属于这个文件夹的子级
		if !strings.HasPrefix(child.Path, parentFile.Path+"/") {
			continue
		}

		if !child.IsActiveDeleted && child.IsDeleted {
			var newChildPath string

			if skipCurrentFolder {
				// 当前文件夹被跳过，子项需要相对于目标位置重新计算路径
				relPath, _ := filepath.Rel(parentFile.Path, child.Path)
				newChildPath = path.Join(targetPath, relPath)
			} else {
				// 当前文件夹未被跳过，子项保持相对路径不变
				newChildPath = child.Path
			}

			// 检查新路径是否已存在
			if existingChild, _ := GetFileByPathAndLibraryNotDeleted(eid, parentFile.LibraryID, newChildPath); existingChild != nil && existingChild.Type == FILE_TYPE_DIR && child.Type == FILE_TYPE_DIR {
				continue // 只有当子项是文件夹且已在目标路径存在时才跳过
			}

			if err := tx.Model(&File{}).Where("eid = ? AND id = ?", eid, child.ID).
				Updates(map[string]interface{}{
					"path":              newChildPath,
					"is_deleted":        false,
					"is_active_deleted": false,
					"deleted_by":        int64(0),
					"deleted_at":        int64(0),
				}).Error; err != nil {
				return err
			}
			*restoredFileIDs = append(*restoredFileIDs, child.ID)
		}
	}

	return nil
}

// ListRecycleBin 回收站列表（分页）：仅主动删除的文件/文件夹
func ListRecycleBin(eid int64, libraryID int64, offset, limit int, sort string, nameKeyword string, deletedBy int64) ([]File, int64, error) {
	var count int64
	var files []File

	query := DB.Model(&File{}).Where("eid = ? AND library_id = ? AND is_deleted = ? AND is_active_deleted = ?", eid, libraryID, true, true)
	if sort == "asc" {
		query = query.Order("deleted_at asc, id asc")
	} else {
		query = query.Order("deleted_at desc, id desc")
	}

	// 名称搜索：按文件名或路径关键词
	if nameKeyword != "" {
		kw := "%" + nameKeyword + "%"
		query = query.Where("(path LIKE ?)", kw)
	}

	// 删除人员筛选
	if deletedBy > 0 {
		query = query.Where("deleted_by = ?", deletedBy)
	}

	if err := query.Count(&count).Error; err != nil {
		return nil, 0, err
	}

	if err := query.Offset(offset).Limit(limit).Find(&files).Error; err != nil {
		return nil, 0, err
	}
	return files, count, nil
}

// 简化的文件名提取函数
func ExtractSimpleFileName(filePath string) string {
	if filePath == "" {
		return ""
	}

	// 分割路径获取文件名
	parts := strings.Split(filePath, "/")
	if len(parts) == 0 {
		return ""
	}

	fileName := parts[len(parts)-1]
	return fileName
}

func ExtractSimpleBaseName(filePath string) string {
	if filePath == "" {
		return ""
	}

	// 获取文件名
	fileName := ExtractSimpleFileName(filePath)
	if fileName == "" {
		return ""
	}

	// 去掉扩展名
	if lastDot := strings.LastIndex(fileName, "."); lastDot > 0 {
		return fileName[:lastDot]
	}

	return fileName
}

// LoadLastBodyTime 加载文件内容的最后更新时间
func (f *File) LoadLastBodyTime() error {
	var fileBody FileBody
	if err := DB.Select("updated_time").Where("file_id = ?", f.ID).Order("updated_time DESC").First(&fileBody).Error; err != nil {
		return err
	}

	f.LastBodyTime = fileBody.UpdatedTime
	return nil
}

func GetFilesByIDs(eid int64, fileIDs []int64) ([]File, error) {
	var files []File
	if err := DB.Where("eid = ? AND id IN ?", eid, fileIDs).Find(&files).Error; err != nil {
		return nil, err
	}
	return files, nil
}

func GetFilesByOriginRefIDs(originType string, originRefIDs []int64) ([]File, error) {
	var files []File
	if len(originRefIDs) == 0 {
		return files, nil
	}
	if err := DB.Where("origin_type = ? AND origin_ref_id IN ?", originType, originRefIDs).Find(&files).Error; err != nil {
		return nil, err
	}
	return files, nil
}

// GetFileByOriginRef 根据来源类型、来源渠道和来源引用ID精确查询单个文件
func GetFileByOriginRef(eid int64, originType string, originSource string, originRefID int64) (*File, error) {
	var file File
	err := DB.Where("eid = ? AND origin_type = ? AND origin_source = ? AND origin_ref_id = ? AND is_deleted = ?",
		eid, originType, originSource, originRefID, false).First(&file).Error
	if err != nil {
		return nil, err
	}
	return &file, nil
}

// GetAIGeneratedFileBySandboxOutputFileID 根据 AI 输出文件 ID 反查对应的 File。
// 这里不强依赖 origin_source，兼容早期仅写入 origin_type / origin_ref_id 的记录。
func GetAIGeneratedFileBySandboxOutputFileID(eid, sandboxOutputFileID int64) (*File, error) {
	var file File
	err := DB.Where("eid = ? AND origin_type = ? AND origin_ref_id = ? AND is_deleted = ?",
		eid, FileOriginTypeAIGenerated, sandboxOutputFileID, false).First(&file).Error
	if err != nil {
		return nil, err
	}
	return &file, nil
}

// GetFileIDsByDirectoryPath 获取文件夹路径下所有子文件的ID（递归，不包含文件夹）
func GetFileIDsByDirectoryPath(eid, libraryID int64, directoryPath string) ([]int64, error) {
	var fileIDs []int64

	// 构建查询：递归查找目录下所有子路径的文件
	// 使用 LIKE pattern 匹配所有子路径
	// 只查询文件类型，排除文件夹
	query := DB.Model(&File{}).
		Select("id").
		Where("eid = ? AND library_id = ? AND path LIKE ? AND type = ? AND is_deleted = ?",
			eid, libraryID, directoryPath+"/%", FILE_TYPE_FILE, false)

	if err := query.Find(&fileIDs).Error; err != nil {
		return nil, err
	}

	return fileIDs, nil
}

// DeduplicateFileIDs 对文件ID数组进行去重
func DeduplicateFileIDs(fileIDs []int64) []int64 {
	seen := make(map[int64]bool)
	var result []int64

	for _, id := range fileIDs {
		if !seen[id] {
			seen[id] = true
			result = append(result, id)
		}
	}

	return result
}

// / GetAccurateFileName 获取文件的准确文件名
func (file *File) GetAccurateFileName() string {
	file.LoadUploadFile()
	if file.UploadFile != nil && file.UploadFile.FileName != "" {
		return file.UploadFile.FileName
	}

	// 从 file.Path 中获取文件名
	file.Path = strings.TrimPrefix(file.Path, "/")
	return ExtractSimpleFileName(file.Path)
}
