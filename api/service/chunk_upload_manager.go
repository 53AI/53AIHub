package service

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/ioutil"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/53AI/53AIHub/config"
)

// ChunkUploadManager 分片上传管理器
type ChunkUploadManager struct {
	chunks      map[string]map[int]*ChunkInfo // fileID -> chunkIndex -> ChunkInfo
	tempStorage string
	mu          sync.RWMutex
}

// ChunkInfo 分片信息
type ChunkInfo struct {
	Index      int    `json:"index"`
	Size       int64  `json:"size"`
	Hash       string `json:"hash"`
	TempPath   string `json:"temp_path"`
	Uploaded   bool   `json:"uploaded"`
	UploadTime int64  `json:"upload_time"`
}

// NewChunkUploadManager 创建分片上传管理器
func NewChunkUploadManager() *ChunkUploadManager {
	tempStorage := config.ChunkUploadTempDir()
	os.MkdirAll(tempStorage, 0755)

	return &ChunkUploadManager{
		chunks:      make(map[string]map[int]*ChunkInfo),
		tempStorage: tempStorage,
	}
}

// UploadChunk 上传分片
func (m *ChunkUploadManager) UploadChunk(fileID string, chunkIndex int, chunkData []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 计算分片哈希
	hash := sha256.Sum256(chunkData)
	hashStr := hex.EncodeToString(hash[:])

	// 保存分片到临时目录
	tempPath := filepath.Join(m.tempStorage, fileID, fmt.Sprintf("chunk_%d", chunkIndex))
	err := os.MkdirAll(filepath.Dir(tempPath), 0755)
	if err != nil {
		return fmt.Errorf("创建临时目录失败: %v", err)
	}

	err = ioutil.WriteFile(tempPath, chunkData, 0644)
	if err != nil {
		return fmt.Errorf("保存分片失败: %v", err)
	}

	// 更新分片信息
	if m.chunks[fileID] == nil {
		m.chunks[fileID] = make(map[int]*ChunkInfo)
	}

	m.chunks[fileID][chunkIndex] = &ChunkInfo{
		Index:      chunkIndex,
		Size:       int64(len(chunkData)),
		Hash:       hashStr,
		TempPath:   tempPath,
		Uploaded:   true,
		UploadTime: time.Now().UnixMilli(),
	}

	return nil
}

// MergeChunks 合并分片
func (m *ChunkUploadManager) MergeChunks(fileID string, totalChunks int) (string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	chunks := m.chunks[fileID]
	if chunks == nil {
		return "", fmt.Errorf("文件分片不存在: %s", fileID)
	}

	if len(chunks) != totalChunks {
		return "", fmt.Errorf("分片不完整: 期望 %d 个，实际 %d 个", totalChunks, len(chunks))
	}

	// 创建最终文件
	finalPath := filepath.Join(m.tempStorage, fileID, "merged")
	finalFile, err := os.Create(finalPath)
	if err != nil {
		return "", fmt.Errorf("创建合并文件失败: %v", err)
	}
	defer finalFile.Close()

	// 按顺序合并分片 (在读锁保护下进行)
	for i := 0; i < totalChunks; i++ {
		chunk := chunks[i]
		if chunk == nil {
			return "", fmt.Errorf("分片 %d 缺失", i)
		}

		chunkData, err := ioutil.ReadFile(chunk.TempPath)
		if err != nil {
			return "", fmt.Errorf("读取分片 %d 失败: %v", i, err)
		}

		_, err = finalFile.Write(chunkData)
		if err != nil {
			return "", fmt.Errorf("写入分片 %d 失败: %v", i, err)
		}
	}

	return finalPath, nil
}

// GetChunkInfo 获取分片信息
func (m *ChunkUploadManager) GetChunkInfo(fileID string) map[int]*ChunkInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if chunks, ok := m.chunks[fileID]; ok {
		// 返回副本以避免并发问题
		result := make(map[int]*ChunkInfo)
		for k, v := range chunks {
			result[k] = v
		}
		return result
	}

	return nil
}

// IsChunkUploaded 检查分片是否已上传
func (m *ChunkUploadManager) IsChunkUploaded(fileID string, chunkIndex int) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if chunks, ok := m.chunks[fileID]; ok {
		if chunk, ok := chunks[chunkIndex]; ok {
			return chunk.Uploaded
		}
	}

	return false
}

// GetUploadedChunkCount 获取已上传分片数量
func (m *ChunkUploadManager) GetUploadedChunkCount(fileID string) int {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if chunks, ok := m.chunks[fileID]; ok {
		count := 0
		for _, chunk := range chunks {
			if chunk.Uploaded {
				count++
			}
		}
		return count
	}

	return 0
}

// CleanupChunks 清理分片文件
func (m *ChunkUploadManager) CleanupChunks(fileID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 删除临时文件
	chunkDir := filepath.Join(m.tempStorage, fileID)
	if _, err := os.Stat(chunkDir); err == nil {
		os.RemoveAll(chunkDir)
	}

	// 删除内存中的分片信息
	delete(m.chunks, fileID)

	return nil
}

// ValidateChunk 验证分片完整性
func (m *ChunkUploadManager) ValidateChunk(fileID string, chunkIndex int, expectedHash string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if chunks, ok := m.chunks[fileID]; ok {
		if chunk, ok := chunks[chunkIndex]; ok {
			return chunk.Hash == expectedHash
		}
	}

	return false
}

// GetChunkProgress 获取文件分片进度
func (m *ChunkUploadManager) GetChunkProgress(fileID string, totalChunks int) float64 {
	uploadedCount := m.GetUploadedChunkCount(fileID)
	if totalChunks == 0 {
		return 0
	}
	return float64(uploadedCount) / float64(totalChunks) * 100
}