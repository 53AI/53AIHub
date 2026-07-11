package rag

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
)

var (
	embeddingSingleflight singleflightGroup
	_                     singleflightGroup = (*syncSingleflight)(nil)
)

type singleflightGroup interface {
	Do(key string, fn func() (interface{}, error)) (interface{}, error)
}

type syncSingleflight struct {
	mu sync.Mutex
	m  map[string]*singleflightCall
}

type singleflightCall struct {
	wg  sync.WaitGroup
	val interface{}
	err error
}

func newSyncSingleflight() *syncSingleflight {
	return &syncSingleflight{m: make(map[string]*singleflightCall)}
}

func (s *syncSingleflight) Do(key string, fn func() (interface{}, error)) (interface{}, error) {
	s.mu.Lock()
	if s.m == nil {
		s.m = make(map[string]*singleflightCall)
	}
	if c, ok := s.m[key]; ok {
		s.mu.Unlock()
		c.wg.Wait()
		return c.val, c.err
	}
	c := &singleflightCall{}
	c.wg.Add(1)
	s.m[key] = c
	s.mu.Unlock()

	c.val, c.err = fn()
	c.wg.Done()

	s.mu.Lock()
	delete(s.m, key)
	s.mu.Unlock()

	return c.val, c.err
}

func init() {
	embeddingSingleflight = newSyncSingleflight()
}

const queryEmbeddingCacheTTL = 24 * time.Hour

func buildQueryEmbeddingCacheKey(eid int64, query string, channelID int64, modelName string) string {
	if eid <= 0 || channelID <= 0 || modelName == "" {
		return ""
	}
	queryHash := sha256.Sum256([]byte(query))
	modelHash := sha256.Sum256([]byte(modelName))
	return fmt.Sprintf("Cache:rag:query_embedding:eid:%d:ch:%d:m:%s:q:%s",
		eid,
		channelID,
		hex.EncodeToString(modelHash[:]),
		hex.EncodeToString(queryHash[:]),
	)
}

func (s *EmbeddingService) getCachedQueryEmbedding(cacheKey string) ([]float64, bool) {
	if cacheKey == "" || !common.IsRedisEnabled() {
		return nil, false
	}

	cacheValue, err := common.RedisGet(cacheKey)
	if err != nil {
		if errors.Is(err, common.ErrRedisNil) || errors.Is(err, common.ErrRedisNotEnabled) {
			return nil, false
		}
		logger.Warnf(context.Background(), "【缓存】读取查询向量缓存失败: key=%s, err=%v", cacheKey, err)
		return nil, false
	}
	if cacheValue == "" {
		return nil, false
	}

	var vector []float64
	if err := json.Unmarshal([]byte(cacheValue), &vector); err != nil {
		logger.Warnf(context.Background(), "【缓存】解析查询向量缓存失败: key=%s, err=%v", cacheKey, err)
		return nil, false
	}
	if len(vector) == 0 {
		return nil, false
	}
	logger.Infof(context.Background(), "【缓存】查询向量缓存命中: key=%s, dim=%d", cacheKey, len(vector))
	return vector, true
}

func (s *EmbeddingService) setCachedQueryEmbedding(cacheKey string, vector []float64) {
	if cacheKey == "" || !common.IsRedisEnabled() || len(vector) == 0 {
		return
	}

	cacheBytes, err := json.Marshal(vector)
	if err != nil {
		logger.Warnf(context.Background(), "【缓存】序列化查询向量缓存失败: key=%s, err=%v", cacheKey, err)
		return
	}

	if err := common.RedisSet(cacheKey, string(cacheBytes), queryEmbeddingCacheTTL); err != nil {
		if errors.Is(err, common.ErrRedisNotEnabled) {
			return
		}
		logger.Warnf(context.Background(), "【缓存】写入查询向量缓存失败: key=%s, err=%v", cacheKey, err)
	}
}
