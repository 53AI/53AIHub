package search_tools

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common/logger"
)

// 搜索引擎结构
type Engine struct {
	searcher   Searcher
	maxWorkers int
	timeout    time.Duration
}

// 新建搜索引擎
func NewEngine(searcher Searcher, options ...EngineOption) *Engine {
	engine := &Engine{
		searcher:   searcher,
		maxWorkers: 5,                // 默认最大并发数
		timeout:    30 * time.Second, // 默认超时时间
	}

	// 应用配置选项
	for _, option := range options {
		option(engine)
	}

	return engine
}

// 并发搜索多个查询并合并结果
func (e *Engine) SearchMulti(queries []string, count int) (*SearchResult, error) {
	if len(queries) == 0 {
		return &SearchResult{
			Items:  []*SearchItem{},
			Errors: []error{fmt.Errorf("queries is empty")},
		}, nil
	}

	var (
		ctx    context.Context
		cancel context.CancelFunc
	)
	if e.timeout > 0 {
		ctx, cancel = context.WithTimeout(context.Background(), e.timeout)
	} else {
		ctx, cancel = context.WithCancel(context.Background())
	}
	defer cancel()

	validQueries := 0
	for _, q := range queries {
		if strings.TrimSpace(q) != "" {
			validQueries++
		}
	}

	if batchSearcher, ok := e.searcher.(BatchSearcher); ok && validQueries > 1 {
		logger.SysLogf("【搜索引擎】使用批量搜索: query_count=%d, max_workers=%d", validQueries, e.maxWorkers)
		batchDone := make(chan struct {
			result *SearchResult
			err    error
		}, 1)
		go func() {
			result, err := batchSearcher.SearchBatch(ctx, queries, count)
			batchDone <- struct {
				result *SearchResult
				err    error
			}{result: result, err: err}
		}()

		select {
		case res := <-batchDone:
			return res.result, res.err
		case <-ctx.Done():
			return nil, fmt.Errorf("overall search timeout: %v", ctx.Err())
		}
	}

	var libraryCount, fileCount int
	if ragSearcher, ok := e.searcher.(*RagSearcher); ok {
		config := ragSearcher.getConfigSnapshot()
		libraryCount = len(config.LibraryIDs)
		fileCount = len(config.FileIDs)
	}
	logger.SysLogf("【搜索引擎】开始并发搜索: query_count=%d, library_count=%d, file_count=%d, max_workers=%d",
		validQueries, libraryCount, fileCount, e.maxWorkers)

	var mu sync.Mutex
	var allItems []*SearchItem
	var errors []error

	semaphore := make(chan struct{}, e.maxWorkers)
	var wg sync.WaitGroup

	for _, query := range queries {
		if strings.TrimSpace(query) == "" {
			continue
		}

		wg.Add(1)
		go func(q string) {
			defer wg.Done()

			select {
			case semaphore <- struct{}{}:
				defer func() { <-semaphore }()
			case <-ctx.Done():
				mu.Lock()
				errors = append(errors, fmt.Errorf("query '%s' canceled due to timeout: %v", q, ctx.Err()))
				mu.Unlock()
				return
			}

			items, err := e.searchWithTimeout(ctx, q, count)

			mu.Lock()
			if err != nil {
				errors = append(errors, fmt.Errorf("query '%s': %v", q, err))
			} else {
				allItems = append(allItems, items...)
			}
			mu.Unlock()
		}(query)
	}

	wg.Wait()
	if e.timeout > 0 && ctx.Err() != nil {
		errors = append(errors, fmt.Errorf("overall search timeout: %v", ctx.Err()))
	}

	dedupedItems := e.deduplicate(allItems)
	if count > 0 && len(dedupedItems) > count {
		dedupedItems = dedupedItems[:count]
	}

	logger.SysLogf("【搜索引擎】并发搜索完成: query_count=%d, total_results=%d, after_dedup=%d, errors=%d",
		validQueries, len(allItems), len(dedupedItems), len(errors))

	return &SearchResult{
		Items:  dedupedItems,
		Errors: errors,
	}, nil
}

// 带超时的搜索方法
func (e *Engine) searchWithTimeout(ctx context.Context, query string, count int) ([]*SearchItem, error) {
	type result struct {
		items []*SearchItem
		err   error
	}

	resultChan := make(chan result, 1)

	go func() {
		items, err := e.searcher.Search(query, count)
		resultChan <- result{items: items, err: err}
	}()

	select {
	case res := <-resultChan:
		return res.items, res.err
	case <-ctx.Done():
		return nil, fmt.Errorf("search timeout for query '%s'", query)
	}
}

// 去重方法（基于 Content 内容）
func (e *Engine) deduplicate(items []*SearchItem) []*SearchItem {
	return deduplicateSearchItems(items)
}
