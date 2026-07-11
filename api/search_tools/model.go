package search_tools

import (
	"context"
	"time"

	"github.com/53AI/53AIHub/model"
)

type Searcher interface {
	Search(query string, count int) ([]*SearchItem, error)
}

type BatchSearcher interface {
	SearchBatch(ctx context.Context, queries []string, count int) (*SearchResult, error)
}

type SearchItem struct {
	ChunkID       int64   `json:"chunk_id"`
	FileID        int64   `json:"file_id"`
	LibraryID     int64   `json:"library_id"`
	FilePath      string  `json:"file_path"`
	FileName      string  `json:"file_name"`
	LibraryName   string  `json:"library_name"`
	LibraryIcon   string  `json:"library_icon"`
	FileCreatedAt int64   `json:"file_created_at,omitempty"`
	SpaceID       int64   `json:"space_id,omitempty"`
	SpaceName     string  `json:"space_name,omitempty"`
	ChunkType     string  `json:"chunk_type"`
	Content       string  `json:"content"`
	Score         float64 `json:"score"`
}

type SearchConfig struct {
	Wsc *WebSearchConfig
	Rsc *RagConfig
}

type WebSearchConfig struct {
	ApiType string `json:"api_type"`
	ApiKey  string `json:"api_key"`
}

// RagConfig RAG搜索配置
type RagConfig struct {
	Type           string                  `json:"type"`          // vector/fulltext/hybrid
	LibraryIDs     []int64                 `json:"library_ids"`   // 知识库ID列表
	FileIDs        []int64                 `json:"file_ids"`      // 文件ID列表
	ChunkTypes     []string                `json:"chunk_types"`   // 分片类型列表
	SearchConfig   *model.SearchConfigData `json:"search_config"` // 搜索详细配置
	EntityKeywords []string                `json:"entity_keywords,omitempty"`
	DocumentType   string                  `json:"document_type,omitempty"`
}

type WebSearcher struct {
	C *SearchConfig
}

// 搜索结果结构
type SearchResult struct {
	Items  []*SearchItem `json:"items"`  // 合并后的所有搜索结果
	Errors []error       `json:"errors"` // 搜索过程中的错误
}

const RAG_MAX_WORKERS_DEFAULT = 3
const RAG_TIMEOUT_DEFAULT = 3 * 10 * time.Second

// 引擎配置选项
type EngineOption func(*Engine)

func WithMaxWorkers(workers int) EngineOption {
	return func(e *Engine) {
		e.maxWorkers = workers
	}
}

func WithTimeout(timeout time.Duration) EngineOption {
	return func(e *Engine) {
		e.timeout = timeout
	}
}
