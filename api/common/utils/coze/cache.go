package coze

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/53AI/53AIHub/common"
	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/model"
)

// CachedTokenInfo stores the full token info in Redis cache
type CachedTokenInfo struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	AuthedTime   int64  `json:"authed_time"`
}

// BuildTokenCacheKey builds Redis cache key for Coze token info
func BuildTokenCacheKey(eid int64, providerID int64, providerType int64) string {
	return fmt.Sprintf("coze:token:%d:%d:%d", eid, providerID, providerType)
}

// GetCachedToken reads cached token info from Redis.
// Returns nil if cache miss or error (caller should fall back to DB).
func GetCachedToken(key string) *CachedTokenInfo {
	val, err := common.RedisGet(key)
	if err != nil {
		return nil
	}
	var info CachedTokenInfo
	if err := json.Unmarshal([]byte(val), &info); err != nil {
		logger.SysErrorf("【cozetoken 刷新】cache反序列化失败: key=%s, err=%v", key, err)
		return nil
	}
	return &info
}

// SetCachedToken writes token info to Redis cache.
// TTL = expiryUnix - now - 30s. Minimum 10s, maximum 24h.
// Returns error only for unexpected failures; cache write failure is non-fatal.
func SetCachedToken(key string, provider *model.Provider) error {
	expiryUnix := GetTokenExpiryUnix(provider)
	ttlSeconds := expiryUnix - time.Now().Unix() - 30
	if ttlSeconds < 10 {
		ttlSeconds = 10
	}
	if ttlSeconds > 86400 {
		ttlSeconds = 86400
	}
	ttl := time.Duration(ttlSeconds) * time.Second

	info := CachedTokenInfo{
		AccessToken:  provider.AccessToken,
		RefreshToken: provider.RefreshToken,
		ExpiresIn:    provider.ExpiresIn,
		AuthedTime:   provider.AuthedTime,
	}
	data, err := json.Marshal(info)
	if err != nil {
		return err
	}
	return common.RedisSet(key, string(data), ttl)
}

// DeleteCachedToken removes the cached token info from Redis.
func DeleteCachedToken(key string) error {
	return common.RedisDel(key)
}

// ApplyCachedToken applies cached token info to a provider struct.
func ApplyCachedToken(provider *model.Provider, info *CachedTokenInfo) {
	provider.AccessToken = info.AccessToken
	provider.RefreshToken = info.RefreshToken
	provider.ExpiresIn = info.ExpiresIn
	provider.AuthedTime = info.AuthedTime
}
