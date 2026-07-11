package elasticsearch

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/elastic/go-elasticsearch/v7"
)

// ElasticsearchConfig Elasticsearch 配置
type ElasticsearchConfig struct {
	Addresses []string `json:"addresses"`  // Elasticsearch 节点地址
	Username  string   `json:"username"`   // 用户名
	Password  string   `json:"password"`   // 密码
	IndexName string   `json:"index_name"` // 索引名称
	Disabled  bool     `json:"disabled"`   // 是否禁用
	CloudID   string   `json:"cloud_id"`   // Elastic Cloud ID (可选)
	APIKey    string   `json:"api_key"`    // API Key (可选)
}

// DefaultElasticsearchConfig 默认配置
func DefaultElasticsearchConfig() *ElasticsearchConfig {
	return &ElasticsearchConfig{
		Addresses: []string{"http://localhost:9200"},
		Username:  "",
		Password:  "",
		IndexName: "files",
		Disabled:  false,
	}
}

// LoadFromEnv 从环境变量加载配置
func LoadFromEnv() *ElasticsearchConfig {
	config := DefaultElasticsearchConfig()

	// 从环境变量读取地址
	if addresses := os.Getenv("ELASTICSEARCH_ADDRESSES"); addresses != "" {
		config.Addresses = strings.Split(addresses, ",")
	}

	// 从环境变量读取用户名密码
	config.Username = os.Getenv("ELASTICSEARCH_USERNAME")
	config.Password = os.Getenv("ELASTICSEARCH_PASSWORD")

	// 从环境变量读取索引名称
	if indexName := os.Getenv("ELASTICSEARCH_INDEX_NAME"); indexName != "" {
		config.IndexName = indexName
	}

	// 从环境变量读取 Cloud ID
	config.CloudID = os.Getenv("ELASTICSEARCH_CLOUD_ID")

	// 从环境变量读取 API Key
	config.APIKey = os.Getenv("ELASTICSEARCH_API_KEY")

	// 检查是否禁用
	if disabled := os.Getenv("ELASTICSEARCH_DISABLED"); disabled != "" {
		config.Disabled = strings.ToLower(disabled) == "true"
	}

	return config
}

// Client Elasticsearch 客户端
type Client struct {
	*elasticsearch.Client
	config *ElasticsearchConfig
}

// NewClient 创建 Elasticsearch 客户端
func NewClient(config *ElasticsearchConfig) (*Client, error) {
	if config.Disabled {
		logger.SysLogf("Elasticsearch 已禁用")
		return &Client{config: config}, nil
	}

	// 构建 Elasticsearch 配置
	esConfig := elasticsearch.Config{
		Addresses: config.Addresses,
		Username:  config.Username,
		Password:  config.Password,
		CloudID:   config.CloudID,
		APIKey:    config.APIKey,
		// 重试配置
		RetryOnStatus: []int{502, 503, 504, 429},
		RetryBackoff: func(i int) time.Duration {
			return time.Duration(i) * 100 * time.Millisecond
		},
		MaxRetries: 3,
	}

	// 创建客户端
	client, err := elasticsearch.NewClient(esConfig)
	if err != nil {
		return nil, fmt.Errorf("创建 Elasticsearch 客户端失败: %v", err)
	}

	// 测试连接
	res, err := client.Info()
	if err != nil {
		return nil, fmt.Errorf("连接 Elasticsearch 失败: %v", err)
	}
	defer res.Body.Close()

	if res.IsError() {
		return nil, fmt.Errorf("Elasticsearch 返回错误: %s", res.Status())
	}

	logger.SysLogf("成功连接到 Elasticsearch: %v", config.Addresses)

	return &Client{
		Client: client,
		config: config,
	}, nil
}

// IsDisabled 检查是否禁用
func (c *Client) IsDisabled() bool {
	return c.config.Disabled
}

// GetIndexName 获取索引名称
func (c *Client) GetIndexName() string {
	return c.config.IndexName
}

// Ping 测试连接
func (c *Client) Ping() error {
	if c.IsDisabled() {
		return fmt.Errorf("Elasticsearch 已禁用")
	}

	res, err := c.Info()
	if err != nil {
		return err
	}
	defer res.Body.Close()

	if res.IsError() {
		return fmt.Errorf("ping 失败: %s", res.Status())
	}

	return nil
}
