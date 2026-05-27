package config

import (
	"github.com/53AI/53AIHub/common/utils/env"
)

// 分块保存优化配置
var (
	// 分块保存策略阈值
	CHUNK_SAVE_SMALL_THRESHOLD  = env.Int("CHUNK_SAVE_SMALL_THRESHOLD", 5)   // 小量分块阈值
	CHUNK_SAVE_MEDIUM_THRESHOLD = env.Int("CHUNK_SAVE_MEDIUM_THRESHOLD", 20)  // 中量分块阈值
	
	// 批次大小配置
	CHUNK_SAVE_SMALL_BATCH_SIZE  = env.Int("CHUNK_SAVE_SMALL_BATCH_SIZE", 20)   // 小批次大小
	CHUNK_SAVE_MEDIUM_BATCH_SIZE = env.Int("CHUNK_SAVE_MEDIUM_BATCH_SIZE", 50) // 中批次大小
	CHUNK_SAVE_LARGE_BATCH_SIZE  = env.Int("CHUNK_SAVE_LARGE_BATCH_SIZE", 100)  // 大批次大小
	
	// 异步处理配置
	CHUNK_SAVE_ASYNC_ENABLED     = env.Bool("CHUNK_SAVE_ASYNC_ENABLED", true)     // 是否启用异步处理
	CHUNK_SAVE_ASYNC_WORKERS     = env.Int("CHUNK_SAVE_ASYNC_WORKERS", 3)         // 异步工作协程数
	CHUNK_SAVE_ASYNC_BUFFER_SIZE = env.Int("CHUNK_SAVE_ASYNC_BUFFER_SIZE", 1000)  // 异步队列缓冲区大小
	
	// 重试配置
	CHUNK_SAVE_MAX_RETRIES = env.Int("CHUNK_SAVE_MAX_RETRIES", 3)        // 最大重试次数
	CHUNK_SAVE_RETRY_DELAY = env.Int("CHUNK_SAVE_RETRY_DELAY", 1000)     // 重试延迟(毫秒)
	
	// 性能监控配置
	CHUNK_SAVE_MONITOR_ENABLED = env.Bool("CHUNK_SAVE_MONITOR_ENABLED", true) // 是否启用性能监控
)

// ChunkSaveStrategy 分块保存策略
type ChunkSaveStrategy int

const (
	StrategyDirect ChunkSaveStrategy = iota // 直接保存
	StrategyBatch                           // 分批保存
	StrategyAsync                           // 异步保存
)

// GetChunkSaveStrategy 根据分块数量获取保存策略
func GetChunkSaveStrategy(chunkCount int) ChunkSaveStrategy {
	if chunkCount <= CHUNK_SAVE_SMALL_THRESHOLD {
		return StrategyDirect
	} else if chunkCount <= CHUNK_SAVE_MEDIUM_THRESHOLD {
		return StrategyBatch
	} else {
		if CHUNK_SAVE_ASYNC_ENABLED {
			return StrategyAsync
		}
		return StrategyBatch
	}
}

// GetBatchSize 根据策略获取批次大小
func GetBatchSize(strategy ChunkSaveStrategy) int {
	switch strategy {
	case StrategyDirect:
		return CHUNK_SAVE_SMALL_BATCH_SIZE
	case StrategyBatch:
		return CHUNK_SAVE_MEDIUM_BATCH_SIZE
	case StrategyAsync:
		return CHUNK_SAVE_LARGE_BATCH_SIZE
	default:
		return CHUNK_SAVE_MEDIUM_BATCH_SIZE
	}
}