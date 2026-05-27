package rag

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
)

const queryEmbeddingCacheTTL = 24 * time.Hour

func buildQueryEmbeddingCacheKey(eid int64, query string, channelID int64) string {
	if eid <= 0 || channelID <= 0 {
		return ""
	}
	hash := sha256.Sum256([]byte(query))
	return fmt.Sprintf("Cache:rag:query_embedding:eid:%d:ch:%d:q:%s", eid, channelID, hex.EncodeToString(hash[:]))
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
