package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
	"github.com/53AI/53AIHub/service/rag"
	"gorm.io/gorm"
)

// AutoChunkingService 自动分块服务
type AutoChunkingService struct {
	db *gorm.DB
}

// NewAutoChunkingService 创建自动分块服务实例
func NewAutoChunkingService(db *gorm.DB) *AutoChunkingService {
	return &AutoChunkingService{
		db: db,
	}
}

// ProcessAutoChunkingAsync 处理自动分块（异步）
func (s *AutoChunkingService) ProcessAutoChunkingAsync(eid int64, fileID int64, userID int64, content string, configID *int64) {
	// 注意：不再跳过小于最小分块大小的内容，而是将其作为单个分块处理
	// 这确保了所有内容都会经过完整的处理流程，包括保存和embedding

	if err := model.UpdateFileParsingStatus(fileID, model.FileParsingStatusParsing); err != nil {
		fmt.Printf("警告：更新文件解析状态为 parsing 失败: %v\n", err)
	}
	// 执行分块
	chunkerService := rag.NewChunkerService(s.db)
	result, err := chunkerService.ChunkDocument(eid, fileID, content, configID)
	if err != nil {
		_ = model.UpdateFileParsingStatus(fileID, model.FileParsingStatusFail)
		fmt.Printf("异步分块 - 分块失败: %v\n", err)
		return
	}

	// 保存分块
	err = chunkerService.SaveChunks(eid, fileID, result.Chunks)
	if err != nil {
		fmt.Printf("异步分块 - 保存分块失败: %v\n", err)
		if err := model.UpdateFileParsingStatus(fileID, model.FileParsingStatusFail); err != nil {
			fmt.Printf("警告：更新文件解析状态为 failed 失败: %v\n", err)
		}
		return
	}

	// 记录操作日志
	err = model.CreateAutoChunkLog(eid, fileID, userID, len(result.Chunks), result.Metadata.TotalTokens)
	if err != nil {
		// 日志记录失败不影响主流程
		fmt.Printf("异步分块 - 记录分块日志失败: %v\n", err)
	}

	fmt.Printf("异步分块完成 - 文件ID: %d, 分块数量: %d, Token数量: %d\n",
		fileID, len(result.Chunks), result.Metadata.TotalTokens)

	if err := model.UpdateFileParsingStatus(fileID, model.FileParsingStatusNormal); err != nil {
		fmt.Printf("警告：更新文件解析状态为 normal 失败: %v\n", err)
	}
	file, err := model.GetFileByID(eid, fileID)
	if err != nil {
		fmt.Printf("获取文件信息失败: %v\n", err)
	}
	if file != nil && file.UploadFileID > 0 {
		uploadFile, _ := model.GetUploadFileByID(file.UploadFileID)
		// 标记为完成
		uploadFile.MarkAsCompleted()
	}

	// 自动进行 embedding 处理
	err = s.processEmbeddingForNewChunks(eid, fileID)
	if err != nil {
		fmt.Printf("异步分块 - embedding 处理失败: %v\n", err)
	}
}

// ProcessEmbeddingForNewChunks 为新创建的分块处理 embedding
func (s *AutoChunkingService) ProcessEmbeddingForNewChunks(eid int64, fileID int64) error {
	return s.processEmbeddingForNewChunks(eid, fileID)
}

// processEmbeddingForNewChunks 为新创建的分块处理 embedding（内部方法）
func (s *AutoChunkingService) processEmbeddingForNewChunks(eid int64, fileID int64) error {
	// 获取文件信息
	var file model.File
	err := s.db.Where("eid = ? AND id = ?", eid, fileID).First(&file).Error
	if err != nil {
		return fmt.Errorf("获取文件信息失败: %v", err)
	}

	// 兜底：若该文件尚无任何检索块，则先创建默认检索块
	{
		existChunks, errExist := model.GetRetrievalChunksByFileID(eid, fileID)
		if errExist != nil {
			fmt.Printf("检查检索块存在失败: %v\n", errExist)
		} else if len(existChunks) == 0 {
			if err := rag.CreateDefaultRetrievalChunksForFile(eid, fileID); err != nil {
				fmt.Printf("创建默认检索块失败: %v\n", err)
			}
		}
	}

	// 将该文件的待处理检索块统一入队，由队列消费者处理
	if err := rag.EnqueueRetrievalChunksByFile(eid, fileID, file.LibraryID); err != nil {
		fmt.Printf("文件 %d 入队检索块失败: %v\n", fileID, err)
	} else {
		fmt.Printf("文件 %d 入队检索块已入队\n", fileID)
	}
	return nil
}

// ChunkSummary 分块摘要
type ChunkSummary struct {
	TotalChunks    int   `json:"total_chunks"`
	TotalTokens    int   `json:"total_tokens"`
	ProcessingTime int64 `json:"processing_time"`
}

// recoverParsingFiles 恢复解析状态为parsing的文件
func recoverParsingFiles() error {
	log.Printf("开始恢复解析状态为parsing的文件任务")

	// 查询所有解析状态为parsing且未被删除的文件
	var files []model.File
	err := model.DB.Where("parsing_status = ? AND is_deleted = ?",
		model.FileParsingStatusParsing, false).Find(&files).Error
	if err != nil {
		return fmt.Errorf("查询解析中的文件失败: %v", err)
	}

	if len(files) == 0 {
		log.Printf("没有需要恢复的解析任务")
		return nil
	}

	log.Printf("发现 %d 个需要恢复的解析任务", len(files))

	// 为每个文件重新执行分块操作
	for _, file := range files {
		// 更新状态为失败
		if err := model.UpdateFileParsingStatus(file.ID, model.FileParsingStatusFail); err != nil {
			log.Printf("更新文件 %d 解析状态为失败时出错: %v", file.ID, err)
			continue
		}

		// 获取文件内容
		fileBody, err := model.GetLastFileBodyByFileID(file.Eid, file.ID)
		if err != nil {
			log.Printf("获取文件内容失败 - FileID: %d, Error: %v", file.ID, err)
			continue
		}

		if fileBody == nil {
			log.Printf("文件内容为空 - FileID: %d", file.ID)
			continue
		}
		content, err := fileBody.GetContent()
		if err != nil {
			log.Printf("获取文件内容失败 - FileID: %d, Error: %v", file.ID, err)
			continue
		}

		// 使用自动分块服务重新处理
		ProcessAutoChunkingAsync(
			file.Eid,
			file.ID,
			file.UserID,
			content,
			file.ConfigID)

		log.Printf("已重新启动文件分块任务 - FileID: %d", file.ID)
	}

	log.Printf("解析中的文件任务恢复完成，共处理 %d 个文件", len(files))
	return nil
}

// RecoverParsingFile 通过HTTP请求触发指定文件的重新解析
func RecoverParsingFile(eid int64, fileID int64) error {
	log.Printf("开始恢复指定文件的解析任务 - EID: %d, FileID: %d", eid, fileID)

	// 查询指定文件，状态为parsing且未被删除
	var file model.File
	err := model.DB.Where("eid = ? AND id = ? AND parsing_status = ? AND is_deleted = ?",
		eid, fileID, model.FileParsingStatusParsing, false).First(&file).Error
	if err != nil {
		return fmt.Errorf("查询解析中的文件失败: %v", err)
	}

	// 获取文件内容
	fileBody, err := model.GetLastFileBodyByFileID(file.Eid, file.ID)
	if err != nil {
		log.Printf("获取文件内容失败 - FileID: %d, Error: %v", file.ID, err)
		return fmt.Errorf("获取文件内容失败: %v", err)
	}

	if fileBody == nil {
		log.Printf("文件内容为空 - FileID: %d", file.ID)
		// 更新文件状态为失败
		if err := model.UpdateFileParsingStatus(file.ID, model.FileParsingStatusFail); err != nil {
			log.Printf("更新文件解析状态失败: %v", err)
		}
		return fmt.Errorf("文件内容为空")
	}
	content, err := fileBody.GetContent()
	if err != nil {
		log.Printf("获取文件内容失败 - FileID: %d, Error: %v", file.ID, err)
		return fmt.Errorf("获取文件内容失败: %v", err)
	}

	// 使用自动分块服务重新处理
	ProcessAutoChunkingAsync(
		file.Eid,
		file.ID,
		file.UserID,
		content,
		file.ConfigID)

	log.Printf("已重新启动文件分块任务 - FileID: %d", file.ID)
	return nil
}

// 全局函数，用于向后兼容
var globalAutoChunkingService *AutoChunkingService

// InitAutoChunkingService 初始化全局自动分块服务
func InitAutoChunkingService(db *gorm.DB) {
	globalAutoChunkingService = NewAutoChunkingService(db)

	// 设置 model 包的回调函数
	model.SetAutoChunkingCallback(ProcessAutoChunkingAsync)
}

// ProcessAutoChunkingAsync 全局函数，用于向后兼容
func ProcessAutoChunkingAsync(eid int64, fileID int64, userID int64, content string, configID *int64) {
	if globalAutoChunkingService == nil {
		globalAutoChunkingService = NewAutoChunkingService(model.DB)
	}

	// 异步执行
	go globalAutoChunkingService.ProcessAutoChunkingAsync(eid, fileID, userID, content, configID)
}

// ProcessEmbeddingForNewChunks 全局函数，用于向后兼容
func ProcessEmbeddingForNewChunks(eid int64, fileID int64) error {
	if globalAutoChunkingService == nil {
		globalAutoChunkingService = NewAutoChunkingService(model.DB)
	}
	return globalAutoChunkingService.ProcessEmbeddingForNewChunks(eid, fileID)
}

// RecoverParsingFiles 全局函数，用于恢复解析状态为parsing的文件
func RecoverParsingFiles() error {
	return recoverParsingFiles()
}

// RecoverParsingFileByID 全局函数，用于恢复指定文件的解析
func RecoverParsingFileByID(eid int64, fileID int64) error {
	return RecoverParsingFile(eid, fileID)
}

// ProcessAutoChunkingWithPipeline 使用流水线处理自动分块
func (s *AutoChunkingService) ProcessAutoChunkingWithPipeline(eid int64, fileID int64, userID int64, content string, configID *int64) error {
	params := map[string]interface{}{
		"eid":           eid,
		"file_id":       fileID,
		"user_id":       userID,
		"origin_status": model.FileParsingStatusInactive,
	}
	if configID != nil {
		params["config_id"] = *configID
	}
	paramsJSON, err := json.Marshal(params)
	if err != nil {
		return fmt.Errorf("failed to marshal parameters: %v", err)
	}
	if err = model.UpdateFileConversionStatus(fileID, model.FileConversionStatusNormal); err != nil {
		// 记录错误但不中断处理流程
		logger.SysErrorf("警告: 更新文件转换状态为pending失败: %v", err)
	}
	if err = model.UpdateFileParsingStatus(fileID, model.FileParsingStatusPending); err != nil {
		logger.SysErrorf("警告: 更新文件转换状态为FileParsingStatusPending失败: %v", err)
	}

	jobs, err := GetRagJobFactoryV2().CreateJobsForFile(context.Background(), eid, fileID, string(paramsJSON))
	if err != nil {
		return fmt.Errorf("failed to create auto chunking job: %v", err)
	}

	if len(jobs) > 0 {
		fmt.Printf("已创建自动分块流水线任务 - 任务ID: %d, 文件ID: %d\n", jobs[0].JobID, fileID)
	}
	return nil
}

// ProcessAutoChunkingWithPipeline 全局函数，用于向后兼容
func ProcessAutoChunkingWithPipeline(eid int64, fileID int64, userID int64, content string, configID *int64) {
	if globalAutoChunkingService == nil {
		globalAutoChunkingService = NewAutoChunkingService(model.DB)
	}

	// 直接调用，任务队列本身就是异步处理的
	if err := globalAutoChunkingService.ProcessAutoChunkingWithPipeline(eid, fileID, userID, content, configID); err != nil {
		fmt.Printf("流水线分块失败: %v\n", err)
	}
}
