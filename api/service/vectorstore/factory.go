package vectorstore

import (
	"context"
	"fmt"
	"time"
)

// NewVectorStore 创建向量存储实例
func NewVectorStore(config *VectorDBConfig) (VectorStore, error) {
	if err := config.Validate(); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}

	switch config.Type {
	case "qdrant":
		return NewQdrantStore(config), nil
	case "milvus":
		// TODO: 实现Milvus适配器
		return nil, fmt.Errorf("milvus adapter not implemented yet")
	case "pgvector":
		// TODO: 实现PGVector适配器
		return nil, fmt.Errorf("pgvector adapter not implemented yet")
	case "weaviate":
		// TODO: 实现Weaviate适配器
		return nil, fmt.Errorf("weaviate adapter not implemented yet")
	case "pinecone":
		// TODO: 实现Pinecone适配器
		return nil, fmt.Errorf("pinecone adapter not implemented yet")
	default:
		return nil, fmt.Errorf("unsupported vector store type: %s", config.Type)
	}
}

// GetSupportedTypes 获取支持的向量存储类型
func GetSupportedTypes() []string {
	return []string{
		"qdrant",
		"milvus",
		"pgvector",
		"weaviate",
		"pinecone",
	}
}

// IsTypeSupported 检查是否支持指定类型
func IsTypeSupported(storeType string) bool {
	supportedTypes := GetSupportedTypes()
	for _, t := range supportedTypes {
		if t == storeType {
			return true
		}
	}
	return false
}

// GetDefaultConfigForType 获取指定类型的默认配置
func GetDefaultConfigForType(storeType string) *VectorDBConfig {
	config := DefaultVectorDBConfig()
	config.Type = storeType

	switch storeType {
	case "qdrant":
		config.Endpoint = "http://localhost:6333"
		config.IndexType = "HNSW"
		config.DistanceMetric = "cosine"
		config.IndexParameters = map[string]interface{}{
			"m":               16,
			"ef_construct":    200,
			"ef":              64,
			"max_connections": 0,
		}
	case "milvus":
		config.Endpoint = "localhost:19530"
		config.IndexType = "HNSW"
		config.DistanceMetric = "cosine"
		config.IndexParameters = map[string]interface{}{
			"M":              16,
			"efConstruction": 200,
		}
	case "pgvector":
		config.Endpoint = "localhost:5432"
		config.Database = "vectordb"
		config.Username = "postgres"
		config.IndexType = "HNSW"
		config.DistanceMetric = "cosine"
		config.IndexParameters = map[string]interface{}{
			"m":               16,
			"ef_construction": 200,
		}
	case "weaviate":
		config.Endpoint = "http://localhost:8080"
		config.IndexType = "HNSW"
		config.DistanceMetric = "cosine"
		config.IndexParameters = map[string]interface{}{
			"maxConnections":        64,
			"efConstruction":        128,
			"ef":                    -1,
			"dynamicEfMin":          100,
			"dynamicEfMax":          500,
			"dynamicEfFactor":       8,
			"vectorCacheMaxObjects": 1000000000000,
			"flatSearchCutoff":      40000,
			"skip":                  false,
		}
	case "pinecone":
		config.Endpoint = "https://your-index.svc.your-env.pinecone.io"
		config.IndexType = "approximated"
		config.DistanceMetric = "cosine"
		config.IndexParameters = map[string]interface{}{
			"replicas": 1,
			"shards":   1,
		}
	}

	return config
}

// ValidateConnection 验证向量存储连接
func ValidateConnection(config *VectorDBConfig) error {
	store, err := NewVectorStore(config)
	if err != nil {
		return fmt.Errorf("failed to create vector store: %w", err)
	}

	ctx := context.Background()
	if err := store.Connect(ctx); err != nil {
		return fmt.Errorf("failed to connect to vector store: %w", err)
	}

	if err := store.HealthCheck(ctx); err != nil {
		return fmt.Errorf("health check failed: %w", err)
	}

	if err := store.Disconnect(ctx); err != nil {
		return fmt.Errorf("failed to disconnect: %w", err)
	}

	return nil
}

// MigrateData 在不同向量存储之间迁移数据
func MigrateData(sourceConfig, targetConfig *VectorDBConfig, collections []string) error {
	source, err := NewVectorStore(sourceConfig)
	if err != nil {
		return fmt.Errorf("failed to create source store: %w", err)
	}

	target, err := NewVectorStore(targetConfig)
	if err != nil {
		return fmt.Errorf("failed to create target store: %w", err)
	}

	ctx := context.Background()

	// 连接到源和目标存储
	if err := source.Connect(ctx); err != nil {
		return fmt.Errorf("failed to connect to source: %w", err)
	}
	defer source.Disconnect(ctx)

	if err := target.Connect(ctx); err != nil {
		return fmt.Errorf("failed to connect to target: %w", err)
	}
	defer target.Disconnect(ctx)

	// 迁移每个集合
	for _, collection := range collections {
		if err := migrateCollection(ctx, source, target, collection); err != nil {
			return fmt.Errorf("failed to migrate collection %s: %w", collection, err)
		}
	}

	return nil
}

// migrateCollection 迁移单个集合
func migrateCollection(ctx context.Context, source, target VectorStore, collection string) error {
	// 获取源集合信息
	info, err := source.GetCollectionInfo(ctx, collection)
	if err != nil {
		return fmt.Errorf("failed to get collection info: %w", err)
	}

	// 在目标存储中创建集合
	config := CollectionConfig{
		Name:      collection,
		Dimension: info.Dimension,
		Metric:    info.Metric,
	}

	if err := target.CreateCollection(ctx, config); err != nil {
		if !IsExistsError(err) {
			return fmt.Errorf("failed to create target collection: %w", err)
		}
	}

	// TODO: 实现数据迁移逻辑
	// 这里需要实现分批获取源数据并插入到目标存储的逻辑
	// 由于没有统一的分页接口，这部分需要根据具体需求实现

	return nil
}

// CompareStores 比较两个向量存储的性能
func CompareStores(configs []*VectorDBConfig, testVectors []VectorRecord) (*PerformanceReport, error) {
	// TODO: 实现性能比较逻辑
	return nil, fmt.Errorf("performance comparison not implemented yet")
}

// PerformanceReport 性能报告
type PerformanceReport struct {
	Stores []StorePerformance `json:"stores"`
}

// StorePerformance 存储性能
type StorePerformance struct {
	Type             string        `json:"type"`
	InsertLatency    time.Duration `json:"insert_latency"`
	SearchLatency    time.Duration `json:"search_latency"`
	InsertThroughput float64       `json:"insert_throughput"`
	SearchThroughput float64       `json:"search_throughput"`
	MemoryUsage      int64         `json:"memory_usage"`
	DiskUsage        int64         `json:"disk_usage"`
}
