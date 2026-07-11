package common

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/53AI/53AIHub/common/logger"
	"github.com/53AI/53AIHub/config"
	"github.com/go-redis/redis/v8"
)

var RDB redis.Cmdable
var RedisEnabled = true
var ErrRedisNotEnabled = errors.New("redis is not enabled")

// ErrRedisNil 透出 go-redis 的 redis.Nil，以便业务侧用 errors.Is 判断
var ErrRedisNil = redis.Nil

// InitRedisClient
func InitRedisClient() error {
	if config.REDIS_CONN == "" {
		RedisEnabled = false
		logger.SysLog("REDIS_CONN not set, Redis is not enabled")
		return nil
	}

	logger.SysLog("Redis is enabled")
	opt, err := redis.ParseURL(config.REDIS_CONN)
	if err != nil {
		logger.FatalLog("Redis connection error: " + err.Error())
	}

	// 配置连接池参数
	opt.PoolSize = config.REDIS_POOL_SIZE
	opt.MinIdleConns = config.REDIS_MIN_IDLE_CONNS
	opt.MaxRetries = config.REDIS_MAX_RETRIES
	opt.DialTimeout = time.Duration(config.REDIS_DIAL_TIMEOUT_SECONDS) * time.Second
	opt.ReadTimeout = time.Duration(config.REDIS_READ_TIMEOUT_SECONDS) * time.Second
	opt.WriteTimeout = time.Duration(config.REDIS_WRITE_TIMEOUT_SECONDS) * time.Second
	opt.IdleTimeout = time.Duration(config.REDIS_IDLE_TIMEOUT_MINUTES) * time.Minute
	opt.MaxConnAge = time.Duration(config.REDIS_MAX_CONN_AGE_MINUTES) * time.Minute

	RDB = redis.NewClient(opt)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err = RDB.Ping(ctx).Result()
	if err != nil {
		logger.FatalLog("Redis test failed: " + err.Error())
	}

	// 记录连接池配置信息
	logger.SysLog(fmt.Sprintf("Redis connection pool configured - PoolSize: %d, MinIdleConns: %d, MaxRetries: %d",
		opt.PoolSize, opt.MinIdleConns, opt.MaxRetries))
	logger.SysLog(fmt.Sprintf("Redis timeouts configured - Dial: %ds, Read: %ds, Write: %ds, Idle: %dm, MaxConnAge: %dm",
		config.REDIS_DIAL_TIMEOUT_SECONDS, config.REDIS_READ_TIMEOUT_SECONDS, config.REDIS_WRITE_TIMEOUT_SECONDS,
		config.REDIS_IDLE_TIMEOUT_MINUTES, config.REDIS_MAX_CONN_AGE_MINUTES))

	return err
}

// checkRedisEnabled checks if Redis is enabled and logs a warning if not
// Returns true if Redis is enabled, false otherwise
func checkRedisEnabled() bool {
	if !RedisEnabled || RDB == nil {
		logger.SysWarn("Redis operation attempted but Redis is not enabled")
		return false
	}
	return true
}

func IsRedisEnabled() bool {
	return RedisEnabled
}

func RedisSet(key string, value string, expiration time.Duration) error {
	if !checkRedisEnabled() {
		return ErrRedisNotEnabled
	}
	ctx := context.Background()
	return RDB.Set(ctx, key, value, expiration).Err()
}

func RedisGet(key string) (string, error) {
	if !checkRedisEnabled() {
		return "", ErrRedisNotEnabled
	}
	ctx := context.Background()
	return RDB.Get(ctx, key).Result()
}

func RedisDel(key string) error {
	if !checkRedisEnabled() {
		return ErrRedisNotEnabled
	}
	ctx := context.Background()
	return RDB.Del(ctx, key).Err()
}

// RedisDelByPattern deletes keys matched by a Redis SCAN pattern.
func RedisDelByPattern(pattern string) (int64, error) {
	if !checkRedisEnabled() {
		return 0, ErrRedisNotEnabled
	}

	ctx := context.Background()
	iter := RDB.Scan(ctx, 0, pattern, 500).Iterator()
	keys := make([]string, 0, 500)
	var deleted int64

	flush := func() error {
		if len(keys) == 0 {
			return nil
		}
		n, err := RDB.Del(ctx, keys...).Result()
		if err != nil {
			return err
		}
		deleted += n
		keys = keys[:0]
		return nil
	}

	for iter.Next(ctx) {
		keys = append(keys, iter.Val())
		if len(keys) >= 500 {
			if err := flush(); err != nil {
				return deleted, err
			}
		}
	}
	if err := iter.Err(); err != nil {
		return deleted, err
	}
	if err := flush(); err != nil {
		return deleted, err
	}
	return deleted, nil
}

// RedisDelPermissionCacheByResourceIDs deletes permission cache entries for a resource type and resource IDs.
func RedisDelPermissionCacheByResourceIDs(eid int64, resourceType int, resourceIDs []int64) (int64, error) {
	if !checkRedisEnabled() {
		return 0, ErrRedisNotEnabled
	}

	uniqueIDs := make(map[int64]struct{}, len(resourceIDs))
	for _, resourceID := range resourceIDs {
		if resourceID > 0 {
			uniqueIDs[resourceID] = struct{}{}
		}
	}
	if len(uniqueIDs) == 0 {
		return 0, nil
	}

	pattern := fmt.Sprintf("Cache:permission:user:*:resource:%d:%d:*", eid, resourceType)
	ctx := context.Background()
	iter := RDB.Scan(ctx, 0, pattern, 500).Iterator()
	keys := make([]string, 0, 500)
	var deleted int64

	flush := func() error {
		if len(keys) == 0 {
			return nil
		}
		n, err := RDB.Del(ctx, keys...).Result()
		if err != nil {
			return err
		}
		deleted += n
		keys = keys[:0]
		return nil
	}

	for iter.Next(ctx) {
		key := iter.Val()
		parts := strings.Split(key, ":")
		if len(parts) != 8 {
			continue
		}
		resourceID, err := strconv.ParseInt(parts[7], 10, 64)
		if err != nil {
			continue
		}
		if _, ok := uniqueIDs[resourceID]; !ok {
			continue
		}
		keys = append(keys, key)
		if len(keys) >= 500 {
			if err := flush(); err != nil {
				return deleted, err
			}
		}
	}
	if err := iter.Err(); err != nil {
		return deleted, err
	}
	if err := flush(); err != nil {
		return deleted, err
	}

	return deleted, nil
}

func RedisDecrease(key string, value int64) error {
	if !checkRedisEnabled() {
		return ErrRedisNotEnabled
	}
	ctx := context.Background()
	return RDB.DecrBy(ctx, key, value).Err()
}

// RedisSetInt64 sets an integer value in Redis with expiration
func RedisSetInt64(key string, value int64, expirationSeconds int64) error {
	if !checkRedisEnabled() {
		return ErrRedisNotEnabled
	}
	ctx := context.Background()
	return RDB.Set(ctx, key, value, time.Duration(expirationSeconds)*time.Second).Err()
}

// RedisGetInt64 gets an integer value from Redis
func RedisGetInt64(key string) (int64, error) {
	if !checkRedisEnabled() {
		return 0, ErrRedisNotEnabled
	}
	ctx := context.Background()
	result, err := RDB.Get(ctx, key).Result()
	if err != nil {
		return 0, err
	}
	return strconv.ParseInt(result, 10, 64)
}

// RedisMGetInt64 批量获取 int64 值，不存在或解析失败的 key 会被忽略
func RedisMGetInt64(keys []string) (map[string]int64, error) {
	if !checkRedisEnabled() {
		return nil, ErrRedisNotEnabled
	}
	result := make(map[string]int64, len(keys))
	if len(keys) == 0 {
		return result, nil
	}

	ctx := context.Background()
	values, err := RDB.MGet(ctx, keys...).Result()
	if err != nil {
		return nil, err
	}

	for i := range values {
		if values[i] == nil {
			continue
		}
		switch v := values[i].(type) {
		case int64:
			result[keys[i]] = v
		case int:
			result[keys[i]] = int64(v)
		case uint64:
			result[keys[i]] = int64(v)
		case string:
			if parsed, parseErr := strconv.ParseInt(v, 10, 64); parseErr == nil {
				result[keys[i]] = parsed
			}
		case []byte:
			if parsed, parseErr := strconv.ParseInt(string(v), 10, 64); parseErr == nil {
				result[keys[i]] = parsed
			}
		default:
			valueStr := fmt.Sprintf("%v", values[i])
			if parsed, parseErr := strconv.ParseInt(valueStr, 10, 64); parseErr == nil {
				result[keys[i]] = parsed
			}
		}
	}
	return result, nil
}

// RedisMSetInt64 批量写入 int64 值（统一过期时间）
func RedisMSetInt64(values map[string]int64, expirationSeconds int64) error {
	if !checkRedisEnabled() {
		return ErrRedisNotEnabled
	}
	if len(values) == 0 {
		return nil
	}

	ctx := context.Background()
	pipe := RDB.Pipeline()
	exp := time.Duration(expirationSeconds) * time.Second
	for key, value := range values {
		pipe.Set(ctx, key, value, exp)
	}
	_, err := pipe.Exec(ctx)
	return err
}

// RedisZAdd adds a member to a sorted set
// key: the key of the sorted set
// score: the score used for ordering
// member: the member to be added
// Returns the number of new members added and any error that occurred
func RedisZAdd(key string, score int64, member string) (int64, error) {
	if !checkRedisEnabled() {
		return 0, ErrRedisNotEnabled
	}
	ctx := context.Background()
	z := redis.Z{
		Score:  float64(score),
		Member: member,
	}
	return RDB.ZAdd(ctx, key, &z).Result()
}

// RedisZRangeByScore gets elements within a score range from a sorted set
// key: the key of the sorted set
// min: minimum score
// max: maximum score
// Returns all members in the specified range and any error that occurred
func RedisZRangeByScore(key string, min, max int64) ([]string, error) {
	if !checkRedisEnabled() {
		return nil, ErrRedisNotEnabled
	}
	ctx := context.Background()
	opt := &redis.ZRangeBy{
		Min: strconv.FormatInt(min, 10),
		Max: strconv.FormatInt(max, 10),
	}
	return RDB.ZRangeByScore(ctx, key, opt).Result()
}

// RedisZRem removes a member from a sorted set
// key: the key of the sorted set
// member: the member to be removed
// Returns the number of members removed and any error that occurred
func RedisZRem(key string, member string) (int64, error) {
	if !checkRedisEnabled() {
		return 0, ErrRedisNotEnabled
	}
	ctx := context.Background()
	return RDB.ZRem(ctx, key, member).Result()
}

// RedisZRemRangeByScore removes all elements within a score range from a sorted set
// key: the key of the sorted set
// min: minimum score
// max: maximum score
// Returns the number of members removed and any error that occurred
func RedisZRemRangeByScore(key string, min, max int64) (int64, error) {
	if !checkRedisEnabled() {
		return 0, ErrRedisNotEnabled
	}
	ctx := context.Background()
	return RDB.ZRemRangeByScore(ctx, key, strconv.FormatInt(min, 10), strconv.FormatInt(max, 10)).Result()
}

// RedisZCount counts the number of elements within a score range in a sorted set
// key: the key of the sorted set
// min: minimum score
// max: maximum score
// Returns the count of members in the specified range and any error that occurred
func RedisZCount(key string, min, max int64) (int64, error) {
	if !checkRedisEnabled() {
		return 0, ErrRedisNotEnabled
	}
	ctx := context.Background()
	return RDB.ZCount(ctx, key, strconv.FormatInt(min, 10), strconv.FormatInt(max, 10)).Result()
}

// RedisExists checks if a key exists
// key: the key to check
// Returns the number of existing keys and any error that occurred
func RedisExists(key string) (int64, error) {
	if !checkRedisEnabled() {
		return 0, ErrRedisNotEnabled
	}
	ctx := context.Background()
	return RDB.Exists(ctx, key).Result()
}

// RedisExpire sets an expiration time for a key
// key: the key to set expiration for
// expiration: the expiration duration
// Returns whether the expiration was set successfully and any error that occurred
func RedisExpire(key string, expiration time.Duration) (bool, error) {
	if !checkRedisEnabled() {
		return false, ErrRedisNotEnabled
	}
	ctx := context.Background()
	return RDB.Expire(ctx, key, expiration).Result()
}

// LogRedisPoolStats 记录Redis连接池状态统计信息
func LogRedisPoolStats() {
	if !RedisEnabled || RDB == nil {
		return
	}

	// 尝试获取连接池统计信息
	if client, ok := RDB.(*redis.Client); ok {
		stats := client.PoolStats()
		logger.SysLog(fmt.Sprintf("Redis Pool Stats - Hits: %d, Misses: %d, Timeouts: %d, TotalConns: %d, IdleConns: %d, StaleConns: %d",
			stats.Hits, stats.Misses, stats.Timeouts, stats.TotalConns, stats.IdleConns, stats.StaleConns))
	}
}

// GetRedisPoolStats 获取Redis连接池状态信息
func GetRedisPoolStats() map[string]interface{} {
	if !RedisEnabled || RDB == nil {
		return map[string]interface{}{
			"enabled": false,
		}
	}

	result := map[string]interface{}{
		"enabled": true,
	}

	if client, ok := RDB.(*redis.Client); ok {
		stats := client.PoolStats()
		result["hits"] = stats.Hits
		result["misses"] = stats.Misses
		result["timeouts"] = stats.Timeouts
		result["total_conns"] = stats.TotalConns
		result["idle_conns"] = stats.IdleConns
		result["stale_conns"] = stats.StaleConns
	}

	return result
}
