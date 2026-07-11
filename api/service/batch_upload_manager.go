package service

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"mime/multipart"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/config"
	"github.com/53AI/53AIHub/model"
)

// BatchUploadManager 批量上传管理器
type BatchUploadManager struct {
	batches         map[string]*BatchUpload
	progressStorage *ProgressStorage
	chunkManager    *ChunkUploadManager
	uploadExecutor  func(*UploadTask) error
	maxConcurrent   int
	chunkSize       int64
	semaphore       chan struct{}
	cleanupTicker   *time.Ticker
	mu              sync.RWMutex
}

var errBatchUploadCancelled = errors.New("批次已取消")

// BatchUpload 批量上传会话
type BatchUpload struct {
	ID            string                 `json:"id"`
	LibraryID     int64                  `json:"library_id"`
	UserID        int64                  `json:"user_id"`
	EID           int64                  `json:"eid"`
	Status        string                 `json:"status"` // init, uploading, converting, completed, failed, cancelled
	TotalFiles    int                    `json:"total_files"`
	UploadedFiles int                    `json:"uploaded_files"`
	FailedFiles   int                    `json:"failed_files"`
	Files         map[string]*FileUpload `json:"files"`
	UploadToken   string                 `json:"upload_token"`
	BasePath      string                 `json:"base_path"`
	OriginType    string                 `json:"origin_type"`
	OriginSource  string                 `json:"origin_source"`
	OriginRefID   int64                  `json:"origin_ref_id"`
	CreatedAt     time.Time              `json:"created_at"`
	UpdatedAt     time.Time              `json:"updated_at"`
	mu            sync.RWMutex           `json:"-"` // Add a mutex to protect all mutable fields of BatchUpload
}

// FileUpload 文件上传信息
type FileUpload struct {
	ID           string           `json:"id"`
	RelativePath string           `json:"relative_path"`
	Status       string           `json:"status"` // queued, uploading, uploaded, converting, completed, failed
	Progress     float64          `json:"progress"`
	UploadedSize int64            `json:"uploaded_size"`
	TotalSize    int64            `json:"total_size"`
	Speed        int64            `json:"speed"`
	ETA          int64            `json:"eta"`
	ChunkInfo    *ChunkUploadInfo `json:"chunk_info,omitempty"`
	Error        string           `json:"error,omitempty"`
	StartTime    time.Time        `json:"start_time"`
	UpdateTime   time.Time        `json:"update_time"`
	SpeedHistory []int64          `json:"speed_history,omitempty"`
	DatabaseID   int64            `json:"database_id"` // 数据库中的文件ID
	FileID       int64            `json:"file_id"`     // 数据库中的File表ID
}

// ChunkUploadInfo 分片上传信息
type ChunkUploadInfo struct {
	TotalChunks     int            `json:"total_chunks"`
	CompletedChunks int            `json:"completed_chunks"`
	ChunkSize       int64          `json:"chunk_size"`
	Chunks          map[int]*Chunk `json:"chunks"`
}

// Chunk 分片信息
type Chunk struct {
	Index      int       `json:"index"`
	Size       int64     `json:"size"`
	Hash       string    `json:"hash"`
	Status     string    `json:"status"` // pending, uploading, completed, failed
	UploadTime time.Time `json:"upload_time"`
}

// UploadTask 上传任务
type UploadTask struct {
	BatchID       string
	FileID        string
	RelativePath  string
	FileHeader    *multipart.FileHeader
	UserID        int64
	EID           int64
	LibraryID     int64
	IsChunked     bool
	ChunkIndex    int
	TotalChunks   int
	ChunkData     []byte
	DatabaseID    int64
	FileIDRef     int64
	BasePath      string
	OriginType    string
	OriginSource  string
	OriginRefID   int64
	Nickname      string
	IP            string
	DuplicateMode DuplicateMode
	ParseType     string
}

// DuplicateMode 同名文件处理模式
type DuplicateMode string

const (
	DuplicateModeSequence DuplicateMode = "sequence" // 默认：自动添加序号
	DuplicateModeReplace  DuplicateMode = "replace"  // 替换原文件
)

// DuplicateFileInfo 同名文件信息
type DuplicateFileInfo struct {
	RelativePath string `json:"relative_path"` // 文件相对路径
	ExistingID   int64  `json:"existing_id"`   // 已存在文件的ID
}

// FileStructureItem 文件结构项
type FileStructureItem struct {
	RelativePath string `json:"relative_path" binding:"required"`
	Size         int64  `json:"size" binding:"required"`
	IsDirectory  bool   `json:"is_directory"`
	ParentPath   string `json:"parent_path"`
	Depth        int    `json:"depth"`
}

// BatchInitRequest 批量上传初始化请求
type BatchInitRequest struct {
	LibraryID     int64               `json:"library_id" binding:"required"`
	BasePath      string              `json:"base_path"`
	TotalFiles    int                 `json:"total_files" binding:"required"`
	TotalSize     int64               `json:"total_size" binding:"required"`
	FileStructure []FileStructureItem `json:"file_structure" binding:"required"`
	OriginType    string              `json:"origin_type"`
	OriginSource  string              `json:"origin_source"`
	OriginRefID   int64               `json:"origin_ref_id"`
}

// BatchInitResponse 批量上传初始化响应
type BatchInitResponse struct {
	BatchID        string              `json:"batch_id"`
	UploadToken    string              `json:"upload_token"`
	MaxConcurrent  int                 `json:"max_concurrent"`
	ChunkSize      int64               `json:"chunk_size"`
	FileMappings   map[string]string   `json:"file_mappings"`
	DuplicateFiles []DuplicateFileInfo `json:"duplicate_files"`
}

// NewBatchUploadManager 创建批量上传管理器
func NewBatchUploadManager() *BatchUploadManager {
	maxConcurrent := config.BATCH_UPLOAD_MAX_CONCURRENT
	if maxConcurrent <= 0 {
		maxConcurrent = 5
	}

	chunkSize := config.BATCH_UPLOAD_CHUNK_SIZE
	if chunkSize <= 0 {
		chunkSize = 5 * 1024 * 1024 // 5MB
	}

	manager := &BatchUploadManager{
		batches:         make(map[string]*BatchUpload),
		progressStorage: NewProgressStorage(),
		chunkManager:    NewChunkUploadManager(),
		uploadExecutor: func(task *UploadTask) error {
			fileProcessor := NewFileProcessor()
			return fileProcessor.ProcessFileUpload(task)
		},
		maxConcurrent: maxConcurrent,
		chunkSize:     chunkSize,
		semaphore:     make(chan struct{}, maxConcurrent),
	}

	// 启动清理定时器
	cleanupInterval := config.GetBatchUploadCleanupInterval()
	manager.cleanupTicker = time.NewTicker(cleanupInterval)
	go manager.cleanupExpiredBatches()

	return manager
}

// CreateBatch 创建批量上传会话
func (m *BatchUploadManager) CreateBatch(eid, userID int64, req *BatchInitRequest) (*BatchUpload, []DuplicateFileInfo, error) {
	dirManager := NewDirectoryManager()
	if err := dirManager.CreateDirectoryTree(eid, req.LibraryID, req.FileStructure, req.BasePath, userID, req.OriginType, req.OriginSource, req.OriginRefID); err != nil {
		return nil, nil, fmt.Errorf("创建目录结构失败: %v", err)
	}

	batchID := m.generateBatchID()
	uploadToken := m.generateUploadToken()

	files := make(map[string]*FileUpload)
	var duplicateFiles []DuplicateFileInfo

	for _, item := range req.FileStructure {
		if !item.IsDirectory {
			fileID := m.generateFileID()
			files[fileID] = &FileUpload{
				ID:           fileID,
				RelativePath: item.RelativePath,
				Status:       "queued",
				Progress:     0,
				TotalSize:    item.Size,
				StartTime:    time.Now(),
				UpdateTime:   time.Now(),
				SpeedHistory: make([]int64, 0),
			}

			filePath := dirManager.GetDirectoryPath(req.BasePath, item.RelativePath)
			if shouldAppendMarkdownSuffix() && filepath.Ext(filePath) != ".md" {
				filePath += ".md"
			}
			existingFile, err := model.GetFileByPathAndLibraryNotDeleted(eid, req.LibraryID, filePath)
			if err == nil && existingFile != nil {
				duplicateFiles = append(duplicateFiles, DuplicateFileInfo{
					RelativePath: item.RelativePath,
					ExistingID:   existingFile.ID,
				})
			}
		}
	}

	batch := &BatchUpload{
		ID:            batchID,
		LibraryID:     req.LibraryID,
		UserID:        userID,
		EID:           eid,
		Status:        "init",
		TotalFiles:    req.TotalFiles,
		UploadedFiles: 0,
		FailedFiles:   0,
		Files:         files,
		UploadToken:   uploadToken,
		BasePath:      req.BasePath,
		OriginType:    strings.TrimSpace(req.OriginType),
		OriginSource:  strings.TrimSpace(req.OriginSource),
		OriginRefID:   req.OriginRefID,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}

	m.mu.Lock()
	m.batches[batchID] = batch
	m.mu.Unlock()

	m.progressStorage.SaveBatch(batch)

	return batch, duplicateFiles, nil
}

// GetBatch 获取批量上传会话
func (m *BatchUploadManager) GetBatch(batchID string) (*BatchUpload, error) {
	m.mu.RLock()
	batch, exists := m.batches[batchID]
	m.mu.RUnlock()

	if exists {
		return batch, nil
	}

	// 从Redis加载
	batch, err := m.progressStorage.LoadBatch(batchID)
	if err != nil {
		return nil, fmt.Errorf("批次不存在: %s", batchID)
	}

	m.mu.Lock()
	m.batches[batchID] = batch
	m.mu.Unlock()

	return batch, nil
}

// ValidateUploadToken 验证上传令牌
func (m *BatchUploadManager) ValidateUploadToken(batchID, token string) bool {
	batch, err := m.GetBatch(batchID)
	if err != nil {
		return false
	}
	return batch.UploadToken == token
}

// SubmitUploadTask 提交上传任务
func (m *BatchUploadManager) SubmitUploadTask(task *UploadTask) error {
	// 获取信号量
	select {
	case m.semaphore <- struct{}{}:
		go m.processUploadTask(task)
		return nil
	default:
		return fmt.Errorf("上传队列已满，请稍后重试")
	}
}

// processUploadTask 处理上传任务
func (m *BatchUploadManager) processUploadTask(task *UploadTask) {
	defer func() { <-m.semaphore }()

	batch, err := m.GetBatch(task.BatchID)
	if err != nil {
		return
	}

	// 获取 fileUpload 的安全副本并使用线程安全的更新方法，避免在持有 batch.mu 时重复加锁导致死锁
	fileUploadPtr, exists := batch.GetFileUpload(task.FileID)
	if !exists || fileUploadPtr == nil {
		return
	}
	if m.IsBatchCancelled(task.BatchID) {
		return
	}
	// 使用副本修改并通过 updateFileProgress 持久化，避免在同一 goroutine 中重复持有 mutex 导致死锁
	fileUpload := *fileUploadPtr
	// 更新文件状态为上传中
	fileUpload.Status = "uploading"
	fileUpload.StartTime = time.Now()
	// 生成10-30之间的随机进度值
	if progress, err := rand.Int(rand.Reader, big.NewInt(21)); err == nil {
		fileUpload.Progress = float64(10 + progress.Int64())
	} else {
		fileUpload.Progress = 20 // 出错时使用默认值
	}
	// 使用线程安全的更新接口（内部对 batch.mu 加锁）
	m.updateFileProgress(task.BatchID, task.FileID, &fileUpload)

	// 执行上传
	err = m.executeUpload(task)
	if err != nil {
		if errors.Is(err, errBatchUploadCancelled) {
			return
		}
		fileUpload.Status = "failed"
		fileUpload.Error = err.Error()
		fileUpload.Progress = 0
		batch.FailedFiles++
		m.updateFileProgress(task.BatchID, task.FileID, &fileUpload)
	} else {
		if m.IsBatchCancelled(task.BatchID) {
			return
		}
		// executeUpload已经处理了所有状态更新，这里只需要更新批次计数
		batch.UploadedFiles++
	}

	fileUpload.UpdateTime = time.Now()
	m.updateBatchStatus(batch)
}

// executeUpload 执行文件上传
func (m *BatchUploadManager) executeUpload(task *UploadTask) error {
	if m.uploadExecutor != nil {
		return m.uploadExecutor(task)
	}
	fileProcessor := NewFileProcessor()
	return fileProcessor.ProcessFileUpload(task)
}

/*
updateFileProgressNoLock 在调用方已持有 batch.mu 时调用（或在已知无需加锁的上下文）
该方法不对 batch.mu 加锁，直接修改 batch 的字段并持久化到 storage。
*/
func (m *BatchUploadManager) updateFileProgressNoLock(batch *BatchUpload, fileID string, fileUpload *FileUpload) {
	if batch.Files == nil {
		batch.Files = make(map[string]*FileUpload)
	}
	batch.Files[fileID] = fileUpload
	batch.UpdatedAt = time.Now()

	// 保存到存储（异步/外部持久化）
	m.progressStorage.UpdateFileProgress(batch.ID, fileID, fileUpload)
}

// updateFileProgress 更新文件进度（对外安全接口）
// 如果批次存在，会对 batch.mu 加锁后调用 updateFileProgressNoLock；否则直接持久化到 storage
func (m *BatchUploadManager) updateFileProgress(batchID, fileID string, fileUpload *FileUpload) {
	// 先快速获取 batch 指针（使用读锁），避免长期持有全局锁
	m.mu.RLock()
	batch, exists := m.batches[batchID]
	m.mu.RUnlock()
	if !exists {
		// 保存到存储（尽量保持幂等）
		m.progressStorage.UpdateFileProgress(batchID, fileID, fileUpload)
		return
	}

	// 使用 batch 的 mutex 保护对 batch.Files 的写入
	batch.mu.Lock()
	defer batch.mu.Unlock()
	m.updateFileProgressNoLock(batch, fileID, fileUpload)
}

// updateBatchStatus 更新批次状态
func (m *BatchUploadManager) updateBatchStatus(batch *BatchUpload) {
	if batch == nil {
		return
	}
	m.mu.Lock()
	if batch.Status != "cancelled" {
		if batch.UploadedFiles+batch.FailedFiles >= batch.TotalFiles {
			if batch.FailedFiles == 0 {
				batch.Status = "completed"
			} else {
				batch.Status = "failed"
			}
		} else {
			batch.Status = "uploading"
		}
	}
	batch.UpdatedAt = time.Now()
	m.mu.Unlock()

	m.progressStorage.SaveBatch(batch)
}

// CancelBatch 取消批量上传
func (m *BatchUploadManager) CancelBatch(batchID string) error {
	batch, err := m.GetBatch(batchID)
	if err != nil {
		return err
	}

	m.mu.Lock()
	batch.Status = "cancelled"
	batch.UpdatedAt = time.Now()
	m.mu.Unlock()

	m.progressStorage.SaveBatch(batch)
	return nil
}

// IsBatchCancelled 判断批次是否已取消
func (m *BatchUploadManager) IsBatchCancelled(batchID string) bool {
	if batchID == "" {
		return false
	}

	m.mu.RLock()
	batch, exists := m.batches[batchID]
	if !exists {
		m.mu.RUnlock()
		return false
	}
	cancelled := batch.Status == "cancelled"
	m.mu.RUnlock()
	return cancelled
}

// cleanupExpiredBatches 清理过期的批次
func (m *BatchUploadManager) cleanupExpiredBatches() {
	for range m.cleanupTicker.C {
		timeout := config.GetBatchUploadTimeout()
		if timeout <= 0 {
			timeout = 24 * time.Hour
		}

		cutoff := time.Now().Add(-timeout)

		m.mu.Lock()
		for batchID, batch := range m.batches {
			batch.mu.RLock() // Acquire read lock for this batch
			if batch.UpdatedAt.Before(cutoff) {
				batch.mu.RUnlock() // Release read lock before acquiring write lock on m.batches
				delete(m.batches, batchID)
				m.progressStorage.DeleteBatch(batchID)
			} else {
				batch.mu.RUnlock() // Release read lock if not deleting
			}
		}
		m.mu.Unlock()
	}
}

// generateBatchID 生成批次ID
func (m *BatchUploadManager) generateBatchID() string {
	timestamp := time.Now().Format("20060102_150405")
	randomBytes := make([]byte, 4)
	rand.Read(randomBytes)
	return fmt.Sprintf("batch_%s_%s", timestamp, hex.EncodeToString(randomBytes))
}

// generateUploadToken 生成上传令牌
func (m *BatchUploadManager) generateUploadToken() string {
	tokenBytes := make([]byte, 16)
	rand.Read(tokenBytes)
	return hex.EncodeToString(tokenBytes)
}

// generateFileID 生成文件ID
func (m *BatchUploadManager) generateFileID() string {
	idBytes := make([]byte, 8)
	rand.Read(idBytes)
	return hex.EncodeToString(idBytes)
}

// GetProgressStorage 获取进度存储管理器
func (m *BatchUploadManager) GetProgressStorage() *ProgressStorage {
	return m.progressStorage
}

// GetChunkManager 获取分片管理器
func (m *BatchUploadManager) GetChunkManager() *ChunkUploadManager {
	return m.chunkManager
}

// GetMaxConcurrent 获取最大并发数
func (m *BatchUploadManager) GetMaxConcurrent() int {
	return m.maxConcurrent
}

// GetChunkSize 获取分片大小
func (m *BatchUploadManager) GetChunkSize() int64 {
	return m.chunkSize
}

// CompleteBatch 完成批量上传
func (m *BatchUploadManager) CompleteBatch(batchID string) error {
	batch, err := m.GetBatch(batchID)
	if err != nil {
		return err
	}

	batch.Status = "completed"
	batch.UpdatedAt = time.Now()

	m.progressStorage.SaveBatch(batch)
	return nil
}

// 以下为对 BatchUpload 的并发安全访问器，避免包外直接访问未导出字段 mu

// GetFileUpload 安全地获取单个文件的副本（只读取指针，不深拷贝 FileUpload）
func (b *BatchUpload) GetFileUpload(fileID string) (*FileUpload, bool) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	fu, ok := b.Files[fileID]
	return fu, ok
}

// GetFilesCopy 返回一份 batch.Files 的浅拷贝（map 副本），以便在其它包中安全遍历
func (b *BatchUpload) GetFilesCopy() map[string]*FileUpload {
	b.mu.RLock()
	defer b.mu.RUnlock()
	cpy := make(map[string]*FileUpload, len(b.Files))
	for k, v := range b.Files {
		cpy[k] = v
	}
	return cpy
}

// SetFileUpload 安全地写入或替换某个文件上传信息
func (b *BatchUpload) SetFileUpload(fileID string, fu *FileUpload) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.Files == nil {
		b.Files = make(map[string]*FileUpload)
	}
	b.Files[fileID] = fu
	b.UpdatedAt = time.Now()
}

// GetEID 安全访问 EID
func (b *BatchUpload) GetEID() int64 {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.EID
}

// GetUserID 安全访问 UserID
func (b *BatchUpload) GetUserID() int64 {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.UserID
}

// GetLibraryID 安全访问 LibraryID
func (b *BatchUpload) GetLibraryID() int64 {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.LibraryID
}

// GetBasePath 安全访问 BasePath
func (b *BatchUpload) GetBasePath() string {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.BasePath
}

// 全局批量上传管理器实例
var BatchUploadManagerInstance *BatchUploadManager
var batchUploadManagerOnce sync.Once

// GetBatchUploadManagerInstance 获取批量上传管理器实例（单例模式）
func GetBatchUploadManagerInstance() *BatchUploadManager {
	batchUploadManagerOnce.Do(func() {
		BatchUploadManagerInstance = NewBatchUploadManager()
	})
	return BatchUploadManagerInstance
}
