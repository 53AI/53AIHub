package elasticsearch

import (
	"sync"

	"github.com/53AI/53AIHub/common/logger"
)

var (
	globalClient *Client
	once         sync.Once
)

// InitGlobalClient 初始化全局 Elasticsearch 客户端
func InitGlobalClient() error {
	var err error
	once.Do(func() {
		config := LoadFromEnv()
		globalClient, err = NewClient(config)
		if err != nil {
			logger.SysLogf("初始化 Elasticsearch 客户端失败: %v", err)
			return
		}

		// 如果未禁用，创建索引
		if !config.Disabled {
			indexManager := NewIndexManager(globalClient)
			if err := indexManager.CreateFilesIndex(); err != nil {
				logger.SysLogf("创建 Elasticsearch 索引失败: %v", err)
			}
		}
	})
	return err
}

// GetGlobalClient 获取全局 Elasticsearch 客户端
func GetGlobalClient() *Client {
	if globalClient == nil {
		logger.SysLogf("Elasticsearch 客户端未初始化，尝试初始化")
		if err := InitGlobalClient(); err != nil {
			logger.SysLogf("初始化 Elasticsearch 客户端失败: %v", err)
			// 返回一个禁用的客户端
			config := &ElasticsearchConfig{Disabled: true}
			globalClient, _ = NewClient(config)
		}
	}
	return globalClient
}

// GetAddresses 获取客户端地址列表
func (c *Client) GetAddresses() []string {
	if c.config == nil {
		return []string{}
	}
	return c.config.Addresses
}

// IsEnabled 检查 Elasticsearch 是否启用
func IsEnabled() bool {
	client := GetGlobalClient()
	return client != nil && !client.IsDisabled()
}

// ResetGlobalClientForTest 重置全局客户端，避免测试间串扰。
func ResetGlobalClientForTest() {
	globalClient = nil
	once = sync.Once{}
}
