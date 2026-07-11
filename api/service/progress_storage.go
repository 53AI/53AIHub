package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
	"github.com/go-redis/redis/v8"
)

// ProgressStorage 进度存储管理器
type ProgressStorage struct {
	redis        *redis.Client
	memoryCache  *sync.Map
	cacheTimeout time.Duration
	batchTimeout time.Duration
	mu           sync.RWMutex // 保护redis字段的并发访问
}

// BatchProgressInfo 批次进度信息
type BatchProgressInfo struct {
	TotalFiles      int     `json:"total_files"`
	UploadedFiles   int     `json:"uploaded_files"`
	FailedFiles     int     `json:"failed_files"`
	TotalSize       int64   `json:"total_size"`
	UploadedSize    int64   `json:"uploaded_size"`
	OverallProgress float64 `json:"overall_progress"`
	Status          string  `json:"status"`
	StartTime       int64   `json:"start_time"`
	EstimatedETA    int64   `json:"estimated_eta"`
}

// FileProgress 文件进度信息
type FileProgress struct {
	// 数据库中的文件ID
	DatabaseID int64 `json:"database_id,omitempty"`
	// 数据库中的File表ID
	FileID int64 `json:"file_id,omitempty"`
	// 文件ID
	FileUploadID string `json:"file_upload_id"`
	// 相对路径
	RelativePath string `json:"relative_path"`
	// 文件状态
	// Enum: queued, uploading, uploaded, converting, completed, failed
	// queued: 队列中，文件正在等待上传
	// uploading: 上传中，文件正在上传到服务器
	// uploaded: 已上传，文件已成功上传到服务器
	// converting: 转换中，文件正在进行格式转换处理
	// completed: 已完成，文件已完全处理完毕
	// failed: 失败，文件上传或处理过程中发生错误
	Status string `json:"status"`
	// 进度百分比
	Progress float64 `json:"progress"`
	// 已上传大小
	UploadedSize int64 `json:"uploaded_size"`
	// 总大小
	TotalSize int64 `json:"total_size"`
	// 上传速度
	Speed int64 `json:"speed"`
	// 预计剩余时间
	ETA int64 `json:"eta"`
	// 错误信息
	Error string `json:"error,omitempty"`
	// 转换进度信息
	ConversionInfo *ConversionProgress `json:"conversion_info,omitempty"`
}

// ConversionProgress 转换进度信息
type ConversionProgress struct {
	Stage    string  `json:"stage"`
	Progress float64 `json:"progress"`
	Message  string  `json:"message"`
}

// BatchProgressResponse 批量上传进度响应
type BatchProgressResponse struct {
	// 批次ID
	BatchID string `json:"batch_id"`
	// 批次状态
	// Enum: init, uploading, converting, completed, failed, cancelled
	// init: 初始化状态，批次刚创建时的状态
	// uploading: 上传中，正在上传文件到服务器
	// uploaded: 已上传
	// completed: 已完成，所有文件已上传并处理完毕
	// failed: 失败，至少有一个文件上传或处理失败
	// cancelled: 已取消，用户主动取消了上传批次
	Status string `json:"status"`
	// 批次进度信息
	BatchProgress *BatchProgressInfo `json:"batch_progress"`
	// 文件进度信息映射
	Files map[string]*FileProgress `json:"files,omitempty"`
	// 错误信息列表
	Errors []FileError `json:"errors,omitempty"`
	// 最后更新时间戳
	LastUpdate int64 `json:"last_update"`
}

// FileError 文件错误信息
type FileError struct {
	FileID       string `json:"file_id"`
	RelativePath string `json:"relative_path"`
	Error        string `json:"error"`
	Timestamp    int64  `json:"timestamp"`
}

// ProgressQueryParams 进度查询参数
type ProgressQueryParams struct {
	Detail       bool   `form:"detail"`
	FileUploadID string `form:"file_upload_id"`
	Since        int64  `form:"since"`
}

// NewProgressStorage 创建进度存储管理器
func NewProgressStorage() *ProgressStorage {
	cacheTimeout := config.GetBatchUploadTimeout()
	batchTimeout := cacheTimeout * 2

	ps := &ProgressStorage{
		redis:        nil,
		memoryCache:  &sync.Map{},
		cacheTimeout: cacheTimeout,
		batchTimeout: batchTimeout,
	}

	// 尝试初始化Redis连接
	ps.initRedisConnection()

	return ps
}

// initRedisConnection 初始化Redis连接
func (s *ProgressStorage) initRedisConnection() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if common.RedisEnabled && common.RDB != nil {
		// 安全地转换为具体的redis.Client类型
		if client, ok := common.RDB.(*redis.Client); ok {
			s.redis = client
		}
	}
}

// ensureRedisConnection 确保Redis连接可用，如果不可用则尝试重新连接
func (s *ProgressStorage) ensureRedisConnection() *redis.Client {
	s.mu.RLock()
	if s.redis != nil {
		client := s.redis
		s.mu.RUnlock()
		return client
	}
	s.mu.RUnlock()

	// 尝试重新初始化Redis连接
	s.initRedisConnection()

	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.redis
}

// SaveBatch 保存批次信息
func (s *ProgressStorage) SaveBatch(batch *BatchUpload) error {
	// 保存到内存缓存
	s.memoryCache.Store(fmt.Sprintf("batch:%s", batch.ID), batch)

	// 尝试保存到Redis
	if redisClient := s.ensureRedisConnection(); redisClient != nil {
		batchJSON, err := json.Marshal(batch)
		if err != nil {
			return fmt.Errorf("序列化批次信息失败: %v", err)
		}

		key := fmt.Sprintf("batch_upload:batch:%s", batch.ID)
		err = redisClient.Set(context.Background(), key, batchJSON, s.batchTimeout).Err()
		if err != nil {
			// Redis错误不应该阻止操作，只记录警告
			fmt.Printf("警告: 保存批次到Redis失败: %v\n", err)
		}

		// 更新最后更新时间
		lastUpdateKey := fmt.Sprintf("batch_upload:last_update:%s", batch.ID)
		redisClient.Set(context.Background(), lastUpdateKey, time.Now().UnixMilli(), s.batchTimeout)
	}

	return nil
}

// LoadBatch 加载批次信息
func (s *ProgressStorage) LoadBatch(batchID string) (*BatchUpload, error) {
	// 先查内存缓存，返回深拷贝以避免并发修改裸指针内的 map 导致 panic
	if value, ok := s.memoryCache.Load(fmt.Sprintf("batch:%s", batchID)); ok {
		if b, ok2 := value.(*BatchUpload); ok2 {
			// 使用 json 深拷贝（简洁且可靠）
			if data, err := json.Marshal(b); err == nil {
				var copyBatch BatchUpload
				if err2 := json.Unmarshal(data, &copyBatch); err2 == nil {
					return &copyBatch, nil
				}
			}
			// 若深拷贝失败，回退到返回原始对象（尽量不发生）
			return b, nil
		}
	}

	// 尝试从Redis加载
	if redisClient := s.ensureRedisConnection(); redisClient != nil {
		key := fmt.Sprintf("batch_upload:batch:%s", batchID)
		batchJSON, err := redisClient.Get(context.Background(), key).Result()
		if err != nil {
			if err == redis.Nil {
				return nil, fmt.Errorf("批次不存在")
			}
			return nil, fmt.Errorf("从Redis加载批次失败: %v", err)
		}

		var batch BatchUpload
		err = json.Unmarshal([]byte(batchJSON), &batch)
		if err != nil {
			return nil, fmt.Errorf("反序列化批次信息失败: %v", err)
		}

		// 回填内存缓存
		s.memoryCache.Store(fmt.Sprintf("batch:%s", batchID), &batch)

		return &batch, nil
	}

	// Redis不可用时，只能从内存缓存查找
	return nil, fmt.Errorf("批次不存在")
}

// UpdateFileProgress 更新文件进度
func (s *ProgressStorage) UpdateFileProgress(batchID, fileID string, fileUpload *FileUpload) error {
	// 更新内存缓存
	key := fmt.Sprintf("file:%s:%s", batchID, fileID)
	s.memoryCache.Store(key, fileUpload)

	// 尝试异步更新Redis
	if redisClient := s.ensureRedisConnection(); redisClient != nil {
		go func() {
			progressJSON, _ := json.Marshal(fileUpload)
			redisKey := fmt.Sprintf("batch_upload:file:%s:%s", batchID, fileID)
			redisClient.Set(context.Background(), redisKey, progressJSON, s.cacheTimeout)

			// 更新批次最后更新时间
			lastUpdateKey := fmt.Sprintf("batch_upload:last_update:%s", batchID)
			redisClient.Set(context.Background(), lastUpdateKey, time.Now().UnixMilli(), s.batchTimeout)
		}()
	}

	return nil
}

// GetFileProgress 获取文件进度
func (s *ProgressStorage) GetFileProgress(batchID, fileID string) (*FileUpload, error) {
	key := fmt.Sprintf("file:%s:%s", batchID, fileID)

	// 先查内存缓存
	if value, ok := s.memoryCache.Load(key); ok {
		return value.(*FileUpload), nil
	}

	// 尝试从Redis获取
	if redisClient := s.ensureRedisConnection(); redisClient != nil {
		redisKey := fmt.Sprintf("batch_upload:file:%s:%s", batchID, fileID)
		progressJSON, err := redisClient.Get(context.Background(), redisKey).Result()
		if err != nil {
			if err == redis.Nil {
				return nil, fmt.Errorf("文件进度不存在")
			}
			return nil, fmt.Errorf("从Redis获取文件进度失败: %v", err)
		}

		var fileUpload FileUpload
		err = json.Unmarshal([]byte(progressJSON), &fileUpload)
		if err != nil {
			return nil, fmt.Errorf("反序列化文件进度失败: %v", err)
		}

		// 回填内存缓存
		s.memoryCache.Store(key, &fileUpload)

		return &fileUpload, nil
	}

	// Redis不可用时，只能从内存缓存查找
	return nil, fmt.Errorf("文件进度不存在")
}

// GetBatchProgress 获取批次进度
func (s *ProgressStorage) GetBatchProgress(batchID string, params *ProgressQueryParams) (*BatchProgressResponse, error) {
	batch, err := s.LoadBatch(batchID)
	if err != nil {
		return nil, err
	}

	// 计算批次进度信息
	batchProgress := s.calculateBatchProgress(batch)

	response := &BatchProgressResponse{
		BatchID:       batchID,
		Status:        batch.Status,
		BatchProgress: batchProgress,
		LastUpdate:    batch.UpdatedAt.UnixMilli(),
	}

	// 如果需要详细信息
	if params.Detail {
		files := make(map[string]*FileProgress)
		errors := make([]FileError, 0)

		for FileUploadID, fileUpload := range batch.Files {
			// 如果指定了特定文件ID，只返回该文件
			if params.FileUploadID != "" && FileUploadID != params.FileUploadID {
				continue
			}

			// 如果指定了时间戳，只返回更新时间晚于该时间戳的文件
			if params.Since > 0 && fileUpload.UpdateTime.UnixMilli() <= params.Since {
				continue
			}

			fileProgress := &FileProgress{
				FileUploadID: FileUploadID,
				RelativePath: fileUpload.RelativePath,
				Status:       fileUpload.Status,
				Progress:     fileUpload.Progress,
				UploadedSize: fileUpload.UploadedSize,
				TotalSize:    fileUpload.TotalSize,
				Speed:        fileUpload.Speed,
				ETA:          fileUpload.ETA,
				Error:        fileUpload.Error,
			}

			// 如果有数据库ID，从数据库获取文件信息
			if fileUpload.DatabaseID != 0 {
				// 从数据库获取文件详细信息
				dbFile, err := model.GetUploadFileByID(fileUpload.DatabaseID)
				if err == nil && dbFile != nil {
					// 添加数据库ID到响应中
					fileProgress.DatabaseID = dbFile.ID
					// 如果有错误信息，确保包含在响应中
					if fileProgress.Status == "failed" && (dbFile.Error != "" && fileProgress.Error == "") {
						fileProgress.Error = dbFile.Error
					}
				}
			}

			// 如果有File表ID，添加到响应中
			if fileUpload.FileID != 0 {
				fileProgress.FileID = fileUpload.FileID
			}

			// 如果文件正在转换，添加转换信息
			if fileUpload.Status == "converting" {
				fileProgress.ConversionInfo = &ConversionProgress{
					Stage:    "html_to_markdown",
					Progress: 50.0,
					Message:  "正在转换HTML到Markdown",
				}
			}

			files[FileUploadID] = fileProgress

			// 收集错误信息
			if fileUpload.Error != "" {
				errors = append(errors, FileError{
					FileID:       FileUploadID,
					RelativePath: fileUpload.RelativePath,
					Error:        fileUpload.Error,
					Timestamp:    fileUpload.UpdateTime.UnixMilli(),
				})
			}
		}

		response.Files = files
		response.Errors = errors
	}

	return response, nil
}

// calculateBatchProgress 计算批次进度
func (s *ProgressStorage) calculateBatchProgress(batch *BatchUpload) *BatchProgressInfo {
	var totalSize, uploadedSize int64
	var avgSpeed int64
	activeFiles := 0

	for _, fileUpload := range batch.Files {
		totalSize += fileUpload.TotalSize
		uploadedSize += fileUpload.UploadedSize

		if fileUpload.Status == "uploading" {
			avgSpeed += fileUpload.Speed
			activeFiles++
		}
	}

	overallProgress := float64(0)
	if totalSize > 0 {
		overallProgress = float64(uploadedSize) / float64(totalSize) * 100
	}

	// 计算预估完成时间
	var estimatedETA int64
	if activeFiles > 0 && avgSpeed > 0 {
		remainingSize := totalSize - uploadedSize
		estimatedETA = remainingSize / (avgSpeed / int64(activeFiles))
	}

	return &BatchProgressInfo{
		TotalFiles:      batch.TotalFiles,
		UploadedFiles:   batch.UploadedFiles,
		FailedFiles:     batch.FailedFiles,
		TotalSize:       totalSize,
		UploadedSize:    uploadedSize,
		OverallProgress: overallProgress,
		Status:          batch.Status,
		StartTime:       batch.CreatedAt.UnixMilli(),
		EstimatedETA:    estimatedETA,
	}
}

// DeleteBatch 删除批次信息
func (s *ProgressStorage) DeleteBatch(batchID string) error {
	// 删除内存缓存
	s.memoryCache.Delete(fmt.Sprintf("batch:%s", batchID))

	// 尝试删除Redis中的批次信息
	if redisClient := s.ensureRedisConnection(); redisClient != nil {
		keys := []string{
			fmt.Sprintf("batch_upload:batch:%s", batchID),
			fmt.Sprintf("batch_upload:last_update:%s", batchID),
		}

		// 删除所有相关的文件进度信息
		pattern := fmt.Sprintf("batch_upload:file:%s:*", batchID)
		fileKeys, err := redisClient.Keys(context.Background(), pattern).Result()
		if err == nil {
			keys = append(keys, fileKeys...)
		}

		if len(keys) > 0 {
			redisClient.Del(context.Background(), keys...)
		}
	}

	return nil
}

// GetLastUpdateTime 获取批次最后更新时间
func (s *ProgressStorage) GetLastUpdateTime(batchID string) (int64, error) {
	if redisClient := s.ensureRedisConnection(); redisClient != nil {
		key := fmt.Sprintf("batch_upload:last_update:%s", batchID)
		result, err := redisClient.Get(context.Background(), key).Result()
		if err != nil {
			if err == redis.Nil {
				return 0, nil
			}
			return 0, err
		}

		var timestamp int64
		err = json.Unmarshal([]byte(result), &timestamp)
		if err != nil {
			return 0, err
		}

		return timestamp, nil
	}

	// Redis不可用时返回0
	return 0, nil
}
