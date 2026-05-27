package vectorstore

import (
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/53AI/53AIHub/common/logger"
)

// VectorDBConfig 向量数据库配置
type VectorDBConfig struct {
	// 基础配置
	Type     string `json:"type"`     // qdrant, milvus, pgvector, weaviate, pinecone
	Endpoint string `json:"endpoint"` // 数据库端点
	APIKey   string `json:"api_key"`  // API密钥
	Database string `json:"database"` // 数据库名称
	Username string `json:"username"` // 用户名
	Password string `json:"password"` // 密码

	// 连接池配置
	MaxConnections    int           `json:"max_connections"`
	MinConnections    int           `json:"min_connections"`
	ConnectionTimeout time.Duration `json:"connection_timeout"`
	IdleTimeout       time.Duration `json:"idle_timeout"`
	MaxLifetime       time.Duration `json:"max_lifetime"`

	// 性能配置
	BatchSize      int           `json:"batch_size"`
	IndexType      string        `json:"index_type"`      // HNSW, IVF, etc.
	DistanceMetric string        `json:"distance_metric"` // cosine, euclidean, dot
	EnableCache    bool          `json:"enable_cache"`
	CacheSize      int           `json:"cache_size"`
	CacheTTL       time.Duration `json:"cache_ttl"`

	// 索引参数
	IndexParameters map[string]interface{} `json:"index_parameters"`

	// 重试配置
	MaxRetries    int           `json:"max_retries"`
	RetryInterval time.Duration `json:"retry_interval"`

	// 其他配置选项
	Options map[string]interface{} `json:"options"`

	// 集合前缀
	CollectionPrefix string `json:"collection_prefix"`

	// 启用压缩
	EnableCompression bool `json:"enable_compression"`

	// TLS配置
	EnableTLS  bool   `json:"enable_tls"`
	TLSCert    string `json:"tls_cert"`
	TLSKey     string `json:"tls_key"`
	TLSCACert  string `json:"tls_ca_cert"`
	SkipVerify bool   `json:"skip_verify"`

	// 日志配置
	VerboseLogging bool `json:"verbose_logging"`

	// 缓冲配置
	EnableBuffer   bool          `json:"enable_buffer"`   // 是否启用向量插入缓冲
	FlushWindow   time.Duration `json:"flush_window"`   // 缓冲刷新时间窗口
	MaxBufferSize int           `json:"max_buffer_size"` // 单 Collection 最大缓冲数
}

// DefaultVectorDBConfig 默认配置
func DefaultVectorDBConfig() *VectorDBConfig {
	return &VectorDBConfig{
		Type:              "qdrant",
		Endpoint:          "http://localhost:6333",
		MaxConnections:    10,
		MinConnections:    1,
		ConnectionTimeout: 30 * time.Second,
		IdleTimeout:       5 * time.Minute,
		MaxLifetime:       1 * time.Hour,
		BatchSize:         100,
		IndexType:         "HNSW",
		DistanceMetric:    "cosine",
		EnableCache:       true,
		CacheSize:         1000,
		CacheTTL:          10 * time.Minute,
		MaxRetries:        3,
		RetryInterval:     1 * time.Second,
		CollectionPrefix:  "53ai_", // TODO::数据集前缀，正式的记得修改为53KM_，在配置文件里设置VECTOR_DB_COLLECTION_PREFIX
		EnableCompression: false,
		EnableTLS:         false,
		SkipVerify:        false,
		VerboseLogging:    false, // 默认关闭详细日志
		EnableBuffer:      true,
		FlushWindow:       3 * time.Second,
		MaxBufferSize:     5000,
		IndexParameters: map[string]interface{}{
			"m":               16,
			"ef_construct":    200,
			"ef":              64,
			"max_connections": 0,
		},
		Options: make(map[string]interface{}),
	}
}

// LoadFromEnv 从环境变量加载配置
func LoadFromEnv() *VectorDBConfig {
	config := DefaultVectorDBConfig()

	// 基础配置
	if dbType := os.Getenv("VECTOR_DB_TYPE"); dbType != "" {
		config.Type = dbType
	}
	if endpoint := os.Getenv("VECTOR_DB_URL"); endpoint != "" {
		config.Endpoint = endpoint
	}
	if apiKey := os.Getenv("VECTOR_DB_API_KEY"); apiKey != "" {
		config.APIKey = apiKey
	}
	if database := os.Getenv("VECTOR_DB_DATABASE"); database != "" {
		config.Database = database
	}
	if username := os.Getenv("VECTOR_DB_USERNAME"); username != "" {
		config.Username = username
	}
	if password := os.Getenv("VECTOR_DB_PASSWORD"); password != "" {
		config.Password = password
	}

	// 连接池配置
	if maxConn := os.Getenv("VECTOR_DB_MAX_CONNECTIONS"); maxConn != "" {
		if val, err := strconv.Atoi(maxConn); err == nil {
			config.MaxConnections = val
		}
	}
	if minConn := os.Getenv("VECTOR_DB_MIN_CONNECTIONS"); minConn != "" {
		if val, err := strconv.Atoi(minConn); err == nil {
			config.MinConnections = val
		}
	}
	if timeout := os.Getenv("VECTOR_DB_CONNECTION_TIMEOUT"); timeout != "" {
		if val, err := time.ParseDuration(timeout); err == nil {
			config.ConnectionTimeout = val
		}
	}

	// 性能配置
	if batchSize := os.Getenv("VECTOR_DB_BATCH_SIZE"); batchSize != "" {
		if val, err := strconv.Atoi(batchSize); err == nil {
			config.BatchSize = val
		}
	}
	if indexType := os.Getenv("VECTOR_DB_INDEX_TYPE"); indexType != "" {
		config.IndexType = indexType
	}
	if metric := os.Getenv("VECTOR_DB_DISTANCE_METRIC"); metric != "" {
		config.DistanceMetric = metric
	}

	// 集合前缀
	if prefix := os.Getenv("VECTOR_DB_COLLECTION_PREFIX"); prefix != "" {
		config.CollectionPrefix = prefix
	}

	// TLS配置
	if enableTLS := os.Getenv("VECTOR_DB_ENABLE_TLS"); enableTLS == "true" {
		config.EnableTLS = true
	}
	if tlsCert := os.Getenv("VECTOR_DB_TLS_CERT"); tlsCert != "" {
		config.TLSCert = tlsCert
	}
	if tlsKey := os.Getenv("VECTOR_DB_TLS_KEY"); tlsKey != "" {
		config.TLSKey = tlsKey
	}
	if tlsCACert := os.Getenv("VECTOR_DB_TLS_CA_CERT"); tlsCACert != "" {
		config.TLSCACert = tlsCACert
	}
	if skipVerify := os.Getenv("VECTOR_DB_SKIP_VERIFY"); skipVerify == "true" {
		config.SkipVerify = true
	}

	// 日志配置
	if verboseLogging := os.Getenv("VECTOR_DB_VERBOSE_LOGGING"); verboseLogging == "true" {
		config.VerboseLogging = true
	}

	// 缓冲配置
	if enableBuffer := os.Getenv("VECTOR_DB_ENABLE_BUFFER"); enableBuffer == "true" {
		config.EnableBuffer = true
	} else if enableBuffer == "false" {
		config.EnableBuffer = false
	}
	if flushWindow := os.Getenv("VECTOR_DB_FLUSH_WINDOW"); flushWindow != "" {
		if val, err := time.ParseDuration(flushWindow); err == nil {
			config.FlushWindow = val
		}
	}
	if maxBufSize := os.Getenv("VECTOR_DB_MAX_BUFFER_SIZE"); maxBufSize != "" {
		if val, err := strconv.Atoi(maxBufSize); err == nil {
			config.MaxBufferSize = val
		}
	}

	return config
}

// Validate 验证配置
func (c *VectorDBConfig) Validate() error {
	if c.Type == "" {
		return fmt.Errorf("vector database type is required")
	}

	if c.Endpoint == "" {
		return fmt.Errorf("vector database endpoint is required")
	}

	if c.MaxConnections <= 0 {
		return fmt.Errorf("max connections must be greater than 0")
	}

	if c.MinConnections < 0 {
		return fmt.Errorf("min connections must be greater than or equal to 0")
	}

	if c.MinConnections > c.MaxConnections {
		return fmt.Errorf("min connections cannot be greater than max connections")
	}

	if c.ConnectionTimeout <= 0 {
		return fmt.Errorf("connection timeout must be greater than 0")
	}

	if c.BatchSize <= 0 {
		return fmt.Errorf("batch size must be greater than 0")
	}

	if c.DistanceMetric == "" {
		return fmt.Errorf("distance metric is required")
	}

	// 验证距离度量
	validMetrics := []string{"cosine", "euclidean", "dot", "manhattan", "hamming"}
	validMetric := false
	for _, metric := range validMetrics {
		if c.DistanceMetric == metric {
			validMetric = true
			break
		}
	}
	if !validMetric {
		return fmt.Errorf("invalid distance metric: %s", c.DistanceMetric)
	}

	// 验证索引类型
	if c.IndexType != "" {
		validIndexTypes := []string{"HNSW", "IVF", "FLAT", "LSH", "ANNOY"}
		validIndexType := false
		for _, indexType := range validIndexTypes {
			if c.IndexType == indexType {
				validIndexType = true
				break
			}
		}
		if !validIndexType {
			return fmt.Errorf("invalid index type: %s", c.IndexType)
		}
	}

	return nil
}

// GetConnectionString 获取连接字符串
func (c *VectorDBConfig) GetConnectionString() string {
	switch c.Type {
	case "qdrant":
		return c.Endpoint
	case "milvus":
		return c.Endpoint
	case "pgvector":
		if c.Username != "" && c.Password != "" {
			return fmt.Sprintf("postgres://%s:%s@%s/%s", c.Username, c.Password, c.Endpoint, c.Database)
		}
		return fmt.Sprintf("postgres://%s/%s", c.Endpoint, c.Database)
	case "weaviate":
		return c.Endpoint
	case "pinecone":
		return c.Endpoint
	default:
		return c.Endpoint
	}
}

// Clone 克隆配置
func (c *VectorDBConfig) Clone() *VectorDBConfig {
	clone := *c

	// 深拷贝map
	if c.IndexParameters != nil {
		clone.IndexParameters = make(map[string]interface{})
		for k, v := range c.IndexParameters {
			clone.IndexParameters[k] = v
		}
	}

	if c.Options != nil {
		clone.Options = make(map[string]interface{})
		for k, v := range c.Options {
			clone.Options[k] = v
		}
	}

	return &clone
}

// String 返回配置的字符串表示
func (c *VectorDBConfig) String() string {
	return fmt.Sprintf("VectorDBConfig{Type: %s, Endpoint: %s, Database: %s}",
		c.Type, c.Endpoint, c.Database)
}

// GetCollectionName 获取完整的集合名称（带前缀）
func (c *VectorDBConfig) GetCollectionName(name string) string {
	var returnName string
	if c.CollectionPrefix == "" {
		returnName = name
	} else {
		returnName = c.CollectionPrefix + name
	}
	logger.SysLogf("collection name: %s", returnName)
	return returnName
}

// StripCollectionPrefix 去除集合名称前缀
func (c *VectorDBConfig) StripCollectionPrefix(name string) string {
	if c.CollectionPrefix == "" {
		return name
	}
	if len(name) > len(c.CollectionPrefix) && name[:len(c.CollectionPrefix)] == c.CollectionPrefix {
		return name[len(c.CollectionPrefix):]
	}
	return name
}
