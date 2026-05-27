package vectorstore

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"

	"github.com/53AI/53AIHub/common/logger"
)

// 全局 VectorStore 管理器（单例模式）
var (
	globalStore          atomic.Pointer[VectorStore]
	globalStoreInitOnce  sync.Once
	globalStoreInitErr   error
	globalStoreCloseOnce sync.Once
	globalStoreClosed    atomic.Bool // 标记是否已关闭
)

// InitGlobalVectorStore 初始化全局向量存储实例
// 应该在应用启动时调用一次
func InitGlobalVectorStore() error {
	globalStoreInitOnce.Do(func() {
		config := LoadFromEnv()
		store, err := NewVectorStore(config)
		if err != nil {
			globalStoreInitErr = fmt.Errorf("创建向量存储实例失败: %v", err)
			return
		}

		ctx := context.Background()
		if err := store.Connect(ctx); err != nil {
			globalStoreInitErr = fmt.Errorf("连接向量存储失败: %v", err)
			return
		}

		globalStore.Store(&store)
		logger.SysLogf("✅ 全局向量存储实例初始化成功")
	})
	return globalStoreInitErr
}

// GetGlobalVectorStore 获取全局向量存储实例
// 如果未初始化，会自动初始化
func GetGlobalVectorStore() (VectorStore, error) {
	// 检查是否已关闭
	if globalStoreClosed.Load() {
		return nil, fmt.Errorf("向量存储已关闭")
	}

	// 先尝试获取已存在的实例
	if ptr := globalStore.Load(); ptr != nil {
		return *ptr, nil
	}

	// 使用 sync.Once 统一初始化，避免竞态
	globalStoreInitOnce.Do(func() {
		// 双重检查：可能已被 InitGlobalVectorStore 初始化
		if globalStore.Load() != nil {
			return
		}

		config := LoadFromEnv()
		store, err := NewVectorStore(config)
		if err != nil {
			globalStoreInitErr = fmt.Errorf("创建向量存储实例失败: %v", err)
			return
		}

		ctx := context.Background()
		if err := store.Connect(ctx); err != nil {
			globalStoreInitErr = fmt.Errorf("连接向量存储失败: %v", err)
			return
		}

		globalStore.Store(&store)
		logger.SysLogf("✅ 全局向量存储实例自动初始化成功")
	})

	// 检查初始化错误
	if globalStoreInitErr != nil {
		return nil, globalStoreInitErr
	}

	// 再次检查是否已关闭（初始化期间可能被关闭）
	if globalStoreClosed.Load() {
		return nil, fmt.Errorf("向量存储已关闭")
	}

	ptr := globalStore.Load()
	if ptr == nil {
		return nil, fmt.Errorf("向量存储初始化失败")
	}
	return *ptr, nil
}

// CloseGlobalVectorStore 关闭全局向量存储实例
// 应该在应用关闭时调用
// 使用 sync.Once 保证只关闭一次
func CloseGlobalVectorStore() error {
	// 先设置关闭标志，拒绝新请求
	globalStoreClosed.Store(true)

	var closeErr error
	globalStoreCloseOnce.Do(func() {
		ptr := globalStore.Load()
		if ptr == nil {
			return
		}

		store := *ptr
		ctx := context.Background()
		if err := store.Disconnect(ctx); err != nil {
			logger.SysErrorf("关闭全局向量存储失败: %v", err)
			closeErr = err
			return
		}

		globalStore.Store(nil)
		logger.SysLogf("🛑 全局向量存储实例已关闭")
	})
	return closeErr
}

// IsGlobalVectorStoreReady 检查全局向量存储是否已初始化且未关闭
func IsGlobalVectorStoreReady() bool {
	return !globalStoreClosed.Load() && globalStore.Load() != nil
}
