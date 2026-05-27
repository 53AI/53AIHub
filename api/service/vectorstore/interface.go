package vectorstore

import (
	"context"
	"time"
)

// VectorStore 向量数据库统一接口
type VectorStore interface {
	// 集合管理
	CreateCollection(ctx context.Context, config CollectionConfig) error
	DeleteCollection(ctx context.Context, name string) error
	GetCollectionInfo(ctx context.Context, name string) (*CollectionInfo, error)
	ListCollections(ctx context.Context) ([]string, error)

	// 向量操作
	Insert(ctx context.Context, collection string, vectors []VectorRecord) error
	BatchInsert(ctx context.Context, collection string, vectors []VectorRecord) error
	Update(ctx context.Context, collection string, vectors []VectorRecord) error
	Delete(ctx context.Context, collection string, ids []interface{}) error
	Get(ctx context.Context, collection string, ids []interface{}) ([]VectorRecord, error)

	// 搜索功能
	Search(ctx context.Context, req SearchRequest) (*SearchResponse, error)
	HybridSearch(ctx context.Context, req HybridSearchRequest) (*SearchResponse, error)
	FilterSearch(ctx context.Context, req FilterSearchRequest) (*SearchResponse, error)

	// 索引管理
	CreateIndex(ctx context.Context, collection string, config IndexConfig) error
	DropIndex(ctx context.Context, collection string, indexName string) error
	GetIndexInfo(ctx context.Context, collection string) (*IndexInfo, error)

	// 健康检查和统计
	HealthCheck(ctx context.Context) error
	GetStats(ctx context.Context) (*DBStats, error)

	// 连接管理
	Connect(ctx context.Context) error
	Disconnect(ctx context.Context) error
	IsConnected() bool

	// 获取存储类型
	Type() string
}

// CollectionConfig 集合配置
type CollectionConfig struct {
	Name        string                 `json:"name"`
	Dimension   int                    `json:"dimension"`
	Metric      string                 `json:"metric"`     // cosine, euclidean, dot
	IndexType   string                 `json:"index_type"` // HNSW, IVF, etc.
	Description string                 `json:"description"`
	Metadata    map[string]interface{} `json:"metadata"`

	// 索引参数
	IndexParams map[string]interface{} `json:"index_params"`

	// 分片配置
	ShardNum   int `json:"shard_num"`
	ReplicaNum int `json:"replica_num"`
}

// CollectionInfo 集合信息
type CollectionInfo struct {
	Name        string                 `json:"name"`
	Dimension   int                    `json:"dimension"`
	Metric      string                 `json:"metric"`
	IndexType   string                 `json:"index_type"`
	VectorCount int64                  `json:"vector_count"`
	IndexSize   int64                  `json:"index_size"`
	Status      string                 `json:"status"`
	CreatedAt   time.Time              `json:"created_at"`
	UpdatedAt   time.Time              `json:"updated_at"`
	Metadata    map[string]interface{} `json:"metadata"`
}

// VectorRecord 向量记录
type VectorRecord struct {
	ID       interface{}            `json:"id"`
	Vector   []float32              `json:"vector"`
	Metadata map[string]interface{} `json:"metadata"`
}

// SearchRequest 搜索请求
type SearchRequest struct {
	Collection     string                 `json:"collection"`
	Query          string                 `json:"query,omitempty"`
	Vector         []float32              `json:"vector"`
	TopK           int                    `json:"top_k"`
	ScoreThreshold float32                `json:"score_threshold"`
	Filters        map[string]interface{} `json:"filters"`
	OutputFields   []string               `json:"output_fields"`
	SearchParams   map[string]interface{} `json:"search_params"`
}

type BatchSearchRequest struct {
	Collection string          `json:"collection"`
	Searches   []SearchRequest `json:"searches"`
}

// HybridSearchRequest 混合搜索请求
type HybridSearchRequest struct {
	Collection     string                 `json:"collection"`
	VectorQuery    *VectorQuery           `json:"vector_query"`
	TextQuery      *TextQuery             `json:"text_query"`
	TopK           int                    `json:"top_k"`
	ScoreThreshold float32                `json:"score_threshold"`
	Filters        map[string]interface{} `json:"filters"`
	OutputFields   []string               `json:"output_fields"`
	RerankConfig   *RerankConfig          `json:"rerank_config"`
}

// FilterSearchRequest 过滤搜索请求
type FilterSearchRequest struct {
	Collection   string                 `json:"collection"`
	Filters      map[string]interface{} `json:"filters"`
	TopK         int                    `json:"top_k"`
	OutputFields []string               `json:"output_fields"`
}

// VectorQuery 向量查询
type VectorQuery struct {
	Vector []float32              `json:"vector"`
	Weight float32                `json:"weight"`
	Params map[string]interface{} `json:"params"`
}

// TextQuery 文本查询
type TextQuery struct {
	Text   string                 `json:"text"`
	Weight float32                `json:"weight"`
	Params map[string]interface{} `json:"params"`
}

// RerankConfig 重排序配置
type RerankConfig struct {
	Strategy string                 `json:"strategy"` // rrf, weighted, etc.
	Params   map[string]interface{} `json:"params"`
}

// SearchResponse 搜索响应
type SearchResponse struct {
	Results   []SearchResult `json:"results"`
	Total     int            `json:"total"`
	Latency   time.Duration  `json:"latency"`
	RequestID string         `json:"request_id"`
}

// SearchResult 搜索结果
type SearchResult struct {
	ID       interface{}            `json:"id"`
	Score    float32                `json:"score"`
	Vector   []float32              `json:"vector,omitempty"`
	Metadata map[string]interface{} `json:"metadata"`
}

// IndexConfig 索引配置
type IndexConfig struct {
	Name        string                 `json:"name"`
	Type        string                 `json:"type"`   // HNSW, IVF, FLAT, etc.
	Metric      string                 `json:"metric"` // cosine, euclidean, dot
	Parameters  map[string]interface{} `json:"parameters"`
	Description string                 `json:"description"`
}

// IndexInfo 索引信息
type IndexInfo struct {
	Name       string                 `json:"name"`
	Type       string                 `json:"type"`
	Metric     string                 `json:"metric"`
	Parameters map[string]interface{} `json:"parameters"`
	Status     string                 `json:"status"`
	Progress   float32                `json:"progress"`
	CreatedAt  time.Time              `json:"created_at"`
	UpdatedAt  time.Time              `json:"updated_at"`
}

// DBStats 数据库统计信息
type DBStats struct {
	Collections  int                    `json:"collections"`
	TotalVectors int64                  `json:"total_vectors"`
	TotalSize    int64                  `json:"total_size"`   // bytes
	MemoryUsage  int64                  `json:"memory_usage"` // bytes
	DiskUsage    int64                  `json:"disk_usage"`   // bytes
	QPS          float64                `json:"qps"`
	AvgLatency   time.Duration          `json:"avg_latency"`
	Status       string                 `json:"status"`
	Version      string                 `json:"version"`
	Uptime       time.Duration          `json:"uptime"`
	Metadata     map[string]interface{} `json:"metadata"`
}

// VectorStoreError 向量存储错误
type VectorStoreError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details string `json:"details"`
}

func (e *VectorStoreError) Error() string {
	return e.Message
}

// 错误代码常量
const (
	ErrCodeConnectionFailed   = "CONNECTION_FAILED"
	ErrCodeCollectionNotFound = "COLLECTION_NOT_FOUND"
	ErrCodeCollectionExists   = "COLLECTION_EXISTS"
	ErrCodeInvalidDimension   = "INVALID_DIMENSION"
	ErrCodeInvalidVector      = "INVALID_VECTOR"
	ErrCodeIndexNotFound      = "INDEX_NOT_FOUND"
	ErrCodeIndexExists        = "INDEX_EXISTS"
	ErrCodeSearchFailed       = "SEARCH_FAILED"
	ErrCodeInsertFailed       = "INSERT_FAILED"
	ErrCodeUpdateFailed       = "UPDATE_FAILED"
	ErrCodeDeleteFailed       = "DELETE_FAILED"
	ErrCodeInvalidConfig      = "INVALID_CONFIG"
	ErrCodeTimeout            = "TIMEOUT"
	ErrCodeUnknown            = "UNKNOWN"
)

// NewVectorStoreError 创建向量存储错误
func NewVectorStoreError(code, message, details string) *VectorStoreError {
	return &VectorStoreError{
		Code:    code,
		Message: message,
		Details: details,
	}
}

// IsConnectionError 判断是否为连接错误
func IsConnectionError(err error) bool {
	if vsErr, ok := err.(*VectorStoreError); ok {
		return vsErr.Code == ErrCodeConnectionFailed
	}
	return false
}

// IsNotFoundError 判断是否为未找到错误
func IsNotFoundError(err error) bool {
	if vsErr, ok := err.(*VectorStoreError); ok {
		return vsErr.Code == ErrCodeCollectionNotFound || vsErr.Code == ErrCodeIndexNotFound
	}
	return false
}

// IsExistsError 判断是否为已存在错误
func IsExistsError(err error) bool {
	if vsErr, ok := err.(*VectorStoreError); ok {
		return vsErr.Code == ErrCodeCollectionExists || vsErr.Code == ErrCodeIndexExists
	}
	return false
}
